const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { canonicalJson, jsonHash } = require('../out/shared/lib/jsonContract');
const { parseBusinessContract, businessContractHash } = require('../out/entities/business-contract/model/contract');
const { parseResultSet } = require('../out/entities/business-contract/model/resultSet');
const { compareQueryResults } = require('../out/features/compare-query-results/model/compareResults');
const { assessValidationEvidence } = require('../out/features/assess-validation/model/assessEvidence');
const { executeVerification } = require('../out/app/verification/api/executeVerification');

const digest = char => char.repeat(64);
const number = value => ({ type: 'number', value });
const string = value => ({ type: 'string', value });
const table = rows => ({ columns: ['Товар', 'Дефицит'], rows: rows.map(([item, amount]) => [string(item), number(amount)]) });
const expected = table([['A', '2']]);
const contract = () => ({
    schemaVersion: 1, id: 'deficit.query', version: 1, projectId: 'own-fixture',
    intent: 'Две строки по 6 при остатке 10 дают одну строку дефицита 2.',
    requirement: { reference: 'fixture/duplicates', sha256: digest('a') },
    scope: { metadataHash: digest('b'), profileId: 'training-file', platformVersion: '8.3.27.1508' },
    preconditions: ['Один товар и склад; количества в одинаковых единицах.'], assumptions: [],
    assertion: { kind: 'query_rows_equal', mode: 'multiset', expected: structuredClone(expected) },
    approvalState: 'proposed'
});
let groups = 0;
function group(name, run) { run(); groups++; console.log('  ✓ ' + name); }

group('JSON boundaries reject accessors without invoking them, exotic prototypes, sparse arrays and cycles', () => {
    let invoked = false;
    const getter = Object.defineProperty({}, 'x', { enumerable: true, get() { invoked = true; return 'hidden'; } });
    assert.throws(() => canonicalJson(getter), /accessors/);
    assert.equal(invoked, false);
    const proxy = new Proxy({}, { getPrototypeOf() { invoked = true; return Object.prototype; } });
    assert.throws(() => canonicalJson(proxy), /proxies/);
    assert.equal(invoked, false, 'Proxy traps must not run at the JSON boundary');
    const overridden = ['A'];
    Object.defineProperty(overridden, 'map', { value() { invoked = true; return []; } });
    assert.throws(() => parseResultSet({ columns: overridden, rows: [] }), /dense/);
    assert.equal(invoked, false, 'Non-enumerable array methods must not bypass JSON-only validation');
    for (const value of [undefined, NaN, Infinity, () => 1, new Date(), new (class extends Array {})()]) assert.throws(() => canonicalJson(value));
    const cycle = {}; cycle.next = cycle;
    assert.throws(() => canonicalJson(cycle), /Cyclic/);
    const sparse = new Array(2); sparse[0] = 1; sparse.extra = 2;
    assert.throws(() => canonicalJson(sparse), /dense/);
    const deep = {}; let child = deep;
    for (let i = 0; i < 30; i++) child = child.next = {};
    assert.throws(() => canonicalJson(deep), /limits/);
    assert.throws(() => canonicalJson('x'.repeat(2 * 1024 * 1024)), /2 MiB/);
    assert.equal(jsonHash({ b: 2, a: 1 }), jsonHash({ a: 1, b: 2 }));
});

group('Contracts reject unsupported schemas, executable assertions, fabricated approval and unknown properties', () => {
    const parsed = parseBusinessContract(contract());
    assert.equal(parsed.approvalState, 'proposed');
    assert.ok(Object.isFrozen(parsed.assertion.expected.rows[0][0]));
    for (const mutate of [c => c.schemaVersion = 2, c => c.version = 0, c => c.approvalState = 'approved',
        c => c.assertion.kind = 'eval', c => c.assertion.script = 'process.exit()',
        c => c.tenantId = 'other-company', c => c.requirement.sha256 = 'fake', c => c.assumptions = 'none']) {
        const value = contract(); mutate(value); assert.throws(() => parseBusinessContract(value));
    }
    const source = contract(), hash = businessContractHash(source);
    const changed = contract(); changed.scope.profileId = 'another-profile';
    assert.notEqual(hash, businessContractHash(changed));
    source.assertion.expected.rows[0][1].value = '99';
    assert.equal(parsed.assertion.expected.rows[0][1].value, '2', 'Parser must not retain mutable caller state');
});

