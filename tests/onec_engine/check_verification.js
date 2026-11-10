const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
if (!process.argv[2]) throw new Error('Pass the own generated lab directory.');
const base = path.resolve(process.argv[2]);
const manifest = JSON.parse(fs.readFileSync(path.join(base, 'verification-manifest.json'), 'utf8'));
const resultPath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(base, 'verification-results.txt');
const source = fs.readFileSync(resultPath, 'utf8').replace(/^\uFEFF/, '');
assert.ok(fs.statSync(resultPath).mtimeMs >= Date.parse(manifest.createdAt), 'Stale result file');
const lines = source.split(/\r?\n/).filter(Boolean);
assert.equal(lines[0], 'RUN|' + manifest.runId, 'Wrong execution identity');
assert.equal(lines.at(-1), 'PASS|typed_comparison');
assert.ok(!lines.some(line => line.startsWith('FAIL|')));
assert.equal(lines.filter(line => line.startsWith('correct.count|')).length, 1);
assert.ok(lines.includes('correct.count|1'));
assert.ok(lines.includes('broken.count|0'));
const actual = { columns: manifest.expected.columns, rows: lines.filter(line => line.startsWith('correct.row|')).map(line => {
    const [prefix, item, amount, extra] = line.split('|');
    assert.equal(prefix, 'correct.row'); assert.equal(item, 'A'); assert.equal(amount, '2'); assert.equal(extra, undefined);
    return [{ type: 'string', value: item }, { type: 'number', value: amount }];
}) };
assert.equal(actual.rows.length, 1);
const cli = path.join(root, 'dist/verification-cli.js');
const invoke = input => JSON.parse(execFileSync(process.execPath, [cli], { input: JSON.stringify(input), encoding: 'utf8', timeout: 5000 })).result;
const sha256 = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha256(fs.readFileSync(path.join(base, 'config/CommonModules/Проверки/Ext/Module.bsl'))), manifest.moduleHash, 'Fixture source changed after preparation');
assert.equal(sha256(fs.readFileSync(path.join(base, 'generated-Текущие.bsl'))), manifest.correctSourceHash);
assert.equal(sha256(fs.readFileSync(path.join(base, 'controlled-per-line-mutation.bsl'))), manifest.mutatedSourceHash);
const metadataFiles = [];
const collectMetadata = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) collectMetadata(filename);
        else if (entry.isFile() && entry.name.endsWith('.xml')) metadataFiles.push([path.relative(path.join(base, 'config'), filename).split(path.sep).join('/'), sha256(fs.readFileSync(filename))]);
    }
};
collectMetadata(path.join(base, 'config'));
metadataFiles.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const contract = {
    schemaVersion: 1, id: 'deficit.duplicates', version: 1, projectId: 'own-fixture',
    intent: 'Two rows of six with stock ten must report total deficit two.',
    requirement: { reference: 'independent-fixture/duplicates', sha256: sha256('Two rows of six; stock ten; expected deficit two.') },
    scope: { metadataHash: sha256(JSON.stringify(metadataFiles)),
        profileId: 'training-file-8.3.27.1508', platformVersion: manifest.platformVersion },
    preconditions: ['Same product A and warehouse W1; identical units; stock ten at fixed period.'], assumptions: [],
    assertion: { kind: 'query_rows_equal', mode: 'multiset', expected: manifest.expected }, approvalState: 'proposed'
};
const contractResult = invoke({ schemaVersion: 1, operation: 'validate_contract', contract });
const corrected = invoke({ schemaVersion: 1, operation: 'compare_contract_result', contract, actual });
const broken = invoke({ schemaVersion: 1, operation: 'compare_contract_result', contract, actual: { columns: actual.columns, rows: [] } });
assert.equal(corrected.status, 'equal'); assert.equal(broken.status, 'different'); assert.equal(broken.missingRows, 1);
assert.equal(corrected.executionVerified, false, 'Caller input comparison does not authenticate an engine receipt');
const report = { runId: manifest.runId, platformVersion: manifest.platformVersion, engineRunObservedInLab: true,
    authenticatedCorporateRunner: false, modelCalled: false, automaticCounterexampleSearch: false, controlledMutation: true,
    engineResultHash: sha256(fs.readFileSync(resultPath)), verificationCliHash: sha256(fs.readFileSync(cli)),
    metadataFiles, contract: contractResult, corrected, broken,
    limitations: ['One own file-base fixture with string dimensions.', 'No AI, production database, RLS, concurrent load or generic configuration coverage.'] };
fs.writeFileSync(path.join(base, 'verification-core-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ runId: manifest.runId, engine: manifest.platformVersion, corrected: corrected.status,
    controlledDefect: broken.status, observedDeficit: actual.rows[0][1].value, executionReceiptAuthenticated: false }, null, 2));
