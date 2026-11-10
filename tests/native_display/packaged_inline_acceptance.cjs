// Offline, physical Tab/Escape qualification of the installed VSIX provider itself.
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const assert = require('node:assert/strict');

exports.run = async () => {
    const root = process.env.NATIVE_INLINE_ROOT, out = process.env.NATIVE_INLINE_OUTPUT;
    const expectedBundleHash = process.env.NATIVE_INLINE_BUNDLE_HASH;
    const expectedVersion = process.env.NATIVE_INLINE_PACKAGE_VERSION;
    assert.ok(root && out && expectedBundleHash && expectedVersion);
    const corpus = JSON.parse(fs.readFileSync(path.join(root, 'tests/evidence/live-normahub-2026-10-31/run-d/corpus-before-run.json'))).cases;
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'tests/evidence/live-normahub-2026-10-31/run-d/results.json')));
    const raw = new Map(saved.network.filter(item => item.caseId.startsWith('i')).map(item => [item.caseId, item.rawContent]));
    const normalized = new Map([
        ['i01', 'А + Б;'], ['i02', '"Привет!"'], ['i03', 'Стр.Вес;'],
        ['i04', '"Не заполнено значение!";'], ['i05', 'КонецДня(Дата)']
    ]);
    const results = [];
    const write = completed => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({
        completed, app: vscode.env.appName, version: vscode.version, packageVersion: expectedVersion,
        bundleHash: expectedBundleHash, provider: 'installed VSIX; no source-module import',
        debounceMs: Number(process.env.NATIVE_INLINE_DEBOUNCE_MS),
        response: 'frozen actual 1017 raw content through controlled HTTPS boundary; no gateway request',
        physicalInput: 'private X11 Tab/Escape', results
    }, null, 2));
    const originalRequest = https.request;
    let active, unscopedCalls = 0;
    https.request = (url, options, callback) => {
        const target = url instanceof URL ? url : new URL(String(url));
        if (target.hostname !== 'api.normahub.cc') return originalRequest(url, options, callback);
        assert.equal(target.pathname, '/v1/chat/completions', 'Unexpected NormaHub route');
        const request = new EventEmitter();
        let sent = '';
        request.write = chunk => { sent += String(chunk); return true; };
        request.destroy = () => { request.destroyed = true; return request; };
        request.end = () => {
            setImmediate(() => {
                if (request.destroyed) return;
                const payload = JSON.parse(sent);
                assert.equal(payload.model, 'deepseek-v4.1-flash-1017');
                assert.equal(payload.reasoning_effort, 'low');
                assert.equal(options.headers.Authorization, 'Bearer synthetic-packaged-test-key');
                if (!active) { unscopedCalls++; throw new Error('Packaged provider made an unscoped request'); }
                active.transportCalls++;
                active.requestControls.push({ model: payload.model, maxTokens: payload.max_tokens,
                    reasoningEffort: payload.reasoning_effort });
                const response = new EventEmitter();
                response.statusCode = 200;
                callback(response);
                response.emit('data', JSON.stringify({ model: 'deepseek-v4.1-flash',
                    choices: [{ finish_reason: 'stop', message: { content: raw.get(active.id) } }],
                    usage: { prompt_tokens: 12, completion_tokens: 30,
                        completion_tokens_details: { reasoning_tokens: 5 } } }));
                response.emit('end');
            });
            return request;
        };
        return request;
    };
    try {
        const extension = vscode.extensions.getExtension('normahub.1c-bsl-ai-copilot');
        assert.ok(extension);
        assert.equal(extension.packageJSON.version, expectedVersion);
        assert.notEqual(path.resolve(extension.extensionPath), path.resolve(root));
        const bundle = fs.readFileSync(path.join(extension.extensionPath, 'dist/extension.js'));
        assert.equal(crypto.createHash('sha256').update(bundle).digest('hex'), expectedBundleHash);
        assert.equal(process.env.NORMAHUB_API_KEY, undefined, 'No real key in isolated profile');
        await extension.activate();
        assert.ok(extension.isActive);
        for (const test of corpus.filter(item => item.kind === 'inline')) {
            const result = { id: test.id, status: 'pending', action: test.id === 'i05' ? 'Escape' : 'Tab',
                transportCalls: 0 };
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
                active = { id: test.id, transportCalls: 0, requestControls: [] };
                process.env.NORMAHUB_API_KEY = 'synthetic-packaged-test-key';
                await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
                const deadline = Date.now() + 8000;
                while (!active.transportCalls && Date.now() < deadline)
                    await new Promise(resolve => setTimeout(resolve, 30));
                assert.ok(active.transportCalls > 0, 'Installed provider did not call the controlled HTTPS boundary');
                result.preActionTransportCalls = active.transportCalls;
                result.before = before;
                result.expected = before.slice(0, test.prefix.length) + normalized.get(test.id) + before.slice(test.prefix.length);
                fs.writeFileSync(path.join(out, 'ready.json'), JSON.stringify({ id: test.id,
                    action: result.action, expectedGhost: normalized.get(test.id) }));
                const actionFile = path.join(out, 'action-' + test.id + '.json');
                const actionDeadline = Date.now() + 15000;
                while (!fs.existsSync(actionFile) && Date.now() < actionDeadline)
                    await new Promise(resolve => setTimeout(resolve, 40));
                assert.ok(fs.existsSync(actionFile), 'Physical input did not arrive');
                result.physical = JSON.parse(fs.readFileSync(actionFile, 'utf8'));
                await new Promise(resolve => setTimeout(resolve, 700));
                result.transportCalls = active.transportCalls;
                result.postActionTransportCalls = active.transportCalls - result.preActionTransportCalls;
                result.requestControls = [...active.requestControls];
                result.after = document.getText();
                result.status = result.physical.sent === result.action &&
                    (result.action === 'Tab' ? result.after === result.expected : result.after === before)
                    ? (result.action === 'Tab' ? 'native_exact_tab_insertion' : 'native_escape_rejection')
                    : 'physical_acceptance_failed';
                if (document.isDirty) await document.save();
            } catch (error) {
                result.status = 'harness_error'; result.error = String(error.stack || error);
            } finally {
                delete process.env.NORMAHUB_API_KEY;
                active = undefined;
                results.push(result); write(false);
            }
        }
    } finally {
        delete process.env.NORMAHUB_API_KEY;
        https.request = originalRequest;
    }
    write(true);
    assert.equal(unscopedCalls, 0);
    assert.ok(results.every(item => item.status === 'native_exact_tab_insertion' || item.status === 'native_escape_rejection'),
        'Installed VSIX physical acceptance failed; inspect results.json');
    if (process.env.NATIVE_INLINE_REQUIRE_NO_POST_ACTION === '1') {
        assert.ok(results.every(item => item.preActionTransportCalls === 1 && item.postActionTransportCalls === 0),
            'Installed VSIX made an extra request after Tab/Escape; inspect results.json');
    }
};
