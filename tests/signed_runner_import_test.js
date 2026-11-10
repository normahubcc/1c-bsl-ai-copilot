'use strict';
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const { profile: makeProfile, request: makeRequest, table, isolation, hash } = require('./helpers/runnerData');
const { parseRunnerConnection } = require('../out/entities/runner/model/connection');
const { RunnerTrustStore } = require('../out/features/manage-runner-trust/model/runnerTrustStore');
const { RunnerSessions } = require('../out/features/runner-validation/model/runnerSessions');
const { formatSignedRunnerReport } = require('../out/features/runner-validation/model/formatReport');
const { parseRunnerRequest } = require('../out/entities/runner/model/queryJob');
const { parsePreparedQueryJob } = require('../out/entities/runner/model/preparedJob');
const { signRunnerReceipt } = require('../out/entities/runner/model/receipt');
const { executePreparedQueryJob } = require('../out/app/runner/api/executeQueryJob');
const { compareQueryResults } = require('../out/features/compare-query-results/model/compareResults');
const { translateText } = require('../out/shared/i18n/translator');
const keys = crypto.generateKeyPairSync('ed25519');
const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const profile = makeProfile(keys.publicKey);
const connection = { schemaVersion: 1, profile, publicKeyPem: publicPem };
function storage() {
    const map = new Map(); return { map, get(key) { return map.get(key); }, async update(key, value) { if (value === undefined) map.delete(key); else map.set(key, value); } };
}
async function setup() {
    const disk = storage(), trust = new RunnerTrustStore(disk); await trust.pin(profile.projectId, connection);
    let current = true, now = Date.now();
    const raw = makeRequest(profile, 'ВЫБРАТЬ "A" КАК Товар, 2 КАК Дефицит', true);
    const artifact = { identity: raw.candidate, code: raw.candidateCode, isCurrent: () => current };
    const plan = { schemaVersion: 1, operation: 'query_validation_plan', selection: raw.selection, contract: raw.contract };
    const sessions = new RunnerSessions(scope => trust.get(scope), () => now);
    const job = sessions.prepare('preview', artifact, plan);
    return { trust, disk, raw, artifact, plan, sessions, job, setCurrent(value) { current = value; }, setNow(value) { now = value; } };
}
function signed(job, actual = table(), delta = 0) {
    const request = parseRunnerRequest(job.request), time = new Date(Date.parse(job.challenge.createdAt) + delta).toISOString();
    const observation = { schemaVersion: 1, nonce: job.challenge.nonce, platformVersion: profile.platformVersion, binaryHash: profile.binaryHash,
        status: 'completed', actual, reason: null, logHash: hash('own controlled observation') };
    return { schemaVersion: 1, operation: 'signed_query_result', jobId: job.challenge.jobId,
        receipt: signRunnerReceipt(request, profile, job.challenge, observation, isolation(), privatePem, time, time) };
}
const cases = [], test = (name, run) => cases.push({ name, run });

