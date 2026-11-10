import { createPrivateKey } from 'node:crypto';
import { immutable } from '../../../shared/lib/jsonContract';
import { assertRunnableRequest, checkProfile, createRunnerChallenge, parseRunnerProfile, parseRunnerRequest, RunnerChallenge, RunnerProfile, RunnerRequest } from '../../../entities/runner/model/queryJob';
import { parsePreparedQueryJob } from '../../../entities/runner/model/preparedJob';
import { runnerKeyId, signRunnerReceipt, verifyRunnerReceipt } from '../../../entities/runner/model/receipt';
import { DockerQueryRuntime } from '../../../features/run-query/api/dockerQueryRuntime';
import { compareQueryResults } from '../../../features/compare-query-results/model/compareResults';

/** Explicit operator/developer entrypoint. Not exposed to Webview, MCP or inference tools. */
export async function executeQueryJob(requestValue: unknown, profileValue: unknown, privatePem: string,
    runtime = new DockerQueryRuntime(), signal?: AbortSignal) {
    const request = parseRunnerRequest(requestValue), profile = parseRunnerProfile(profileValue);
    checkProfile(request, profile);
    return executeKnownJob(request, profile, createRunnerChallenge(request, profile), privatePem, runtime, signal);
}

export async function executePreparedQueryJob(jobValue: unknown, profileValue: unknown, privatePem: string,
    runtime = new DockerQueryRuntime(), signal?: AbortSignal) {
    const profile = parseRunnerProfile(profileValue), prepared = parsePreparedQueryJob(jobValue, profile);
    return executeKnownJob(prepared.request, profile, prepared.challenge, privatePem, runtime, signal);
}

async function executeKnownJob(request: RunnerRequest, profile: RunnerProfile, challenge: RunnerChallenge,
    privatePem: string, runtime: DockerQueryRuntime, signal?: AbortSignal) {
    assertRunnableRequest(request, profile);
    const key = createPrivateKey(privatePem);
    if (runnerKeyId(key) !== profile.keyId) throw new Error('Signing key is outside the pinned runner profile.');
    const startedAt = new Date().toISOString();
    const { engine: observation, isolation } = await runtime.execute(request, profile, challenge, signal);
    if (signal?.aborted) throw new Error('Runner job cancelled.');
    const receipt = signRunnerReceipt(request, profile, challenge, observation, isolation, privatePem, startedAt, new Date().toISOString());
    const publicKey = (await import('node:crypto')).createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
    const assessment = verifyRunnerReceipt(receipt, request, profile, challenge, publicKey);
    const comparison = observation.actual ? compareQueryResults(request.contract.assertion.expected, observation.actual, request.contract.assertion.mode) : null;
    return immutable({ challenge, receipt, assessment, comparison });
}
