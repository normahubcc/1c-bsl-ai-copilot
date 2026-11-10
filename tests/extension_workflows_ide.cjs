// Actual IDE source modules, real native Memento/files/editor and real own 1C runner.
// AI response, native file choices and pin confirmation are controlled test boundaries.
const vscode = require('vscode'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { execFile } = require('node:child_process');
const { promisify } = require('node:util');
exports.run = async function () {
    const root = process.env.SNAPSHOT_REPOSITORY, evidence = process.env.SNAPSHOT_IDE_EVIDENCE;
    const profileFile = process.env.SNAPSHOT_RUNNER_PROFILE, keyDirectory = process.env.SNAPSHOT_RUNNER_KEYS, node = process.env.SNAPSHOT_RUNNER_NODE;
    assert.ok(root && evidence && profileFile && keyDirectory && node);
    const results = [], write = completed => fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({
        app: vscode.env.appName, version: vscode.version, source: root, packagedVsix: false,
        transport: 'controlled; no gateway request', dialogs: 'controlled choices and confirmation',
        native: 'real files, editor, virtual documents and companion extension Memento', engine: 'own isolated pinned 1C query runner', completed, results
    }, null, 2));
    const check = async (name, run) => {
        try { results.push({ name, pass: true, detail: await run() }); }
        catch (error) { results.push({ name, pass: false, error: String(error.stack || error), operatorDiagnostic: String(error.stdout || '') + String(error.stderr || '') }); }
        write(false);
    };
    const extension = vscode.extensions.getExtension('normahub.1c-bsl-ai-copilot');
    let context;
    await check('development bundle activates and a new native extension Memento supplies the pin storage', async () => {
        assert.ok(extension); assert.equal(path.resolve(extension.extensionPath), path.resolve(root));
        await extension.activate(); assert.ok(extension.isActive && vscode.workspace.isTrusted);
        context = await vscode.extensions.getExtension('copilot.test-boundary').activate();
        assert.ok(context.globalState); assert.ok(!process.env.NORMAHUB_API_KEY && !process.env.OPENAI_API_KEY);
        assert.ok((await vscode.commands.getCommands()).includes('normahub1c.manageQueryRunner'));
        return { sourcePath: root, pinStorage: 'real Memento under isolated companion test extension namespace' };
    });
    const { PreviewStore, captureEditorTarget } = require(path.join(root, 'out/features/apply-code/model/previewStore'));
    const { PreviewReview } = require(path.join(root, 'out/app/review/api/previewReview'));
    const { PreviewValidation } = require(path.join(root, 'out/app/validation/api/previewValidation'));
    const { RunnerTrustStore } = require(path.join(root, 'out/features/manage-runner-trust/model/runnerTrustStore'));
    const { localScopeHash } = require(path.join(root, 'out/entities/editor-snapshot/model/snapshot'));
    const { captureTaskContext, runAiTask } = require(path.join(root, 'out/features/ai-task/api/runTask'));
    const { NormaHubClient: Client } = require(path.join(root, 'out/normahubClient'));
    const oldKey = Client.getApiKey, oldComplete = Client.complete;
    // Exact query over the independently specified fixture: two six-unit rows, stock ten => deficit two.
    const query = `ВЫБРАТЬ Строки.Товар КАК Товар, Строки.Требуется - ЕСТЬNULL(Остатки.КоличествоОстаток, 0) КАК Дефицит
ИЗ (ВЫБРАТЬ Строки.Товар КАК Товар, Строки.Склад КАК Склад, СУММА(Строки.Вес) КАК Требуется
ИЗ Документ.Заказ.Товары КАК Строки ГДЕ Строки.Ссылка = &Ссылка
СГРУППИРОВАТЬ ПО Строки.Товар, Строки.Склад) КАК Строки
ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.ТоварыНаСкладах.Остатки(&Дата, ) КАК Остатки
ПО Строки.Товар = Остатки.Номенклатура И Строки.Склад = Остатки.Склад
ГДЕ Строки.Требуется > ЕСТЬNULL(Остатки.КоличествоОстаток, 0)`;
    const code = 'Запрос = Новый Запрос;\nВызватьИсключение "SURROUNDING_BSL_MUST_NOT_RUN";\nЗапрос.Текст = "' + query.replace(/"/g, '""').replace(/\n/g, '\n|') + '";';
    Client.getApiKey = async () => 'synthetic-in-memory-key'; Client.complete = async () => code;
    const folder = vscode.workspace.workspaceFolders[0], sourceUri = vscode.Uri.joinPath(folder.uri, 'Module.bsl');
    const open = async () => vscode.window.showTextDocument(await vscode.workspace.openTextDocument(sourceUri));
    const profile = { ...JSON.parse(fs.readFileSync(profileFile, 'utf8')), projectId: localScopeHash(folder.uri.toString(), sourceUri.toString()) };
    const ownProfileFile = path.join(evidence, 'profile.json'); fs.writeFileSync(ownProfileFile, JSON.stringify(profile, null, 2));
    const connection = { schemaVersion: 1, profile, publicKeyPem: fs.readFileSync(path.join(keyDirectory, 'public.pem'), 'utf8') };
    fs.writeFileSync(path.join(evidence, 'public-connection.json'), JSON.stringify(connection, null, 2));
    let wizardInputs = [], wizardChoices = [];
    let selected, action, preview, sourceDocument, original, job, packet, report, confirms = 0;
    const store = new PreviewStore(), controller = new PreviewValidation(context, store, () => 'en', {}, {
        async input(options) { const value = wizardInputs.shift(); assert.notEqual(value, undefined); assert.equal(options.validateInput(value), undefined); return value; },
        async pick(items) { const desired = items.some(i => i.action === action) ? action : wizardChoices.shift(); const item = items.find(i => i.action === desired); assert.ok(item, 'action available: ' + action); return item; },
        async file() { return selected ? [vscode.Uri.file(selected)] : undefined; },
        async confirm(message, options, label) { confirms++; assert.equal(options.modal, true); if (message.includes('profile for this project')) assert.ok(options.detail.includes(profile.keyId)); else assert.ok(options.detail.includes('not an approved business contract')); return label; }
    });
    const choose = (file, value) => { selected = path.join(evidence, file); fs.writeFileSync(selected, JSON.stringify(value, null, 2)); };
    const waitReport = async pattern => { const deadline = Date.now() + 5000;
        while (!pattern.test(report.getText()) && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
        assert.match(report.getText(), pattern);
    };
    try {
        await check('operator profile is explicitly confirmed and pinned per actual native project scope', async () => {
            await open(); action = 'connect'; selected = path.join(evidence, 'public-connection.json'); await controller.manageProfile();
            const pin = new RunnerTrustStore(context.globalState).get(profile.projectId);
            assert.equal(confirms, 1); assert.equal(pin.profile.keyId, profile.keyId);
            return { projectId: profile.projectId, keyId: pin.profile.keyId, nativeMemento: true };
        });
        await check('host-issued prepared job binds native unsaved source, candidate, proposed contract and nonce', async () => {
            const editor = await open(); sourceDocument = editor.document; assert.ok(await editor.edit(e => e.insert(new vscode.Position(0, 0), '// own unsaved input\n'))); original = sourceDocument.getText(); assert.ok(sourceDocument.isDirty);
            const target = captureEditorTarget(), result = await runAiTask({ subscriptions: [] }, 'query', 'Own fixture: aggregate six plus six, stock ten.', captureTaskContext());
            preview = store.add(result.code, 'bsl', target, { task: result.task, contentHash: result.contentHash, isCurrent: result.isCurrent });
            const { request } = require(path.join(root, 'tests/helpers/runnerData'));
            const raw = request(profile, query, true);
            raw.selection.start += 'Запрос = Новый Запрос;\n'.length; raw.selection.end += 'Запрос = Новый Запрос;\n'.length;
            wizardInputs = ['Two rows of six and stock ten must give a deficit of two.', 'OWN-DEFICIT-1', 'Own isolated fixture: product A, one warehouse and consistent units.', '', 'Товар:string;Дефицит:number', 'A;2'];
            wizardChoices = ['0', 'manual', 'add', 'finish', 'multiset'];
            action = 'create'; await controller.menu(preview.previewId);
            job = JSON.parse(vscode.window.activeTextEditor.document.getText());
            assert.equal(wizardInputs.length, 0); assert.equal(wizardChoices.length, 0);
            assert.equal(job.request.contract.approvalState, 'proposed');
            assert.equal(job.operation, 'prepared_query_job'); assert.equal(job.request.candidateCode, code);
            assert.equal(job.request.candidate.taskId, result.task.taskId); assert.equal(job.request.candidate.scopeHash, profile.projectId);
            fs.writeFileSync(path.join(evidence, 'prepared-job.json'), JSON.stringify(job, null, 2));
            return { jobId: job.challenge.jobId, candidateHash: job.request.candidate.candidateHash, sourceUnchanged: sourceDocument.getText() === original };
        });
        await check('native diff shows exact immutable snapshots and guarded apply remains once-only with native Undo', async () => {
            const review = new PreviewReview(store, () => 'en');
            try {
                await review.open(preview.previewId);
                assert.equal(sourceDocument.getText(), original);
                assert.match(vscode.window.activeTextEditor.document.uri.scheme, /^normahub-diff-/);
                const other = vscode.workspace.workspaceFolders[1];
                const otherEditor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.joinPath(other.uri, 'Module.bsl')), { preview: false });
                const before = otherEditor.document.getText(), target = captureEditorTarget();
                const draft = store.add('// reviewed local draft\n', 'bsl', target);
                assert.equal(draft.reviewAvailable, true);
                const materialized = store.captureReview(draft.previewId);
                assert.equal(materialized.before, before);
                await review.open(draft.previewId); assert.equal(otherEditor.document.getText(), before);
                await store.apply(draft.previewId); assert.equal(otherEditor.document.getText(), materialized.after);
                await assert.rejects(store.apply(draft.previewId), /устарел/);
                await vscode.commands.executeCommand('undo'); assert.equal(otherEditor.document.getText(), before);
                await otherEditor.document.save();
                return { nativeDiff: true, exactInsertion: true, onceOnly: true, nativeUndo: true };
            } finally { review.dispose(); }
        });
        await check('external operator executes the exact IDE job in pinned real 1C and cleans its own container', async () => {
            const output = path.join(evidence, 'operator-output');
            const result = await promisify(execFile)(node, [path.join(root, 'dist/runner-cli.js'), 'run-prepared', '--job', path.join(evidence, 'prepared-job.json'),
                '--profile', ownProfileFile, '--private-key', path.join(keyDirectory, 'private.pem'), '--output', output], { timeout: 150000, maxBuffer: 1024 * 1024 });
            fs.writeFileSync(path.join(evidence, 'operator.log'), result.stdout + result.stderr);
            packet = JSON.parse(fs.readFileSync(path.join(output, 'result.json'), 'utf8'));
            assert.equal(packet.receipt.payload.job.nonce, job.challenge.nonce);
            const assessment = JSON.parse(fs.readFileSync(path.join(output, 'assessment.json'), 'utf8'));
            assert.equal(assessment.queryExecutionVerified, true); assert.equal(assessment.comparison.status, 'equal');
            const cleanup = await promisify(execFile)('docker', ['ps', '-a', '--filter', 'label=normahub.copilot.nonce=' + job.challenge.nonce, '--format', '{{.ID}}']);
            assert.equal(cleanup.stdout.trim(), ''); return { queryExecutionVerified: true, comparison: 'equal', cleanup: true, imageId: profile.imageId };
        });
        await check('native import verifies the saved job and opens a read-only EN report without applying candidate code', async () => {
            action = 'import'; selected = path.join(evidence, 'operator-output/result.json'); await controller.menu(preview.previewId);
            report = vscode.window.activeTextEditor.document;
            assert.match(report.uri.scheme, /^normahub-runner-/); assert.equal(report.languageId, 'markdown');
            assert.match(report.getText(), /"queryExecutionVerified": true/); assert.match(report.getText(), /The supplied expectations match/);
            assert.match(report.getText(), /"executionVerified": false/); assert.match(report.getText(), /"canApply": false/);
            assert.equal(sourceDocument.getText(), original);
            const canonical = report.getText();
            await vscode.commands.executeCommand('type', { text: 'SHOULD_NOT_WRITE' });
            assert.equal(report.getText(), canonical, 'native typing must be read-only');
            try { await vscode.window.activeTextEditor.edit(e => e.insert(new vscode.Position(0, 0), 'SHOULD_NOT_WRITE')); } catch { /* native API rejection is also safe */ }
            const deadline = Date.now() + 5000;
            while (report.getText() !== canonical && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
            assert.equal(report.getText(), canonical, 'programmatic changes must not persist in a signed report');
            fs.writeFileSync(path.join(evidence, 'current-report.md'), report.getText());
            return { readOnly: true, sourceUnchanged: true, approvalVerified: false, fullBslExecution: 'not_run' };
        });
        await check('tampered signed result is rejected by the native import boundary', async () => {
            const tampered = structuredClone(packet); tampered.receipt.payload.observation.actual.rows[0][1].value = '999';
            choose('tampered-result.json', tampered); action = 'import';
            await assert.rejects(controller.menu(preview.previewId), /signature/); assert.equal(sourceDocument.getText(), original);
            return { rejected: true };
        });
        await check('native source edit automatically invalidates an already open report and keeps its historical text readable', async () => {
            const editor = await open(); assert.ok(await editor.edit(e => e.insert(new vscode.Position(0, 0), '// own edit after execution\n')));
            await waitReport(/"sourceStatus": "source_changed"/); assert.match(report.getText(), /"queryExecutionVerified": false/);
            action = 'import'; await controller.menu(preview.previewId); assert.equal(vscode.window.activeTextEditor.document.uri.toString(), report.uri.toString());
            fs.writeFileSync(path.join(evidence, 'stale-report.md'), report.getText());
            return { stale: true, queryExecutionVerified: false, sourceVersion: sourceDocument.version };
        });
        await check('disconnect via actual project context revokes the existing virtual report', async () => {
            await open(); action = 'revoke'; await controller.manageProfile();
            await waitReport(/"sourceStatus": "trust_changed"/);
            assert.match(report.getText(), /"queryExecutionVerified": false/);
            assert.equal(new RunnerTrustStore(context.globalState).get(profile.projectId), undefined);
            fs.writeFileSync(path.join(evidence, 'revoked-report.md'), report.getText()); await sourceDocument.save();
            return { revoked: true };
        });
    } finally { controller.dispose(); Client.getApiKey = oldKey; Client.complete = oldComplete; }
    write(true); assert.ok(results.every(r => r.pass), 'Native signed import failed; inspect fresh results.json');
};
