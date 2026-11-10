import * as vscode from 'vscode';
import { workspaceRoot, isBslDocument } from '../../../shared/config/workspace';
import { MultiTabScanner } from '../../../multiTabScanner';
import { EditorSnapshot } from '../model/snapshot';
import { editorProjectUri, snapshotDocument, snapshotMatches } from './vscodeSnapshot';
import { targetRevision } from './lifecycle';
import { projectContextEpoch } from '../../project-context/model/contextEpoch';

export interface CapturedTaskContext {
    readonly root: string;
    readonly code: string;
    readonly neighbors: string;
    readonly origin: 'editor' | 'snippet' | 'workspace';
    readonly projectUri: string | null;
    readonly source: EditorSnapshot | null;
}

// Serialized fields and model answers cannot manufacture a native capture capability.
const captures = new WeakMap<CapturedTaskContext, () => boolean>();

export function captureTaskContext(): CapturedTaskContext {
    const editor = vscode.window.activeTextEditor;
    const document = editor?.document;
    const bsl = isBslDocument(document) && !document?.isClosed;
    const projectUri = editorProjectUri(document);
    const root = projectUri ? workspaceRoot(document) : '';
    const source = bsl ? snapshotDocument(document!, targetRevision(document!.uri)) : null;
    const code = bsl ? document!.getText(editor!.selection.isEmpty ? undefined : editor!.selection).slice(0, 16000) : '';
    const neighborSummary = () => bsl && projectUri ? MultiTabScanner.getOpenModulesContext(document).slice(0, 8000) : '';
    const neighbors = neighborSummary();
    const epoch = root ? projectContextEpoch(root) : '';
    const context: CapturedTaskContext = Object.freeze({ root, code, neighbors, origin: bsl ? 'editor' : 'workspace', projectUri, source });
    captures.set(context, () => {
        if (root && epoch !== projectContextEpoch(root)) return false;
        if (projectUri && !(vscode.workspace.workspaceFolders || []).some(folder => folder.uri.toString() === projectUri)) return false;
        if (!source) return true;
        return snapshotMatches(document!, targetRevision(document!.uri), source) &&
            neighborSummary() === neighbors;
    });
    return context;
}

/** Explicit pasted text never borrows an unrelated active editor's project or neighbors. */
export function captureSnippetContext(code: string): CapturedTaskContext {
    if (typeof code !== 'string') throw new Error('Укажите текст фрагмента.');
    const context: CapturedTaskContext = Object.freeze({ root: '', code: code.slice(0, 16000), neighbors: '', origin: 'snippet', projectUri: null, source: null });
    captures.set(context, () => true);
    return context;
}

export function taskContextIsCurrent(context: CapturedTaskContext): boolean {
    try { return captures.get(context)?.() === true; }
    catch { return false; }
}

export function assertCapturedTaskContext(context: CapturedTaskContext): void {
    if (!captures.has(context)) throw new Error('Контекст задачи не захвачен редактором. Повторите действие.');
    if (!taskContextIsCurrent(context)) throw new Error('Исходный контекст изменился. Повторите генерацию.');
}