test('Public connection normalizes SPKI and rejects private/RSA keys, unknown fields and a wrong fingerprint', () => {
    assert.equal(parseRunnerConnection(connection).publicKeyPem, publicPem);
    assert.ok(Object.isFrozen(parseRunnerConnection(connection).profile));
    for (const value of [{ ...connection, publicKeyPem: privatePem }, { ...connection, privateKey: privatePem },
        { ...connection, profile: { ...profile, keyId: hash('other-key') } }, { ...connection, schemaVersion: 2 }]) assert.throws(() => parseRunnerConnection(value));
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
    assert.throws(() => parseRunnerConnection({ ...connection, publicKeyPem: rsa }), /Ed25519/);
});
test('Pins persist only per host-selected scope; copies cannot mutate authority and reconnect rotates the revision', async () => {
    const { trust, disk } = await setup(), first = trust.get(profile.projectId);
    assert.equal(new RunnerTrustStore(disk).get(profile.projectId).revision, first.revision);
    assert.equal(trust.get(hash('another-project')), undefined);
    await assert.rejects(trust.pin(hash('another-project'), connection), /другому проекту/);
    await trust.pin(profile.projectId, connection); assert.notEqual(trust.get(profile.projectId).revision, first.revision);
    assert.ok(!JSON.stringify([...disk.map.values()]).includes('PRIVATE KEY'));
});
test('A failing Memento write remains fail closed even when it mutates its cache before rejecting', async () => {
    const disk = storage(), trust = new RunnerTrustStore(disk);
    disk.update = async (key, value) => { disk.map.set(key, value); throw Error('own persistence failure'); };
    await assert.rejects(trust.pin(profile.projectId, connection), /persistence/);
    assert.equal(trust.get(profile.projectId), undefined);
    assert.equal(new RunnerTrustStore(disk).get(profile.projectId), undefined);
    disk.update = async (key, value) => { disk.map.set(key, value); };
    await trust.pin(profile.projectId, connection); assert.ok(trust.get(profile.projectId));
});
test('Host creates request/challenge from the actual artifact; untrusted plans cannot replace identity, key or code', async () => {
    const { sessions, artifact, plan, job } = await setup();
    assert.deepEqual(job.request.candidate, artifact.identity); assert.equal(job.request.candidateCode, artifact.code);
    assert.ok(!('query' in job.request)); assert.ok(!('publicKeyPem' in job));
    for (const [key, value] of [['candidate', artifact.identity], ['candidateCode', 'ВЫБРАТЬ 0'], ['challenge', job.challenge], ['trusted', true]]) {
        assert.throws(() => sessions.prepare('bad', artifact, { ...plan, [key]: value }));
    }
    const next = sessions.prepare('preview', artifact, plan); assert.notEqual(job.challenge.nonce, next.challenge.nonce);
});
test('Matching signature is verified against the saved host job and keeps full-code/approval/apply false', async () => {
    const { sessions, job } = await setup();
    const view = sessions.accept('preview', signed(job));
    assert.equal(view.assessment.signatureVerified, true); assert.equal(view.assessment.queryExecutionVerified, true);
    assert.equal(view.assessment.executionVerified, false); assert.equal(view.assessment.canApply, false); assert.equal(view.assessment.approvalVerified, false);
    assert.equal(view.state(), 'current'); assert.ok(Object.isFrozen(view.payload));
});
test('Result packets cannot choose their trust root, request, challenge or approval flags', async () => {
    const { sessions, job } = await setup();
    for (const key of ['profile', 'publicKeyPem', 'challenge', 'request', 'executionVerified', 'trusted']) {
        assert.throws(() => sessions.accept('preview', { ...signed(job), [key]: key === 'publicKeyPem' ? publicPem : true }));
    }
    const packet = structuredClone(signed(job)); packet.receipt.payload.observation.actual.rows[0][1].value = '999';
    assert.throws(() => sessions.accept('preview', packet), /signature/);
});
test('A legitimate signature for another challenge or another window cannot be adopted as the expected job', async () => {
    const { sessions, job, artifact, plan, trust } = await setup();
    const other = new RunnerSessions(scope => trust.get(scope)); const otherJob = other.prepare('preview', artifact, plan);
    const packet = signed(otherJob); packet.jobId = job.challenge.jobId;
    assert.throws(() => sessions.accept('preview', packet), /binding|expected/);
    assert.throws(() => new RunnerSessions(scope => trust.get(scope)).accept('preview', signed(job)), /этом окне/);
});
test('The same receipt is idempotent; a different valid result cannot silently replace the first result', async () => {
    const { sessions, job } = await setup(), packet = signed(job);
    const first = sessions.accept('preview', packet); assert.equal(sessions.accept('preview', packet).assessment.receiptHash, first.assessment.receiptHash);
    assert.throws(() => sessions.accept('preview', signed(job, table([]))), /другой результат/);
});
test('Source edits invalidate imports and previously opened evidence; failed guards cannot acquire current status', async () => {
    const { sessions, job, setCurrent } = await setup();
    const view = sessions.accept('preview', signed(job)); setCurrent(false);
    assert.equal(view.state(), 'source_changed'); assert.throws(() => sessions.accept('preview', signed(job)), /контекст изменился/);
});
test('Revoke/reconnect invalidates pending jobs and evidence even when the same public key is pinned again', async () => {
    const { sessions, job, trust } = await setup(); const view = sessions.accept('preview', signed(job));
    await trust.revoke(profile.projectId); assert.equal(view.state(), 'trust_changed');
    assert.throws(() => sessions.assertCurrent('preview'), /изменён или отключён/);
    await trust.pin(profile.projectId, connection); assert.equal(view.state(), 'trust_changed');
});
test('Replacing/evicting a job invalidates old evidence; pending memory is bounded', async () => {
    const { sessions, job, artifact, plan } = await setup(), view = sessions.accept('preview', signed(job));
    const next = sessions.prepare('preview', artifact, plan); assert.equal(view.state(), 'superseded');
    assert.throws(() => sessions.accept('preview', signed(job)), /другому заданию/);
    const nextView = sessions.accept('preview', signed(next));
    for (let i = 0; i < 17; i++) sessions.prepare('another-' + i, artifact, plan);
    assert.equal(nextView.state(), 'superseded'); assert.throws(() => sessions.assertCurrent('preview'), /подготовьте задание/);
});
test('Expiry is visible and cannot revive after the host clock moves back', async () => {
    const { sessions, job, setNow } = await setup(), view = sessions.accept('preview', signed(job));
    setNow(Date.parse(view.payload.expiresAt) + 1); assert.equal(view.state(), 'expired');
    setNow(Date.parse(view.payload.finishedAt)); assert.equal(view.state(), 'expired');
    const report = formatSignedRunnerReport(view, null, s => translateText(s, 'en'));
    assert.match(report, /"queryExecutionVerified": false/); assert.match(report, /"canApply": false/);
});
test('RU/EN reports preserve signed values and never interpret requirement/query text as Markdown commands', async () => {
    const setupData = await setup(), { sessions, artifact, plan } = setupData;
    plan.contract.intent = '```\n[run](command:evil)';
    const job = sessions.prepare('report', artifact, plan), view = sessions.accept('report', signed(job));
    const comparison = compareQueryResults(view.request.contract.assertion.expected, view.payload.observation.actual, 'multiset');
    const report = formatSignedRunnerReport(view, comparison, s => s);
    assert.match(report, /\\u0060\\u0060\\u0060/); assert.ok(!report.includes('\n[run]'));
    assert.match(report, /полный|Полный/); assert.match(report, /"approvalVerified": false/);
});
test('Prepared operator execution preserves the host nonce and refuses edits or expired leases before runtime', async () => {
    const { job } = await setup(); let calls = 0;
    const runtime = { async execute(request, profile, challenge) { calls++; return { isolation: isolation(), engine: {
        schemaVersion: 1, nonce: challenge.nonce, platformVersion: profile.platformVersion, binaryHash: profile.binaryHash,
        status: 'completed', actual: table(), reason: null, logHash: hash('controlled engine') } }; } };
    const result = await executePreparedQueryJob(job, profile, privatePem, runtime);
    assert.equal(result.challenge.nonce, job.challenge.nonce); assert.equal(calls, 1);
    const changed = structuredClone(job); changed.request.contract.intent += ' changed';
    await assert.rejects(executePreparedQueryJob(changed, profile, privatePem, runtime), /binding/); assert.equal(calls, 1);
    assert.throws(() => parsePreparedQueryJob(job, profile, Date.parse(job.challenge.deadlineAt)), /expired/);
});
test('Real operator CLI exports only public connection data and rejects accidental private-key input', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-public-connection-'));
    try {
        await fs.writeFile(path.join(directory, 'profile.json'), JSON.stringify(profile));
        await fs.writeFile(path.join(directory, 'public.pem'), publicPem); await fs.writeFile(path.join(directory, 'private.pem'), privatePem, { mode: 0o600 });
        const invoke = (key, out) => spawnSync(process.execPath, [path.resolve(__dirname, '../dist/runner-cli.js'), 'export-connection',
            '--profile', path.join(directory, 'profile.json'), '--public-key', path.join(directory, key), '--output', path.join(directory, out)], { encoding: 'utf8', timeout: 10000 });
        const done = invoke('public.pem', 'connection.json'); assert.equal(done.status, 0, done.stdout + done.stderr);
        const data = await fs.readFile(path.join(directory, 'connection.json'), 'utf8'); assert.ok(!data.includes('PRIVATE KEY')); assert.equal(JSON.parse(data).profile.keyId, profile.keyId);
        assert.equal(invoke('private.pem', 'bad.json').status, 1);
        await assert.rejects(fs.stat(path.join(directory, 'bad.json')), /ENOENT/);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

(async () => { for (const { name, run } of cases) { await run(); console.log('  ✓ ' + name); }
    console.log(`Signed runner import: ${cases.length} groups passed; crypto/host state and operator CLI, controlled observation only.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
