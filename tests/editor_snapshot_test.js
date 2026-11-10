'use strict';
// Native API/transport are controlled here; the snapshot/task/preview implementations are real.
const assert = require('node:assert/strict'), Module = require('node:module');
const { createHash } = require('node:crypto');
const { textGeometry } = require('./helpers/textGeometry');
const { editorSnapshotHash, parseEditorSnapshot } = require('../out/entities/editor-snapshot/model/snapshot');
const { createSingleFileChange } = require('../out/entities/code-change/model/singleFileChange');
const { createLocalTaskSpec } = require('../out/entities/ai-task/model/draftTask');
const hash = text => createHash('sha256').update(text, 'utf16le').digest('hex');
const folder = name => ({ uri: { fsPath: '/' + name, scheme: 'file', toString: () => 'file:///' + name } });
const folders = [folder('a'), folder('b')];
const documents = new Map();
let settings, keyReads, modelCalls, metadataReads, transport, readKey, readMetadata, openHook, showHook, editHook, tabListener, edits;
class Position { constructor(line, character) { Object.assign(this, { line, character }); } }
class Range { constructor(start, end) { Object.assign(this, { start, end }); } }
const api = {
    Position, Range, TabInputText: class { constructor(uri) { this.uri = uri; } }, TabInputTextDiff: class {},
    workspace: { isTrusted: true, workspaceFolders: folders, textDocuments: [],
        getWorkspaceFolder: uri => folders.find(folder => api.workspace.workspaceFolders.includes(folder) && uri.toString().startsWith(folder.uri.toString() + '/')),
        getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }),
        openTextDocument: async uri => {
            if (openHook) await openHook();
            if (uri.content !== undefined) return makeEditor('untitled:result', uri.content, uri.language).document;
            return documents.get(uri.toString()).document;
        }
    },
    window: { activeTextEditor: undefined,
        tabGroups: { all: [], onDidChangeTabs: listener => { tabListener = listener; return { dispose() { if (tabListener === listener) tabListener = undefined; } }; } },
        showTextDocument: async document => { if (showHook) await showHook(); const editor = documents.get(document.uri.toString()); api.window.activeTextEditor = editor; return editor; }
    }
};
const load = Module._load;
Module._load = function (name, ...args) { return name === 'vscode' ? api : load.call(this, name, ...args); };
const { captureTaskContext, captureSnippetContext, runAiTask } = require('../out/features/ai-task/api/runTask');
const { taskContextIsCurrent } = require('../out/entities/editor-snapshot/api/taskContext');
const { watchEditorTargetLifecycle } = require('../out/entities/editor-snapshot/api/lifecycle');
const { invalidateProjectContext } = require('../out/entities/project-context/model/contextEpoch');
const { PreviewStore, captureEditorTarget } = require('../out/features/apply-code/model/previewStore');
const { NormaHubClient: Client } = require('../out/normahubClient');
const { MetadataScanner } = require('../out/metadataScanner');
const { translateText } = require('../out/shared/i18n/translator');
Module._load = load;

const context = { subscriptions: [], secrets: {} };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const sourceCode = 'Процедура Т()\n    Сообщить("исходник");\nКонецПроцедуры';

function reset() {
    documents.clear(); api.workspace.textDocuments = []; api.workspace.workspaceFolders = folders.slice(); api.workspace.isTrusted = true;
    api.window.activeTextEditor = undefined; api.window.tabGroups.all = [];
    settings = { reasoningModel: 'gpt-6-sol' }; keyReads = modelCalls = metadataReads = edits = 0;
    readKey = async () => 'synthetic-test-key'; readMetadata = async () => ({ name: 'Own test fixture', objects: [], isDemoFallback: false });
    transport = async () => 'Запрос = Новый Запрос;'; openHook = showHook = editHook = undefined;
    Client.getApiKey = async () => { keyReads++; return readKey(); };
    Client.complete = async (...args) => { modelCalls++; return transport(...args); };
    MetadataScanner.scanWorkspace = async (...args) => { metadataReads++; return readMetadata(...args); };
}

