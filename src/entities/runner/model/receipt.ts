import { createHash, createPrivateKey, createPublicKey, sign, verify, KeyObject } from 'node:crypto';
import { canonicalJson, hash, identifier, immutable, jsonHash, oneOf, record, schemaV1, text } from '../../../shared/lib/jsonContract';
import { parseResultSet } from '../../business-contract/model/resultSet';
import { RunnerChallenge, RunnerProfile, RunnerRequest, RUNNER_POLICY, checkProfile, protocolVersion } from './queryJob';
import { IsolationEvidence, parseIsolationEvidence } from './isolation';

export function runnerKeyId(key: KeyObject): string {
    const publicKey = key.type === 'private' ? createPublicKey(key) : key;
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('An Ed25519 runner key is required.');
    return createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
}

export function parseEngineObservation(value: unknown) {
    canonicalJson(value);
    const version = protocolVersion((value as { schemaVersion?: unknown })?.schemaVersion);
    const v = record(value, ['schemaVersion', 'nonce', 'platformVersion', 'binaryHash', 'status', 'actual', 'reason', 'logHash', ...(version === 2 ? ['parametersHash'] : [])], 'engine');
    const status = oneOf(v.status, ['completed', 'failed', 'unsupported'], 'engine.status');
    const reason = v.reason === null ? null : text(v.reason, 'engine.reason', 4000);
    if (status !== 'completed' && !reason) throw new Error('Uncompleted engine checks require a reason.');
    if (status !== 'completed' && v.actual !== null) throw new Error('An uncompleted engine check cannot return actual rows.');
    return immutable({ schemaVersion: version, ...(version === 2 ? { parametersHash: hash(v.parametersHash, 'parametersHash') } : {}), nonce: hash(v.nonce, 'nonce'), platformVersion: text(v.platformVersion, 'platformVersion', 64),
        binaryHash: hash(v.binaryHash, 'binaryHash'), status, actual: status === 'completed' ? parseResultSet(v.actual) : null,
        reason, logHash: hash(v.logHash, 'logHash') });
}
export type EngineObservation = ReturnType<typeof parseEngineObservation>;

function timestamp(value: unknown): string {
    const result = text(value, 'timestamp', 24);
    if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) throw new Error('Invalid UTC timestamp.');
    return result;
}

export function parseRunnerChallenge(value: unknown): RunnerChallenge {
    canonicalJson(value);
    const v = record(value, ['schemaVersion', 'jobId', 'nonce', 'requestHash', 'profileHash', 'policyHash', 'createdAt', 'deadlineAt'], 'challenge');
    schemaV1(v.schemaVersion);
    const createdAt = timestamp(v.createdAt), deadlineAt = timestamp(v.deadlineAt);
    if (Date.parse(deadlineAt) - Date.parse(createdAt) !== RUNNER_POLICY.deadlineMs) throw new Error('Invalid job deadline.');
    return immutable({ schemaVersion: 1, jobId: identifier(v.jobId, 'jobId'), nonce: hash(v.nonce, 'nonce'),
        requestHash: hash(v.requestHash, 'requestHash'), profileHash: hash(v.profileHash, 'profileHash'),
        policyHash: hash(v.policyHash, 'policyHash'), createdAt, deadlineAt });
}

export function assertRunnerChallengeBinding(request: RunnerRequest, profile: RunnerProfile, challenge: RunnerChallenge) {
    checkProfile(request, profile);
    if (challenge.requestHash !== jsonHash(request) || challenge.profileHash !== jsonHash(profile) || challenge.policyHash !== jsonHash(RUNNER_POLICY)) {
        throw new Error('Runner challenge/profile/request binding mismatch.');
    }
}
function assertBinding(request: RunnerRequest, profile: RunnerProfile, challenge: RunnerChallenge, observation: EngineObservation) {
    assertRunnerChallengeBinding(request, profile, challenge);
    if (observation.schemaVersion !== request.schemaVersion || (request.schemaVersion === 2 && observation.parametersHash !== jsonHash(request.parameters))) throw new Error('Engine parameter binding mismatch.');
    if (observation.nonce !== challenge.nonce || observation.binaryHash !== profile.binaryHash || observation.platformVersion !== profile.platformVersion) {
        throw new Error('Runner job/profile/engine binding mismatch.');
    }
}