group('Known deficit oracle detects the per-line mistake without pretending to run 1C', () => {
    const result = executeVerification({ schemaVersion: 1, operation: 'compare_contract_result', contract: contract(), actual: table([]) });
    assert.equal(result.status, 'different');
    assert.equal(result.missingRows, 1);
    assert.equal(result.differences[0].row[1].value, '2');
    assert.equal(result.executionVerified, false);
    assert.equal(result.approvalVerified, false);
    assert.equal(executeVerification({ schemaVersion: 1, operation: 'compare_contract_result', contract: contract(), actual: expected }).status, 'equal');
});

group('Multiset comparison preserves duplicate counts; ordered comparison detects changed positions', () => {
    const a = table([['A', '2'], ['A', '2'], ['B', '3']]);
    const b = table([['B', '3'], ['A', '2'], ['A', '2']]);
    assert.equal(compareQueryResults(a, b, 'multiset').status, 'equal');
    assert.equal(compareQueryResults(a, b, 'ordered').status, 'different');
    const lostDuplicate = compareQueryResults(a, table([['A', '2'], ['B', '3']]), 'multiset');
    assert.equal(lostDuplicate.missingRows, 1);
    assert.equal(lostDuplicate.unexpectedRows, 0);
    assert.equal(compareQueryResults(table([]), table([]), 'multiset').status, 'equal');
    const columns = compareQueryResults(expected, { columns: ['Дефицит', 'Товар'], rows: [[number('2'), string('A')]] }, 'multiset');
    assert.equal(columns.status, 'schema_mismatch');
    assert.equal(columns.missingRows, null, 'No invented row statistics on incompatible schemas');
});

group('Decimal strings retain precision beyond IEEE-754 and normalize value-preserving zeros only', () => {
    assert.equal(compareQueryResults(table([['A', '0002.000']]), expected, 'multiset').status, 'equal');
    assert.equal(compareQueryResults(table([['A', '-0.0']]), table([['A', '0']]), 'multiset').status, 'equal');
    assert.equal(compareQueryResults(table([['A', '9007199254740992']]), table([['A', '9007199254740993']]), 'multiset').status, 'different');
    assert.equal(compareQueryResults(table([['A', '1.00000000000000000001']]), table([['A', '1']]), 'multiset').status, 'different');
    for (const invalid of ['1e3', 'NaN', '1,2', '', 2]) assert.throws(() => parseResultSet(table([['A', invalid]])));
});

group('NULL, Undefined, booleans, empty references and concrete references remain distinguishable', () => {
    const single = cell => ({ columns: ['Значение'], rows: [[cell]] });
    const cells = [{ type: 'null' }, { type: 'undefined' }, { type: 'boolean', value: false }, string(''),
        { type: 'empty_reference', metadata: 'Справочник.Товары' },
        { type: 'reference', metadata: 'Справочник.Товары', id: 'aaaaaaaa-0000-0000-0000-000000000001' }];
    for (let i = 0; i < cells.length; i++) for (let j = 0; j < cells.length; j++) {
        assert.equal(compareQueryResults(single(cells[i]), single(cells[j]), 'multiset').status, i === j ? 'equal' : 'different');
    }
    const uppercase = { ...cells[5], id: cells[5].id.toUpperCase() };
    assert.equal(compareQueryResults(single(cells[5]), single(uppercase), 'multiset').status, 'equal');
    assert.throws(() => parseResultSet(single({ ...cells[5], id: '00000000-0000-0000-0000-000000000000' })));
    assert.throws(() => parseResultSet(single({ type: 'null', value: 0 })));
    assert.throws(() => parseResultSet(single({ type: 'date', value: '2026-02-29T00:00:00' })));
    assert.equal(parseResultSet(single({ type: 'date', value: '2024-02-29T23:59:59' })).rows.length, 1);
    assert.throws(() => parseResultSet({ columns: ['A', 'a'], rows: [] }));
    assert.throws(() => parseResultSet({ columns: ['A'], rows: [[], []] }));
});

group('Difference samples are bounded while row counts include all differences', () => {
    const rows = Array.from({ length: 100 }, (_, i) => [String(i), '1']);
    const result = compareQueryResults(table(rows), table([]), 'multiset');
    assert.equal(result.missingRows, 100);
    assert.equal(result.differences.length, 20);
    assert.equal(result.truncated, true);
    assert.throws(() => parseResultSet(table(Array.from({ length: 2001 }, () => ['A', '1']))));
});

