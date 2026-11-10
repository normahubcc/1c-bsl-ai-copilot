// Explicit own-fixture engine integration. Never accepts an existing business database.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { request: makeRequest } = require('../helpers/runnerData');
const profileFile = process.argv[2], keyDirectory = process.argv[3], output = process.argv[4];
if (!profileFile || !keyDirectory || !output || fs.existsSync(output)) throw Error('Pass own profile, external key directory and new evidence directory.');
fs.mkdirSync(output, { mode: 0o700 });
const profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
const cli = path.resolve(__dirname, '../../dist/runner-cli.js');
const correct = `ВЫБРАТЬ
 Строки.Товар КАК Товар,
 Строки.Требуется - ЕСТЬNULL(Остатки.КоличествоОстаток, 0) КАК Дефицит
ИЗ
 (ВЫБРАТЬ Строки.Товар КАК Товар, Строки.Склад КАК Склад,
  СУММА(Строки.Вес) КАК Требуется
  ИЗ Документ.Заказ.Товары КАК Строки
  ГДЕ Строки.Ссылка = &Ссылка
  СГРУППИРОВАТЬ ПО Строки.Товар, Строки.Склад) КАК Строки
 ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.ТоварыНаСкладах.Остатки(&Дата, ) КАК Остатки
 ПО Строки.Товар = Остатки.Номенклатура И Строки.Склад = Остатки.Склад
ГДЕ Строки.Требуется > ЕСТЬNULL(Остатки.КоличествоОстаток, 0)`;
const broken = correct.replace('СУММА(Строки.Вес)', 'Строки.Вес').replace('СГРУППИРОВАТЬ ПО Строки.Товар, Строки.Склад', '');
const cases = [ ['correct', correct, 0, true, 'equal'], ['controlled-defect', broken, 2, true, 'different'],
    ['schema-error', 'ВЫБРАТЬ НетПоля КАК Товар ИЗ Документ.НетОбъекта', 2, false, null],
    ['typed-null', 'ВЫБРАТЬ NULL КАК Товар, 2 КАК Дефицит', 0, true, 'equal'] ];
const summaries = [];
const invoke = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
for (const [name, query, expectedExit, executed, comparison] of cases) {
    const requestPath = path.join(output, name + '-request.json'), directory = path.join(output, name);
    const request = makeRequest(profile, query, true);
    if (name === 'typed-null') request.contract.assertion.expected.rows[0][0] = { type: 'null' };
    fs.writeFileSync(requestPath, JSON.stringify(request, null, 2), { mode: 0o600 });
    const started = Date.now();
    const run = invoke(['run', '--profile', profileFile, '--request', requestPath, '--private-key', path.join(keyDirectory, 'private.pem'), '--output', directory]);
    fs.writeFileSync(path.join(output, name + '-cli.txt'), run.stdout + run.stderr);
    assert.equal(run.status, expectedExit, run.stdout + run.stderr);
    const assessment = JSON.parse(fs.readFileSync(path.join(directory, 'assessment.json'), 'utf8'));
    assert.equal(assessment.queryExecutionVerified, executed); assert.equal(assessment.comparison?.status ?? null, comparison);
    assert.equal(assessment.executionVerified, false); assert.equal(assessment.canApply, false); assert.equal(assessment.approvalVerified, false);
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'receipt.json'), 'utf8'));
    const verification = invoke(['verify', '--profile', profileFile, '--request', requestPath, '--challenge', path.join(directory, 'challenge.json'),
        '--receipt', path.join(directory, 'receipt.json'), '--public-key', path.join(keyDirectory, 'public.pem')]);
    assert.equal(verification.status, expectedExit, verification.stdout + verification.stderr);
    const verifyResult = JSON.parse(verification.stdout); assert.equal(verifyResult.signatureVerified, true);
    const cleanup = spawnSync('docker', ['ps', '-a', '--filter', 'label=normahub.copilot.nonce=' + receipt.payload.job.nonce, '--format', '{{.ID}}'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(cleanup.status, 0); assert.equal(cleanup.stdout.trim(), '', 'Job container leaked');
    summaries.push({ name, exitCode: run.status, elapsedMs: Date.now() - started, queryExecutionVerified: executed,
        comparison, platformVersion: receipt.payload.observation.platformVersion, imageId: profile.imageId,
        isolation: receipt.payload.isolation, cleanedUp: true, fullBslExecution: 'not_run', modelCalled: false });
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summaries, null, 2));
    console.log(JSON.stringify(summaries.at(-1)));
}
const receiptFile = path.join(output, 'correct/receipt.json');
const tampered = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
tampered.payload.observation.actual.rows[0][1].value = '999';
const tamperedFile = path.join(output, 'tampered-receipt.json'); fs.writeFileSync(tamperedFile, JSON.stringify(tampered));
const refusal = invoke(['verify', '--profile', profileFile, '--request', path.join(output, 'correct-request.json'),
    '--challenge', path.join(output, 'correct/challenge.json'), '--receipt', tamperedFile, '--public-key', path.join(keyDirectory, 'public.pem')]);
assert.equal(refusal.status, 1); assert.match(refusal.stdout, /Invalid runner signature/);
fs.writeFileSync(path.join(output, 'tamper-refusal.json'), refusal.stdout);
console.log('Real own-fixture engine runs and signature tamper refusal passed.');