function payload(request: RunnerRequest, profile: RunnerProfile, challenge: RunnerChallenge, observation: EngineObservation, isolation: IsolationEvidence, startedAt: string, finishedAt: string) {
    assertBinding(request, profile, challenge, observation);
    if (Date.parse(startedAt) < Date.parse(challenge.createdAt) || Date.parse(finishedAt) < Date.parse(startedAt) ||
        Date.parse(finishedAt) > Date.parse(challenge.deadlineAt)) throw new Error('Execution is outside its job lease.');
    return immutable({ schemaVersion: request.schemaVersion, ...(request.schemaVersion === 2 ? { parameters: request.parameters, parametersHash: jsonHash(request.parameters) } : {}), kind: 'selected_query_execution' as const, runnerId: profile.runnerId, keyId: profile.keyId,
        job: challenge, candidate: request.candidate, queryHash: request.queryHash, selection: request.selection,
        contractHash: jsonHash(request.contract), expectedHash: jsonHash(request.contract.assertion.expected),
        observation, isolation: parseIsolationEvidence(isolation), startedAt, finishedAt, expiresAt: new Date(Date.parse(finishedAt) + RUNNER_POLICY.receiptTtlMs).toISOString(),
        scope: 'selected_query_only' as const, fullBslExecution: 'not_run' as const, approvalVerified: false as const, canApply: false as const });
}

export function signRunnerReceipt(request: RunnerRequest, profile: RunnerProfile, challenge: RunnerChallenge,
    observation: EngineObservation, isolation: IsolationEvidence, privatePem: string, startedAt: string, finishedAt: string) {
    const key = createPrivateKey(privatePem);
    if (runnerKeyId(key) !== profile.keyId) throw new Error('Runner signing key differs from its pinned profile.');
    const body = payload(request, profile, challenge, observation, isolation, timestamp(startedAt), timestamp(finishedAt));
    return immutable({ schemaVersion: request.schemaVersion, algorithm: 'Ed25519' as const, payload: body,
        signature: sign(null, Buffer.from(canonicalJson(body), 'utf8'), key).toString('base64') });
}

/** The public key/profile/challenge are supplied by the trusted caller, never taken from the receipt. */
export function verifyRunnerEvidence(value: unknown, request: RunnerRequest, profile: RunnerProfile, challengeValue: unknown,
    publicPem: string, now = Date.now()) {
    canonicalJson(value);
    const envelope = record(value, ['schemaVersion', 'algorithm', 'payload', 'signature'], 'receipt');
    if (protocolVersion(envelope.schemaVersion) !== request.schemaVersion) throw new Error('Receipt protocol differs from the expected request.'); oneOf(envelope.algorithm, ['Ed25519'], 'algorithm');
    const key = createPublicKey(publicPem);
    if (runnerKeyId(key) !== profile.keyId) throw new Error('The public key is not pinned to this runner profile.');
    const encoded = text(envelope.signature, 'signature', 88), signature = Buffer.from(encoded, 'base64');
    if (signature.length !== 64 || signature.toString('base64') !== encoded ||
        !verify(null, Buffer.from(canonicalJson(envelope.payload)), key, signature)) throw new Error('Invalid runner signature.');
    const v = record(envelope.payload, ['schemaVersion', 'kind', 'runnerId', 'keyId', 'job', 'candidate', 'queryHash', 'selection', 'contractHash',
        'expectedHash', 'observation', 'isolation', 'startedAt', 'finishedAt', 'expiresAt', 'scope', 'fullBslExecution', 'approvalVerified', 'canApply', ...(request.schemaVersion === 2 ? ['parameters', 'parametersHash'] : [])], 'payload');
    const challenge = parseRunnerChallenge(challengeValue), observation = parseEngineObservation(v.observation);
    const expected = payload(request, profile, challenge, observation, parseIsolationEvidence(v.isolation), timestamp(v.startedAt), timestamp(v.finishedAt));
    if (canonicalJson(expected) !== canonicalJson(envelope.payload)) throw new Error('Receipt does not match the expected job/candidate/contract.');
    if (!Number.isSafeInteger(now) || now < 0 || Date.parse(expected.finishedAt) > now) throw new Error('Receipt timestamp is in the future.');
    const expired = now >= Date.parse(expected.expiresAt);
    const assessment = immutable({ schemaVersion: 1 as const, signatureVerified: true, status: expired ? 'stale' as const : observation.status,
        queryExecutionVerified: !expired && observation.status === 'completed', receiptHash: jsonHash(value),
        scope: 'selected_query_only' as const, sourceFreshness: 'must_be_revalidated_by_host' as const,
        fullBslExecution: 'not_run' as const, executionVerified: false as const, approvalVerified: false as const, canApply: false as const });
    return immutable({ assessment, payload: expected });
}

/** Compatibility entrypoint retains its original flat assessment DTO. */
export function verifyRunnerReceipt(...args: Parameters<typeof verifyRunnerEvidence>) {
    return verifyRunnerEvidence(...args).assessment;
}
