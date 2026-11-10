'use strict';
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { profile: makeProfile, request: makeRequest, isolation, table, hash } = require('./helpers/runnerData');
const { parseRunnerProfile, parseRunnerRequest, createRunnerChallenge, decodeQueryLiteral, assertSingleQuery } = require('../out/entities/runner/model/queryJob');
const { parseEngineObservation, signRunnerReceipt, verifyRunnerReceipt } = require('../out/entities/runner/model/receipt');
const { parseIsolationEvidence } = require('../out/entities/runner/model/isolation');
const { DockerQueryRuntime, assertContainerPolicy } = require('../out/features/run-query/api/dockerQueryRuntime');
const { executeQueryJob } = require('../out/app/runner/api/executeQueryJob');
const keys = crypto.generateKeyPairSync('ed25519');
const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const profile = parseRunnerProfile(makeProfile(keys.publicKey));
const raw = makeRequest(profile), request = parseRunnerRequest(raw), challenge = createRunnerChallenge(request, profile);
const observation = (nonce = challenge.nonce) => parseEngineObservation({ schemaVersion: 1, nonce, platformVersion: profile.platformVersion,
    binaryHash: profile.binaryHash, status: 'completed', actual: table(), reason: null, logHash: hash('own engine log') });
const start = challenge.createdAt, finish = new Date(Date.parse(start) + 1000).toISOString();
const signed = () => signRunnerReceipt(request, profile, challenge, observation(), isolation(), privatePem, start, finish);
const verify = (receipt = signed(), r = request, p = profile, c = challenge, pub = publicPem, now = Date.parse(finish) + 1) => verifyRunnerReceipt(receipt, r, p, c, pub, now);
const cases = [], test = (name, run) => cases.push({ name, run });

test('Plain/literal selection binds exact candidate code without evaluating surrounding BSL, including Cyrillic and CRLF', () => {
    const text = 'ВЫБРАТЬ\n"A" КАК Товар, 2 КАК Дефицит';
    const source = makeRequest(profile, text, true), parsed = parseRunnerRequest(source);
    assert.equal(parsed.query, text); assert.match(parsed.candidateCode, /SURROUNDING_BSL/);
    assert.equal(decodeQueryLiteral('"ВЫБРАТЬ\r\n  |1"'), 'ВЫБРАТЬ\n1');
    for (const literal of ['"SELECT', '"SELECT\n1"', '"SELECT" + " more"']) assert.throws(() => decodeQueryLiteral(literal));
    assertSingleQuery('// own comment\nВЫБРАТЬ ";" КАК Значение // ;\n');
    for (const text of ['ВЫБРАТЬЛИ 1', 'SELECTED 1', 'SELECT 1; SELECT 2', 'Сообщить("x");']) assert.throws(() => assertSingleQuery(text));
});
test('Candidate changes, overlong/malformed inputs, unpaired surrogates, foreign profiles and executable fields are rejected', () => {
    for (const mutate of [x => x.candidateCode += ' ', x => x.selection.end = 999999, x => x.selection.start = 1,
        x => x.command = 'sh', x => x.schemaVersion = 2, x => x.contract.approvalState = 'approved', x => x.candidateCode = '\ud800']) {
        const source = structuredClone(raw); mutate(source); assert.throws(() => parseRunnerRequest(source));
    }
    assert.throws(() => parseRunnerProfile({ ...profile, imageId: 'ubuntu:latest' }));
    assert.throws(() => createRunnerChallenge(request, { ...profile, metadataHash: hash('another schema') }));
});
test('Pinned Ed25519 receipt verifies only the selected-query scope and never authorizes source freshness, full BSL or apply', () => {
    const assessment = verify();
    assert.equal(assessment.queryExecutionVerified, true); assert.equal(assessment.signatureVerified, true);
    assert.equal(assessment.scope, 'selected_query_only'); assert.equal(assessment.executionVerified, false);
    assert.equal(assessment.approvalVerified, false); assert.equal(assessment.canApply, false);
    assert.equal(assessment.fullBslExecution, 'not_run'); assert.match(assessment.sourceFreshness, /revalidated/);
    assert.ok(Object.isFrozen(assessment));
});
test('Tampered data, unknown fields, self-supplied public keys, wrong pinned keys and algorithms cannot pass verification', () => {
    for (const mutate of [x => x.payload.observation.actual.rows[0][1].value = '999', x => x.payload.canApply = true,
        x => x.publicKey = publicPem, x => x.algorithm = 'none', x => x.signature = 'A'.repeat(88)]) {
        const receipt = structuredClone(signed()); mutate(receipt); assert.throws(() => verify(receipt));
    }
    const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    assert.throws(() => verify(signed(), request, profile, challenge, other), /not pinned/);
});
test('Every job/candidate/contract/profile replay mismatch is rejected even with an otherwise valid signature', () => {
    const receipt = signed();
    for (const mutate of [x => x.candidate.taskId = 'another-task', x => x.contract.intent += ' changed',
        x => x.contract.assertion.expected.rows[0][1].value = '3']) {
        const source = structuredClone(raw); mutate(source); assert.throws(() => verify(receipt, parseRunnerRequest(source)));
    }
    for (const key of ['nonce', 'requestHash', 'profileHash', 'policyHash']) assert.throws(() => verify(receipt, request, profile, { ...challenge, [key]: hash('wrong') }));
    assert.throws(() => verify(receipt, request, { ...profile, runnerId: 'another-runner' }));
});
test('Expired/future/failed engine evidence cannot become a current successful query check', () => {
    assert.equal(verify(signed(), request, profile, challenge, publicPem, Date.parse(finish) + 300000).queryExecutionVerified, false);
    assert.throws(() => verify(signed(), request, profile, challenge, publicPem, Date.parse(start)), /future/);
    const failed = { ...observation(), status: 'failed', actual: null, reason: 'Own controlled platform error' };
    const receipt = signRunnerReceipt(request, profile, challenge, failed, isolation(), privatePem, start, finish);
    assert.equal(verify(receipt).status, 'failed'); assert.equal(verify(receipt).queryExecutionVerified, false);
    assert.throws(() => parseEngineObservation({ ...failed, reason: null }));
    assert.throws(() => signRunnerReceipt(request, profile, challenge, observation(hash('wrong nonce')), isolation(), privatePem, start, finish));
});
test('Effective kernel evidence refuses root, absent limits, swap, capabilities, missing seccomp and network interfaces', () => {
    assert.ok(parseIsolationEvidence(isolation()));
    for (const mutate of [x => x.uid = 0, x => x.memory = 'max', x => x.swap = 'max', x => x.pids = 'max',
        x => x.cpu = 'max 100000', x => x.seccomp = '0', x => x.noNewPrivileges = '0', x => x.capabilities = 'a',
        x => x.rootReadOnly = false, x => x.interfaces.push('eth0')]) {
        const value = isolation(); mutate(value); assert.throws(() => parseIsolationEvidence(value));
    }
});

