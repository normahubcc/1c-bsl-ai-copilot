// Exercise the real provider with the VS Code API boundary replaced, not its handlers.
const assert = require('node:assert/strict');
const Module = require('node:module');
const messages = [];
const edits = [];
const listeners = {};
const settings = { reasoningModel: 'gpt-6-sol', autocompleteModel: 'deepseek-v4.1-flash' };
const disposable = { dispose() {} };
const api = {
    workspace: {
        workspaceFolders: [], textDocuments: [],
        getConfiguration: () => ({
            get: (name, fallback) => settings[name] ?? fallback,
            update: async (name, value) => { settings[name] = value; }
        })
    },
    window: {
        activeTextEditor: undefined,
        onDidChangeActiveTextEditor: fn => { listeners.editor = fn; return disposable; },
        onDidChangeTextEditorSelection: fn => { listeners.selection = fn; return disposable; },
        showInformationMessage() {}, showWarningMessage() {}, showErrorMessage() {}
    },
    Position: class { constructor(line, character) { this.line = line; this.character = character; } },
    Selection: class { constructor(start, end) { this.start = start; this.end = end; } },
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    TextEditorRevealType: { InCenter: 1 },
    env: { clipboard: { writeText: async () => {} } },
    ConfigurationTarget: { Global: 1 }
};
const load = Module._load;
Module._load = function(name, ...args) {
    return name === 'vscode' ? api : load.call(this, name, ...args);
};
const { NormaHub1CSidebarProvider } = require('../out/sidebarProvider');
const { NormaHubClient } = require('../out/normahubClient');
const { MetadataScanner } = require('../out/metadataScanner');
Module._load = load;

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

