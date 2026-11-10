import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { RUNNER_POLICY, RunnerChallenge, RunnerProfile, RunnerRequest } from '../../../entities/runner/model/queryJob';
import { parseEngineObservation } from '../../../entities/runner/model/receipt';
import { parseIsolationEvidence } from '../../../entities/runner/model/isolation';
import { jsonHash } from '../../../shared/lib/jsonContract';
import { TextDecoder } from 'node:util';

const KERNEL_PROBE = `import json,os,pathlib
p=pathlib.Path('/sys/fs/cgroup')
s=dict(line.split(':',1) for line in pathlib.Path('/proc/self/status').read_text().splitlines() if ':' in line)
ro=any(line.split()[4]=='/' and 'ro' in line.split()[5].split(',') for line in pathlib.Path('/proc/self/mountinfo').read_text().splitlines())
print(json.dumps(dict(uid=os.getuid(),memory=(p/'memory.max').read_text().strip(),swap=(p/'memory.swap.max').read_text().strip(),pids=(p/'pids.max').read_text().strip(),cpu=(p/'cpu.max').read_text().strip(),seccomp=s['Seccomp'].strip(),noNewPrivileges=s['NoNewPrivs'].strip(),capabilities=s['CapEff'].strip(),rootReadOnly=ro,interfaces=sorted(os.listdir('/sys/class/net')))))`;

export type DockerCommand = (args: readonly string[], input: string | undefined, timeoutMs: number, signal?: AbortSignal) => Promise<string>;

export const runDockerCommand: DockerCommand = (args, input, timeoutMs, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Runner job cancelled.')); return; }
    const child = spawn('docker', [...args], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } });
    const output: Buffer[] = [], errors: Buffer[] = [];
    let bytes = 0, errorBytes = 0, failure: Error | undefined;
    const stop = (reason: string) => { failure ??= new Error(reason); child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop('Docker command exceeded its deadline.'), timeoutMs);
    const cancel = () => stop('Runner job cancelled.');
    signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) stop('Docker output exceeds 2 MiB.'); else output.push(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { errorBytes += chunk.length; if (errorBytes > 32768) stop('Docker diagnostics exceed 32 KiB.'); else errors.push(chunk); });
    child.stdin.on('error', () => { /* exit/error below is authoritative */ });
    const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    child.once('error', error => { clean(); reject(error); });
    child.once('close', code => {
        clean();
        if (failure) reject(failure);
        else if (code !== 0) reject(new Error(`Docker command failed (${code}): ${Buffer.concat(errors).toString('utf8').slice(-1000)}`));
        else {
            try { resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(output))); }
            catch { reject(new Error('Docker returned invalid UTF-8.')); }
        }
    });
    child.stdin.end(input);
});

/** No caller-provided executable, arguments, host mounts, ports, paths or image tags. */
export class DockerQueryRuntime {
    constructor(private readonly command: DockerCommand = runDockerCommand) {}

