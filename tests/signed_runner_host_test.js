'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const crypto = require('node:crypto'), Module = require('node:module');
const { profile: makeProfile, request: makeRequest, table, isolation, hash } = require('./helpers/runnerData');
const { localScopeHash } = require('../out/entities/editor-snapshot/model/snapshot');
const { parseRunnerRequest } = require('../out/entities/runner/model/queryJob');
const { signRunnerReceipt } = require('../out/entities/runner/model/receipt');
class EventEmitter {
    listeners = new Set(); event = fn => { this.listeners.add(fn); return { dispose: () => this.listeners.delete(fn) }; };
    fire(value) { for (const fn of this.listeners) fn(value); } dispose() { this.listeners.clear(); }
}
const events = { edit: new EventEmitter(), close: new EventEmitter(), tabs: new EventEmitter(), folders: new EventEmitter() };
const providers = new Map(), docs = new Map(); let shown, sourceCurrent = true;
const uri = (scheme, file) => ({ scheme, path: file, fsPath: file, toString: () => scheme + ':' + file });
const projectUri = 'file:///own-project', scopeHash = localScopeHash(projectUri, 'file:///own-project/Module.bsl');
const vscode = {
    EventEmitter, Uri: { from: v => uri(v.scheme, v.path) },
    workspace: { isTrusted: true, onDidChangeTextDocument: events.edit.event, onDidCloseTextDocument: events.close.event,
        onDidChangeWorkspaceFolders: events.folders.event,
        registerTextDocumentContentProvider(scheme, provider) { providers.set(scheme, provider); return { dispose() { providers.delete(scheme); } }; },
        async openTextDocument(value) {
            if (value.scheme) { if (!docs.has(value.toString())) docs.set(value.toString(), { uri: value, languageId: 'markdown', getText: () => providers.get(value.scheme).provideTextDocumentContent(value) }); return docs.get(value.toString()); }
            return { uri: uri('untitled', String(docs.size)), languageId: value.language, getText: () => value.content };
        }
    }, window: { tabGroups: { onDidChangeTabs: events.tabs.event }, async showTextDocument(doc) { shown = doc; return { document: doc }; } }
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscode;
    if (request.endsWith('/taskContext') && parent.filename.endsWith('/previewValidation.js')) return {
        captureTaskContext: () => ({ projectUri, source: { sourceUri: 'file:///own-project/Module.bsl' } }), taskContextIsCurrent: () => sourceCurrent
    };
    return load.call(this, request, parent, isMain);
};
const { PreviewValidation } = require('../out/app/validation/api/previewValidation');
Module._load = load;
const keys = crypto.generateKeyPairSync('ed25519');
const profile = { ...makeProfile(keys.publicKey), projectId: scopeHash }, raw = makeRequest(profile);
const connection = { schemaVersion: 1, profile, publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
const map = new Map(), context = { globalState: { get: k => map.get(k), async update(k, v) { if (v === undefined) map.delete(k); else map.set(k, v); } } };
let action, selectedFile, approve = true, duringPick, duringConfirm, confirmation;
const ui = {
    async pick(items) { if (duringPick) await duringPick(); return items.find(i => i.action === action); },
    async file() { return selectedFile ? [uri('file', selectedFile)] : undefined; },
    async confirm(message, options, label) { confirmation = { message, options, label }; if (duringConfirm) await duringConfirm(); return approve ? label : undefined; }
};
const artifact = { identity: raw.candidate, code: raw.candidateCode, scopeLabel: projectUri, isCurrent: () => sourceCurrent };
const previews = { captureQueryArtifact() { if (!sourceCurrent) throw Error('source changed'); return artifact; } };
let comparisons = 0, exportCalls = 0, language = 'en';
const controller = new PreviewValidation(context, previews, () => language,
    { async compare() { comparisons++; }, async exportRequest() { exportCalls++; } }, ui);
const tests = [], test = (name, run) => tests.push({ name, run }); let directory, job, report;
async function select(value) { selectedFile = path.join(directory, 'chosen.json'); await fs.writeFile(selectedFile, JSON.stringify(value)); }
function signed(actual = table()) {
    const time = new Date().toISOString(); return { schemaVersion: 1, operation: 'signed_query_result', jobId: job.challenge.jobId,
        receipt: signRunnerReceipt(parseRunnerRequest(job.request), profile, job.challenge, {
            schemaVersion: 1, nonce: job.challenge.nonce, platformVersion: profile.platformVersion, binaryHash: profile.binaryHash,
            status: 'completed', actual, reason: null, logHash: hash('controlled host')
        }, isolation(), keys.privateKey.export({type:'pkcs8', format:'pem'}).toString(), time, time) };
}
test('Profile onboarding exports the actual scope before any AI task or key connection', async () => {
    action = 'scope'; await controller.manageProfile();
    assert.deepEqual(JSON.parse(shown.getText()), { schemaVersion: 1, operation: 'runner_project_descriptor', projectId: scopeHash, projectUri });
    assert.equal(map.size, 0);
});
test('Native pin confirmation exposes the full fingerprint, cancel and stale confirmation persist nothing', async () => {
    action = 'connect'; await select(connection); approve = false; await controller.manageProfile();
    assert.equal(map.size, 0); assert.equal(confirmation.options.modal, true); assert.match(confirmation.options.detail, new RegExp(profile.keyId));
    assert.match(confirmation.message, /Connect/); assert.equal(confirmation.label, 'Pin profile');
    approve = true; duringConfirm = () => { sourceCurrent = false; };
    await assert.rejects(controller.manageProfile(), /контекст изменился/); assert.equal(map.size, 0);
    sourceCurrent = true; duringConfirm = undefined;
    await select({ ...connection, profile: { ...profile, projectId: hash('foreign') } });
    await assert.rejects(controller.manageProfile(), /другому проекту/); assert.equal(map.size, 0);
    await select(connection); await controller.manageProfile(); assert.equal(map.size, 1);
});
test('A busy native menu cannot duplicate preparation; cancellation and supplied-data routes remain usable', async () => {
    action = 'compare'; duringPick = async () => { await assert.rejects(controller.menu('preview'), /уже открыта/); };
    await controller.menu('preview'); assert.equal(comparisons, 1); duringPick = undefined;
    action = 'export'; await controller.menu('preview'); assert.equal(exportCalls, 1);
    action = undefined; const before = shown; await controller.menu('preview'); assert.equal(shown, before);
});
test('Host preparation and local signed import show a virtual report and never write the source', async () => {
    action = 'prepare'; await select({ schemaVersion: 1, operation: 'query_validation_plan', selection: raw.selection, contract: raw.contract });
    await controller.menu('preview'); job = JSON.parse(shown.getText()); assert.equal(job.request.candidateCode, artifact.code);
    action = 'import'; await select(signed()); await controller.menu('preview'); report = shown;
    assert.match(report.uri.scheme, /^normahub-runner-/); assert.match(report.getText(), /The supplied expectations match/);
    assert.match(report.getText(), /"queryExecutionVerified": true/); assert.match(report.getText(), /"canApply": false/);
    assert.equal(artifact.code, raw.candidateCode); assert.equal(providers.size, 1);
    let repairs = 0; const subscription = providers.get(report.uri.scheme).onDidChange(() => { repairs++; });
    events.edit.fire({ document: { uri: report.uri, getText: () => 'tampered display' } }); assert.equal(repairs, 1);
    events.edit.fire({ document: report }); assert.equal(repairs, 1, 'canonical provider update must not loop'); subscription.dispose();
});
test('Source events and RU/EN switching update already open reports, stale imports fail and historical reports remain readable', async () => {
    sourceCurrent = false; events.edit.fire({ document: { uri: uri('file', '/own-project/Module.bsl') } });
    assert.match(report.getText(), /no longer current/); assert.match(report.getText(), /"queryExecutionVerified": false/);
    action = 'import'; await controller.menu('preview'); assert.equal(shown, report); // historical report route for stale preview
    language = 'ru'; controller.refreshReports(); assert.match(report.getText(), /больше не актуален/);
    language = 'en'; sourceCurrent = true;
});
test('Disconnecting a profile updates the existing report and prevents reuse of its pending job', async () => {
    action = 'revoke'; await controller.manageProfile(); assert.equal(map.size, 0);
    assert.match(report.getText(), /Trust in this result has been revoked/); assert.match(report.getText(), /"queryExecutionVerified": false/);
    action = 'connect'; await select(connection); await controller.manageProfile();
    action = 'import'; await select(signed()); await assert.rejects(controller.menu('preview'), /изменён или отключён/);
});
test('Untrusted workspaces cannot configure a validation profile and disposal unregisters reports', async () => {
    vscode.workspace.isTrusted = false; await assert.rejects(controller.manageProfile(), /доверенная/);
    vscode.workspace.isTrusted = true; controller.dispose(); assert.equal(providers.size, 0);
});
(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-native-boundary-'));
    try { for (const { name, run } of tests) { await run(); console.log('  ✓ ' + name); }
        console.log(`Signed runner native adapter: ${tests.length} groups passed; controlled VS Code boundary.`);
    } finally { controller.dispose(); await fs.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
