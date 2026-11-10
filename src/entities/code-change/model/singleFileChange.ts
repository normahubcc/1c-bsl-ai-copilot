import { hash, identifier, immutable, jsonHash } from '../../../shared/lib/jsonContract';
import { EditorSnapshot, editorSnapshotHash, nonnegativeInteger } from '../../editor-snapshot/model/snapshot';
import { sha256Text, TEXT_HASH_ENCODING } from '../../../shared/lib/sha256';

export interface SingleFileChange {
    readonly schemaVersion: 1;
    readonly changeSetId: string;
    readonly taskId: string | null;
    readonly baseSnapshotHash: string;
    readonly contentHash: string;
    readonly textHashEncoding: typeof TEXT_HASH_ENCODING;
    readonly range: { readonly start: number; readonly end: number };
}

/** Initial single-file insertion/replacement proposal, not a multi-file transaction or execution approval. */
export function createSingleFileChange(source: EditorSnapshot, range: { start: number; end: number }, code: string, taskId?: string): SingleFileChange {
    if (typeof code !== 'string' || !code.length) throw new Error('A change requires nonempty text.');
    const start = nonnegativeInteger(range.start, 'range.start'), end = nonnegativeInteger(range.end, 'range.end');
    if (start > end || end > source.documentLength) throw new Error('Change range is outside its source snapshot.');
    const base = { schemaVersion: 1 as const, taskId: taskId === undefined ? null : identifier(taskId, 'taskId'),
        baseSnapshotHash: editorSnapshotHash(source), contentHash: sha256Text(code), textHashEncoding: TEXT_HASH_ENCODING, range: { start, end } };
    hash(base.contentHash, 'contentHash');
    return immutable({ ...base, changeSetId: jsonHash(base) });
}

/** Materialize an exact captured proposal without touching a document or rebasing onto later edits. */
export function materializeSingleFileChange(source: EditorSnapshot, baseText: string, change: SingleFileChange, code: string): string {
    if (baseText.length !== source.documentLength || sha256Text(baseText) !== source.contentHash ||
        change.baseSnapshotHash !== editorSnapshotHash(source) || change.contentHash !== sha256Text(code)) throw new Error('Снимок сравнения не соответствует исходному модулю.');
    if (change.range.start < 0 || change.range.start > change.range.end || change.range.end > baseText.length) throw new Error('Диапазон изменения выходит за пределы снимка.');
    return baseText.slice(0, change.range.start) + code + baseText.slice(change.range.end);
}
