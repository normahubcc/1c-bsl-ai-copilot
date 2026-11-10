import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { readLocalJson } from './shared/lib/readLocalJson';
import { runnerKeyId, verifyRunnerReceipt } from './entities/runner/model/receipt';
import { parseRunnerProfile, parseRunnerRequest } from './entities/runner/model/queryJob';
import { executeQueryJob, executePreparedQueryJob } from './app/runner/api/executeQueryJob';
import { parseRunnerConnection } from './entities/runner/model/connection';
import { compareQueryResults } from './features/compare-query-results/model/compareResults';

const cancellation = new AbortController();
process.once('SIGINT', () => cancellation.abort());
process.once('SIGTERM', () => cancellation.abort());
const guard = () => { if (cancellation.signal.aborted) throw new Error('Runner command cancelled.'); };
let failureDirectory: string | undefined;

function options(command: string, allowed: readonly string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 3; i < process.argv.length; i += 2) {
        const flag = process.argv[i], value = process.argv[i + 1];
        if (!allowed.includes(flag) || result[flag] || !value || value.startsWith('--')) throw new Error(`Invalid ${command} arguments.`);
        result[flag] = value;
    }
    if (allowed.some(flag => !result[flag])) throw new Error(`Required ${command} flags: ${allowed.join(' ')}`);
    return result;
}
async function pem(filename: string, privateKey = false): Promise<string> {
    const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 16384 || privateKey && ((stat.mode & 0o077) !== 0 || process.getuid && stat.uid !== process.getuid())) {
            throw new Error('Require an owned private runner key with mode 0600; key files must be regular and small.');
        }
        const buffer = Buffer.alloc(16385), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 16384) throw new Error('Key file exceeds its size limit.');
        return buffer.subarray(0, bytesRead).toString('utf8');
    } finally { await handle.close(); }
}
const load = (filename: string) => readLocalJson(filename, guard);
const save = (filename: string, value: unknown) => fs.writeFile(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

async function main() {
    const command = process.argv[2];
    if (command === 'init-key') {
        const o = options(command, ['--directory']), directory = path.resolve(o['--directory']);
        await fs.mkdir(directory, { mode: 0o700 });
        const pair = generateKeyPairSync('ed25519');
        await fs.writeFile(path.join(directory, 'private.pem'), pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
        await fs.writeFile(path.join(directory, 'public.pem'), pair.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644, flag: 'wx' });
        console.log(JSON.stringify({ ok: true, keyId: runnerKeyId(pair.publicKey), directory }));
    } else if (command === 'export-connection') {
        const o = options(command, ['--profile', '--public-key', '--output']);
        const connection = parseRunnerConnection({ schemaVersion: 1, profile: await load(o['--profile']), publicKeyPem: await pem(o['--public-key']) });
        await save(path.resolve(o['--output']), connection);
        console.log(JSON.stringify({ ok: true, output: path.resolve(o['--output']), keyId: connection.profile.keyId }));
    } else if (command === 'run' || command === 'run-prepared') {
        const inputFlag = command === 'run' ? '--request' : '--job';
        const o = options(command, [inputFlag, '--profile', '--private-key', '--output']);
        const request = await load(o[inputFlag]), profile = await load(o['--profile']), key = await pem(o['--private-key'], true);
        const directory = path.resolve(o['--output']); await fs.mkdir(directory, { mode: 0o700 }); failureDirectory = directory;
        const execute = command === 'run' ? executeQueryJob : executePreparedQueryJob;
        const result = await execute(request, profile, key, undefined, cancellation.signal);
        await save(path.join(directory, 'challenge.json'), result.challenge);
        await save(path.join(directory, 'receipt.json'), result.receipt);
        await save(path.join(directory, 'assessment.json'), { ...result.assessment, comparison: result.comparison });
        await save(path.join(directory, 'result.json'), { schemaVersion: 1, operation: 'signed_query_result', jobId: result.challenge.jobId, receipt: result.receipt });
        console.log(JSON.stringify({ ok: true, output: directory, queryExecutionVerified: result.assessment.queryExecutionVerified,
            comparison: result.comparison?.status ?? null, fullBslExecution: 'not_run', approvalVerified: false, canApply: false }));
        if (!result.assessment.queryExecutionVerified || result.comparison?.status !== 'equal') process.exitCode = 2;
    } else if (command === 'verify') {
        const o = options(command, ['--request', '--profile', '--challenge', '--receipt', '--public-key']);
        const request = parseRunnerRequest(await load(o['--request']));
        const receipt: any = await load(o['--receipt']);
        const result = verifyRunnerReceipt(receipt, request, parseRunnerProfile(await load(o['--profile'])),
            await load(o['--challenge']), await pem(o['--public-key']));
        const actual = receipt.payload.observation.actual;
        const comparison = actual ? compareQueryResults(request.contract.assertion.expected, actual, request.contract.assertion.mode) : null;
        console.log(JSON.stringify({ ok: true, ...result, comparison }));
        if (!result.queryExecutionVerified || comparison?.status !== 'equal') process.exitCode = 2;
    } else if (command === 'key-id') {
        const o = options(command, ['--public-key']);
        console.log(JSON.stringify({ ok: true, keyId: runnerKeyId(createPublicKey(await pem(o['--public-key']))) }));
    } else throw new Error('Use init-key, key-id, export-connection, run, run-prepared or verify; this is an explicit operator CLI.');
}
main().catch(async error => {
    const failure = { ok: false, cancelled: cancellation.signal.aborted, error: error instanceof Error ? error.message : 'Runner command failed.' };
    if (failureDirectory) await save(path.join(failureDirectory, 'failure.json'), failure).catch(() => {});
    console.log(JSON.stringify(failure)); process.exitCode = 1;
});
