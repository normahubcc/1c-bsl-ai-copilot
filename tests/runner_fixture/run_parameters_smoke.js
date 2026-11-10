// Explicit integration with the synthetic 1C fixture. No production infobase is accepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { request: makeRequest } = require('../helpers/runnerData');
const { queryChoices } = require('../../out/features/create-validation-plan/model/queryChoices');

const [profileFile, keyDirectory, output] = process.argv.slice(2);
if (!profileFile || !keyDirectory || !output || fs.existsSync(output)) {
    throw new Error('Pass the explicit own v2 profile, external operator key directory and a new evidence directory.');
}
const profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
assert.equal(profile.schemaVersion, 2);
assert.equal(profile.kind, 'query_text_fixture_v2');
fs.mkdirSync(output, { mode: 0o700 });
const cli = path.resolve(__dirname, '../../dist/runner-cli.js');
const invoke = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
const live = JSON.parse(fs.readFileSync(path.join(__dirname, '../evidence/live-normahub-2026-10-31/run-b/q04-request.json'), 'utf8'));
const selected = queryChoices(live.candidateCode).find(choice => choice.start === live.selection.start && choice.end === live.selection.end);
assert.ok(selected, 'Frozen AI query has an exact complete literal');

function request(query, parameters, expected) {
    const result = makeRequest(profile, query, true);
    result.schemaVersion = 2;
    result.parameters = parameters;
    result.contract.assertion.expected = { columns: ['Значение'], rows: [[expected]] };
    result.contract.scope.profileId = profile.profileId;
    return result;
}
const scalar = (type, value, name = 'Значение') => ({ name, value: type === 'null' ? { type } : { type, value } });
const cases = [
    { name: 'frozen-ai-q04-warehouse', query: selected.query, params: [scalar('string', 'W1', 'Склад')],
        expected: { columns: ['Товар', 'Количество'], rows: [[{ type: 'string', value: 'A' }, { type: 'number', value: '10' }]] } },
    { name: 'warehouse-no-match', query: selected.query, params: [scalar('string', 'W2', 'Склад')],
        expected: { columns: ['Товар', 'Количество'], rows: [] } },
    { name: 'string-data', query: 'ВЫБРАТЬ &Значение КАК Значение', params: [scalar('string', 'W1\"; УНИЧТОЖИТЬ ТАБЛИЦУ Документ.Заказ')],
        expected: { type: 'string', value: 'W1\"; УНИЧТОЖИТЬ ТАБЛИЦУ Документ.Заказ' } },
    { name: 'decimal-exact', query: 'ВЫБРАТЬ &Значение КАК Значение', params: [scalar('number', '9007199254740993.125')],
        expected: { type: 'number', value: '9007199254740993.125' } },
    { name: 'boolean-false', query: 'ВЫБРАТЬ &Значение КАК Значение', params: [scalar('boolean', false)],
        expected: { type: 'boolean', value: false } },
    { name: 'date', query: 'ВЫБРАТЬ &Значение КАК Значение', params: [scalar('date', '2024-02-29T12:34:56')],
        expected: { type: 'date', value: '2024-02-29T12:34:56' } },
    { name: 'null', query: 'ВЫБРАТЬ &Значение КАК Значение', params: [scalar('null')],
        expected: { type: 'null' } }
];
const summary = [];
for (const item of cases) {
    const job = request(item.query, item.params, item.expected);
    if (item.expected.columns) job.contract.assertion.expected = item.expected;
    const requestFile = path.join(output, item.name + '-request.json');
    const directory = path.join(output, item.name);
    fs.writeFileSync(requestFile, JSON.stringify(job, null, 2), { mode: 0o600 });
    const started = Date.now();
    const run = invoke(['run', '--profile', profileFile, '--request', requestFile,
        '--private-key', path.join(keyDirectory, 'private.pem'), '--output', directory]);
    fs.writeFileSync(path.join(output, item.name + '-cli.txt'), run.stdout + run.stderr, { mode: 0o600 });
    assert.equal(run.status, 0, item.name + ': ' + run.stdout + run.stderr);
    const assessment = JSON.parse(fs.readFileSync(path.join(directory, 'assessment.json'), 'utf8'));
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'receipt.json'), 'utf8'));
    assert.equal(assessment.queryExecutionVerified, true);
    assert.equal(assessment.comparison.status, 'equal');
    assert.equal(assessment.canApply, false);
    assert.equal(receipt.payload.observation.schemaVersion, 2);
    assert.equal(receipt.payload.parametersHash, receipt.payload.observation.parametersHash);
    const verification = invoke(['verify', '--profile', profileFile, '--request', requestFile,
        '--challenge', path.join(directory, 'challenge.json'), '--receipt', path.join(directory, 'receipt.json'),
        '--public-key', path.join(keyDirectory, 'public.pem')]);
    assert.equal(verification.status, 0, verification.stdout + verification.stderr);
    const containers = spawnSync('docker', ['ps', '-a', '--filter', 'label=normahub.copilot.nonce=' + receipt.payload.job.nonce,
        '--format', '{{.ID}}'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(containers.status, 0);
    assert.equal(containers.stdout.trim(), '', 'Job container leaked');
    summary.push({ name: item.name, elapsedMs: Date.now() - started, queryExecutionVerified: true,
        comparison: 'equal', imageId: profile.imageId, parametersHash: receipt.payload.parametersHash,
        cleanedUp: true, fullBslExecution: 'not_run', modelCalled: false });
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary.at(-1)));
}
const base = request('ВЫБРАТЬ &Значение КАК Значение', [scalar('string', 'W1')], { type: 'string', value: 'W1' });
for (const [name, params] of [
    ['missing', []], ['unused', [scalar('string', 'W1'), { name: 'Лишний', value: { type: 'null' } }]],
    ['reserved', [{ name: 'Дата', value: { type: 'null' } }, scalar('string', 'W1')]]
]) {
    const file = path.join(output, name + '-request.json');
    fs.writeFileSync(file, JSON.stringify({ ...base, parameters: params }), { mode: 0o600 });
    const run = invoke(['run', '--profile', profileFile, '--request', file,
        '--private-key', path.join(keyDirectory, 'private.pem'), '--output', path.join(output, name)]);
    assert.notEqual(run.status, 0, name + ' must fail preflight');
    assert.equal(fs.existsSync(path.join(output, name, 'failure.json')), true, name + ' must leave a refusal record');
    assert.equal(fs.existsSync(path.join(output, name, 'challenge.json')), false, name + ' must not create a challenge');
    assert.equal(fs.existsSync(path.join(output, name, 'receipt.json')), false, name + ' must not run the engine');
    summary.push({ name, preflightRejected: true, engineStarted: false });
}
const valid = path.join(output, 'frozen-ai-q04-warehouse');
const tampered = JSON.parse(fs.readFileSync(path.join(valid, 'receipt.json'), 'utf8'));
tampered.payload.parameters[0].value.value = 'W2';
const tamperedFile = path.join(output, 'tampered-receipt.json');
fs.writeFileSync(tamperedFile, JSON.stringify(tampered), { mode: 0o600 });
const refusal = invoke(['verify', '--profile', profileFile,
    '--request', path.join(output, 'frozen-ai-q04-warehouse-request.json'),
    '--challenge', path.join(valid, 'challenge.json'), '--receipt', tamperedFile,
    '--public-key', path.join(keyDirectory, 'public.pem')]);
assert.equal(refusal.status, 1);
summary.push({ name: 'tampered-parameter-receipt', verificationRejected: true });
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('Own 1C engine parameter controls and tamper refusal passed.');
