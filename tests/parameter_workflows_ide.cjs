// Native IDE, isolated profile and own 1C fixture; the AI response and dialog choices are controlled.
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

exports.run = async function () {
    const root = process.env.SNAPSHOT_REPOSITORY, evidence = process.env.SNAPSHOT_IDE_EVIDENCE;
    const profileFile = process.env.SNAPSHOT_RUNNER_PROFILE, keyDirectory = process.env.SNAPSHOT_RUNNER_KEYS;
    const node = process.env.SNAPSHOT_RUNNER_NODE;
    assert.ok(root && evidence && profileFile && keyDirectory && node);
    const results = [];
    const write = completed => fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({
        app: vscode.env.appName, version: vscode.version, source: root, completed,
        transport: 'controlled saved query; no gateway call', engine: 'own pinned training fixture', results
    }, null, 2));
    const check = async (name, run) => {
        try { results.push({ name, pass: true, detail: await run() }); }
        catch (error) { results.push({ name, pass: false, error: String(error.stack || error),
            operatorDiagnostic: String(error.stdout || '') + String(error.stderr || '') }); }
        write(false);
    };
    const extension = vscode.extensions.getExtension('normahub.1c-bsl-ai-copilot');
    assert.ok(extension);
    await extension.activate();
    const context = await vscode.extensions.getExtension('copilot.test-boundary').activate();
    const { PreviewStore, captureEditorTarget } = require(path.join(root, 'out/features/apply-code/model/previewStore'));
    const { PreviewValidation } = require(path.join(root, 'out/app/validation/api/previewValidation'));
    const { RunnerTrustStore } = require(path.join(root, 'out/features/manage-runner-trust/model/runnerTrustStore'));
    const { localScopeHash } = require(path.join(root, 'out/entities/editor-snapshot/model/snapshot'));
    const { captureTaskContext, runAiTask } = require(path.join(root, 'out/features/ai-task/api/runTask'));
    const { NormaHubClient: Client } = require(path.join(root, 'out/normahubClient'));
    const { queryChoices } = require(path.join(root, 'out/features/create-validation-plan/model/queryChoices'));
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'tests/evidence/live-normahub-2026-10-31/run-b/q04-request.json'), 'utf8'));
    const choice = queryChoices(saved.candidateCode).find(x => x.start === saved.selection.start && x.end === saved.selection.end);
    assert.ok(choice);
    const code = saved.candidateCode;
    const oldKey = Client.getApiKey, oldComplete = Client.complete;
    Client.getApiKey = async () => 'synthetic-in-memory-key';
    Client.complete = async () => code;
    const folder = vscode.workspace.workspaceFolders[0];
    const sourceUri = vscode.Uri.joinPath(folder.uri, 'Module.bsl');
    const open = async () => vscode.window.showTextDocument(await vscode.workspace.openTextDocument(sourceUri));
    const profile = { ...JSON.parse(fs.readFileSync(profileFile, 'utf8')),
        projectId: localScopeHash(folder.uri.toString(), sourceUri.toString()) };
    const ownProfileFile = path.join(evidence, 'profile.json');
    fs.writeFileSync(ownProfileFile, JSON.stringify(profile, null, 2));
    const connectionFile = path.join(evidence, 'public-connection.json');
    fs.writeFileSync(connectionFile, JSON.stringify({ schemaVersion: 1, profile,
        publicKeyPem: fs.readFileSync(path.join(keyDirectory, 'public.pem'), 'utf8') }, null, 2));
    let selected = connectionFile, action = 'connect';
    const inputs = ['W1', 'Stock at the selected date and warehouse must contain A/10.', 'OWN-STOCK-Q04',
        'Own fixture: one A/W1 stock movement of ten and no W2 stock.', '', 'Товар:string;Количество:number', 'A;10'];
    const choices = ['0', 'string', 'manual', 'add', 'finish', 'multiset'];
    let confirmDetail = '', preview, source, original, job, packet, report;
    const store = new PreviewStore();
    const controller = new PreviewValidation(context, store, () => 'en', {}, {
        async input(options) { const value = inputs.shift(); assert.notEqual(value, undefined);
            assert.equal(options.validateInput(value), undefined); return value; },
        async pick(items) { const desired = items.some(item => item.action === action) ? action : choices.shift();
            const item = items.find(candidate => candidate.action === desired); assert.ok(item, 'Missing choice: ' + desired); return item; },
        async file() { return [vscode.Uri.file(selected)]; },
        async confirm(message, options, label) { assert.equal(options.modal, true); confirmDetail = options.detail;
            if (message.includes('profile for this project')) assert.ok(options.detail.includes(profile.keyId));
            return label; }
    });
    try {
        await check('v2 profile pinned in native IDE project', async () => {
            await open(); await controller.manageProfile();
            assert.equal(new RunnerTrustStore(context.globalState).get(profile.projectId).profile.schemaVersion, 2);
            return { projectId: profile.projectId, imageId: profile.imageId };
        });
        await check('native wizard binds the frozen AI query, typed warehouse and independent expected rows', async () => {
            const editor = await open(); source = editor.document;
            assert.ok(await editor.edit(edit => edit.insert(new vscode.Position(0, 0), '// unsaved own input\n')));
            original = source.getText();
            const target = captureEditorTarget();
            const result = await runAiTask({ subscriptions: [] }, 'query', 'Own stock on W1.', captureTaskContext());
            preview = store.add(result.code, 'bsl', target, { task: result.task, contentHash: result.contentHash, isCurrent: result.isCurrent });
            action = 'create'; await controller.menu(preview.previewId);
            job = JSON.parse(vscode.window.activeTextEditor.document.getText());
            assert.equal(job.request.schemaVersion, 2);
            assert.deepEqual(job.request.parameters, [{ name: 'Склад', value: { type: 'string', value: 'W1' } }]);
            const preparedChoice = queryChoices(job.request.candidateCode).find(x => x.start === job.request.selection.start && x.end === job.request.selection.end);
            assert.equal(preparedChoice?.query, choice.query);
            assert.equal(job.request.contract.assertion.expected.rows[0][1].value, '10');
            assert.equal(job.request.contract.approvalState, 'proposed');
            assert.match(confirmDetail, /W1/);
            assert.equal(source.getText(), original);
            assert.equal(inputs.length, 0); assert.equal(choices.length, 0);
            fs.writeFileSync(path.join(evidence, 'prepared-job.json'), JSON.stringify(job, null, 2));
            return { jobId: job.challenge.jobId, sourceUnchanged: true, parameters: job.request.parameters };
        });
        await check('external operator executes the IDE prepared query in pinned own 1C', async () => {
            const output = path.join(evidence, 'operator-output');
            const result = await promisify(execFile)(node, [path.join(root, 'dist/runner-cli.js'), 'run-prepared',
                '--job', path.join(evidence, 'prepared-job.json'), '--profile', ownProfileFile,
                '--private-key', path.join(keyDirectory, 'private.pem'), '--output', output],
            { timeout: 150000, maxBuffer: 1024 * 1024 });
            fs.writeFileSync(path.join(evidence, 'operator.log'), result.stdout + result.stderr);
            packet = JSON.parse(fs.readFileSync(path.join(output, 'result.json'), 'utf8'));
            const assessment = JSON.parse(fs.readFileSync(path.join(output, 'assessment.json'), 'utf8'));
            assert.equal(assessment.queryExecutionVerified, true);
            assert.equal(assessment.comparison.status, 'equal');
            assert.equal(packet.receipt.payload.parametersHash, packet.receipt.payload.observation.parametersHash);
            assert.equal(packet.receipt.payload.job.nonce, job.challenge.nonce);
            return { comparison: 'equal', imageId: profile.imageId, fullBslExecution: 'not_run' };
        });
        await check('native read-only report shows bound parameters while source remains current', async () => {
            action = 'import'; selected = path.join(evidence, 'operator-output/result.json');
            await controller.menu(preview.previewId);
            report = vscode.window.activeTextEditor.document;
            assert.match(report.uri.scheme, /^normahub-runner-/);
            assert.match(report.getText(), /"Склад"/);
            assert.match(report.getText(), /"parametersHash"/);
            assert.match(report.getText(), /"queryExecutionVerified": true/);
            assert.match(report.getText(), /"canApply": false/);
            assert.equal(source.getText(), original);
            return { reportReadOnly: true, sourceCurrent: true };
        });
        await check('tampered parameter in signed receipt is rejected at native import', async () => {
            const altered = structuredClone(packet);
            altered.receipt.payload.parameters[0].value.value = 'W2';
            selected = path.join(evidence, 'tampered-result.json');
            fs.writeFileSync(selected, JSON.stringify(altered, null, 2));
            action = 'import'; await assert.rejects(controller.menu(preview.previewId), /signature|binding/i);
            return { rejected: true };
        });
        await check('source edit invalidates the existing signed report', async () => {
            await open(); assert.ok(await vscode.window.activeTextEditor.edit(edit => edit.insert(new vscode.Position(0, 0), '// changed\n')));
            const deadline = Date.now() + 5000;
            while (!/"sourceStatus": "source_changed"/.test(report.getText()) && Date.now() < deadline)
                await new Promise(resolve => setTimeout(resolve, 25));
            assert.match(report.getText(), /"sourceStatus": "source_changed"/);
            assert.match(report.getText(), /"queryExecutionVerified": false/);
            return { staleAfterEdit: true };
        });
    } finally {
        controller.dispose(); Client.getApiKey = oldKey; Client.complete = oldComplete;
        if (source?.isDirty) await source.save();
    }
    write(true);
    assert.ok(results.every(result => result.pass), 'Native parameter workflow failed; inspect results.json');
};