async function run() {
    let key = 'nr_hub_test';
    let scans = 0, balanceChecks = 0, renders = 0, receive;
    const context = {
        subscriptions: [],
        secrets: {
            get: async () => key,
            store: async (_, value) => { key = value; },
            delete: async () => { key = ''; }
        }
    };
    const view = {
        webview: {
            set html(value) { this.renderedHtml = value; renders++; },
            postMessage: value => { messages.push(value); return Promise.resolve(true); },
            onDidReceiveMessage: fn => { receive = fn; return disposable; }
        }
    };
    const gateway = deferred();
    NormaHubClient.checkBalance = async () => { balanceChecks++; return gateway.promise; };
    MetadataScanner.scanWorkspace = async () => {
        scans++;
        return { name: 'Test', objects: [], isDemoFallback: true };
    };
    const provider = new NormaHub1CSidebarProvider({}, context);
    await provider.resolveWebviewView(view, {}, {});
    assert.match(view.webview.renderedHtml, /Проверяем подключение/);
    assert.equal(scans, 0, 'First render must not wait for metadata');
    assert.equal(balanceChecks, 0, 'First render must not wait for network');
    assert.ok(receive, 'Host bridge is registered before rendering');

    api.window.activeTextEditor = {
        document: { fileName: 'Untitled-1', languageId: 'bsl', getText: () => 'ВЫБРАТЬ Ссылка' },
        selection: { isEmpty: false, start: { line: 0 }, end: { line: 1 }, active: {} },
        edit: async fn => { fn({ insert: (_, code) => edits.push(code) }); return true; }
    };
    const ready = receive({ type: 'webviewReady' });
    assert.equal(messages.at(-1).type, 'editorContext');
    assert.equal(messages.at(-1).isBsl, true, 'Untitled BSL is supported');
    gateway.resolve({ status: 'active' });
    await ready;
    assert.equal(messages.at(-1).type, 'sidebarStatus');
    assert.equal(messages.at(-1).metadataAvailable, false);

    for (const request of [
        { type: 'generateBatchTemplate', entity: 'ЗаказКлиента', tabular: 'Товары', register: 'ТоварыНаСкладах' },
        { type: 'generateExtension', method: 'ПриЗаписи', directive: 'Перед', params: 'Отказ' },
        { type: 'generateFormButton', buttonName: 'Кнопка', title: 'Печать', commandName: 'Печать' }
    ]) {
        await receive(request);
        assert.ok(messages.at(-1).code?.length, 'Generator must return real preview code');
        assert.equal(edits.length, 0, 'Generating must not modify an active file');
    }
    await receive({ type: 'insertCode', code: 'Код' });
    assert.deepEqual(edits, ['Код']);
    api.window.activeTextEditor.document.languageId = 'json';
    await receive({ type: 'insertCode', code: 'BSL' });
    assert.equal(edits.length, 1, 'Unsupported file must never receive BSL');
    api.window.activeTextEditor.document.languageId = 'bsl';
    api.window.activeTextEditor.edit = async () => false;
    await receive({ type: 'insertCode', code: 'BSL' });
    assert.match(messages.at(-1).message, /Не удалось вставить/);

    await receive({ type: 'saveKey', value: 'nr_hub_updated' });
    assert.equal(renders, 1, 'Saving key must not discard forms by reloading HTML');
    assert.match(messages.at(-1).maskedKey, /nr_hub_u/);

    const auditedEditor = api.window.activeTextEditor;
    auditedEditor.document.uri = { toString: () => 'untitled:Untitled-1' };
    auditedEditor.document.version = 4;
    auditedEditor.document.lineCount = 100;
    auditedEditor.document.getText = () => 'Предупреждение("Проверка");';
    auditedEditor.selection = { isEmpty: false, start: { line: 40 }, end: { line: 41 }, active: {} };
    auditedEditor.revealRange = () => {};
    await receive({ type: 'auditSelection' });
    assert.equal(messages.at(-1).canJump, true);
    assert.equal(messages.at(-1).issues[0].line, 41, 'Selected fragment offsets must refer to the real file');
    api.workspace.openTextDocument = async uri => {
        assert.equal(uri, auditedEditor.document.uri);
        return auditedEditor.document;
    };
    api.window.showTextDocument = async doc => {
        assert.equal(doc, auditedEditor.document);
        return auditedEditor;
    };
    api.window.activeTextEditor = { document: { fileName: 'ДругойФайл.json', languageId: 'json' } };
    await receive({ type: 'jumpToLine', line: 41 });
    assert.equal(auditedEditor.selection.start.line, 40, 'Jump must use audited file even after active editor changes');
    auditedEditor.document.version = 5;
    await receive({ type: 'jumpToLine', line: 41 });
    assert.match(messages.at(-1).message, /изменён после проверки/);
    await receive({ type: 'auditCodeSnippet', code: 'Предупреждение("Проверка");' });
    assert.equal(messages.at(-1).canJump, false, 'Pasted snippets have no editor navigation target');
    key = '';
    const originalEnv = process.env.NORMAHUB_API_KEY;
    const originalOpenAI = process.env.OPENAI_API_KEY;
    delete process.env.NORMAHUB_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await receive({ type: 'generateQuery', intent: 'Остатки' });
    assert.match(messages.at(-1).error, /API-ключ/);
    key = 'nr_hub_test';
    let calls = 0;
    const completion = deferred();
    NormaHubClient.complete = async (_, model) => {
        calls++;
        assert.equal(model, settings.reasoningModel);
        return completion.promise;
    };
    const first = receive({ type: 'generateQuery', intent: 'Остатки' });
    await new Promise(resolve => setImmediate(resolve));
    await receive({ type: 'generateQuery', intent: 'Повтор' });
    assert.equal(calls, 1, 'Duplicate generation must not create additional paid requests');
    completion.resolve('');
    await first;
    assert.match(messages.at(-1).error, /пустой ответ/);
    NormaHubClient.complete = async () => { throw new Error('Сеть недоступна'); };
    await receive({ type: 'generateQuery', intent: 'Остатки' });
    assert.equal(messages.at(-1).error, 'Сеть недоступна');
    if (originalEnv !== undefined) process.env.NORMAHUB_API_KEY = originalEnv;
    if (originalOpenAI !== undefined) process.env.OPENAI_API_KEY = originalOpenAI;

    const malicious = provider._getHtmlForWebview('<img src=x>', { error: '<script>bad()</script>' }, 'gpt-6-sol');
    assert.ok(!malicious.includes('<script>bad()</script>'));
    assert.ok(malicious.includes('&lt;script&gt;bad()&lt;/script&gt;'));
    console.log('Sidebar host: startup, previews, Untitled, insertion failure, key preservation, duplicate/empty/error generation, HTML escaping and audit-document navigation passed.');
}
run().catch(err => { console.error(err); process.exitCode = 1; });
