import * as vscode from 'vscode';
import { isBslDocument } from '../../../shared/config/workspace';
import { targetRevision } from './targetLifecycle';
import { EditorSnapshot, editorSnapshotHash } from '../../../entities/editor-snapshot/model/snapshot';
import { snapshotDocument, snapshotMatches } from '../../../entities/editor-snapshot/api/vscodeSnapshot';
import { LocalTaskSpec } from '../../../entities/ai-task/model/draftTask';
import { createSingleFileChange, materializeSingleFileChange, SingleFileChange } from '../../../entities/code-change/model/singleFileChange';
import { sha256Text } from '../../../shared/lib/sha256';
import { jsonHash } from '../../../shared/lib/jsonContract';
import { parseQueryCandidateIdentity, QueryCandidateLease, QueryCandidateArtifact } from '../../../entities/validation/model/queryComparison';

export interface EditorTarget {
    document: vscode.TextDocument;
    uri: vscode.Uri;
    version: number;
    position: vscode.Position;
    selection?: vscode.Range;
    name: string;
    lifecycleRevision: number;
    readonly source: EditorSnapshot;
    readonly baseText?: string;
    readonly offsets: { readonly start: number; readonly end: number };
}

export interface PreviewTaskBinding {
    readonly task: LocalTaskSpec;
    readonly contentHash: string;
    readonly isCurrent: () => boolean;
}

export function captureEditorTarget(replaceText?: string): EditorTarget | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isBslDocument(editor.document)) return undefined;
    const document = editor.document;
    const lifecycleRevision = targetRevision(document.uri);
    const baseText = document.getText();
    const selection = replaceText !== undefined && !editor.selection.isEmpty && document.getText(editor.selection) === replaceText
        ? new vscode.Range(editor.selection.start, editor.selection.end) : undefined;
    const start = document.offsetAt(selection?.start ?? editor.selection.active);
    const end = selection ? document.offsetAt(selection.end) : start;
    return Object.freeze({
        baseText: baseText.length <= 1024 * 1024 ? baseText : undefined, document: editor.document, uri: editor.document.uri, version: editor.document.version,
        lifecycleRevision,
        position: editor.selection.active, name: editor.document.fileName.split(/[/\\]/).pop() || 'BSL',
        selection, source: snapshotDocument(document, lifecycleRevision), offsets: Object.freeze({ start, end })
    });
}

/** Apply only code produced by the host, once, against the captured document version. */
export class PreviewStore {
    private nextId = 0;
    private applying = new Set<string>();
    private records = new Map<string, { code: string; language: string; target?: EditorTarget; change?: SingleFileChange; binding?: PreviewTaskBinding }>();

    add(code: string, language = 'bsl', target?: EditorTarget, binding?: PreviewTaskBinding) {
        if (binding && sha256Text(code) !== binding.contentHash) throw new Error('Содержимое результата изменилось. Повторите генерацию.');
        if (binding && target && binding.task.sourceSnapshotHash !== editorSnapshotHash(target.source)) throw new Error('Результат относится к другому исходному модулю. Повторите генерацию.');
        const change = language === 'bsl' && target ? createSingleFileChange(target.source, target.offsets, code, binding?.task.taskId) : undefined;
        const id = String(++this.nextId);
        const capturedBinding = binding ? Object.freeze({ task: binding.task, contentHash: binding.contentHash, isCurrent: binding.isCurrent }) : undefined;
        this.records.set(id, { code, language, target, change, binding: capturedBinding });
        if (this.records.size > 30) this.records.delete(this.records.keys().next().value!);
        return { reviewAvailable: !!change && typeof target?.baseText === 'string', previewId: id, targetName: target?.name, targetVersion: target?.version, replacesSelection: !!target?.selection,
            ...(change ? { changeSetId: change.changeSetId, baseSnapshotHash: change.baseSnapshotHash, candidateHash: change.contentHash } : {}),
            ...(binding ? { taskId: binding.task.taskId, candidateHash: binding.contentHash, sourceCurrent: binding.isCurrent(),
                comparisonAvailable: binding.task.kind === 'query' && !!target } : {}), executionVerified: false };
    }

