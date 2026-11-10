import { randomUUID } from 'node:crypto';
import { canonicalJson, hash, identifier, immutable, jsonHash, oneOf, record, schemaV1, text } from '../../../shared/lib/jsonContract';
import { TEXT_HASH_ENCODING } from '../../../shared/lib/sha256';

export type AiTaskKind = 'query' | 'bdd' | 'explain';
export interface LocalTaskSpec {
    readonly schemaVersion: 1;
    readonly taskId: string;
    readonly kind: AiTaskKind;
    readonly origin: 'editor' | 'snippet' | 'workspace';
    readonly scopeHash: string;
    readonly sourceSnapshotHash: string | null;
    readonly intentHash: string;
    readonly codeContextHash: string;
    readonly neighborContextHash: string;
    readonly metadataPromptHash: string;
    readonly requestedModel: string;
    readonly textHashEncoding: typeof TEXT_HASH_ENCODING;
    readonly mode: 'unverified_draft';
}

export function createLocalTaskSpec(value: unknown): LocalTaskSpec {
    canonicalJson(value);
    const source = record(value, ['schemaVersion', 'kind', 'origin', 'scopeHash', 'sourceSnapshotHash', 'intentHash', 'codeContextHash', 'neighborContextHash', 'metadataPromptHash', 'requestedModel', 'textHashEncoding'], 'task');
    schemaV1(source.schemaVersion);
    const origin = oneOf(source.origin, ['editor', 'snippet', 'workspace'], 'origin');
    const sourceSnapshotHash = source.sourceSnapshotHash === null ? null : hash(source.sourceSnapshotHash, 'sourceSnapshotHash');
    if ((origin === 'editor') !== (sourceSnapshotHash !== null)) throw new Error('Editor tasks require a source snapshot; detached tasks cannot claim one.');
    return immutable({ schemaVersion: 1, taskId: randomUUID(), kind: oneOf(source.kind, ['query', 'bdd', 'explain'], 'kind'), origin,
        scopeHash: hash(source.scopeHash, 'scopeHash'), sourceSnapshotHash, intentHash: hash(source.intentHash, 'intentHash'),
        codeContextHash: hash(source.codeContextHash, 'codeContextHash'), neighborContextHash: hash(source.neighborContextHash, 'neighborContextHash'),
        metadataPromptHash: hash(source.metadataPromptHash, 'metadataPromptHash'), requestedModel: text(source.requestedModel, 'requestedModel', 128),
        textHashEncoding: oneOf(source.textHashEncoding, [TEXT_HASH_ENCODING], 'textHashEncoding'), mode: 'unverified_draft' });
}

export function draftCandidateId(task: LocalTaskSpec, contentHash: string): string {
    identifier(task.taskId, 'taskId');
    hash(contentHash, 'candidateHash');
    return jsonHash({ taskId: task.taskId, sourceSnapshotHash: task.sourceSnapshotHash, contentHash });
}