const now = Date.parse('2026-10-29T12:00:00.000Z');
const binding = () => ({ schemaVersion: 1, projectId: 'own-fixture', snapshotHash: digest('a'), candidateHash: digest('b'),
    contractHash: digest('c'), fixtureHash: digest('d'), profileHash: digest('e'), policyHash: digest('f') });
const check = (status = 'passed') => ({ id: 'behavior.deficit', level: 'behavior', status,
    ...(status === 'passed' ? {} : { reason: 'Explicit test outcome.' }), evidence: [{ artifactId: 'run-1/results', sha256: digest('a') }] });
const report = () => ({ schemaVersion: 1, binding: binding(), startedAt: '2026-10-29T11:00:00.000Z', finishedAt: '2026-10-29T11:01:00.000Z',
    expiresAt: '2026-10-29T13:00:00.000Z', checks: [check()] });
const assess = (r = report(), b = binding(), required = ['behavior.deficit']) => assessValidationEvidence(r, b, required, now);

group('Every declared binding dimension invalidates old evidence; cross-project evidence is refused', () => {
    for (const field of ['snapshotHash', 'candidateHash', 'contractHash', 'fixtureHash', 'profileHash', 'policyHash']) {
        const current = binding(); current[field] = digest('0');
        const result = assess(report(), current);
        assert.equal(result.status, 'stale');
        assert.deepEqual(result.changedBindings, [field]);
        assert.equal(result.canApply, false);
    }
    assert.equal(assess(report(), { ...binding(), projectId: 'other-customer' }).status, 'scope_mismatch');
});

group('Consistent caller reports never authenticate execution or approval; expiry and future time are visible', () => {
    const result = assess();
    assert.equal(result.status, 'reported_pass');
    assert.equal(result.executionVerified, false);
    assert.equal(result.approvalVerified, false);
    assert.equal(result.canApply, false);
    const expired = report(); expired.expiresAt = '2026-10-29T12:00:00.000Z';
    assert.equal(assess(expired).status, 'stale');
    const future = report(); future.finishedAt = '2026-10-29T12:01:00.000Z';
    assert.equal(assess(future).status, 'invalid_time');
    const invalid = report(); invalid.finishedAt = '2026-10-29T10:00:00.000Z';
    assert.throws(() => assess(invalid), /order/);
});

group('Failed, cancelled, unsupported, missing and malformed checks cannot become a pass', () => {
    for (const status of ['failed', 'cancelled', 'not_run', 'unsupported']) {
        const r = report(); r.checks = [check(status)];
        assert.equal(assess(r).status, status === 'failed' || status === 'cancelled' ? status : 'incomplete');
    }
    assert.equal(assess(report(), binding(), ['compile.server']).status, 'incomplete');
    const optionalFailure = report(); optionalFailure.checks.push({ ...check('failed'), id: 'performance' });
    assert.equal(assess(optionalFailure).status, 'failed', 'Optional failures must not be hidden');
    for (const mutate of [r => r.checks.push(check()), r => r.checks[0].status = 'verified',
        r => r.checks[0].evidence = [], r => { r.checks[0] = check('not_run'); delete r.checks[0].reason; },
        r => r.binding.projectId = '', r => r.approvalVerified = true]) {
        const r = report(); mutate(r); assert.throws(() => assess(r));
    }
    assert.throws(() => assess(report(), binding(), []));
    assert.throws(() => assess(report(), binding(), ['behavior.deficit', 'behavior.deficit']));
});

group('Real standalone CLI accepts the strict contract and refuses malformed, oversized and invalid UTF-8 input', () => {
    const cli = path.join(__dirname, '../dist/verification-cli.js');
    const invoke = input => spawnSync(process.execPath, [cli], { input, timeout: 5000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    const valid = invoke(JSON.stringify({ schemaVersion: 1, operation: 'validate_contract', contract: contract() }));
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    assert.equal(JSON.parse(valid.stdout).result.contractHash, businessContractHash(contract()));
    for (const input of ['not json', JSON.stringify({ schemaVersion: 2, operation: 'validate_contract' }),
        JSON.stringify({ schemaVersion: 1, operation: 'eval', code: 'anything' }), Buffer.from([0xff]), ' '.repeat(2 * 1024 * 1024 + 1)]) {
        const result = invoke(input);
        assert.equal(result.status, 1);
        assert.ok(JSON.parse(result.stdout).error.code);
    }
    assert.throws(() => executeVerification({ schemaVersion: 1, operation: 'validate_contract', contract: contract(), canApply: true }));
});

console.log(`Verification foundation: ${groups} meaningful groups passed; provided-data comparison only, no 1C/inference approval claims.`);
