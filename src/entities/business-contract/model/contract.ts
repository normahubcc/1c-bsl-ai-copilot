import { array, canonicalJson, hash, identifier, immutable, jsonHash, oneOf, positiveInteger, record, schemaV1, text } from '../../../shared/lib/jsonContract';
import { parseResultSet, QueryResultSet } from './resultSet';

export type ComparisonMode = 'multiset' | 'ordered';

/** Initial boundary accepts proposals only. Approval must come from a future authenticated service. */
export interface BusinessContract {
    readonly schemaVersion: 1;
    readonly id: string;
    readonly version: number;
    readonly projectId: string;
    readonly intent: string;
    readonly requirement: { readonly reference: string; readonly sha256: string };
    readonly scope: { readonly metadataHash: string; readonly profileId: string; readonly platformVersion: string };
    readonly preconditions: readonly string[];
    readonly assumptions: readonly string[];
    readonly assertion: { readonly kind: 'query_rows_equal'; readonly mode: ComparisonMode; readonly expected: QueryResultSet };
    readonly approvalState: 'proposed';
}

export function parseBusinessContract(value: unknown): BusinessContract {
    canonicalJson(value);
    const source = record(value, ['schemaVersion', 'id', 'version', 'projectId', 'intent', 'requirement', 'scope', 'preconditions', 'assumptions', 'assertion', 'approvalState'], 'contract');
    schemaV1(source.schemaVersion);
    const requirement = record(source.requirement, ['reference', 'sha256'], 'requirement');
    const scope = record(source.scope, ['metadataHash', 'profileId', 'platformVersion'], 'scope');
    const assertion = record(source.assertion, ['kind', 'mode', 'expected'], 'assertion');
    const lines = (value: unknown, path: string) => array(value, path, 50).map((line, index) => text(line, `${path}[${index}]`, 2000));
    return immutable({
        schemaVersion: 1, id: identifier(source.id, 'id'), version: positiveInteger(source.version, 'version'),
        projectId: identifier(source.projectId, 'projectId'), intent: text(source.intent, 'intent', 8000),
        requirement: { reference: text(requirement.reference, 'requirement.reference'), sha256: hash(requirement.sha256, 'requirement.sha256') },
        scope: { metadataHash: hash(scope.metadataHash, 'scope.metadataHash'), profileId: identifier(scope.profileId, 'scope.profileId'), platformVersion: text(scope.platformVersion, 'scope.platformVersion', 64) },
        preconditions: lines(source.preconditions, 'preconditions'), assumptions: lines(source.assumptions, 'assumptions'),
        assertion: { kind: oneOf(assertion.kind, ['query_rows_equal'], 'assertion.kind'), mode: oneOf(assertion.mode, ['multiset', 'ordered'], 'assertion.mode'), expected: parseResultSet(assertion.expected) },
        approvalState: oneOf(source.approvalState, ['proposed'], 'approvalState')
    });
}

export function businessContractHash(value: unknown): string {
    return jsonHash(parseBusinessContract(value));
}
