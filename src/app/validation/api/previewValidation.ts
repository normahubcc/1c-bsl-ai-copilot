import * as vscode from 'vscode';
import { PreviewStore } from '../../../features/apply-code/model/previewStore';
import { RunnerTrustStore } from '../../../features/manage-runner-trust/model/runnerTrustStore';
import { RunnerSessions } from '../../../features/runner-validation/model/runnerSessions';
import { parseRunnerConnection } from '../../../entities/runner/model/connection';
import { localScopeHash } from '../../../entities/editor-snapshot/model/snapshot';
import { captureTaskContext, taskContextIsCurrent } from '../../../entities/editor-snapshot/api/taskContext';
import { readLocalJson } from '../../../shared/lib/readLocalJson';
import { translateText, UiLanguage } from '../../../shared/i18n/translator';
import { compareQueryResults } from '../../../features/compare-query-results/model/compareResults';
import { PreviewComparison } from './previewComparison';
import { RunnerReportDocuments } from './runnerReportDocuments';
import { validationPlanWizard } from './validationPlanWizard';

export interface ValidationMenuItem extends vscode.QuickPickItem { action: string; }
export interface ValidationNativeUi {
    input?(options: vscode.InputBoxOptions): Thenable<string | undefined>;
    pick(items: ValidationMenuItem[], options: vscode.QuickPickOptions): Thenable<ValidationMenuItem | undefined>;
    file(options: vscode.OpenDialogOptions): Thenable<vscode.Uri[] | undefined>;
    confirm(message: string, options: vscode.MessageOptions, action: string): Thenable<string | undefined>;
}
const nativeUi: ValidationNativeUi = {
    input: options => vscode.window.showInputBox(options),
    pick: (items, options) => vscode.window.showQuickPick(items, options),
    file: options => vscode.window.showOpenDialog(options),
    confirm: (message, options, action) => vscode.window.showInformationMessage(message, options, action)
};
type Scope = { scopeHash: string; label: string; isCurrent: () => boolean };

