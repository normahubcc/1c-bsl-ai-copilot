import * as vscode from 'vscode';
import { sha256Text, TEXT_HASH_ENCODING } from '../../../shared/lib/sha256';
import { EditorSnapshot, editorSnapshotHash, parseEditorSnapshot } from '../model/snapshot';

export function editorProjectUri(document?: vscode.TextDocument): string | null {
    const folder = document && vscode.workspace.getWorkspaceFolder?.(document.uri);
    if (folder) return folder.uri.toString();
    // A standalone file cannot borrow another project's configuration.
    if (document && document.uri.scheme !== 'untitled') return null;
    const folders = vscode.workspace.workspaceFolders || [];
    return folders.length === 1 ? folders[0].uri.toString() : null;
}

/** Native IDE adapter. Domain models import no vscode modules. */
export function snapshotDocument(document: vscode.TextDocument, lifecycleEpoch: number, contents = document.getText()): EditorSnapshot {
    return parseEditorSnapshot({ schemaVersion: 1, sourceUri: document.uri.toString(), projectUri: editorProjectUri(document),
        languageId: document.languageId, documentVersion: document.version, lifecycleEpoch,
        contentHash: sha256Text(contents), textHashEncoding: TEXT_HASH_ENCODING, documentLength: contents.length });
}

export function snapshotMatches(document: vscode.TextDocument, lifecycleEpoch: number, expected: EditorSnapshot): boolean {
    if (document.isClosed || document.uri.toString() !== expected.sourceUri || document.version !== expected.documentVersion ||
        document.languageId !== expected.languageId || lifecycleEpoch !== expected.lifecycleEpoch || editorProjectUri(document) !== expected.projectUri) return false;
    return editorSnapshotHash(snapshotDocument(document, lifecycleEpoch)) === editorSnapshotHash(expected);
}
