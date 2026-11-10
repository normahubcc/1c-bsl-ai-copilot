// Test the autonomous timeout/AutoRemove primitive without waiting the full production lifetime.
const assert = require('node:assert/strict'), fs = require('node:fs');
const { parseRunnerProfile, parseRunnerRequest, createRunnerChallenge } = require('../../out/entities/runner/model/queryJob');
const { DockerQueryRuntime, runDockerCommand } = require('../../out/features/run-query/api/dockerQueryRuntime');
const { request: makeRequest } = require('../helpers/runnerData');

(async () => {
    if (!process.argv[2] || !process.argv[3]) throw Error('Pass approved own profile and a new output JSON path.');
    const profile = parseRunnerProfile(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
    const request = parseRunnerRequest(makeRequest(profile)), challenge = createRunnerChallenge(request, profile);
    let captured;
    const capture = async args => {
        if (args[0] === 'info') return JSON.stringify({ CgroupVersion: '2', MemoryLimit: true, SwapLimit: true, CpuCfsQuota: true, PidsLimit: true, SecurityOptions: ['name=seccomp'] });
        if (args[0] === 'create') { captured = [...args]; throw Error('test capture'); }
        return '';
    };
    await assert.rejects(new DockerQueryRuntime(capture).execute(request, profile, challenge), /test capture/);
    const position = captured.indexOf('--signal=KILL') + 1;
    assert.ok(position > 0); assert.equal(captured[position], '180'); captured[position] = '2';
    const id = (await runDockerCommand(captured, undefined, 15000)).trim();
    assert.match(id, /^[a-f0-9]{64}$/);
    let removed = false;
    try {
        await runDockerCommand(['start', id], undefined, 15000);
        // The start client has exited; no controller remains to kill or remove this container.
        await new Promise(resolve => setTimeout(resolve, 3500));
        const remaining = await runDockerCommand(['container', 'ls', '-a', '--filter', 'label=normahub.copilot.nonce=' + challenge.nonce, '--format', '{{.ID}}'], undefined, 15000);
        assert.equal(remaining.trim(), '', 'Autonomous timeout/AutoRemove did not remove the own container');
        removed = true;
        const report = { passed: true, productionLifetimeSeconds: 180, shortenedPrimitiveTestSeconds: 2,
            controllerNeededAfterStart: false, autoRemoved: true, imageId: profile.imageId,
            limitation: 'This is a shortened timeout/AutoRemove primitive test, not durable crash/job recovery qualification.' };
        fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        console.log(JSON.stringify(report));
    } finally { if (!removed) await runDockerCommand(['rm', '--force', id], undefined, 15000).catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