/** Thin native orchestration. No Docker, private-key access, inference or automatic apply. */
export class PreviewValidation implements vscode.Disposable {
    private readonly trust: RunnerTrustStore;
    private readonly sessions: RunnerSessions;
    private readonly busy = new Set<string>();
    private reports?: RunnerReportDocuments;
    constructor(private readonly context: vscode.ExtensionContext, private readonly previews: PreviewStore,
        private readonly language: () => UiLanguage, private readonly comparison: PreviewComparison,
        private readonly ui: ValidationNativeUi = nativeUi) {
        this.trust = new RunnerTrustStore(context.globalState);
        this.sessions = new RunnerSessions(scope => this.trust.get(scope));
    }
    private t(value: string): string { return translateText(value, this.language()); }
    private guard(scope: Scope) {
        if (vscode.workspace.isTrusted !== true) throw new Error('Для проверки требуется доверенная рабочая область VS Code.');
        if (!scope.isCurrent()) throw new Error('Исходный контекст изменился. Повторите генерацию.');
    }
    private currentScope(): Scope {
        const context = captureTaskContext();
        const source = context.source?.sourceUri;
        if (!context.projectUri && !source?.startsWith('file:')) throw new Error('Выберите проект или сохранённый BSL-модуль для профиля проверки.');
        return { scopeHash: localScopeHash(context.projectUri, source ?? null), label: context.projectUri ?? source!,
            isCurrent: () => taskContextIsCurrent(context) };
    }
    private async json(title: string, guard: () => void): Promise<unknown | undefined> {
        guard();
        const files = await this.ui.file({ title: this.t(title), canSelectMany: false, canSelectFiles: true,
            canSelectFolders: false, filters: { JSON: ['json'] } });
        guard();
        if (!files?.length) return undefined;
        if (files.length !== 1 || files[0].scheme !== 'file') throw new Error('Выберите один локальный JSON-файл.');
        return readLocalJson(files[0].fsPath, guard);
    }
    private async connect(scope: Scope) {
        const guard = () => this.guard(scope);
        const data = await this.json('Выберите публичный профиль от оператора 1С', guard);
        if (data === undefined) return;
        const connection = parseRunnerConnection(data);
        if (connection.profile.projectId !== scope.scopeHash) throw new Error('Профиль оператора относится к другому проекту.');
        const action = this.t('Закрепить профиль');
        const approved = await this.ui.confirm(this.t('Подключить профиль проверки для этого проекта?'), { modal: true,
            detail: [this.t('Сверьте полный отпечаток ключа с оператором перед подключением.'), '', scope.label,
                this.t('Оператор') + ': ' + connection.profile.runnerId, this.t('Профиль') + ': ' + connection.profile.profileId,
                this.t('Платформа') + ': ' + connection.profile.platformVersion,
                this.t('Отпечаток ключа') + ': ' + connection.profile.keyId,
                this.t('Профиль разрешает проверку подписи. Исполнение кода и approval он не предоставляет.')].join('\n') }, action);
        guard();
        if (approved === action) await this.trust.pin(scope.scopeHash, connection);
    }
    async manageProfile(): Promise<void> {
        const scope = this.currentScope(); this.guard(scope);
        const key = 'profile:' + scope.scopeHash;
        if (this.busy.has(key)) throw new Error('Профиль проверки уже изменяется.');
        this.busy.add(key);
        try {
            const pin = this.trust.get(scope.scopeHash);
            const picked = await this.ui.pick([
                { action: 'connect', label: this.t(pin ? 'Сменить профиль проверки' : 'Подключить профиль проверки 1С'), description: pin?.profile.profileId },
                { action: 'scope', label: this.t('Экспортировать описание проекта для оператора') },
                ...(pin ? [{ action: 'revoke', label: this.t('Отключить профиль проверки'), description: pin.profile.keyId }] : [])
            ], { title: this.t('Профиль проверки 1С'), placeHolder: scope.label });
            this.guard(scope);
            if (picked?.action === 'connect') await this.connect(scope);
            if (picked?.action === 'revoke' && pin) await this.trust.revoke(scope.scopeHash);
            if (picked?.action === 'scope') {
                const document = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify({
                    schemaVersion: 1, operation: 'runner_project_descriptor', projectId: scope.scopeHash, projectUri: scope.label
                }, null, 2) });
                this.guard(scope);
                await vscode.window.showTextDocument(document, { preview: false });
                this.guard(scope);
            }
        } finally { this.busy.delete(key); }
    }
    async menu(preview: string): Promise<void> {
        if (this.busy.has(preview)) throw new Error('Проверка этого результата уже открыта.');
        this.busy.add(preview);
        try {
            let artifact;
            try { artifact = this.previews.captureQueryArtifact(preview); } catch (error) {
                if (this.reports?.has(preview)) { await this.reports.openLatest(preview); return; }
                throw error;
            }
            const scope: Scope = { scopeHash: artifact.identity.scopeHash, label: artifact.scopeLabel ?? artifact.identity.scopeHash, isCurrent: artifact.isCurrent };
            const pin = this.trust.get(scope.scopeHash);
            const items: ValidationMenuItem[] = [];
            if (this.reports?.has(preview)) items.push({ action: 'report', label: this.t('Открыть последний отчёт 1С') });
            if (pin) items.push({ action: 'create', label: this.t('Создать проверку запроса'), description: pin.profile.profileId },
                { action: 'prepare', label: this.t('Импортировать готовый план проверки') },
                { action: 'import', label: this.t('Импортировать подписанный результат 1С') });
            items.push({ action: 'connect', label: this.t(pin ? 'Сменить профиль проверки' : 'Подключить профиль проверки 1С') },
                { action: 'compare', label: this.t('Сравнить предоставленные данные'), description: this.t('Без подтверждения исполнения 1С') },
                { action: 'export', label: this.t('Экспортировать задание сравнения данных') });
            if (pin) items.push({ action: 'revoke', label: this.t('Отключить профиль проверки') });
            const picked = await this.ui.pick(items, { title: this.t('Проверить результат'), matchOnDescription: true });
            if (!picked) return;
            if (picked.action === 'report') { await this.reports?.openLatest(preview); return; }
            this.guard(scope);
            switch (picked.action) {
                case 'connect': await this.connect(scope); break;
                case 'revoke': await this.trust.revoke(scope.scopeHash); break;
                case 'compare': await this.comparison.compare(preview); break;
                case 'export': await this.comparison.exportRequest(preview); break;
                case 'create': await this.prepare(preview, true); break;
                case 'prepare': await this.prepare(preview); break;
                case 'import': await this.importResult(preview); break;
            }
        } finally { this.busy.delete(preview); }
    }
    private async prepare(preview: string, interactive = false) {
        const artifact = this.previews.captureQueryArtifact(preview);
        const originalPin = this.trust.get(artifact.identity.scopeHash);
        if (!originalPin) throw new Error('Сначала подключите профиль проверки для проекта.');
        const guard = () => {
            if (!artifact.isCurrent()) throw new Error('Исходный контекст изменился. Повторите генерацию.');
            if (this.trust.get(artifact.identity.scopeHash)?.revision !== originalPin.revision) throw new Error('Профиль проверки изменён или отключён. Подготовьте новое задание.');
        };
        const plan = interactive ? await validationPlanWizard(artifact, originalPin.profile, this.ui, value => this.t(value), guard)
            : await this.json('Выберите план проверки: контракт и диапазон запроса', guard);
        if (plan === undefined) return;
        guard();
        const job = this.sessions.prepare(preview, artifact, plan);
        try {
            const doc = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(job, null, 2) });
            this.sessions.assertCurrent(preview);
            await vscode.window.showTextDocument(doc, { preview: false });
            this.sessions.assertCurrent(preview); this.reports?.refresh();
        } catch (error) { this.sessions.invalidate(preview); this.reports?.refresh(); throw error; }
    }
    private async importResult(preview: string) {
        const guard = () => this.sessions.assertCurrent(preview);
        const input = await this.json('Выберите подписанный результат задания 1С', guard);
        if (input === undefined) return;
        const evidence = this.sessions.accept(preview, input);
        const comparison = evidence.payload.observation.actual ? compareQueryResults(evidence.request.contract.assertion.expected,
            evidence.payload.observation.actual, evidence.request.contract.assertion.mode) : null;
        if (!this.reports) {
            this.reports = new RunnerReportDocuments(this.language, listener => this.trust.subscribe(listener));
        }
        await this.reports.show(preview, evidence, comparison, guard);
    }
    refreshReports() { this.reports?.refresh(); }
    dispose() { this.reports?.dispose(); }
}
