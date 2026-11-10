'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises');
const path = require('node:path'), os = require('node:os'), Module = require('node:module');
const { spawnSync } = require('node:child_process');
const { jsonHash } = require('../out/shared/lib/jsonContract');
const { QueryComparisonJob } = require('../out/features/compare-query-results/model/queryComparisonJob');
const { parseQueryCandidateIdentity } = require('../out/entities/validation/model/queryComparison');
const { formatQueryComparison } = require('../out/features/compare-query-results/model/formatComparison');
const { readLocalJson } = require('../out/shared/lib/readLocalJson');
const { translateText } = require('../out/shared/i18n/translator');
const { textGeometry } = require('./helpers/textGeometry');
const { editorSnapshotHash } = require('../out/entities/editor-snapshot/model/snapshot');
const { createLocalTaskSpec } = require('../out/entities/ai-task/model/draftTask');
const { sha256Text } = require('../out/shared/lib/sha256');

const digest = x => x.repeat(64);
const identity = () => ({ schemaVersion: 1, taskId: 'query.task-1', scopeHash: digest('a'), snapshotHash: digest('b'),
    contextHash: digest('c'), candidateHash: digest('d'), textHashEncoding: 'utf16le' });
const table = (rows = [['A', '2']]) => ({ columns: ['Товар', 'Дефицит'],
    rows: rows.map(([item, count]) => [{ type: 'string', value: item }, { type: 'number', value: count }]) });
function input(candidate = identity()) {
    return { schemaVersion: 1, operation: 'compare_provided_query_result', candidate,
        contract: { schemaVersion: 1, id: 'deficit', version: 1, projectId: candidate.scopeHash,
            intent: 'Две строки по 6, остаток 10: дефицит 2.',
            requirement: { reference: 'own/duplicates', sha256: digest('e') },
            scope: { metadataHash: digest('f'), profileId: 'declared-profile', platformVersion: '8.3.27.1508' },
            preconditions: ['Один товар, один склад.'], assumptions: [], approvalState: 'proposed',
            assertion: { kind: 'query_rows_equal', mode: 'multiset', expected: table() } }, actual: table() };
}
const job = (current = () => true) => new QueryComparisonJob({ identity: identity(), isCurrent: current });
const cases = [], test = (name, run) => cases.push({ name, run });

test('A matching package produces an immutable local receipt without execution, approval or apply authority', () => {
    const pending = job(), source = input();
    assert.equal(pending.status, 'created');
    const result = pending.run(source);
    assert.equal(pending.status, 'completed'); assert.equal(result.comparison.status, 'equal');
    assert.equal(result.executionVerified, false); assert.equal(result.approvalVerified, false); assert.equal(result.canApply, false);
    assert.equal(result.engineStatus, 'not_run'); assert.equal(result.profileStatus, 'not_verified');
    assert.equal(result.metadataScopeStatus, 'not_verified'); assert.equal(result.inputHash, jsonHash(source));
    const { receiptHash, ...body } = result; assert.equal(receiptHash, jsonHash(body));
    assert.ok(Object.isFrozen(result.contract.assertion.expected.rows[0][0]));
    source.contract.intent = 'Changed'; source.actual.rows[0][1].value = '999';
    assert.match(result.contract.intent, /дефицит 2/); assert.equal(result.comparison.actualRowCount, 1);
    assert.throws(() => pending.run(input()), /завершено/);
});
test('Business mismatch and schema mismatch complete the comparison without becoming success or invented row counts', () => {
    const mismatch = input(); mismatch.actual = table([]);
    const result = job().run(mismatch); assert.equal(result.comparison.status, 'different'); assert.equal(result.comparison.missingRows, 1);
    const schema = input(); schema.actual = { columns: ['Other'], rows: [] };
    const other = job().run(schema); assert.equal(other.comparison.status, 'schema_mismatch'); assert.equal(other.comparison.missingRows, null);
    assert.equal(other.executionVerified, false);
});
test('Every candidate binding dimension, including task identity and encoding, refuses a mixed package', () => {
    for (const key of ['taskId', 'scopeHash', 'snapshotHash', 'contextHash', 'candidateHash', 'textHashEncoding']) {
        const source = input(); source.candidate[key] = key === 'taskId' ? 'another.task' : key === 'textHashEncoding' ? 'utf8' : digest('9');
        const pending = job(); assert.throws(() => pending.run(source)); assert.equal(pending.status, 'failed');
    }
    const source = input(); source.contract.projectId = 'different-project';
    assert.throws(() => job().run(source), /другому проекту/);
});
test('Imported claims, foreign operations and unsupported schemas cannot manufacture trusted results', () => {
    for (const mutate of [x => x.schemaVersion = 2, x => x.operation = 'execute_shell', x => x.executionVerified = true,
        x => x.command = 'rm -rf /', x => x.contract.approvalState = 'approved', x => x.candidate.isCurrent = true,
        x => x.contract.assertion.kind = 'eval']) {
        const source = input(); mutate(source); assert.throws(() => job().run(source));
    }
    let invoked = false; const source = input();
    Object.defineProperty(source, 'actual', { get() { invoked = true; return table(); } });
    assert.throws(() => job().run(source), /accessor/); assert.equal(invoked, false);
    assert.throws(() => parseQueryCandidateIdentity({ ...identity(), candidateHash: 'invalid' }));
});
test('Cancellation, stale preflight and stale completion are terminal refusals, including throwing guards', () => {
    let current = true; const stale = job(() => current); current = false;
    assert.throws(() => stale.run(input()), /контекст изменился/); assert.equal(stale.status, 'stale');
    const cancelled = job(); cancelled.cancel(); assert.equal(cancelled.status, 'cancelled');
    assert.throws(() => cancelled.run(input()), /отменено/);
    let checks = 0; const late = job(() => ++checks < 3);
    assert.throws(() => late.run(input()), /контекст изменился/); assert.equal(late.status, 'stale');
    assert.throws(() => job(() => { throw Error('guard failure'); }), /контекст изменился/);
});
test('RU/EN reports preserve values and escape Markdown while explaining unverified scope and bounded differences', () => {
    const source = input(); source.contract.intent = '```\n[click](command:evil)'; source.actual = table([]);
    const result = job().run(source), en = formatQueryComparison(result, s => translateText(s, 'en'));
    assert.match(en, /1C execution is unconfirmed/); assert.match(en, /Missing rows: 1/);
    assert.ok(en.includes('\\u0060\\u0060\\u0060')); assert.ok(!en.includes('\n[click]'));
    assert.match(formatQueryComparison(result, s => s), /Исполнение 1С не подтверждено/);
    const schema = input(); schema.actual.columns = ['Other', 'Count'];
    assert.match(formatQueryComparison(job().run(schema), s => translateText(s, 'en')), /Missing rows: Unknown/);
});

