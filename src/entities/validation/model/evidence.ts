import { array, canonicalJson, hash, identifier, immutable, oneOf, record, schemaV1, text } from '../../../shared/lib/jsonContract';

export const BINDING_HASH_FIELDS = ['snapshotHash', 'candidateHash', 'contractHash', 'fixtureHash', 'profileHash', 'policyHash'] as const;
export interface ValidationBinding {
    readonly schemaVersion: 1;
    readonly projectId: string;
    readonly snapshotHash: string;
    readonly candidateHash: string;
    readonly contractHash: string;
    readonly fixtureHash: string;
    readonly profileHash: string;
    readonly policyHash: string;
}

const LEVELS = ['structure', 'static', 'compile', 'behavior', 'ui', 'performance'] as const;
const STATUSES = ['passed', 'failed', 'not_run', 'unsupported', 'cancelled'] as const;
export interface ValidationCheck {
    readonly id: string;
    readonly level: typeof LEVELS[number];
    readonly status: typeof STATUSES[number];
    readonly reason?: string;
    readonly evidence: readonly { readonly artifactId: string; readonly sha256: string }[];
}

export interface ValidationReport {
    readonly schemaVersion: 1;
    readonly binding: ValidationBinding;
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly expiresAt: string;
    readonly checks: readonly ValidationCheck[];
}

export function parseValidationBinding(value: unknown): ValidationBinding {
    canonicalJson(value);
    const source = record(value, ['schemaVersion', 'projectId', ...BINDING_HASH_FIELDS], 'binding');
    schemaV1(source.schemaVersion);
    return immutable({ schemaVersion: 1, projectId: identifier(source.projectId, 'binding.projectId'),
        snapshotHash: hash(source.snapshotHash, 'snapshotHash'), candidateHash: hash(source.candidateHash, 'candidateHash'),
        contractHash: hash(source.contractHash, 'contractHash'), fixtureHash: hash(source.fixtureHash, 'fixtureHash'),
        profileHash: hash(source.profileHash, 'profileHash'), policyHash: hash(source.policyHash, 'policyHash') });
}

function timestamp(value: unknown, path: string): string {
    const result = text(value, path, 24), time = Date.parse(result);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== result) throw new Error(`${path}: expected a valid UTC ISO timestamp with milliseconds.`);
    return result;
}

export function parseValidationReport(value: unknown): ValidationReport {
    canonicalJson(value);
    const source = record(value, ['schemaVersion', 'binding', 'startedAt', 'finishedAt', 'expiresAt', 'checks'], 'report');
    schemaV1(source.schemaVersion);
    const startedAt = timestamp(source.startedAt, 'startedAt'), finishedAt = timestamp(source.finishedAt, 'finishedAt'), expiresAt = timestamp(source.expiresAt, 'expiresAt');
    if (Date.parse(startedAt) > Date.parse(finishedAt) || Date.parse(finishedAt) > Date.parse(expiresAt)) throw new Error('Report timestamps are out of order.');
    const checks = array(source.checks, 'checks', 100).map((value, index): ValidationCheck => {
        const path = `checks[${index}]`;
        const check = record(value, ['id', 'level', 'status', 'reason', 'evidence'], path);
        const status = oneOf(check.status, STATUSES, `${path}.status`);
        const reason = check.reason === undefined ? undefined : text(check.reason, `${path}.reason`, 2000);
        if (status !== 'passed' && !reason) throw new Error(`${path}: explain a check that did not pass.`);
        const evidence = array(check.evidence, `${path}.evidence`, 20).map((value, index) => {
            const artifact = record(value, ['artifactId', 'sha256'], `${path}.evidence[${index}]`);
            return { artifactId: identifier(artifact.artifactId, 'artifactId'), sha256: hash(artifact.sha256, 'artifact.sha256') };
        });
        if ((status === 'passed' || status === 'failed') && !evidence.length) throw new Error(`${path}: completed checks require evidence references.`);
        return { id: identifier(check.id, `${path}.id`), level: oneOf(check.level, LEVELS, `${path}.level`), status,
            ...(reason ? { reason } : {}), evidence };
    });
    if (new Set(checks.map(check => check.id)).size !== checks.length) throw new Error('Validation check IDs must be unique.');
    return immutable({ schemaVersion: 1, binding: parseValidationBinding(source.binding), startedAt, finishedAt, expiresAt, checks });
}
