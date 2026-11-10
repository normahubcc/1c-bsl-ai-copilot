import * as vscode from 'vscode';
import { PreviewStore } from '../../../features/apply-code/model/previewStore';
import { QueryComparisonJob } from '../../../features/compare-query-results/model/queryComparisonJob';
import { formatQueryComparison } from '../../../features/compare-query-results/model/formatComparison';
import { readLocalJson } from '../../../shared/lib/readLocalJson';
import { translateText, UiLanguage } from '../../../shared/i18n/translator';

type PickPackage = (options: vscode.OpenDialogOptions) => Thenable<vscode.Uri[] | undefined>;

/** Native orchestration; only the file chooser port is replaceable in IDE automation. */
export class PreviewComparison {
    private readonly busy = new Set<string>();
    constructor(private readonly previews: PreviewStore, private readonly language: () => UiLanguage,
        private readonly pickPackage: PickPackage = options => vscode.window.showOpenDialog(options)) {}

    async exportRequest(id: string): Promise<void> {
        const lease = this.previews.captureQueryCandidate(id);
        const request = { schemaVersion: 1, operation: 'query_comparison_request', candidate: lease.identity,
            responseOperation: 'compare_provided_query_result', contractProjectId: lease.identity.scopeHash,
            engineStatus: 'not_run', approvalVerified: false };
        const doc = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(request, null, 2) });
        if (!lease.isCurrent()) throw new Error('Исходный контекст изменился. Повторите генерацию.');
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    async compare(id: string): Promise<'completed' | 'cancelled'> {
        if (this.busy.has(id)) throw new Error('Сравнение этого результата уже выполняется.');
        const job = new QueryComparisonJob(this.previews.captureQueryCandidate(id));
        this.busy.add(id);
        const t = (value: string) => translateText(value, this.language());
        try {
            const selected = await this.pickPackage({ canSelectMany: false, canSelectFiles: true, canSelectFolders: false,
                title: t('Выберите пакет сравнения: контракт и фактические строки'), filters: { JSON: ['json'] } });
            job.assertCurrent();
            if (!selected?.length) { job.cancel(); return 'cancelled'; }
            if (selected.length !== 1 || selected[0].scheme !== 'file') throw new Error('Выберите один локальный JSON-файл.');
            return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
                title: t('Сравнение данных запроса'), cancellable: true }, async (_progress, cancellation) => {
                const subscription = cancellation.onCancellationRequested(() => job.cancel());
                try {
                    if (cancellation.isCancellationRequested) job.cancel();
                    const value = await readLocalJson(selected[0].fsPath, () => job.assertCurrent());
                    const receipt = job.run(value);
                    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: formatQueryComparison(receipt, t) });
                    job.assertCurrent();
                    await vscode.window.showTextDocument(doc, { preview: false });
                    return 'completed' as const;
                } finally { subscription.dispose(); }
            });
        } finally { this.busy.delete(id); }
    }
}
