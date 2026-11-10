// Native host/files/report probe. Dialog selection and AI key/complete are controlled.
const vscode = require('vscode'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

exports.run = async function () {
    const root = process.env.SNAPSHOT_REPOSITORY, evidence = process.env.SNAPSHOT_IDE_EVIDENCE;
    assert.ok(root && evidence);
    const results = [];
    const write = completed => fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({
        app: vscode.env.appName, version: vscode.version, source: root, packagedVsix: false,
        transport: 'controlled; no gateway request', dialog: 'controlled selection; native file and editor APIs', completed, results
    }, null, 2));
    const check = async (name, run) => {
        try { results.push({ name, pass: true, detail: await run() }); }
        catch (error) { results.push({ name, pass: false, error: String(error.stack || error) }); }
        write(false);
    };
    const extension = vscode.extensions.getExtension('normahub.1c-bsl-ai-copilot');
    await check('development bundle activates from the selected dirty source', async () => {
        assert.ok(extension); assert.equal(path.resolve(extension.extensionPath), path.resolve(root));
        await extension.activate(); assert.ok(extension.isActive); assert.ok(vscode.workspace.isTrusted);
        assert.ok(!process.env.NORMAHUB_API_KEY && !process.env.OPENAI_API_KEY);
        return { path: extension.extensionPath };
    });
    const { PreviewStore, captureEditorTarget } = require(path.join(root, 'out/features/apply-code/model/previewStore'));
    const { PreviewComparison } = require(path.join(root, 'out/app/validation/api/previewComparison'));
    const { captureTaskContext, runAiTask } = require(path.join(root, 'out/features/ai-task/api/runTask'));
    const { NormaHubClient: Client } = require(path.join(root, 'out/normahubClient'));
    const oldKey = Client.getApiKey, oldComplete = Client.complete;
    Client.getApiKey = async () => 'synthetic-in-memory-test-key'; Client.complete = async () => 'Запрос = Новый Запрос;';
    const folder = vscode.workspace.workspaceFolders[0];
    const open = async () => vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, 'Module.bsl')));
    const store = new PreviewStore();
    let preview, document, candidate, selected, duringPick;
    const controller = new PreviewComparison(store, () => 'en', async () => { if (duringPick) await duringPick(); return selected; });
    const table = rows => ({ columns: ['Товар', 'Дефицит'], rows: rows.map(([item, count]) => [
        { type: 'string', value: item }, { type: 'number', value: count }]) });
    const packet = actual => ({ schemaVersion: 1, operation: 'compare_provided_query_result', candidate,
        contract: { schemaVersion: 1, id: 'own.deficit', version: 1, projectId: candidate.scopeHash,
            intent: 'Two rows of six, stock ten: deficit two.', requirement: { reference: 'own/duplicates', sha256: 'a'.repeat(64) },
            scope: { metadataHash: 'b'.repeat(64), profileId: 'declared-only', platformVersion: '8.3.27.1508' },
            preconditions: ['One item and warehouse.'], assumptions: [], approvalState: 'proposed',
            assertion: { kind: 'query_rows_equal', mode: 'multiset', expected: table([['A', '2']]) } }, actual });
    const choose = value => {
        const file = path.join(evidence, 'own-comparison-package.json');
        fs.writeFileSync(file, JSON.stringify(value)); selected = [vscode.Uri.file(file)];
    };
    try {
        await check('host exports a real query candidate descriptor without source contents or fabricated expectations', async () => {
            const editor = await open(); document = editor.document;
            const target = captureEditorTarget(), result = await runAiTask({ subscriptions: [] }, 'query', 'Own test requirement', captureTaskContext());
            preview = store.add(result.code, 'bsl', target, { task: result.task, contentHash: result.contentHash, isCurrent: result.isCurrent });
            assert.equal(preview.comparisonAvailable, true);
            await controller.exportRequest(preview.previewId);
            const doc = vscode.window.activeTextEditor.document; assert.equal(doc.languageId, 'json');
            const request = JSON.parse(doc.getText()); candidate = request.candidate;
            assert.equal(request.operation, 'query_comparison_request'); assert.equal(candidate.taskId, result.task.taskId);
            assert.ok(!('contract' in request)); assert.ok(!doc.getText().includes('Процедура'));
            return { sourceVersion: document.version, candidateHash: candidate.candidateHash, taskId: candidate.taskId };
        });
        await check('a selected real local package produces native EN differences and does not edit the source', async () => {
            const original = document.getText(), version = document.version;
            choose(packet(table([])));
            assert.equal(await controller.compare(preview.previewId), 'completed');
            const report = vscode.window.activeTextEditor.document;
            assert.equal(report.languageId, 'markdown'); assert.match(report.getText(), /Missing rows: 1/);
            assert.match(report.getText(), /1C execution is unconfirmed/); assert.match(report.getText(), /"canApply": false/);
            assert.equal(document.getText(), original); assert.equal(document.version, version);
            fs.writeFileSync(path.join(evidence, 'difference-report.md'), report.getText());
            return { missingRows: 1, sourceUnchanged: true, engineStatus: 'not_run' };
        });
        await check('matching supplied data completes locally with execution and approval still unconfirmed', async () => {
            choose(packet(table([['A', '2']]))); await controller.compare(preview.previewId);
            const report = vscode.window.activeTextEditor.document.getText();
            assert.match(report, /The supplied rows match/); assert.match(report, /"executionVerified": false/);
            assert.match(report, /"approvalVerified": false/); assert.ok(store.captureQueryCandidate(preview.previewId).isCurrent());
            return { suppliedRowsMatch: true, executionVerified: false, approvalVerified: false };
        });
        await check('a foreign candidate package cannot open a native comparison report', async () => {
            const source = packet(table([])); source.candidate = { ...source.candidate, taskId: 'another-task' }; choose(source);
            const before = vscode.window.activeTextEditor.document;
            await assert.rejects(controller.compare(preview.previewId), /другому кандидату/);
            assert.equal(vscode.window.activeTextEditor.document, before); return { rejected: true };
        });
        await check('cancelled selection creates no report and a new attempt remains available', async () => {
            selected = undefined; const before = vscode.window.activeTextEditor.document;
            assert.equal(await controller.compare(preview.previewId), 'cancelled');
            assert.equal(vscode.window.activeTextEditor.document, before);
            return { cancelled: true, sourceStillCurrent: store.captureQueryCandidate(preview.previewId).isCurrent() };
        });
        await check('native source editing during package selection invalidates the job before comparison', async () => {
            choose(packet(table([['A', '2']])));
            duringPick = async () => {
                const editor = await open(); await editor.edit(edit => edit.insert(new vscode.Position(0, 0), '// own later edit\n'));
            };
            await assert.rejects(controller.compare(preview.previewId), /контекст изменился/);
            assert.match(document.getText(), /^\/\/ own later edit/); await document.save();
            return { sourceVersionAfterEdit: document.version, rejected: true };
        });
    } finally { Client.getApiKey = oldKey; Client.complete = oldComplete; }
    write(true);
    assert.ok(results.every(result => result.pass), 'Native comparison checks failed; inspect results.json');
};
