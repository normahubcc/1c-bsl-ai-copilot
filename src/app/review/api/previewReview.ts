import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { PreviewStore } from '../../../features/apply-code/model/previewStore';
import { translateText, UiLanguage } from '../../../shared/i18n/translator';

/** Local read-only snapshots for native diff. No source file write, automatic apply or persisted code. */
export class PreviewReview implements vscode.Disposable, vscode.TextDocumentContentProvider {
    private readonly scheme = 'normahub-diff-' + randomUUID().slice(0, 8);
    private readonly values = new Map<string, string>();
    private readonly changed = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this.changed.event;
    private readonly subscriptions: vscode.Disposable[];
    constructor(private readonly previews: PreviewStore, private readonly language: () => UiLanguage) {
        this.subscriptions = [vscode.workspace.registerTextDocumentContentProvider(this.scheme, this),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.uri.scheme === this.scheme && event.document.getText() !== this.provideTextDocumentContent(event.document.uri)) this.changed.fire(event.document.uri);
            })];
    }
    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.values.get(uri.toString()) ?? translateText('Снимок diff выгружен. Откройте сравнение повторно.', this.language());
    }
    async open(id: string) {
        const artifact = this.previews.captureReview(id), token = randomUUID();
        const left = vscode.Uri.from({ scheme: this.scheme, path: '/' + token + '/before.bsl' });
        const right = vscode.Uri.from({ scheme: this.scheme, path: '/' + token + '/after.bsl' });
        this.values.set(left.toString(), artifact.before); this.values.set(right.toString(), artifact.after);
        while (this.values.size > 32) {
            const key = this.values.keys().next().value!; this.values.delete(key); this.changed.fire(vscode.Uri.parse(key));
        }
        const guard = () => { if (!artifact.isCurrent()) throw new Error('Исходный контекст изменился. Повторите генерацию.'); };
        try {
            guard();
            await vscode.commands.executeCommand('vscode.diff', left, right,
                translateText('Предложение изменения', this.language()) + ': ' + artifact.name + ' (v' + artifact.version + ')', { preview: false });
            guard();
        } catch (error) { this.values.delete(left.toString()); this.values.delete(right.toString()); this.changed.fire(left); this.changed.fire(right); throw error; }
    }
    dispose() { this.values.clear(); this.subscriptions.forEach(s => s.dispose()); this.changed.dispose(); }
}
