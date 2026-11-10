import { canonicalJson, identifier, immutable, oneOf, record, schemaV1 } from '../../../shared/lib/jsonContract';
import { parseRunnerRequest, RunnerProfile, RunnerRequest, RunnerChallenge, protocolVersion } from './queryJob';
import { assertRunnerChallengeBinding, parseRunnerChallenge } from './receipt';
import { QueryCandidateArtifact } from '../../validation/model/queryComparison';

export function runnerRequestInput(request: RunnerRequest) {
    const { query: _query, queryHash: _hash, ...input } = request;
    return immutable(input);
}

export function requestFromHostPlan(artifact: QueryCandidateArtifact, planValue: unknown, profile: RunnerProfile): RunnerRequest {
    canonicalJson(planValue);
    const version = protocolVersion((planValue as { schemaVersion?: unknown })?.schemaVersion);
    if (version !== profile.schemaVersion) throw new Error('Версия плана не соответствует подключённому профилю.');
    const plan = record(planValue, ['schemaVersion', 'operation', 'selection', 'contract', ...(version === 2 ? ['parameters'] : [])], 'plan');
     oneOf(plan.operation, ['query_validation_plan'], 'plan.operation');
    return parseRunnerRequest({ schemaVersion: version, ...(version === 2 ? { parameters: plan.parameters } : {}), operation: 'run_query_fragment', candidate: artifact.identity,
        candidateCode: artifact.code, selection: plan.selection, contract: plan.contract, profileId: profile.profileId });
}

export function preparedJobEnvelope(request: RunnerRequest, challenge: RunnerChallenge) {
    return immutable({ schemaVersion: 1 as const, operation: 'prepared_query_job' as const,
        request: runnerRequestInput(request), challenge });
}

export function parsePreparedQueryJob(value: unknown, profile: RunnerProfile, now = Date.now()) {
    canonicalJson(value);
    const v = record(value, ['schemaVersion', 'operation', 'request', 'challenge'], 'preparedJob');
    schemaV1(v.schemaVersion); oneOf(v.operation, ['prepared_query_job'], 'operation');
    const request = parseRunnerRequest(v.request), challenge = parseRunnerChallenge(v.challenge);
    assertRunnerChallengeBinding(request, profile, challenge);
    if (!Number.isSafeInteger(now) || now < Date.parse(challenge.createdAt) || now >= Date.parse(challenge.deadlineAt)) {
        throw new Error('Prepared job lease is expired or in the future. Prepare a new job in the IDE.');
    }
    return immutable({ request, challenge });
}

export function parseSignedQueryResult(value: unknown) {
    canonicalJson(value);
    const v = record(value, ['schemaVersion', 'operation', 'jobId', 'receipt'], 'signedResult');
    schemaV1(v.schemaVersion); oneOf(v.operation, ['signed_query_result'], 'operation');
    return { jobId: identifier(v.jobId, 'jobId'), receipt: v.receipt };
}