function makeEditor(address = 'file:///a/Module.bsl', contents = sourceCode, languageId = 'bsl') {
    const uri = { scheme: address.split(':')[0], toString: () => address };
    const document = { uri, fileName: address.replace('file://', ''), languageId, version: 1, isClosed: false, text: contents,
        getText(range) { return range ? this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end)) : this.text; } };
    Object.assign(document, textGeometry(() => document.text, Position));
    const editor = { document, selection: { isEmpty: true, active: new Position(0, 0), start: new Position(0, 0), end: new Position(0, 0) },
        async edit(callback) {
            const version = document.version, pending = [];
            if (editHook) editHook();
            callback({ insert: (position, text) => pending.push([document.offsetAt(position), document.offsetAt(position), text]),
                replace: (range, text) => pending.push([document.offsetAt(range.start), document.offsetAt(range.end), text]) });
            if (document.version !== version) return false;
            for (const [start, end, text] of pending.sort((a, b) => b[0] - a[0])) document.text = document.text.slice(0, start) + text + document.text.slice(end);
            if (pending.length) { document.version++; edits++; }
            return true;
        }
    };
    documents.set(address, editor); api.workspace.textDocuments.push(document); api.window.activeTextEditor = editor;
    api.window.tabGroups.all.push({ tabs: [{ input: new api.TabInputText(uri) }] });
    return editor;
}

const cases = [];
const test = (name, run) => cases.push({ name, run });
const binding = result => ({ task: result.task, contentHash: result.contentHash, isCurrent: result.isCurrent });

test('Snapshot hashes bind full unsaved text, version, scope, URI, language and lifecycle without storing the text', () => {
    const editor = makeEditor(), captured = captureTaskContext(), source = captured.source;
    assert.equal(source.contentHash, hash(sourceCode));
    assert.ok(!JSON.stringify(source).includes('исходник'));
    assert.ok(Object.isFrozen(source));
    assert.equal(source.textHashEncoding, 'utf16le');
    for (const [field, value] of [['documentVersion', 2], ['sourceUri', 'untitled:one'], ['projectUri', null], ['languageId', '1c'], ['lifecycleEpoch', 9], ['contentHash', hash('other')]]) {
        assert.notEqual(editorSnapshotHash(source), editorSnapshotHash({ ...source, [field]: value }));
    }
    assert.throws(() => parseEditorSnapshot({ ...source, approvalVerified: true }));
    assert.throws(() => createSingleFileChange(source, { start: 0, end: source.documentLength + 1 }, 'x'));
    editor.document.text += '\nИзменение = 1;';
    assert.equal(taskContextIsCurrent(captured), false, 'Hash catches a changed buffer even with a faulty unchanged version adapter');
    const temporary = makeEditor('file:///a/Incomplete.bsl', 'a\ud800b');
    const before = captureTaskContext(); temporary.document.text = 'a\ufffdb';
    assert.equal(taskContextIsCurrent(before), false, 'Unpaired surrogates and replacement characters cannot share a buffer identity');
});

test('Plain serialized or cloned contexts cannot acquire a native capture capability', async () => {
    makeEditor(); const captured = captureTaskContext();
    assert.throws(() => { captured.code = 'Подмена'; });
    await assert.rejects(runAiTask(context, 'query', 'Тест', { ...captured }), /не захвачен/);
    assert.equal(keyReads, 0); assert.equal(modelCalls, 0);
});

test('Cancelled and Restricted Mode tasks stop before secrets, metadata or inference', async () => {
    makeEditor(); const captured = captureTaskContext(), controller = new AbortController(); controller.abort();
    await assert.rejects(runAiTask(context, 'query', 'Тест', captured, controller.signal), error => Client.isCancelledError(error));
    api.workspace.isTrusted = false;
    await assert.rejects(runAiTask(context, 'query', 'Тест', captured), /доверенная/);
    assert.equal(keyReads, 0); assert.equal(metadataReads, 0); assert.equal(modelCalls, 0);
});

test('Buffer changes during key lookup prevent the paid request', async () => {
    const editor = makeEditor(), gate = deferred(); readKey = () => gate.promise;
    const pending = runAiTask(context, 'query', 'Тест', captureTaskContext());
    editor.document.text += ' '; editor.document.version++; gate.resolve('key');
    await assert.rejects(pending, /контекст изменился/);
    assert.equal(metadataReads, 0); assert.equal(modelCalls, 0);
});

test('Metadata changes or cancellation during schema lookup prevent the paid request', async () => {
    for (const cancel of [false, true]) {
        reset(); makeEditor(); const gate = deferred(), controller = new AbortController(); readMetadata = () => gate.promise;
        const pending = runAiTask(context, 'query', 'Тест', captureTaskContext(), controller.signal); await turn();
        if (cancel) controller.abort(); else invalidateProjectContext('/a');
        gate.resolve({ name: 'Own test fixture', objects: [] });
        await assert.rejects(pending, error => cancel ? Client.isCancelledError(error) : /контекст изменился/.test(error.message));
        assert.equal(modelCalls, 0);
    }
});

