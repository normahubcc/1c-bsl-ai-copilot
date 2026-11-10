import { canonicalJson, hash, identifier, immutable, oneOf, record, schemaV1 } from '../../../shared/lib/jsonContract';
import { TEXT_HASH_ENCODING } from '../../../shared/lib/sha256';
import { parseBusinessContract } from '../../business-contract/model/contract';
import { parseResultSet } from '../../business-contract/model/resultSet';

/** Local source identity. No tenant authorization or engine attestation is implied. */
export interface QueryCandidateIdentity {
    readonly schemaVersion: 1;
    readonly taskId: string;
    readonly scopeHash: string;
    readonly snapshotHash: string;
    readonly contextHash: string;
    readonly candidateHash: string;
    readonly textHashEncoding: typeof TEXT_HASH_ENCODING;
}

export interface QueryCandidateLease {
    readonly identity: QueryCandidateIdentity;
    /** Host-only, never accepted from imported JSON or Webview. */
    readonly isCurrent: () => boolean;
}

export interface QueryCandidateArtifact extends QueryCandidateLease { readonly code: string; readonly scopeLabel?: string; }

export function parseQueryCandidateIdentity(value: unknown): QueryCandidateIdentity {
    canonicalJson(value);
    const source = record(value, ['schemaVersion', 'taskId', 'scopeHash', 'snapshotHash', 'contextHash', 'candidateHash', 'textHashEncoding'], 'candidate');
    schemaV1(source.schemaVersion);
    return immutable({ schemaVersion: 1, taskId: identifier(source.taskId, 'candidate.taskId'),
        scopeHash: hash(source.scopeHash, 'candidate.scopeHash'), snapshotHash: hash(source.snapshotHash, 'candidate.snapshotHash'),
        contextHash: hash(source.contextHash, 'candidate.contextHash'), candidateHash: hash(source.candidateHash, 'candidate.candidateHash'),
        textHashEncoding: oneOf(source.textHashEncoding, [TEXT_HASH_ENCODING], 'candidate.textHashEncoding') });
}

export function parseQueryComparisonPackage(value: unknown) {
    canonicalJson(value);
    const source = record(value, ['schemaVersion', 'operation', 'candidate', 'contract', 'actual'], 'comparison');
    schemaV1(source.schemaVersion);
    oneOf(source.operation, ['compare_provided_query_result'], 'operation');
    return immutable({ schemaVersion: 1 as const, operation: 'compare_provided_query_result' as const,
        candidate: parseQueryCandidateIdentity(source.candidate), contract: parseBusinessContract(source.contract), actual: parseResultSet(source.actual) });
}