let directory;
test('Bounded real local file input accepts UTF-8 and rejects invalid JSON, malformed UTF-8, excess bytes and directories', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-comparison-'));
    const good = path.join(directory, 'good.json'); await fs.writeFile(good, JSON.stringify(input()));
    assert.deepEqual(await readLocalJson(good, () => {}), input());
    for (const [name, data, pattern] of [['bad.json', '{', /JSON/], ['utf8.json', Buffer.from([0xc3, 0x28]), /UTF-8/],
        ['large.json', ' '.repeat(2 * 1024 * 1024 + 1), /2 MiB/]]) {
        const file = path.join(directory, name); await fs.writeFile(file, data); await assert.rejects(readLocalJson(file, () => {}), pattern);
    }
    await assert.rejects(readLocalJson(directory, () => {}), /обычный JSON/);
    if (process.platform === 'linux') {
        const fifo = path.join(directory, 'pipe'); assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
        await assert.rejects(readLocalJson(fifo, () => {}), /обычный JSON/);
    }
});
test('File I/O rechecks host freshness throughout reads and always releases its own handle', async () => {
    const file = path.join(directory, 'many.json'); await fs.writeFile(file, JSON.stringify({ data: 'A'.repeat(100000) }));
    let calls = 0;
    await assert.rejects(readLocalJson(file, () => { if (++calls === 5) throw Error('source changed'); }), /source changed/);
    assert.equal(calls, 5);
    await fs.rename(file, file + '.moved');
    assert.ok((await readLocalJson(file + '.moved', () => {})).data.length === 100000);
});