test('Focus and model changes during awaits keep the original source, project, neighbors and requested route', async () => {
    const a = makeEditor(), neighborA = makeEditor('file:///a/CommonModules/OnlyA/Module.bsl', 'Процедура МетодА() Экспорт\nКонецПроцедуры');
    makeEditor('file:///b/CommonModules/SecretB/Module.bsl', 'Процедура СекретБ() Экспорт\nКонецПроцедуры');
    api.window.activeTextEditor = a; const gate = deferred(); readKey = () => gate.promise;
    let request, scannedRoot; readMetadata = async root => { scannedRoot = root; return { name: 'Own test fixture', objects: [] }; };
    transport = async (...args) => { request = args; return 'Запрос = Новый Запрос;'; };
    const pending = runAiTask(context, 'query', 'Тест', captureTaskContext());
    api.window.activeTextEditor = documents.get('file:///b/CommonModules/SecretB/Module.bsl'); settings.reasoningModel = 'gpt-6.1-sol'; gate.resolve('key');
    const result = await pending;
    assert.equal(scannedRoot, '/a'); assert.equal(request[1], 'gpt-6-sol'); assert.equal(result.task.requestedModel, 'gpt-6-sol');
    assert.ok(request[2].includes('МетодА')); assert.ok(!request[2].includes('СекретБ')); assert.ok(request[3].includes('исходник'));
    assert.equal(result.sourceCurrent, true); assert.equal(result.executionVerified, false); assert.equal(result.task.mode, 'unverified_draft');
    assert.ok(!JSON.stringify(result.task).includes('synthetic-test-key')); assert.ok(!JSON.stringify(result.task).includes('исходник'));
    neighborA.document.text = 'Процедура НовыйМетод() Экспорт\nКонецПроцедуры';
    assert.equal(result.isCurrent(), false);
});

test('Pasted snippets are detached from the active project, metadata and neighbors', async () => {
    makeEditor(); makeEditor('file:///a/CommonModules/Sensitive/Module.bsl', 'Процедура ЧужиеДанные() Экспорт\nКонецПроцедуры');
    let request; transport = async (...args) => { request = args; return 'Объяснение'; };
    const result = await runAiTask(context, 'explain', 'Объясни', captureSnippetContext('Явный фрагмент'));
    assert.equal(metadataReads, 0); assert.ok(!request[2].includes('ЧужиеДанные')); assert.ok(request[3].includes('Явный фрагмент'));
    assert.equal(result.task.origin, 'snippet'); assert.equal(result.task.sourceSnapshotHash, null);
    assert.throws(() => createLocalTaskSpec({ ...result.task, sourceSnapshotHash: hash('fake') }));
});

test('Standalone files, untitled single-root and ambiguous multi-root captures cannot borrow another scope', () => {
    const outside = makeEditor('file:///outside/Module.bsl'); let captured = captureTaskContext();
    assert.equal(captured.root, ''); assert.equal(captured.projectUri, null); assert.equal(captured.neighbors, '');
    makeEditor('untitled:One'); captured = captureTaskContext(); assert.equal(captured.root, ''); assert.equal(captured.projectUri, null);
    api.workspace.workspaceFolders = [folders[0]]; captured = captureTaskContext(); assert.equal(captured.root, '/a'); assert.equal(captured.projectUri, 'file:///a');
    api.window.activeTextEditor = outside; captured = captureTaskContext(); assert.equal(captured.root, '');
    makeEditor('file:///a/Neighbor.bsl', 'Процедура ЧужойКонтекст() Экспорт\nКонецПроцедуры');
    makeEditor('vscode-remote://ssh-remote+own/outside/Module.bsl'); captured = captureTaskContext();
    assert.equal(captured.root, ''); assert.equal(captured.projectUri, null); assert.equal(captured.neighbors, '');
    assert.equal(taskContextIsCurrent(captured), true, 'An unbound remote URI must remain detached from the one local folder');
});

test('A late response remains an openable draft, while stale apply and hidden raw-code injection are refused', async () => {
    const editor = makeEditor(), target = captureEditorTarget(), gate = deferred(); transport = () => gate.promise;
    const pending = runAiTask(context, 'query', 'Тест', captureTaskContext()); await turn();
    editor.document.text += '\nДругойКод = 1;'; editor.document.version++;
    gate.resolve('Запрос = Новый Запрос;'); const result = await pending;
    assert.equal(result.sourceCurrent, false); assert.equal(result.generationStatus, 'completed_unverified');
    const store = new PreviewStore(), preview = store.add(result.code, 'bsl', target, binding(result));
    assert.equal(preview.sourceCurrent, false); assert.equal(preview.executionVerified, false);
    await store.open(preview.previewId);
    await assert.rejects(store.apply(preview.previewId), /изменён/); assert.equal(edits, 0);
    assert.throws(() => store.add('Подмена', 'bsl', target, binding(result)), /Содержимое/);
});