function inspection(nonce) {
    return { Id: 'e'.repeat(64), Image: profile.imageId,
        Config: { Image: profile.imageId, User: '10001:10001', Env: ['PATH=/usr/bin', 'HOME=/work/home'], Labels: { 'normahub.copilot.nonce': nonce },
            Entrypoint: ['/usr/bin/timeout'], Cmd: ['--signal=KILL', '180', '/usr/bin/python3', '/runner/worker.py', '--idle'] },
        Mounts: [], HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, AutoRemove: true, Privileged: false, Memory: 2147483648, MemorySwap: 2147483648,
            NanoCpus: 1000000000, PidsLimit: 256, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges=true'], IpcMode: 'private', CgroupnsMode: 'private', PidMode: '',
            Tmpfs: { '/work': 'rw,nosuid,nodev,size=805306368,uid=10001,gid=10001,mode=0700', '/tmp': 'rw,nosuid,nodev,size=268435456,mode=1777' } } };
}
test('Container inspection refuses host mounts, writable root, bridge networking, extra capabilities and secret environment', () => {
    assertContainerPolicy(inspection(challenge.nonce), profile.imageId, challenge.nonce);
    for (const mutate of [x => x.Mounts.push({ Type: 'bind' }), x => x.HostConfig.ReadonlyRootfs = false, x => x.HostConfig.NetworkMode = 'bridge',
        x => x.HostConfig.CapAdd = ['SYS_ADMIN'], x => x.Config.Env.push('NORMAHUB_API_KEY=forbidden'), x => x.HostConfig.Privileged = true,
        x => x.HostConfig.Tmpfs['/work'] = 'size=999g', x => x.HostConfig.Memory = 0, x => x.HostConfig.SecurityOpt.push('seccomp=unconfined'),
        x => x.Config.Cmd[1] = '999999', x => x.HostConfig.AutoRemove = false]) {
        const value = inspection(challenge.nonce); mutate(value); assert.throws(() => assertContainerPolicy(value, profile.imageId, challenge.nonce));
    }
});
function transport(options = {}) {
    const calls = []; let nonce, inspections = 0;
    const command = async (args, input, timeout, signal) => {
        calls.push({ args, input, timeout, signal });
        if (args[0] === 'info') return JSON.stringify({ CgroupVersion: '2', MemoryLimit: !options.noLimits, SwapLimit: true, CpuCfsQuota: true, PidsLimit: true, SecurityOptions: ['name=seccomp'] });
        if (args[0] === 'create') { nonce = args[args.indexOf('--label') + 1].split('=')[1]; return 'e'.repeat(64); }
        if (args[0] === 'inspect') return JSON.stringify([inspection(++inspections > 1 && options.foreignCleanup ? hash('foreign owner') : nonce)]);
        if (args[0] === 'exec' && args.includes('-c')) return JSON.stringify(isolation());
        if (args[0] === 'exec') {
            if (options.controller) { options.controller.abort(); throw Error('Runner job cancelled.'); }
            if (options.fail) throw Error('Own simulated execution timeout'); return JSON.stringify(observation(nonce));
        }
        if (args[0] === 'container') return '{}';
        return '';
    };
    return { calls, command };
}
test('Only a fixed sandbox is created, only query data crosses stdin, and owned container cleanup runs after success', async () => {
    const spy = transport(), output = await executeQueryJob(raw, profile, privatePem, new DockerQueryRuntime(spy.command));
    assert.equal(output.comparison.status, 'equal'); assert.equal(output.assessment.queryExecutionVerified, true);
    const create = spy.calls.find(x => x.args[0] === 'create').args;
    assert.ok(create.includes('--read-only') && create.includes('ALL')); assert.ok(!create.includes('--volume'));
    const input = JSON.parse(spy.calls.find(x => x.args[0] === 'exec' && x.args[1] === '-i').input);
    assert.deepEqual(Object.keys(input).sort(), ['nonce', 'query', 'schemaVersion']); assert.equal(input.query, request.query);
    assert.ok(!JSON.stringify(spy.calls).includes('PRIVATE KEY')); assert.equal(spy.calls.at(-1).args.join(' '), 'rm --force ' + 'e'.repeat(64));
});
test('Unavailable enforcement stops before create; timeout/cancel survives cleanup without creating a receipt', async () => {
    const unavailable = transport({ noLimits: true });
    await assert.rejects(executeQueryJob(raw, profile, privatePem, new DockerQueryRuntime(unavailable.command)), /unavailable/);
    assert.ok(!unavailable.calls.some(x => x.args[0] === 'create'));
    const failed = transport({ fail: true }); await assert.rejects(executeQueryJob(raw, profile, privatePem, new DockerQueryRuntime(failed.command)), /timeout/);
    assert.equal(failed.calls.at(-1).args[0], 'rm'); assert.equal(failed.calls.at(-1).signal, undefined);
    const controller = new AbortController(); controller.abort();
    const cancelled = transport(); await assert.rejects(executeQueryJob(raw, profile, privatePem, new DockerQueryRuntime(cancelled.command), controller.signal), /cancelled/);
    assert.equal(cancelled.calls.length, 0);
    const active = new AbortController(), aborting = transport({ controller: active });
    await assert.rejects(executeQueryJob(raw, profile, privatePem, new DockerQueryRuntime(aborting.command), active.signal), /cancelled/);
    assert.equal(aborting.calls.at(-1).args[0], 'rm'); assert.equal(aborting.calls.at(-1).signal, undefined);
    const foreign = transport({ foreignCleanup: true });
    await assert.rejects(executeQueryJob(raw, profile, privatePem, new DockerQueryRuntime(foreign.command)), /different owner/);
    assert.ok(!foreign.calls.some(call => call.args[0] === 'rm'), 'Never delete a differently owned container');
});
test('Real CLI initializes private keys outside the repo and refuses existing output, wrong flags and permissive private files', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-runner-cli-'));
    const cli = path.resolve(__dirname, '../dist/runner-cli.js');
    const invoke = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000 });
    try {
        const directory = path.join(base, 'keys'); let done = invoke(['init-key', '--directory', directory]);
        assert.equal(done.status, 0, done.stdout + done.stderr); assert.ok(JSON.parse(done.stdout).keyId);
        assert.equal((await fs.stat(path.join(directory, 'private.pem'))).mode & 0o077, 0);
        assert.equal(invoke(['init-key', '--directory', directory]).status, 1);
        assert.equal(invoke(['run', '--shell', 'forbidden']).status, 1);
        const profilePath = path.join(base, 'profile.json'), requestPath = path.join(base, 'request.json');
        await fs.writeFile(profilePath, JSON.stringify(profile)); await fs.writeFile(requestPath, JSON.stringify(raw));
        const privatePath = path.join(base, 'unsafe.pem'); await fs.writeFile(privatePath, privatePem, { mode: 0o644 });
        done = invoke(['run', '--profile', profilePath, '--request', requestPath, '--private-key', privatePath, '--output', path.join(base, 'output')]);
        assert.equal(done.status, 1); assert.match(done.stdout, /0600/);
    } finally { await fs.rm(base, { recursive: true, force: true }); }
});

(async () => { for (const { name, run } of cases) { await run(); console.log('  ✓ ' + name); }
    console.log(`Runner protocol and isolation: ${cases.length} groups passed; controlled Docker transport, real crypto/CLI; engine separate.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
