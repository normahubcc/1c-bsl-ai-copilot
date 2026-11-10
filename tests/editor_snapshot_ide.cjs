// Run via --extensionTestsPath in an isolated real VS Code/Cursor profile.
const vscode = require('vscode'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

exports.run = async function () {
    const root = process.env.SNAPSHOT_REPOSITORY, evidence = process.env.SNAPSHOT_IDE_EVIDENCE;
    assert.ok(root && evidence);
    const output = path.join(evidence, 'results.json'), results = [];
    let completed = false;
    const hash = text => createHash('sha256').update(text, 'utf16le').digest('hex');
    const write = () => fs.writeFileSync(output, JSON.stringify({ app: vscode.env.appName, version: vscode.version,
        source: root, packagedVsix: false, transport: 'controlled; no gateway request', completed, results }, null, 2));
    const check = async (name, action) => {
        try { const detail = await action(); results.push({ name, pass: true, detail }); }
        catch (error) { results.push({ name, pass: false, error: String(error.stack || error) }); }
        write();
    };
    const until = async predicate => {
        const end = Date.now() + 8000;
        while (!predicate() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25));
        assert.ok(predicate(), 'Timed out waiting for a native event');
    };
    const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
    const extension = vscode.extensions.getExtension('normahub.1c-bsl-ai-copilot');
    await check('source development candidate activates in the actual extension host', async () => {
        assert.ok(extension); assert.equal(path.resolve(extension.extensionPath), path.resolve(root));
        await extension.activate(); assert.ok(extension.isActive); assert.equal(vscode.workspace.isTrusted, true);
        assert.ok(!process.env.NORMAHUB_API_KEY && !process.env.OPENAI_API_KEY);
        return { path: extension.extensionPath, version: extension.packageJSON.version };
    });
    const { PreviewStore, captureEditorTarget } = require(path.join(root, 'out/features/apply-code/model/previewStore'));
    const { captureTaskContext, captureSnippetContext, runAiTask } = require(path.join(root, 'out/features/ai-task/api/runTask'));
    const { taskContextIsCurrent } = require(path.join(root, 'out/entities/editor-snapshot/api/taskContext'));
    const { NormaHubClient: Client } = require(path.join(root, 'out/normahubClient'));
    const { watchMetadataChanges } = require(path.join(root, 'out/features/project-context/model/watchMetadata'));
    const oldKey = Client.getApiKey, oldComplete = Client.complete;
    Client.getApiKey = async () => 'synthetic-in-memory-test-key';
    Client.complete = async () => 'Запрос = Новый Запрос;';
    const subscriptions = watchMetadataChanges();
    const context = { subscriptions: [], secrets: {} };
    const a = vscode.workspace.workspaceFolders.find(folder => folder.name === 'a');
    const b = vscode.workspace.workspaceFolders.find(folder => folder.name === 'b');
    assert.ok(a && b, 'Two explicit fixture folders are required');
    const open = async folder => vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, 'Module.bsl')));
    const binding = result => ({ task: result.task, contentHash: result.contentHash, isCurrent: result.isCurrent });
    try {
        await check('native unsaved UTF-16/CRLF replacement and Undo preserve source and once-only semantics', async () => {
            const document = await vscode.workspace.openTextDocument({ language: 'bsl', content: 'А😀\r\nБета' });
            const editor = await vscode.window.showTextDocument(document), original = document.getText();
            editor.selection = new vscode.Selection(1, 0, 1, 4);
            const target = captureEditorTarget('Бета'), store = new PreviewStore(), preview = store.add('Замена', 'bsl', target);
            assert.equal(target.offsets.start, 5); assert.equal(target.source.contentHash, hash(original));
            await store.apply(preview.previewId); assert.equal(document.getText(), 'А😀\r\nЗамена');
            await assert.rejects(store.apply(preview.previewId), /устарел/);
            await vscode.commands.executeCommand('undo'); assert.equal(document.getText(), original);
            return { language: document.languageId, eol: document.eol, offsets: target.offsets, sourceHash: target.source.contentHash };
        });
        await check('native edits after capture reject the old preview without modifying the new buffer', async () => {
            const editor = await open(a), store = new PreviewStore(), preview = store.add('WRONG_INSERT', 'bsl', captureEditorTarget());
            await editor.edit(builder => builder.insert(new vscode.Position(0, 0), '// own change\n'));
            const current = editor.document.getText();
            await assert.rejects(store.apply(preview.previewId), /изменён/); assert.equal(editor.document.getText(), current);
            await editor.document.save();
            return { currentVersion: editor.document.version };
        });
        await check('multi-root AI capture keeps project A and its requested route after focus moves to B', async () => {
            await open(a); const captured = captureTaskContext(), gate = deferred();
            let reached = false, request;
            Client.complete = async (...args) => { reached = true; request = args; return gate.promise; };
            const pending = runAiTask(context, 'query', 'Own fixture request', captured); await until(() => reached);
            await open(b); gate.resolve('Запрос = Новый Запрос;'); const result = await pending;
            assert.equal(result.sourceCurrent, true); assert.equal(captured.projectUri, a.uri.toString());
            assert.equal(result.task.origin, 'editor'); assert.equal(result.executionVerified, false);
            assert.ok(request[2].includes('FixtureA')); assert.ok(!request[2].includes('FixtureB'));
            return { projectUri: captured.projectUri, taskId: result.task.taskId, metadataPromptHash: result.task.metadataPromptHash };
        });
        await check('a late native-document response remains readable while its source-bound apply is refused', async () => {
            const editor = await open(a), target = captureEditorTarget(), gate = deferred(); let reached = false;
            Client.complete = async () => { reached = true; return gate.promise; };
            const pending = runAiTask(context, 'query', 'Own fixture request', captureTaskContext()); await until(() => reached);
            await editor.edit(builder => builder.insert(new vscode.Position(0, 0), '// changed during request\n'));
            gate.resolve('Запрос = Новый Запрос;'); const result = await pending;
            assert.equal(result.sourceCurrent, false); const store = new PreviewStore(), preview = store.add(result.code, 'bsl', target, binding(result));
            await store.open(preview.previewId); const current = editor.document.getText();
            await assert.rejects(store.apply(preview.previewId), /изменён/); assert.equal(editor.document.getText(), current);
            await editor.document.save(); return { generationStatus: result.generationStatus, sourceCurrent: result.sourceCurrent };
        });
        await check('real saved metadata watcher invalidates an unchanged source candidate', async () => {
            await open(a); Client.complete = async () => 'Запрос = Новый Запрос;';
            const target = captureEditorTarget(), result = await runAiTask(context, 'query', 'Own fixture request', captureTaskContext());
            const store = new PreviewStore(), preview = store.add(result.code, 'bsl', target, binding(result));
            fs.writeFileSync(path.join(a.uri.fsPath, 'metadata.json'), JSON.stringify({ name: 'FixtureA_changed', objects: [] }));
            await until(() => !result.isCurrent());
            await assert.rejects(store.apply(preview.previewId), /контекст изменился/);
            return { observedMetadataInvalidation: true };
        });
        await check('native last-tab close/reopen invalidates the capture even when text is unchanged', async () => {
            const editor = await open(a); await editor.document.save();
            const captured = captureTaskContext(), target = captureEditorTarget(), store = new PreviewStore(), preview = store.add('WRONG_INSERT', 'bsl', target);
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await until(() => !taskContextIsCurrent(captured));
            const reopened = await open(a);
            await assert.rejects(store.apply(preview.previewId), /закрыт|переоткрыт|изменён/);
            return { oldDocumentClosed: editor.document.isClosed, sameObjectAfterReopen: editor.document === reopened.document };
        });
        await check('native pasted-code explanation does not borrow active project metadata', async () => {
            await open(b); let prompt;
            Client.complete = async (...args) => { prompt = args[2]; return 'Own controlled explanation'; };
            const result = await runAiTask(context, 'explain', 'Explain own snippet', captureSnippetContext('Значение = 1;'));
            assert.equal(result.task.origin, 'snippet'); assert.equal(result.task.sourceSnapshotHash, null);
            assert.ok(!prompt.includes('FixtureA') && !prompt.includes('FixtureB')); return { origin: result.task.origin };
        });
        await check('native serialized captures cannot manufacture host capture capability', async () => {
            await open(a); const captured = captureTaskContext(); let reads = 0;
            Client.getApiKey = async () => { reads++; return 'unused'; };
            await assert.rejects(runAiTask(context, 'query', 'Own request', JSON.parse(JSON.stringify(captured))), /не захвачен/);
            assert.equal(reads, 0); return { keyReads: reads };
        });
    } finally {
        Client.getApiKey = oldKey; Client.complete = oldComplete;
        subscriptions.forEach(subscription => subscription.dispose());
    }
    completed = true;
    write();
    assert.ok(results.every(result => result.pass), 'Native snapshot checks failed; inspect results.json');
};