test('Metadata invalidation after a response blocks apply even if the target text is unchanged', async () => {
    makeEditor(); const target = captureEditorTarget(), result = await runAiTask(context, 'query', 'Тест', captureTaskContext());
    const store = new PreviewStore(), preview = store.add(result.code, 'bsl', target, binding(result));
    invalidateProjectContext('/b'); assert.equal(result.isCurrent(), true, 'Another project must not invalidate this result');
    invalidateProjectContext('/a'); await assert.rejects(store.apply(preview.previewId), /контекст изменился/); assert.equal(edits, 0);
});

test('Wrong-source bindings cannot turn one task into an edit of a different module', async () => {
    makeEditor(); const result = await runAiTask(context, 'query', 'Тест', captureTaskContext());
    makeEditor('file:///b/Module.bsl');
    assert.throws(() => new PreviewStore().add(result.code, 'bsl', captureEditorTarget(), binding(result)), /другому/);
});

test('Frozen UTF-16 ranges preserve the original selection, CRLF, non-BMP prefix and single apply', async () => {
    const editor = makeEditor('file:///a/Module.bsl', 'А😀\r\nБета');
    editor.selection = { isEmpty: false, active: new Position(1, 4), start: new Position(1, 0), end: new Position(1, 4) };
    const target = captureEditorTarget('Бета'), store = new PreviewStore(), preview = store.add('Замена', 'bsl', target);
    assert.equal(target.offsets.start, 5); assert.equal(target.offsets.end, 9);
    assert.throws(() => { target.offsets.start = 0; });
    editor.selection.start.line = 0; editor.selection.active.character = 0;
    await store.apply(preview.previewId); assert.equal(editor.document.text, 'А😀\r\nЗамена');
    await assert.rejects(store.apply(preview.previewId), /устарел/); assert.equal(edits, 1);
});

test('Changes after open/show awaits and immediately inside the edit callback cannot bypass source guards', async () => {
    for (const stage of ['open', 'show', 'edit']) {
        reset(); const editor = makeEditor(), store = new PreviewStore(), preview = store.add('X', 'bsl', captureEditorTarget());
        const mutate = () => { editor.document.text += ' '; };
        if (stage === 'open') openHook = mutate; else if (stage === 'show') showHook = mutate; else editHook = mutate;
        await assert.rejects(store.apply(preview.previewId), /изменён/); assert.equal(edits, 0);
    }
});

test('Reopened document objects, lifecycle disposal/recreation and last-tab close invalidate captures', async () => {
    const editor = makeEditor(), store = new PreviewStore(), preview = store.add('X', 'bsl', captureEditorTarget());
    makeEditor('file:///a/Module.bsl'); await assert.rejects(store.apply(preview.previewId), /переоткрыт/);
    api.window.activeTextEditor = editor; const first = watchEditorTargetLifecycle(), captured = captureTaskContext(); first.dispose();
    assert.equal(taskContextIsCurrent(captured), false);
    const second = watchEditorTargetLifecycle(), listener = tabListener; first.dispose(); assert.equal(tabListener, listener);
    const fresh = captureTaskContext(), closed = api.window.tabGroups.all.flatMap(group => group.tabs);
    api.window.tabGroups.all = []; tabListener({ closed }); assert.equal(taskContextIsCurrent(fresh), false); second.dispose();
});

test('Trust loss or cancellation during HTTP never produces an insertable result', async () => {
    for (const cancel of [true, false]) {
        reset(); makeEditor(); const gate = deferred(), controller = new AbortController(); transport = () => gate.promise;
        const pending = runAiTask(context, 'query', 'Тест', captureTaskContext(), controller.signal); await turn();
        if (cancel) controller.abort(); else api.workspace.isTrusted = false;
        gate.resolve('Запрос = Новый Запрос;');
        await assert.rejects(pending, error => cancel ? Client.isCancelledError(error) : /доверенная/.test(error.message));
    }
});

test('New source/trust warnings are translated without changing generated code', () => {
    for (const message of ['Для AI-задачи требуется доверенная рабочая область VS Code.', 'Исходный контекст изменился. Повторите генерацию.',
        'Исходный контекст изменился. Черновик можно открыть или скопировать; для вставки повторите генерацию.']) {
        assert.notEqual(translateText(message, 'en'), message);
    }
});

(async () => {
    for (const { name, run } of cases) { reset(); await run(); console.log('PASS ' + name); }
    console.log(`Editor snapshot and task binding: ${cases.length} groups passed at controlled host boundaries; live IDE/gateway separate.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
