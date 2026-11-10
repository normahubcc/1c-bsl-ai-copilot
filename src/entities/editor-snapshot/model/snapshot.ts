import { canonicalJson, hash, immutable, jsonHash, oneOf, positiveInteger, record, schemaV1, text } from '../../../shared/lib/jsonContract';
import { TEXT_HASH_ENCODING } from '../../../shared/lib/sha256';

export interface EditorSnapshot {
    readonly schemaVersion: 1;
    readonly sourceUri: string;
    readonly projectUri: string | null;
    readonly languageId: string;
    readonly documentVersion: number;
    readonly lifecycleEpoch: number;
    readonly contentHash: string;
    readonly textHashEncoding: typeof TEXT_HASH_ENCODING;
    readonly documentLength: number;
}

export function nonnegativeInteger(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${path}: expected a nonnegative safe integer.`);
    return value;
}

function uri(value: unknown, path: string): string {
    const result = text(value, path, 4096);
    if (!/^[a-z][a-z0-9+.-]*:/i.test(result)) throw new Error(`${path}: expected a URI.`);
    return result;
}

export function parseEditorSnapshot(value: unknown): EditorSnapshot {
    canonicalJson(value);
    const source = record(value, ['schemaVersion', 'sourceUri', 'projectUri', 'languageId', 'documentVersion', 'lifecycleEpoch', 'contentHash', 'textHashEncoding', 'documentLength'], 'editorSnapshot');
    schemaV1(source.schemaVersion);
    return immutable({ schemaVersion: 1, sourceUri: uri(source.sourceUri, 'sourceUri'),
        projectUri: source.projectUri === null ? null : uri(source.projectUri, 'projectUri'),
        languageId: text(source.languageId, 'languageId', 64), documentVersion: positiveInteger(source.documentVersion, 'documentVersion'),
        lifecycleEpoch: nonnegativeInteger(source.lifecycleEpoch, 'lifecycleEpoch'), contentHash: hash(source.contentHash, 'contentHash'),
        textHashEncoding: oneOf(source.textHashEncoding, [TEXT_HASH_ENCODING], 'textHashEncoding'),
        documentLength: nonnegativeInteger(source.documentLength, 'documentLength') });
}

export function editorSnapshotHash(value: unknown): string { return jsonHash(parseEditorSnapshot(value)); }

/** Local namespace identity only, not a tenant/project authorization token. */
export function localScopeHash(projectUri: string | null, sourceUri: string | null): string {
    return jsonHash({ projectUri, sourceUri: projectUri ? null : sourceUri });
}