    async execute(request: RunnerRequest, profile: RunnerProfile, challenge: RunnerChallenge, signal?: AbortSignal) {
        const name = 'copilot-query-' + randomUUID();
        const remaining = () => {
            if (signal?.aborted) throw new Error('Runner job cancelled.');
            const value = Date.parse(challenge.deadlineAt) - Date.now();
            if (value <= 0) throw new Error('Runner job exceeded its lease.');
            return value;
        };
        const call = (args: string[], input?: string) => this.command(args, input, Math.min(30000, remaining()), signal);
        const info = JSON.parse(await call(['info', '--format', '{{json .}}']));
        if (info.CgroupVersion !== '2' || !info.MemoryLimit || !info.SwapLimit || !info.CpuCfsQuota || !info.PidsLimit ||
            !info.SecurityOptions?.some((item: string) => item.startsWith('name=seccomp'))) throw new Error('Required Docker limits/seccomp are unavailable.');
        const owner = 'normahub.copilot.nonce';
        let cleanupNeeded = false;
        try {
            cleanupNeeded = true; // create can succeed in the daemon even when its client is interrupted.
            await call(['create', '--rm', '--pull', 'never', '--name', name, '--label', `${owner}=${challenge.nonce}`, '--network', 'none', '--read-only',
                '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true', '--pids-limit', String(RUNNER_POLICY.pids),
                '--memory', String(RUNNER_POLICY.memoryBytes), '--memory-swap', String(RUNNER_POLICY.memoryBytes), '--cpus', '1',
                '--user', RUNNER_POLICY.user, '--ipc', 'private', '--cgroupns', 'private', '--ulimit', 'nofile=1024:1024',
                '--tmpfs', '/work:rw,nosuid,nodev,size=805306368,uid=10001,gid=10001,mode=0700',
                '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456,mode=1777',
                '--env', 'HOME=/work/home', '--env', 'LANG=ru_RU.UTF-8', '--env', 'LC_ALL=ru_RU.UTF-8',
                '--entrypoint', '/usr/bin/timeout', profile.imageId, '--signal=KILL', String(RUNNER_POLICY.containerLifetimeSeconds),
                '/usr/bin/python3', '/runner/worker.py', '--idle']);
            const inspection = JSON.parse(await call(['inspect', name]))[0];
            assertContainerPolicy(inspection, profile.imageId, challenge.nonce);
            await call(['start', name]);
            const isolation = parseIsolationEvidence(JSON.parse(await call(['exec', name, '/usr/bin/python3', '-c', KERNEL_PROBE])));
            const response = await this.command(['exec', '-i', name, '/usr/bin/python3', '/runner/worker.py'],
                JSON.stringify({ schemaVersion: request.schemaVersion, nonce: challenge.nonce, query: request.query,
                    ...(request.schemaVersion === 2 ? { parameters: request.parameters, parametersHash: jsonHash(request.parameters) } : {}) }), remaining(), signal);
            const observation = parseEngineObservation(JSON.parse(response));
            remaining();
            return { engine: observation, isolation };
        } finally {
            if (cleanupNeeded) {
                // Cleanup has its own bounded deadline and survives user cancellation.
                const raw = await this.command(['container', 'ls', '-a', '--filter', `name=^/${name}$`, '--format', '{{json .}}'], undefined, 15000);
                if (raw.trim()) {
                    const inspection = JSON.parse(await this.command(['inspect', name], undefined, 15000))[0];
                    if (inspection.Config?.Labels?.[owner] !== challenge.nonce) throw new Error('Refusing cleanup of a container with a different owner.');
                    if (!/^[a-f0-9]{64}$/.test(inspection.Id)) throw new Error('Invalid owned container ID.');
                    await this.command(['rm', '--force', inspection.Id], undefined, 15000);
                }
            }
        }
    }
}

export function assertContainerPolicy(value: any, imageId: string, nonce: string): void {
    const h = value?.HostConfig, c = value?.Config;
    const allowedEnv = new Set(['PATH', 'HOME', 'LANG', 'LC_ALL']);
    if (!h || !c || value.Image !== imageId || c.Image !== imageId || c.User !== RUNNER_POLICY.user || c.Labels?.['normahub.copilot.nonce'] !== nonce ||
        h.NetworkMode !== 'none' || h.ReadonlyRootfs !== true || h.AutoRemove !== true || h.Privileged || h.Memory !== RUNNER_POLICY.memoryBytes ||
        h.MemorySwap !== RUNNER_POLICY.memoryBytes || h.NanoCpus !== RUNNER_POLICY.nanoCpus || h.PidsLimit !== RUNNER_POLICY.pids ||
        !h.CapDrop?.includes('ALL') || h.CapAdd?.length || !h.SecurityOpt?.includes('no-new-privileges=true') ||
        h.SecurityOpt.some((option: string) => /unconfined/.test(option)) || h.IpcMode !== 'private' || h.PidMode || h.CgroupnsMode !== 'private' ||
        h.Binds?.length || h.Devices?.length || h.DeviceRequests?.length || Object.keys(h.PortBindings || {}).length ||
        (value.Mounts || []).some((mount: any) => mount.Type !== 'tmpfs') ||
        Object.keys(h.Tmpfs || {}).sort().join(',') !== '/tmp,/work' ||
        h.Tmpfs['/work'] !== 'rw,nosuid,nodev,size=805306368,uid=10001,gid=10001,mode=0700' ||
        h.Tmpfs['/tmp'] !== 'rw,nosuid,nodev,size=268435456,mode=1777' ||
        JSON.stringify(c.Entrypoint) !== '["/usr/bin/timeout"]' ||
        JSON.stringify(c.Cmd) !== JSON.stringify(['--signal=KILL', String(RUNNER_POLICY.containerLifetimeSeconds), '/usr/bin/python3', '/runner/worker.py', '--idle']) ||
        (c.Env || []).some((env: string) => !allowedEnv.has(env.split('=')[0]))) throw new Error('Effective container policy does not match the fixed runner profile.');
}
