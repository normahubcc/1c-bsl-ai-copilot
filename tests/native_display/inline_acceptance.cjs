// Offline replay through the actual source provider and physical Tab on a private display.
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

exports.run = async () => {
    const root = process.env.NATIVE_INLINE_ROOT, out = process.env.NATIVE_INLINE_OUTPUT;
    assert.ok(root && out);
    const records = JSON.parse(fs.readFileSync(path.join(root, 'tests/evidence/live-normahub-2026-10-31/run-d/results.json')));
    const corpus = JSON.parse(fs.readFileSync(path.join(root, 'tests/evidence/live-normahub-2026-10-31/run-d/corpus-before-run.json'))).cases;
    const raw = new Map(records.network.filter(item => item.caseId.startsWith('i')).map(item => [item.caseId, item.rawContent]));
    const { BSLInlineCompletionProvider } = require(path.join(root, 'out/inlineCompletionProvider'));
    const { NormaHubClient: Client } = require(path.join(root, 'out/normahubClient'));
    const companion = vscode.extensions.getExtension('copilot.test-boundary');
    const context = await companion.activate();
    const primary = vscode.extensions.getExtension('normahub.1c-bsl-ai-copilot');
    assert.ok(primary);
    await primary.activate();
    const originalKey = Client.getApiKey, originalComplete = Client.complete;
    let active;
    Client.getApiKey = async () => 'synthetic-in-memory-key';
    Client.complete = async () => { assert.ok(active, 'Unexpected inference'); active.transportCalls++;
        return raw.get(active.id); };
    const provider = new BSLInlineCompletionProvider(context);
    const actualProvide = provider.provideInlineCompletionItems.bind(provider);
    provider.provideInlineCompletionItems = async (...args) => {
        const [document] = args;
        if (active && document.uri.toString() === active.uri && document.version === active.version)
            active.providerInvocations++;
        const value = await actualProvide(...args);
        const items = Array.isArray(value) ? value : value?.items ?? [];
        if (active && document.uri.toString() === active.uri && document.version === active.version && items.length) {
            active.offered = items.map(item => ({ text: typeof item.insertText === 'string' ? item.insertText : item.insertText.value,
                start: [item.range.start.line, item.range.start.character], end: [item.range.end.line, item.range.end.character] }));
        }
        return value;
    };
    const registration = vscode.languages.registerInlineCompletionItemProvider({ language: 'bsl', scheme: 'file' }, provider);
    const results = [];
    const write = completed => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({
        completed, app: vscode.env.appName, version: vscode.version, sourceProvider: true,
        response: 'frozen actual 1017 raw content; no gateway request', physicalInput: 'private X11 Tab/Escape', results
    }, null, 2));
    try {
        for (const test of corpus.filter(item => item.kind === 'inline')) {
            const result = { id: test.id, status: 'pending', providerInvocations: 0, transportCalls: 0,
                action: test.id === 'i05' ? 'Escape' : 'Tab' };
            try {
                const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, test.id + '.bsl');
                const before = test.prefix + test.suffix;
                await vscode.workspace.fs.writeFile(uri, Buffer.from(before, 'utf8'));
                const document = await vscode.workspace.openTextDocument(uri);
                const editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
                assert.equal(document.languageId, 'bsl');
                const position = document.positionAt(test.prefix.length);
                editor.selection = new vscode.Selection(position, position);
                await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
                active = { id: test.id, uri: uri.toString(), version: document.version, providerInvocations: 0,
                    transportCalls: 0, offered: [] };
                await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
                const offeredDeadline = Date.now() + 8000;
                while (!active.offered.length && Date.now() < offeredDeadline)
                    await new Promise(resolve => setTimeout(resolve, 30));
                result.providerInvocations = active.providerInvocations;
                result.transportCalls = active.transportCalls;
                result.offered = active.offered;
                result.before = before;
                result.documentVersion = active.version;
                assert.equal(active.offered.length, 1, 'Source provider did not offer one item');
                const offered = active.offered[0];
                const start = document.offsetAt(new vscode.Position(...offered.start));
                const end = document.offsetAt(new vscode.Position(...offered.end));
                result.expected = before.slice(0, start) + offered.text + before.slice(end);
                fs.writeFileSync(path.join(out, 'ready.json'), JSON.stringify({ id: test.id, action: result.action,
                    expectedGhost: offered.text }));
                const actionFile = path.join(out, 'action-' + test.id + '.json');
                const deadline = Date.now() + 15000;
                while (!fs.existsSync(actionFile) && Date.now() < deadline)
                    await new Promise(resolve => setTimeout(resolve, 40));
                assert.ok(fs.existsSync(actionFile), 'Physical input did not arrive');
                result.physical = JSON.parse(fs.readFileSync(actionFile, 'utf8'));
                await new Promise(resolve => setTimeout(resolve, 200));
                result.after = document.getText();
                result.status = result.physical.sent === result.action &&
                    (result.action === 'Tab' ? result.after === result.expected : result.after === before)
                    ? (result.action === 'Tab' ? 'native_exact_tab_insertion' : 'native_escape_rejection')
                    : 'physical_acceptance_failed';
                if (document.isDirty) await document.save();
            } catch (error) {
                result.status = 'harness_error'; result.error = String(error.stack || error);
            } finally { active = undefined; results.push(result); write(false); }
        }
    } finally {
        registration.dispose(); provider.dispose();
        Client.getApiKey = originalKey; Client.complete = originalComplete;
    }
    write(true);
    assert.ok(results.every(item => item.status === 'native_exact_tab_insertion' || item.status === 'native_escape_rejection'),
        'Physical Tab/Escape replay failed; inspect results.json');
};