// Real preview/controller implementations, controlled native boundary. No gateway or runtime fixtures.
class Position { constructor(line, character) { Object.assign(this, { line, character }); } }
const openDocs = [];
let pick, progressCancellation = false, openHook;
const api = { Position, Range: class {}, ProgressLocation: { Notification: 15 },
    workspace: { isTrusted: true, workspaceFolders: [], getWorkspaceFolder() {},
        async openTextDocument(options) { if (openHook) openHook(); const doc = { ...options }; openDocs.push(doc); return doc; } },
    window: { activeTextEditor: undefined, async showTextDocument(doc) { return { document: doc }; },
        async showOpenDialog(options) { return pick(options); },
        async withProgress(_options, run) { return run({}, { isCancellationRequested: progressCancellation, onCancellationRequested() { return { dispose() {} }; } }); } }
};
const originalLoad = Module._load;
Module._load = function (name, ...args) { return name === 'vscode' ? api : originalLoad.call(this, name, ...args); };
const { PreviewStore, captureEditorTarget } = require('../out/features/apply-code/model/previewStore');
const { PreviewComparison } = require('../out/app/validation/api/previewComparison');
Module._load = originalLoad;
function preview(kind = 'query') {
    api.workspace.isTrusted = true; progressCancellation = false; openHook = undefined;
    const text = 'Процедура Т()\nКонецПроцедуры', document = { uri: { scheme: 'file', toString: () => 'file:///own/Module.bsl' },
        fileName: '/own/Module.bsl', version: 1, languageId: 'bsl', isClosed: false, getText: () => text, ...textGeometry(() => text, Position) };
    api.window.activeTextEditor = { document, selection: { isEmpty: true, active: new Position(0, 0) } };
    const target = captureEditorTarget(), spec = createLocalTaskSpec({ schemaVersion: 1, kind, origin: 'editor', scopeHash: digest('a'),
        sourceSnapshotHash: editorSnapshotHash(target.source), intentHash: digest('b'), codeContextHash: digest('c'),
        neighborContextHash: digest('d'), metadataPromptHash: digest('e'), requestedModel: 'controlled-test', textHashEncoding: 'utf16le' });
    const store = new PreviewStore(), code = 'Запрос = Новый Запрос;';
    const result = store.add(code, 'bsl', target, { task: spec, contentHash: sha256Text(code), isCurrent: () => true });
    return { store, result, document };
}
test('Only a host-owned AI-query preview can issue a lease; local/explain, evicted and untrusted records are refused', () => {
    const { store, result } = preview(); assert.equal(result.comparisonAvailable, true);
    assert.equal(store.captureQueryCandidate(result.previewId).identity.candidateHash, sha256Text('Запрос = Новый Запрос;'));
    const other = preview('explain'); assert.equal(other.result.comparisonAvailable, false);
    assert.throws(() => other.store.captureQueryCandidate(other.result.previewId), /AI-запроса/);
    api.workspace.isTrusted = false; assert.throws(() => store.captureQueryCandidate(result.previewId), /контекст изменился/);
    api.workspace.isTrusted = true; const lease = store.captureQueryCandidate(result.previewId);
    for (let i = 0; i < 31; i++) store.add('Локальный = 1;');
    assert.equal(lease.isCurrent(), false); assert.throws(() => store.captureQueryCandidate(result.previewId), /устарел/);
});
test('Export contains host identity, excludes source/key/expected data, and refuses a change during native open', async () => {
    const { store, result, document } = preview(), controller = new PreviewComparison(store, () => 'en');
    await controller.exportRequest(result.previewId);
    const exported = JSON.parse(openDocs.at(-1).content);
    assert.equal(exported.operation, 'query_comparison_request'); assert.equal(exported.contractProjectId, digest('a'));
    assert.ok(!openDocs.at(-1).content.includes('Процедура')); assert.ok(!('contract' in exported));
    openHook = () => { document.version++; };
    await assert.rejects(controller.exportRequest(result.previewId), /контекст изменился/);
});
test('Native import compares the selected local file, opens EN differences, preserves preview and never applies code', async () => {
    const { store, result } = preview(), candidate = store.captureQueryCandidate(result.previewId).identity;
    const source = input(candidate); source.actual = table([]);
    const file = path.join(directory, 'native.json'); await fs.writeFile(file, JSON.stringify(source));
    let title; pick = options => { title = options.title; return [{ scheme: 'file', fsPath: file }]; };
    const controller = new PreviewComparison(store, () => 'en');
    assert.equal(await controller.compare(result.previewId), 'completed'); assert.match(title, /^Choose a comparison package/);
    assert.equal(openDocs.at(-1).language, 'markdown'); assert.match(openDocs.at(-1).content, /Missing rows: 1/);
    assert.equal(store.captureQueryCandidate(result.previewId).isCurrent(), true);
});
test('Chooser cancellation, unsupported URI and progress cancellation never become a completed check', async () => {
    const { store, result } = preview(), controller = new PreviewComparison(store, () => 'ru');
    pick = () => undefined; assert.equal(await controller.compare(result.previewId), 'cancelled');
    pick = () => [{ scheme: 'https', fsPath: 'https://example.invalid' }]; await assert.rejects(controller.compare(result.previewId), /локальный JSON/);
    const file = path.join(directory, 'cancel.json'); await fs.writeFile(file, JSON.stringify(input(store.captureQueryCandidate(result.previewId).identity)));
    pick = () => [{ scheme: 'file', fsPath: file }]; progressCancellation = true;
    await assert.rejects(controller.compare(result.previewId), /отменено/);
});
test('A native chooser cannot rebind changed source, and concurrent clicks cannot duplicate an import', async () => {
    const { store, result, document } = preview(), controller = new PreviewComparison(store, () => 'ru');
    let resolve; pick = () => new Promise(done => { resolve = done; });
    const first = controller.compare(result.previewId);
    await assert.rejects(controller.compare(result.previewId), /уже выполняется/);
    document.version++; resolve(undefined); await assert.rejects(first, /контекст изменился/);
    assert.throws(() => store.captureQueryCandidate(result.previewId), /контекст изменился/);
});

(async () => {
    try {
        for (const { name, run } of cases) { await run(); console.log('  ✓ ' + name); }
        console.log(`Query comparison workflow: ${cases.length} groups passed; provided data only, no 1C execution or approval.`);
    } finally { if (directory) await fs.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
