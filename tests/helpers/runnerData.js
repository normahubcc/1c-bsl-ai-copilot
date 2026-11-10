const { createHash, randomUUID } = require('node:crypto');
const { runnerKeyId } = require('../../out/entities/runner/model/receipt');
const { sha256Text } = require('../../out/shared/lib/sha256');
const hash = value => createHash('sha256').update(value).digest('hex');
const table = (rows = [['A', '2']]) => ({ columns: ['Товар', 'Дефицит'], rows: rows.map(([item, count]) => [
    { type: 'string', value: item }, { type: 'number', value: count }]) });
function profile(publicKey) {
    return { schemaVersion: 1, kind: 'query_text_fixture_v1', runnerId: 'own-test-runner', keyId: runnerKeyId(publicKey),
        projectId: hash('own-fixture-project'), profileId: 'own-fixture-v1', imageId: 'sha256:' + 'a'.repeat(64),
        fixtureHash: hash('fixture'), metadataHash: hash('metadata'), platformVersion: '8.3.27.1508', binaryHash: hash('binary') };
}
function request(profile, query = 'ВЫБРАТЬ "A" КАК Товар, 2 КАК Дефицит', literal = false) {
    const quoted = '"' + query.replace(/"/g, '""').replace(/\n/g, '\n|') + '"';
    const prefix = 'ВызватьИсключение "SURROUNDING_BSL_MUST_NOT_RUN";\nЗапрос.Текст = ';
    const candidateCode = literal ? prefix + quoted + ';' : query;
    const candidate = { schemaVersion: 1, taskId: randomUUID(), scopeHash: profile.projectId,
        snapshotHash: hash('controlled test snapshot'), contextHash: hash('controlled test context'),
        candidateHash: sha256Text(candidateCode), textHashEncoding: 'utf16le' };
    return { schemaVersion: 1, operation: 'run_query_fragment', candidate, candidateCode,
        selection: { start: literal ? prefix.length : 0, end: literal ? prefix.length + quoted.length : candidateCode.length,
            format: literal ? 'bsl_string_literal' : 'query_text' }, profileId: profile.profileId,
        contract: { schemaVersion: 1, id: 'deficit.duplicates', version: 1, projectId: profile.projectId,
            intent: 'Two rows of six with stock ten must report deficit two.',
            requirement: { reference: 'independent/duplicates', sha256: hash('6+6; stock 10; deficit 2') },
            scope: { metadataHash: profile.metadataHash, profileId: profile.profileId, platformVersion: profile.platformVersion },
            preconditions: ['Same product A, warehouse W1 and units.'], assumptions: [],
            assertion: { kind: 'query_rows_equal', mode: 'multiset', expected: table() }, approvalState: 'proposed' } };
}
function isolation() {
    return { uid: 10001, memory: '2147483648', swap: '0', pids: '256', cpu: '100000 100000', seccomp: '2',
        noNewPrivileges: '1', capabilities: '0000000000000000', rootReadOnly: true, interfaces: ['lo'] };
}
module.exports = { hash, table, profile, request, isolation };
