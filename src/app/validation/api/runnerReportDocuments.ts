import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { ImportedRunnerEvidence } from '../../../features/runner-validation/model/runnerSessions';
import { formatSignedRunnerReport, RunnerComparison } from '../../../features/runner-validation/model/formatReport';
import { onProjectContextInvalidated } from '../../../entities/project-context/model/contextEpoch';
import { UiLanguage, translateText } from '../../../shared/i18n/translator';

/** Owned read-only documents: source/metadata/pin/expiry changes invalidate presentation without editing user files. */
export class RunnerReportDocuments implements vscode.Disposable, vscode.TextDocumentContentProvider {
    private readonly scheme = 'normahub-runner-' + randomUUID().slice(0, 8);
    private readonly changed = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this.changed.event;
    private readonly records = new Map<string, { uri: vscode.Uri; evidence: ImportedRunnerEvidence; comparison: RunnerComparison; timer?: ReturnType<typeof setTimeout> }>();
    private readonly latest = new Map<string, string>();
    private readonly subscriptions: vscode.Disposable[] = [];

    constructor(private readonly language: () => UiLanguage, subscribePins: (listener: () => void) => vscode.Disposable) {
        this.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(this.scheme, this),
            onProjectContextInvalidated(() => this.refresh()), subscribePins(() => this.refresh()));
        const refresh = () => this.refresh();
        this.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.uri.scheme !== this.scheme) this.refresh();
            else if (event.document.getText() !== this.provideTextDocumentContent(event.document.uri)) {
                // Native typing is read-only, but another extension can still submit a WorkspaceEdit.
                // Restore the presentation from verified evidence, never from editable document text.
                this.changed.fire(event.document.uri);
            }
        }),
            vscode.workspace.onDidCloseTextDocument(doc => { if (doc.uri.scheme !== this.scheme) this.refresh(); }),
            vscode.workspace.onDidChangeWorkspaceFolders(refresh));
        if (vscode.window.tabGroups?.onDidChangeTabs) this.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(refresh));
    }
    has(preview: string): boolean { return this.latest.has(preview); }
    async show(preview: string, evidence: ImportedRunnerEvidence, comparison: RunnerComparison, guard: () => void) {
        const key = evidence.payload.job.jobId;
        let record = this.records.get(key);
        if (!record) {
            const uri = vscode.Uri.from({ scheme: this.scheme, path: '/1C-' + key + '.md' });
            record = { uri, evidence, comparison };
            const delay = Date.parse(evidence.payload.expiresAt) - Date.now() + 1;
            if (delay > 0) { record.timer = setTimeout(() => this.changed.fire(uri), delay); record.timer.unref?.(); }
            this.records.set(key, record);
            if (this.records.size > 16) {
                const oldest = this.records.keys().next().value!;
                const removed = this.records.get(oldest)!; clearTimeout(removed.timer); this.records.delete(oldest); this.changed.fire(removed.uri);
                for (const [id, job] of this.latest) if (job === oldest) this.latest.delete(id);
            }
        }
        this.latest.set(preview, key);
        guard();
        const doc = await vscode.workspace.openTextDocument(record.uri); guard();
        await vscode.window.showTextDocument(doc, { preview: false });
        // Activation can change the source; the read-only provider then displays a stale state.
        this.refresh(); guard();
    }
    async openLatest(preview: string) {
        const key = this.latest.get(preview), record = key && this.records.get(key);
        if (!record) throw new Error('Отчёт выгружен. Импортируйте результат повторно.');
        this.changed.fire(record.uri);
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(record.uri), { preview: false });
    }
    provideTextDocumentContent(uri: vscode.Uri): string {
        const record = [...this.records.values()].find(value => value.uri.toString() === uri.toString());
        return record ? formatSignedRunnerReport(record.evidence, record.comparison, text => translateText(text, this.language()))
            : translateText('Отчёт выгружен. Импортируйте результат повторно.', this.language());
    }
    refresh() { for (const record of this.records.values()) this.changed.fire(record.uri); }
    dispose() {
        for (const record of this.records.values()) clearTimeout(record.timer);
        this.records.clear(); this.latest.clear();
        this.subscriptions.forEach(subscription => subscription.dispose()); this.changed.dispose();
    }
}
