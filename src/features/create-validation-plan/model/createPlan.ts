import { QueryParameter } from '../../../entities/runner/model/parameters';
import { createHash, randomUUID } from 'node:crypto';
import { QueryCandidateArtifact } from '../../../entities/validation/model/queryComparison';
import { RunnerProfile } from '../../../entities/runner/model/queryJob';
import { parseBusinessContract } from '../../../entities/business-contract/model/contract';
import { QueryResultSet } from '../../../entities/business-contract/model/resultSet';
import { requestFromHostPlan } from '../../../entities/runner/model/preparedJob';
import { QueryChoice } from './queryChoices';

/** User expectation is independent input. No inference response or observed result is used as an oracle. */
export function createUserPlan(artifact: QueryCandidateArtifact, profile: RunnerProfile, choice: QueryChoice,
    input: { requirement: string; reference: string; preconditions: string[]; assumptions: string[]; mode: 'ordered' | 'multiset'; expected: QueryResultSet; parameters?: readonly QueryParameter[] }) {
    if (!artifact.isCurrent()) throw new Error('Исходный контекст изменился. Повторите генерацию.');
    const contract = parseBusinessContract({ schemaVersion: 1, id: 'user.query.' + randomUUID(), version: 1,
        projectId: artifact.identity.scopeHash, intent: input.requirement,
        requirement: { reference: input.reference, sha256: createHash('sha256').update(input.requirement, 'utf8').digest('hex') },
        scope: { metadataHash: profile.metadataHash, profileId: profile.profileId, platformVersion: profile.platformVersion },
        preconditions: input.preconditions, assumptions: input.assumptions, approvalState: 'proposed',
        assertion: { kind: 'query_rows_equal', mode: input.mode, expected: input.expected } });
    const plan = { schemaVersion: profile.schemaVersion,
        ...(profile.schemaVersion === 2 ? { parameters: input.parameters ?? [] } : {}), operation: 'query_validation_plan' as const,
        selection: { start: choice.start, end: choice.end, format: choice.format }, contract };
    requestFromHostPlan(artifact, plan, profile); return plan;
}