    captureReview(id: string) {
        const record = this.get(id), { target, change } = record;
        if (!target || !change || typeof target.baseText !== 'string') throw new Error('Для этого результата нет снимка изменения.');
        if (target.baseText.length > 1024 * 1024) throw new Error('Модуль превышает лимит native diff 2 MiB.');
        const isCurrent = () => this.records.get(id) === record && vscode.workspace.isTrusted === true &&
            snapshotMatches(target.document, targetRevision(target.uri), target.source) && (!record.binding || record.binding.isCurrent());
        if (!isCurrent()) throw new Error('Исходный контекст изменился. Повторите генерацию.');
        const after = materializeSingleFileChange(target.source, target.baseText, change, record.code);
        return Object.freeze({ before: target.baseText, after, name: target.name, version: target.version, isCurrent });
    }

    latestReviewId(): string | undefined {
        return [...this.records].reverse().find(([, record]) => record.change && typeof record.target?.baseText === 'string')?.[0];
    }

    captureQueryArtifact(id: string): QueryCandidateArtifact {
        const lease = this.captureQueryCandidate(id);
        const record = this.get(id), source = record.target!.source;
        return Object.freeze({ ...lease, code: record.code, scopeLabel: source.projectUri ?? source.sourceUri });
    }

    captureQueryCandidate(id: string): QueryCandidateLease {
        const record = this.get(id), { target, binding } = record;
        if (!target || !binding || binding.task.kind !== 'query' || !binding.task.sourceSnapshotHash) {
            throw new Error('Сравнение доступно для AI-запроса с исходным BSL-модулем.');
        }
        const isCurrent = () => this.records.get(id) === record && vscode.workspace.isTrusted === true &&
            binding.isCurrent() && snapshotMatches(target.document, targetRevision(target.uri), target.source) &&
            sha256Text(record.code) === binding.contentHash;
        if (!isCurrent()) throw new Error('Исходный контекст изменился. Повторите генерацию.');
        return Object.freeze({ identity: parseQueryCandidateIdentity({ schemaVersion: 1, taskId: binding.task.taskId,
            scopeHash: binding.task.scopeHash, snapshotHash: binding.task.sourceSnapshotHash, contextHash: jsonHash(binding.task),
            candidateHash: binding.contentHash, textHashEncoding: binding.task.textHashEncoding }), isCurrent });
    }

    async open(id: string): Promise<void> {
        const record = this.get(id);
        const doc = await vscode.workspace.openTextDocument({ content: record.code, language: record.language });
        await vscode.window.showTextDocument(doc);
    }

    async apply(id: string): Promise<string> {
        if (this.applying.has(id)) throw new Error('Этот результат уже применяется.');
        this.applying.add(id);
        try {
        const record = this.get(id), target = record.target;
        if (record.language !== 'bsl' || !target) throw new Error('Для результата нет исходного BSL-модуля. Откройте результат в отдельном редакторе.');
        const closed = () => target.document.isClosed || targetRevision(target.uri) !== target.lifecycleRevision;
        const assertCurrent = (document: vscode.TextDocument) => {
            if (closed() || document !== target.document) throw new Error('Исходный модуль закрыт или переоткрыт. Создайте предпросмотр повторно.');
            if (!isBslDocument(document) || !snapshotMatches(document, targetRevision(target.uri), target.source)) throw new Error('Исходный модуль изменён после генерации. Создайте результат повторно или откройте его отдельно.');
            if (record.binding && !record.binding.isCurrent()) throw new Error('Исходный контекст изменился. Повторите генерацию.');
            if (!record.change || record.change.contentHash !== sha256Text(record.code)) throw new Error('Содержимое результата изменилось. Повторите генерацию.');
        };
        assertCurrent(target.document);
        const doc = await vscode.workspace.openTextDocument(target.uri);
        assertCurrent(doc);
        const editor = await vscode.window.showTextDocument(doc);
        // Re-check after showTextDocument: editor activation may run other extensions.
        assertCurrent(editor.document);
        const change = record.change!;
        const applied = await editor.edit(edit => {
            assertCurrent(editor.document);
            const start = doc.positionAt(change.range.start), end = doc.positionAt(change.range.end);
            if (change.range.start === change.range.end) edit.insert(start, record.code);
            else edit.replace(new vscode.Range(start, end), record.code);
        });
        if (!applied) throw new Error('Не удалось вставить: файл может быть только для чтения.');
        this.records.delete(id);
        return `Код применён в ${target.name}`;
        } finally { this.applying.delete(id); }
    }

    private get(id: string) {
        const record = this.records.get(id);
        if (!record) throw new Error('Предпросмотр устарел. Сформируйте результат повторно.');
        return record;
    }
}
