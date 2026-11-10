import { PreviewReview } from './app/review/api/previewReview';
import * as vscode from 'vscode';
import * as path from 'path';
import { checkSidecarHealth } from './features/integrations/api/sidecarHealth';
import { NormaHubClient } from './normahubClient';
import { MetadataScanner } from './metadataScanner';
import { StandardsChecker } from './standardsChecker';
import { BSPHelper } from './bspHelper';
import { QueryBuilder } from './queryBuilder';
import { ExtensionGenerator, ExtensionDirective } from './extensionGenerator';
import { BDDGenerator } from './bddGenerator';
import { parseVanessaSteps } from './entities/bdd/model/steps';
import { MultiTabScanner } from './multiTabScanner';
import { TechLogAnalyzer } from './techLogAnalyzer';
import { ConfigurationMetadata } from './types';
import { workspaceStyles } from './workspaceStyles';
import { workspaceTools } from './workspaceTools';
import { clearInlineCompletionContextCache } from './inlineCompletionContext';
import { workspaceRoot, isBslDocument } from './shared/config/workspace';
import { DEFAULT_AUTOCOMPLETE_MODEL, resolveModel, validateModel, ModelPurpose } from './shared/config/models';
import { captureTaskContext, captureSnippetContext, runAiTask, GeneratedTaskResult } from './features/ai-task/api/runTask';
import { PreviewStore, captureEditorTarget, EditorTarget, PreviewTaskBinding } from './features/apply-code/model/previewStore';
import { invalidateProjectContext } from './entities/project-context/model/contextEpoch';
import { UiLanguage, translateText } from './shared/i18n/translator';
import { localizePresentation } from './features/ui-language/model/presentation';
import { preferredUiLanguage, saveUiLanguage } from './features/ui-language/model/preferences';
import { languageScript } from './features/ui-language/ui/script';
import { BSP_DESCRIPTIONS_EN } from './shared/i18n/bsp.en';
import { splitParameters } from './shared/bsl/parameters';
import { PreviewComparison } from './app/validation/api/previewComparison';
import { PreviewValidation } from './app/validation/api/previewValidation';

export class NormaHub1CSidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _queryPending = false;
    private _queryAbort?: AbortController;
    private _previews = new PreviewStore();
    private _ready = false;
    private _language: UiLanguage;
    private _comparison = new PreviewComparison(this._previews, () => this._language);
    private _validation?: PreviewValidation;
    private _review?: PreviewReview;
    private review() {
        if (!this._review) { this._review = new PreviewReview(this._previews, () => this._language); this._context.subscriptions.push(this._review); }
        return this._review;
    }
    public async reviewLatestPreview(): Promise<void> {
        try {
            const id = this._previews.latestReviewId();
            if (!id) throw new Error('Сначала создайте BSL-черновик для открытого модуля.');
            await this.review().open(id);
        } catch (error) { await vscode.window.showErrorMessage(translateText(error instanceof Error ? error.message : 'Не удалось открыть diff.', this._language)); }
    }

    private validation() {
        if (!this._validation) {
            this._validation = new PreviewValidation(this._context, this._previews, () => this._language, this._comparison);
            this._context.subscriptions.push(this._validation);
        }
        return this._validation;
    }

    public async manageRunnerProfile(): Promise<void> {
        try { await this.validation().manageProfile(); }
        catch (error) { await vscode.window.showErrorMessage(translateText(error instanceof Error ? error.message : 'Не удалось открыть профиль проверки.', this._language)); }
    }
    private _lastSidebarStatus?: Record<string, any>;
    private _languageChangeId = 0;
    private _navigation?: { tool: string; explain?: boolean; selectedText: string };

    public async openTool(tool: string, explain = false): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        this._navigation = { tool, explain, selectedText: editor && isBslDocument(editor.document) && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '' };
        await vscode.commands.executeCommand('normahub1c.mainView.focus');
        if (this._ready) this._sendNavigation();
    }

    private _sendNavigation() {
        if (!this._navigation || !this._view) return;
        this._postMessage({ type: 'navigateTool', ...this._navigation });
        this._navigation = undefined;
    }

    private _sendCode(type: string, code: string, target?: EditorTarget, extra = {}, binding?: PreviewTaskBinding) {
        this._postMessage({ type, code, ...extra, ...this._previews.add(code, 'bsl', target, binding) });
    }
    private _auditDocument?: { uri: vscode.Uri; version: number };

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext,
        private readonly _onLanguageChanged?: (language: UiLanguage) => void
    ) { this._language = preferredUiLanguage(_context); }

    private _postMessage(message: Record<string, any>) {
        if (message.type === 'sidebarStatus') this._lastSidebarStatus = message;
        return this._view?.webview.postMessage(localizePresentation(message, this._language));
    }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        this._ready = false;
        webviewView.onDidDispose?.(() => { this._ready = false; this._queryAbort?.abort(); });
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        const updateHtml = async () => {
            const apiKey = await NormaHubClient.getApiKey(this._context);
            const config = vscode.workspace.getConfiguration('normahub1c');
            const selectedModel = resolveModel(config.get<string>('reasoningModel'), 'gpt-6.1-sol');
            webviewView.webview.html = this._getHtmlForWebview(apiKey, undefined, selectedModel, undefined, resolveModel(config.get<string>('autocompleteModel')));
            return apiKey;
        };

        let apiKey = await NormaHubClient.getApiKey(this._context);
        let statusRefreshId = 0;

        const refreshSidebarStatus = async () => {
            const refreshId = ++statusRefreshId;
            const rootPath = workspaceRoot();
            const [balanceInfo, metadata] = await Promise.all([
                apiKey ? NormaHubClient.checkBalance(apiKey) : Promise.resolve(undefined),
                MetadataScanner.scanWorkspace(rootPath)
            ]);
            if (refreshId !== statusRefreshId) return;

            const gatewayActive = balanceInfo?.status === 'active';
            const insufficient = balanceInfo?.status === 'insufficient_funds';
            const gatewayStatusLabel = gatewayActive
                ? 'Шлюз подключён'
                : (insufficient ? 'Баланс исчерпан' : (apiKey ? (balanceInfo?.error || 'Ошибка ключа') : 'Ключ не настроен'));
            const gatewayStatusBadge = gatewayActive ? 'badge-ok' : (insufficient ? 'badge-warn' : (apiKey ? 'badge-crit' : 'badge-warn'));
            const balanceDisplay = gatewayActive
                ? 'Оплата по факту использования · шлюз активен'
                : (insufficient ? 'Баланс исчерпан на normahub.cc' : (apiKey ? (balanceInfo?.error || 'Ошибка ключа') : 'Ключ не настроен'));

            this._postMessage({
                type: 'sidebarStatus',
                gatewayStatusLabel,
                gatewayStatusBadge,
                balanceDisplay,
                gatewayActive,
                maskedKey: apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : 'Не задан',
                metadataLabel: metadata.objects.length && !metadata.isDemoFallback ? `Метаданные: ${metadata.objects.length} объектов` : 'Метаданные не найдены',
                metadataAvailable: metadata.objects.length > 0 && !metadata.isDemoFallback
            });
        };

        const refreshSidebarStatusSafely = async () => {
            try {
                await refreshSidebarStatus();
            } catch (err) {
                this._postMessage({
                    type: 'sidebarStatus',
                    gatewayStatusLabel: apiKey ? 'Не удалось проверить подключение' : 'Ключ не настроен',
                    gatewayStatusBadge: 'badge-warn',
                    balanceDisplay: 'Статус шлюза недоступен',
                    gatewayActive: false,
                    metadataLabel: 'Не удалось прочитать структуру',
                    metadataAvailable: false
                });
                console.error('[NormaHub] Sidebar status refresh failed:', err);
            }
        };

        const sendEditorContext = () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document) {
                const docName = editor.document.fileName.split(/[/\\]/).pop() || '';
                const isBsl = ['bsl', '1c', 'oscript'].includes(editor.document.languageId) || /\.(bsl|os)$/i.test(docName);
                const sel = editor.selection;
                const lineCount = (!sel.isEmpty && sel.end.line >= sel.start.line) ? (sel.end.line - sel.start.line + 1) : 0;
                const selText = !sel.isEmpty ? editor.document.getText(sel) : '';
                this._postMessage({
                    type: 'editorContext',
                    fileName: docName,
                    isBsl,
                    lineCount,
                    hasSelection: !sel.isEmpty,
                    documentUri: editor.document.uri?.toString(),
                    documentVersion: editor.document.version,
                    selectedText: selText
                });
            } else {
                this._postMessage({
                    type: 'editorContext',
                    fileName: '',
                    isBsl: false,
                    lineCount: 0,
                    hasSelection: false,
                    selectedText: ''
                });
            }
        };

        this._context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(sendEditorContext),
            vscode.window.onDidChangeTextEditorSelection(sendEditorContext)
        );

        sendEditorContext();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (!data || typeof data.type !== 'string') return;
            try {
            switch (data.type) {
                case 'setUiLanguage': {
                    const changeId = ++this._languageChangeId;
                    try {
                        const language = await saveUiLanguage(this._context, data.language);
                        if (changeId !== this._languageChangeId) break;
                        this._language = language;
                        this._validation?.refreshReports();
                        this._onLanguageChanged?.(language);
                        this._postMessage({type:'uiLanguageChanged',language:this._language});
                        sendEditorContext();
                        if (this._lastSidebarStatus) this._postMessage(this._lastSidebarStatus);
                    } catch {
                        if (changeId !== this._languageChangeId) break;
                        this._postMessage({type:'uiLanguageChanged',language:this._language,error:'Не удалось сохранить язык интерфейса.'});
                    }
                    break;
                }
                case 'getEditorContext':
                    sendEditorContext();
                    break;

                case 'webviewReady':
                    this._ready = true;
                    this._sendNavigation();
                    sendEditorContext();
                    await refreshSidebarStatusSafely();
                    break;

                case 'deleteKey':
                    await NormaHubClient.setApiKey(this._context, '');
                    apiKey = await NormaHubClient.getApiKey(this._context);
                    await refreshSidebarStatusSafely();
                    break;

                case 'saveKey':
                    if (typeof data.value !== 'string' || !data.value.trim()) throw new Error('Введите API-ключ. Для удаления используйте отдельную кнопку.');
                    await NormaHubClient.setApiKey(this._context, data.value);
                    apiKey = await NormaHubClient.getApiKey(this._context);
                    vscode.window.showInformationMessage(translateText('API-ключ сохранен в защищенном SecretStorage.', this._language));
                    this._postMessage({ type: 'toast', message: 'API-ключ сохранен в защищенном хранилище' });
                    await refreshSidebarStatusSafely();
                    break;

                case 'changeModel':
                    await this._handleChangeModel(data.model, data.purpose);
                    break;

                case 'openAuditSettings':
                    await vscode.commands.executeCommand('workbench.action.openSettings', '@id:normahub1c.auditDisabledRules');
                    break;

                case 'openExtensionSettings':
                    await vscode.commands.executeCommand('workbench.action.openSettings', 'normahub1c');
                    break;

                case 'openBilling':
                    vscode.env.openExternal(vscode.Uri.parse('https://normahub.cc'));
                    break;

                case 'openB2B':
                    vscode.env.openExternal(vscode.Uri.parse('https://normahub.cc'));
                    break;

                case 'generateQuery':
                    await this._handleGenerateQuery(data.intent);
                    break;

                case 'refactorQuery':
                    await this._handleRefactorQuery(data.rawQuery);
                    break;

                case 'generateBatchTemplate':
                    await this._handleGenerateBatchTemplate(data.entity, data.tabular, data.register, data.registerType, data.fields, data.sourceMode);
                    break;

                case 'generateExtension':
                    await this._handleGenerateExtension(data.method, data.directive, data.params, data.isFunction, data.moduleType);
                    break;

                case 'generateFormButton':
                    await this._handleGenerateFormButton(data.buttonName, data.title, data.commandName, data.parentName);
                    break;

                case 'auditSelection':
                    await this._handleAuditSelection();
                    break;

                case 'auditCodeSnippet':
                    await this._handleAuditCodeSnippet(data.code);
                    break;

                case 'jumpToLine':
                    await this._handleJumpToLine(data.line);
                    break;

                case 'insertCode':
                    await this._handleInsertCode(data.previewId);
                    break;

                case 'reviewPreview':
                    await this.review().open(data.previewId);
                    break;

                case 'openResult':
                    await this._previews.open(data.previewId);
                    break;

                case 'exportComparisonRequest':
                    await this._comparison.exportRequest(data.previewId);
                    break;

                case 'openValidationMenu':
                    await this.validation().menu(data.previewId);
                    break;

                case 'manageRunnerProfile':
                    await this.manageRunnerProfile();
                    break;

                case 'compareQueryData':
                    await this._comparison.compare(data.previewId);
                    break;

                case 'insertBsp': {
                    const method = BSPHelper.STANDARD_MODULES.find(m => m.example === data.code);
                    if (!method) throw new Error('Пример БСП не найден.');
                    const result = this._previews.add(method.example, 'bsl', captureEditorTarget());
                    await this._handleInsertCode(result.previewId);
                    break;
                }

                case 'cancelTask':
                    this._queryAbort?.abort();
                    break;

                case 'explainSelection':
                    await this._handleExplainSelection(data.code);
                    break;

                case 'copyToClipboard':
                    await vscode.env.clipboard.writeText(data.text);
                    break;

                case 'generateBdd':
                    await this._handleGenerateBdd(data.entity, data.tabular, data.register, data.prompt, data.openEditor, data.useAI, data.stepsText);
                    break;

                case 'analyzeTechLog':
                    await this._handleAnalyzeTechLog(data.rawLog);
                    break;

                case 'scanMetadata':
                    await this._handleScanMetadata();
                    break;

                case 'checkSidecarStatus':
                    await this._handleCheckSidecar();
                    break;

                case 'openWorkspaceFile':
                    await this._handleOpenWorkspaceFile(data.relativePath);
                    break;
            }
            } catch (error) {
                const message = NormaHubClient.isCancelledError(error) ? 'Генерация отменена.' : (error instanceof Error ? error.message : 'Не удалось выполнить действие.');
                const resultTypes: Record<string, string> = { generateBatchTemplate: 'batchResult', generateExtension: 'extensionResult', generateFormButton: 'formBtnResult', generateBdd: 'bddResult', scanMetadata: 'metadataResult', explainSelection: 'explainResult' };
                this._postMessage({ type: resultTypes[data.type] || 'toast', error: message, message });
            }
        });
        await updateHtml();
    }

    private async _handleChangeModel(model: string, purpose: ModelPurpose = 'reasoningModel') {
        model = validateModel(model);
        if (!['autocompleteModel', 'reasoningModel'].includes(purpose)) throw new Error('Неизвестная настройка модели.');
        const config = vscode.workspace.getConfiguration('normahub1c');
        const inspected = config.inspect?.(purpose);
        const target = inspected?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
            : inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
        await config.update(purpose, model, target);
        const effectiveConfig = vscode.workspace.getConfiguration('normahub1c');
        this._postMessage({ type: 'modelsChanged', reasoningModel: resolveModel(effectiveConfig.get<string>('reasoningModel'), 'gpt-6.1-sol'), autocompleteModel: resolveModel(effectiveConfig.get<string>('autocompleteModel')) });
        this._postMessage({ type: 'toast', message: purpose === 'autocompleteModel' ? 'Модель автодополнения сохранена' : 'Модель генерации сохранена' });
    }

    private async _handleGenerateQuery(intent: string) {
        if (!this._view || this._queryPending) return;
        if (typeof intent !== 'string' || !intent.trim()) {
            this._postMessage({ type: 'queryResult', error: 'Опишите задачу для запроса 1С.' });
            return;
        }
        const target = captureEditorTarget(), snapshot = captureTaskContext();
        this._queryPending = true;
        this._postMessage({ type: 'taskState', busy: true });
        this._queryAbort = new AbortController();
        try {
            const result = await runAiTask(this._context, 'query', intent, snapshot, this._queryAbort.signal);
            this._sendCode('queryResult', result.code, target,
                { candidateId: result.candidateId, generationStatus: result.generationStatus,
                    ...(!result.sourceCurrent ? { message: 'Исходный контекст изменился. Черновик можно открыть или скопировать; для вставки повторите генерацию.' } : {}) },
                { task: result.task, contentHash: result.contentHash, isCurrent: result.isCurrent });
        } catch (err) {
            this._postMessage({ type: 'queryResult', error: NormaHubClient.isCancelledError(err) ? 'Генерация отменена.' : (err as Error).message });
        } finally { this._queryPending = false; this._queryAbort = undefined; this._postMessage({ type: 'taskState', busy: false }); }
    }

    private async _handleExplainSelection(selectedCode?: string) {
        if (!this._view) return;
        if (this._queryPending) throw new Error('Дождитесь текущей AI-задачи или отмените её.');
        const snapshot = typeof selectedCode === 'string' ? captureSnippetContext(selectedCode) : captureTaskContext();
        const code = snapshot.code;
        if (!code.trim()) throw new Error('Выделите BSL-код или вставьте фрагмент для объяснения.');
        this._queryPending = true;
        this._postMessage({ type: 'taskState', busy: true });
        this._queryAbort = new AbortController();
        try {
            const result = await runAiTask(this._context, 'explain', 'Объясни этот фрагмент и предложи улучшения.', snapshot, this._queryAbort.signal);
            this._postMessage({ type: 'explainResult', report: result.code, taskId: result.task.taskId, candidateId: result.candidateId,
                sourceCurrent: result.sourceCurrent, generationStatus: result.generationStatus, executionVerified: false,
                ...(!result.sourceCurrent ? { message: 'Исходный контекст изменился. Объяснение относится к захваченному фрагменту.' } : {}) });
        } catch (error) {
            this._postMessage({ type: 'explainResult', error: NormaHubClient.isCancelledError(error) ? 'Анализ отменён.' : (error as Error).message });
        } finally { this._queryPending = false; this._queryAbort = undefined; this._postMessage({ type: 'taskState', busy: false }); }
    }

    private async _handleRefactorQuery(rawQuery: string) {
        if (!this._view) return;
        if (!rawQuery || !rawQuery.trim()) {
            this._postMessage({ type: 'refactorResult', error: 'Вставьте текст запроса 1С для оптимизации.' });
            return;
        }
        const result = QueryBuilder.refactorQuery(rawQuery);
        this._postMessage({ type:'refactorResult', code: result.refactoredQuery, ...this._previews.add(result.refactoredQuery, 'plaintext'),
            optimizations: result.appliedOptimizations, reason: result.reason,
            changed: result.appliedOptimizations.length > 0
        });
    }

    private async _handleGenerateBatchTemplate(entity: string, tabular: string, register: string, registerType = 'Остатки', fields: string[] = [], sourceMode: 'document' | 'table' = 'document') {
        const target = captureEditorTarget();
        const metadata = await MetadataScanner.scanWorkspace(workspaceRoot(target?.document));
        const code = QueryBuilder.generateBatchQuery({ entityName: entity, tabularSection: tabular, registerName: register,
            registerType: registerType as 'Остатки', fields, sourceMode, metadata, includeScaffolding: true });
        this._sendCode('batchResult', code, target);
    }

    private async _handleGenerateExtension(method: string, directive: ExtensionDirective, paramsStr: string, isFunction = false, moduleType: 'МодульОбъекта' | 'МодульФормы' | 'ОбщийМодуль' = 'МодульОбъекта') {
        const code = ExtensionGenerator.generateInterceptor({ targetMethod: method, directive,
            parameters: paramsStr ? splitParameters(paramsStr) : [],
            isFunction: !!isFunction, moduleType });
        this._sendCode('extensionResult', code, captureEditorTarget());
    }

    private async _handleGenerateFormButton(buttonName: string, title: string, commandName: string, parentName?: string) {
        const code = ExtensionGenerator.generateFormButtonExtension(buttonName, title, commandName, parentName);
        this._sendCode('formBtnResult', code, captureEditorTarget());
    }

    private async _handleAuditSelection() {
        if (!this._view) return;
        this._auditDocument = undefined;
        const editor = vscode.window.activeTextEditor;
        if (!editor || !(['bsl', '1c', 'oscript'].includes(editor.document.languageId) || /\.(bsl|os)$/i.test(editor.document.fileName))) {
            this._postMessage({ type: 'auditResult', report: 'Откройте модуль BSL для анализа.' });
            return;
        }

        const code = editor.selection.isEmpty
            ? editor.document.getText()
            : editor.document.getText(editor.selection);

        const lineOffset = editor.selection.isEmpty ? 0 : editor.selection.start.line;
        const issues = StandardsChecker.auditCode(code, {disabledRules:vscode.workspace.getConfiguration('normahub1c').get<string[]>('auditDisabledRules', [])}).map(issue => ({ ...issue, line: issue.line + lineOffset }));
        this._auditDocument = { uri: editor.document.uri, version: editor.document.version };
        const report = StandardsChecker.formatAuditReport(issues);
        this._postMessage({ type: 'auditResult', issues, report, canJump: true });
    }

    private async _handleAuditCodeSnippet(code: string) {
        if (!this._view) return;
        this._auditDocument = undefined;
        if (!code || !code.trim()) {
            this._postMessage({ type: 'auditResult', report: 'Вставьте код для проверки.' });
            return;
        }
        const issues = StandardsChecker.auditCode(code, {disabledRules:vscode.workspace.getConfiguration('normahub1c').get<string[]>('auditDisabledRules', [])});
        const report = StandardsChecker.formatAuditReport(issues);
        this._postMessage({ type: 'auditResult', issues, report, canJump: false });
    }

    private async _handleJumpToLine(lineNumber: number) {
        if (!this._auditDocument || !Number.isInteger(lineNumber) || lineNumber <= 0) return;
        const document = await vscode.workspace.openTextDocument(this._auditDocument.uri);
        if (document.version !== this._auditDocument.version) {
            this._postMessage({ type: 'toast', message: 'Модуль изменён после проверки. Запустите аудит повторно.' });
            return;
        }
        const editor = await vscode.window.showTextDocument(document);
        if (editor) {
            const line = Math.min(editor.document.lineCount - 1, Math.max(0, lineNumber - 1));
            const pos = new vscode.Position(line, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
    }

    private async _handleInsertCode(previewId: string) {
        try {
            const message = await this._previews.apply(previewId);
            this._postMessage({ type: 'toast', message });
        } catch (error) {
            this._postMessage({ type: 'toast', message: (error as Error).message });
        }
    }

    private async _handleGenerateBdd(entity: string, tabular: string, register: string, prompt = '', openEditor = false, useAI = false, stepsText = '') {
        if (!this._view) return;
        if (this._queryPending) throw new Error('Дождитесь завершения текущей AI-задачи или отмените её.');
        let feature: string;
        let taskResult: GeneratedTaskResult | undefined;
        if (useAI) {
            this._queryPending = true;
        this._postMessage({ type: 'taskState', busy: true });
            this._queryAbort = new AbortController();
            try {
                const requirements = [prompt, stepsText && `Шаги из библиотеки пользователя (сохранить имена и параметры):\n${stepsText}`, entity && `Документ: ${entity}`, tabular && `Табличная часть: ${tabular}`, register && `Регистр: ${register}`].filter(Boolean).join('\n');
                taskResult = await runAiTask(this._context, 'bdd', requirements, captureTaskContext(), this._queryAbort.signal);
                feature = taskResult.code;
            } finally { this._queryPending = false; this._queryAbort = undefined; this._postMessage({ type: 'taskState', busy: false }); }
        } else {
            const spec = BDDGenerator.generateDocumentScenario(entity || prompt, tabular, register);
            if (prompt) spec.scenarios[0].description = [spec.scenarios[0].description, prompt].filter(Boolean).join('\n');
            spec.scenarios[0].steps = parseVanessaSteps(stepsText);
            feature = BDDGenerator.generateFeature(spec);
        }
        const preview = this._previews.add(feature, 'gherkin', undefined, taskResult ? { task: taskResult.task, contentHash: taskResult.contentHash, isCurrent: taskResult.isCurrent } : undefined);
        const stepCount = feature.split(/\r?\n/).filter(line => /^\s*(?:Дано|Допустим|Когда|Тогда|И|Но|Given|When|Then|And|But)\s+/i.test(line)).length;
        const statusMessage = stepCount ? `Шагов: ${stepCount}. Проверьте их по библиотеке Vanessa и выполните в 1С.` : 'Сохранены только требования: исполняемых шагов нет.';
        this._postMessage({ type: 'bddResult', feature, stepCount,
            ...(taskResult ? { candidateId: taskResult.candidateId, generationStatus: taskResult.generationStatus } : {}),
            message: taskResult && !taskResult.sourceCurrent ? 'Исходный контекст изменился. Черновик можно открыть или скопировать; для вставки повторите генерацию.\n' + statusMessage : statusMessage, ...preview });
        if (openEditor) await this._previews.open(preview.previewId);
    }

    private async _handleAnalyzeTechLog(rawLog: string) {
        if (!this._view) return;
        if (!rawLog || !rawLog.trim()) {
            this._postMessage({ type: 'techLogResult', report: 'Вставьте текст лога ТЖ для анализа.' });
            return;
        }

        // Safe truncation if text exceeds 500 KB to protect Webview UI from freezing
        let processedLog = rawLog;
        let notice = '';
        if (rawLog.length > 500000) {
            processedLog = rawLog.slice(0, 500000);
            notice = '⚠️ Лог превышает 500 КБ. Проанализированы первые события для сохранения отзывчивости UI.\n\n';
        }

        const events = TechLogAnalyzer.parseLog(processedLog);
        const diagnoses = TechLogAnalyzer.diagnose(events);
        const report = notice + TechLogAnalyzer.formatReport(diagnoses, events.length);
        this._postMessage({ type: 'techLogResult', report, count: events.length, diagnosesCount: diagnoses.length, diagnoses, truncated: rawLog.length > 500000 });
    }

    private async _handleScanMetadata() {
        if (!this._view) return;
        const rootPath = workspaceRoot();
        invalidateProjectContext(rootPath || undefined);
        MetadataScanner.clearCache(rootPath);
        clearInlineCompletionContextCache();
        const metadata = await MetadataScanner.scanWorkspace(rootPath);
        this._postMessage({
            type: 'metadataResult',
            name: metadata.name,
            version: metadata.version,
            objectsCount: metadata.objects.length,
            objects: metadata.objects,
            summary: MetadataScanner.formatForPrompt(metadata)
        });
    }

    private async _handleCheckSidecar() {
        this._postMessage({ type: 'sidecarStatus', ...await checkSidecarHealth() });
    }

    private async _handleOpenWorkspaceFile(relativePath: string) {
        const bundledDocs = ['epf/README.md', 'turboconf/README.md', 'README.md'];
        const rootPath = bundledDocs.includes(relativePath) ? this._extensionUri.fsPath : workspaceRoot();
        if (!rootPath || typeof relativePath !== 'string' || !relativePath.trim()) {
            vscode.window.showWarningMessage(translateText('Откройте рабочую область перед открытием файла.', this._language));
            return;
        }
        const fullPath = path.isAbsolute(relativePath) ? relativePath : path.join(rootPath, relativePath);
        const relativeToRoot = path.relative(rootPath, fullPath);
        if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
            vscode.window.showErrorMessage(translateText('Нельзя открыть файл за пределами рабочей области.', this._language));
            return;
        }
        try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
            await vscode.window.showTextDocument(doc);
        } catch (err: any) {
            vscode.window.showErrorMessage(translateText(`Не удалось открыть файл: ${err.message}`, this._language));
        }
    }

    private _getHtmlForWebview(apiKey: string, balance: any, selectedModel: string, metadata?: ConfigurationMetadata, autocompleteModel: string = DEFAULT_AUTOCOMPLETE_MODEL): string {
        autocompleteModel = resolveModel(autocompleteModel);
        selectedModel = resolveModel(selectedModel, 'gpt-6.1-sol');
        const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[char]!));
        const maskedKey = escapeHtml(apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : 'Не задан');
        const isGatewayActive = balance && balance.status === 'active';
        const isInsufficient = balance && balance.status === 'insufficient_funds';
        const balanceDisplay = escapeHtml(isGatewayActive
            ? 'Оплата по факту использования (шлюз активен)'
            : (isInsufficient ? 'Баланс исчерпан на normahub.cc' : (apiKey ? (balance?.error || 'Проверяем подключение…') : 'Ключ не настроен')));
        const gatewayStatusLabel = escapeHtml(isGatewayActive
            ? 'Шлюз подключён'
            : (isInsufficient ? 'Баланс исчерпан' : (apiKey ? (balance ? 'Ошибка' : 'Проверяем…') : 'Не настроен')));
        const gatewayStatusBadge = isGatewayActive ? 'badge-ok' : (isInsufficient || !balance ? 'badge-warn' : (apiKey ? 'badge-crit' : 'badge-warn'));

        // Serialize all 40+ BSP standard modules for instant, zero-latency client-side search
        const bspModulesJson = JSON.stringify(BSPHelper.STANDARD_MODULES.map(method => ({...method,descriptionEnglish:BSP_DESCRIPTIONS_EN[method.method] || method.description})));
        const workspaceToolsJson = JSON.stringify(workspaceTools);
        const openTabsCount = MultiTabScanner.getOpenModulesCount();
        const metadataLabel = metadata?.isDemoFallback
            ? 'Примерные метаданные'
            : (metadata?.objects?.length ? 'Метаданные доступны' : 'Метаданные не найдены');
        const metadataStatus = metadata && !metadata.isDemoFallback && metadata.objects.length ? 'online' : 'idle';

        return `<!DOCTYPE html>
<html lang="${this._language}">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${translateText('NormaHub · Помощник 1С', this._language)}</title>
    <style>
        :root {
            /* Palette 1: Warm Sand (Песочно-бежевая) */
            --sand-bg: #F8F6F0;
            --sand-card-bg: #FFFFFF;
            --sand-card-subtle: #F2EDE4;
            --sand-sub-bg: #EFE9DF;
            --sand-border: #E0D7C8;
            --sand-border-light: #ECE5D8;
            --sand-border-focus: #C87D3B;
            --sand-primary: #C87D3B;
            --sand-primary-hover: #AF682A;
            --sand-secondary: #8B5E34;
            --sand-secondary-hover: #734B28;
            --sand-text: #2C2621;
            --sand-text-secondary: #5C5248;
            --sand-muted: #7E7368;
            --sand-code-bg: #ECE5D8;
            --sand-shadow: 0 1px 3px rgba(44, 38, 33, 0.05), 0 4px 12px rgba(44, 38, 33, 0.03);
            
            /* Palette 2: Warm Dark (Espresso Obsidian) */
            --dark-bg: #151311;
            --dark-card-bg: #1F1B18;
            --dark-card-subtle: #191614;
            --dark-sub-bg: #191614;
            --dark-border: #332B25;
            --dark-border-light: #2A231E;
            --dark-border-focus: #E6A23C;
            --dark-primary: #E6A23C;
            --dark-primary-hover: #F7B550;
            --dark-secondary: #2A2420;
            --dark-secondary-hover: #38302A;
            --dark-text: #F0EAE2;
            --dark-text-secondary: #B8ADA2;
            --dark-muted: #8A7E72;
            --dark-code-bg: #12100E;
            --dark-shadow: 0 2px 8px rgba(0, 0, 0, 0.35), 0 6px 20px rgba(0, 0, 0, 0.25);
        }

        body.theme-warm-sand {
            --bg-main: var(--sand-bg);
            --bg-card: var(--sand-card-bg);
            --bg-card-subtle: var(--sand-card-subtle);
            --bg-sub: var(--sand-sub-bg);
            --border-color: var(--sand-border);
            --border-light: var(--sand-border-light);
            --border-focus: var(--sand-border-focus);
            --btn-primary: var(--sand-primary);
            --btn-primary-hover: var(--sand-primary-hover);
            --btn-primary-text: #FFFFFF;
            --btn-sec: #FFFFFF;
            --btn-sec-hover: #F2EDE4;
            --btn-sec-text: var(--sand-text);
            --text-main: var(--sand-text);
            --text-secondary: var(--sand-text-secondary);
            --text-muted: var(--sand-muted);
            --code-bg: var(--sand-code-bg);
            --code-text: #2C2621;
            --accent-badge: #C87D3B;
            --card-shadow: var(--sand-shadow);
            --badge-crit-bg: #FEE2E2;
            --badge-crit-text: #991B1B;
            --badge-warn-bg: #FEF3C7;
            --badge-warn-text: #92400E;
            --badge-ok-bg: #D1FAE5;
            --badge-ok-text: #065F46;
            --tab-active-bg: #FFFFFF;
            --tab-active-text: #C87D3B;
            --tab-active-shadow: 0 1px 4px rgba(44, 38, 33, 0.08);
        }

        body.theme-espresso {
            --bg-main: var(--dark-bg);
            --bg-card: var(--dark-card-bg);
            --bg-card-subtle: var(--dark-card-subtle);
            --bg-sub: var(--dark-sub-bg);
            --border-color: var(--dark-border);
            --border-light: var(--dark-border-light);
            --border-focus: var(--dark-primary);
            --btn-primary: var(--dark-primary);
            --btn-primary-hover: var(--dark-primary-hover);
            --btn-primary-text: #151311;
            --btn-sec: var(--dark-card-bg);
            --btn-sec-hover: #29231E;
            --btn-sec-text: var(--dark-text);
            --text-main: var(--dark-text);
            --text-secondary: var(--dark-text-secondary);
            --text-muted: var(--dark-muted);
            --code-bg: var(--dark-code-bg);
            --code-text: #F5EFEB;
            --accent-badge: #E6A23C;
            --card-shadow: var(--dark-shadow);
            --badge-crit-bg: #3E1616;
            --badge-crit-text: #F87171;
            --badge-warn-bg: #382811;
            --badge-warn-text: #FBBF24;
            --badge-ok-bg: #112D20;
            --badge-ok-text: #34D399;
            --tab-active-bg: #29231E;
            --tab-active-text: #E6A23C;
            --tab-active-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
        }

        * {
            box-sizing: border-box;
        }

        .sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
        }

        :focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
        button:disabled { opacity: 0.55; cursor: not-allowed; transform: none; box-shadow: none; }
        .studio-target, .pilot-prompt-status { font-size: 11px; line-height: 1.5; color: var(--text-secondary); margin: 8px 0; overflow-wrap: anywhere; }
        .pilot-prompt-status:empty { display: none; }
        .pilot-prompt-status[data-state="error"] { color: var(--badge-crit-text); }
        .pilot-context-bar.context-empty { border-style: dashed; }
        .pilot-context-bar.context-warning { border-color: var(--badge-warn-text); }
        .pilot-context-dot.online { color: var(--badge-ok-text); }
        .pilot-context-dot.warning { color: var(--badge-warn-text); }
        .top-navbar { flex-wrap: wrap; }
        .header-badges { flex-wrap: wrap; min-width: 0; }
        .killer-card-header, .studio-header, .pilot-prompt-footer { flex-wrap: wrap; gap: 8px; }
        .killer-card-title, .studio-badge, .studio-meta { min-width: 0; overflow-wrap: anywhere; }
        .pilot-model-wrapper { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; }
        .pilot-model-select { max-width: 100%; }
        .studio-actions-bar { flex-wrap: wrap; }
        .studio-btn-primary { min-width: 100px; }
        .toast { max-width: calc(100% - 24px); width: max-content; white-space: normal; overflow-wrap: anywhere; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); }
        .modal-card { max-height: calc(100dvh - 24px); }
        .modal-body { overflow-y: auto; min-height: 0; }
        .modal-header, .modal-footer { flex-shrink: 0; }
        .issue-link { width: auto; display: inline-flex; margin: 0 0 0 6px; padding: 2px 5px; background: transparent; color: var(--text-main); }
        .bsp-empty { padding: 16px 8px; color: var(--text-secondary); line-height: 1.5; }
        body.theme-warm-sand { color-scheme: light; --btn-primary: #995A24; --btn-primary-hover: #7F4618; --text-muted: #685D53; }
        body.theme-espresso { color-scheme: dark; --text-muted: #A4988B; }
        .studio-badge { color: var(--badge-ok-text); }
        .studio-btn-primary { background: #047857; }
        .studio-btn-primary:hover { background: #065F46; }
        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
        }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
            font-size: var(--vscode-font-size, 12px);
            color: var(--text-main);
            background-color: var(--bg-main);
            padding: 10px 8px 16px 8px;
            margin: 0;
            line-height: 1.5;
            max-width: 100%;
            overflow-x: hidden;
            word-wrap: break-word;
            transition: background-color 0.25s ease, color 0.25s ease;
        }

        /* Top Header Navigation Bar */
        .top-navbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--border-light);
        }

        .brand-block {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-shrink: 0;
        }

        .brand-badge {
            background: linear-gradient(135deg, var(--btn-primary), var(--accent-badge));
            color: var(--btn-primary-text);
            font-weight: 800;
            font-size: 10.5px;
            padding: 2px 6px;
            border-radius: 5px;
            letter-spacing: 0.6px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.15);
            font-family: 'JetBrains Mono', monospace;
        }

        .brand-title {
            font-size: 12.5px;
            font-weight: 700;
            letter-spacing: 0.1px;
            color: var(--text-main);
            white-space: nowrap;
        }

        /* Embedded Header Micro-Pills */
        .header-badges {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
        }

        .meta-pill {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            padding: 2px 5px;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            font-size: 10px;
            color: var(--text-main);
            font-weight: 500;
            white-space: nowrap;
            box-shadow: 0 1px 2px rgba(0,0,0,0.03);
            cursor: default;
        }

        .meta-pill .pill-num {
            font-weight: 700;
            font-family: 'JetBrains Mono', monospace;
        }

        .meta-pill .pill-text {
            color: var(--text-muted);
            font-size: 9px;
        }

        /* Compact Top-Right Theme Switcher Button */
        .theme-toggle-btn {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            color: var(--text-main);
            cursor: pointer;
            border-radius: 6px;
            padding: 2px 6px;
            font-size: 10px;
            display: inline-flex;
            align-items: center;
            gap: 3px;
            font-weight: 600;
            box-shadow: 0 1px 2px rgba(0,0,0,0.06);
            transition: all 0.18s ease;
            width: auto;
            margin: 0;
        }

        .theme-toggle-btn:hover {
            border-color: var(--border-focus);
            transform: translateY(-1px);
        }

        .theme-toggle-btn .theme-icon {
            font-size: 10.5px;
            line-height: 1;
        }

        /* Status Dots */
        .status-dot {
            width: 6.5px;
            height: 6.5px;
            border-radius: 50%;
            display: inline-block;
        }

        .status-dot.online {
            background-color: #10B981;
            box-shadow: 0 0 5px rgba(16, 185, 129, 0.5);
        }

        .status-dot.idle {
            background-color: #9CA3AF;
        }

        /* High-Level Segmented Category Switcher: [⚡ AI Ассистент] vs [🛠️ Инструменты 1С] */
        .category-segmented {
            display: flex;
            background: var(--bg-card-subtle);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 2.5px;
            margin-bottom: 7px;
            gap: 3px;
        }

        .seg-btn {
            flex: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            padding: 5px 6px;
            border: 1px solid transparent;
            border-radius: 6px;
            background: transparent;
            color: var(--text-muted);
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
            white-space: nowrap;
            width: auto;
            margin: 0;
        }

        .seg-btn.active {
            background: var(--btn-primary);
            color: var(--btn-primary-text);
            border-color: var(--border-focus);
            box-shadow: 0 1px 3px rgba(0,0,0,0.18);
        }

        .seg-btn:not(.active):hover {
            background: var(--bg-card);
            color: var(--text-main);
        }

        /* Dropdown Selector for Sub-Tools */
        .tool-dropdown-wrapper {
            margin-bottom: 9px;
        }

        .tool-select {
            width: 100%;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 6.5px 9px;
            font-size: 11.5px;
            font-weight: 600;
            color: var(--text-main);
            outline: none;
            cursor: pointer;
            transition: all 0.15s ease;
            box-shadow: var(--card-shadow);
        }

        .tool-select:focus {
            border-color: var(--border-focus);
        }

        /* Cards & Section Blocks */
        .card {
            background-color: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 7px;
            padding: 10px 11px;
            margin-bottom: 9px;
            max-width: 100%;
            box-sizing: border-box;
            box-shadow: var(--card-shadow);
            transition: border-color 0.18s ease;
        }

        .card:hover {
            border-color: var(--border-light);
        }

        .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 5px;
            margin-bottom: 6px;
        }

        .card-title {
            font-size: 11.5px;
            font-weight: 700;
            color: var(--text-main);
            letter-spacing: 0.2px;
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .card-desc {
            font-size: 11px;
            color: var(--text-muted);
            margin-bottom: 8px;
            line-height: 1.45;
            word-break: break-word;
        }

        /* Form Controls: Inputs, Textarea, Select */
        input[type="text"], input[type="password"], textarea, select {
            width: 100%;
            max-width: 100%;
            box-sizing: border-box;
            background-color: var(--bg-card-subtle);
            color: var(--text-main);
            border: 1px solid var(--border-color);
            padding: 6.5px 9px;
            border-radius: 5px;
            font-size: 11.5px;
            outline: none;
            font-family: inherit;
            margin-bottom: 6px;
            text-overflow: ellipsis;
            transition: all 0.15s ease;
        }

        input:focus, textarea:focus, select:focus {
            border-color: var(--border-focus);
            background-color: var(--bg-card);
            box-shadow: 0 0 0 2px rgba(230, 162, 60, 0.18);
        }

        textarea {
            resize: vertical;
            min-height: 65px;
            font-family: 'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace;
            font-size: 11px;
            line-height: 1.45;
        }

        /* Buttons & Actions */
        .btn-group {
            display: flex;
            gap: 5px;
            margin-top: 5px;
            flex-wrap: wrap;
        }

        .btn-group button {
            flex: 1 1 calc(50% - 5px);
            min-width: 110px;
            width: auto;
            margin-top: 0;
        }

        button {
            background-color: var(--btn-primary);
            color: var(--btn-primary-text);
            border: 1px solid transparent;
            padding: 6.5px 11px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 11.5px;
            font-weight: 600;
            width: 100%;
            max-width: 100%;
            box-sizing: border-box;
            margin-top: 4px;
            transition: all 0.15s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            white-space: normal;
            word-break: break-word;
            text-align: center;
            box-shadow: 0 1px 2px rgba(0,0,0,0.08);
        }

        button:hover {
            background-color: var(--btn-primary-hover);
            transform: translateY(-1px);
            box-shadow: 0 2px 5px rgba(0,0,0,0.12);
        }

        button.secondary {
            background-color: var(--btn-sec);
            color: var(--btn-sec-text);
            border: 1px solid var(--border-color);
            box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }

        button.secondary:hover {
            background-color: var(--btn-sec-hover);
            border-color: var(--border-focus);
            box-shadow: 0 2px 4px rgba(0,0,0,0.08);
        }

        button.sm {
            padding: 3px 7px;
            font-size: 10.5px;
            width: auto;
            flex: initial;
            margin-top: 0;
        }

        kbd {
            background: rgba(128, 128, 128, 0.15);
            border: 1px solid var(--border-color);
            border-radius: 3px;
            padding: 1px 4px;
            font-size: 9.5px;
            font-family: monospace;
            color: var(--text-muted);
            font-weight: normal;
        }

        /* Chips / Tag Pills */
        .chips-row {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-bottom: 7px;
        }

        .chip {
            background: var(--bg-card-subtle);
            border: 1px solid var(--border-color);
            color: var(--text-secondary);
            border-radius: 12px;
            padding: 2.5px 8px;
            font-size: 10.5px;
            cursor: pointer;
            user-select: none;
            transition: all 0.15s ease;
            font-weight: 500;
        }

        .chip:hover {
            border-color: var(--border-focus);
            color: var(--text-main);
            background: var(--bg-card);
            transform: translateY(-0.5px);
        }

        .chip.active {
            background: var(--btn-primary);
            color: var(--btn-primary-text);
            border-color: var(--btn-primary);
            font-weight: 600;
        }

        /* Output Code Box */
        .code-box {
            background-color: var(--code-bg);
            color: var(--code-text);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 9px;
            font-family: 'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace;
            font-size: 11px;
            white-space: pre;
            max-height: 250px;
            overflow-x: auto;
            overflow-y: auto;
            margin-top: 7px;
            line-height: 1.5;
            word-break: normal;
            box-shadow: inset 0 1px 3px rgba(0,0,0,0.06);
        }

        /* Semantic Badges */
        .badge {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 3px;
            line-height: 1.3;
        }

        .badge-crit { background: var(--badge-crit-bg); color: var(--badge-crit-text); border: 1px solid var(--badge-crit-text); }
        .badge-warn { background: var(--badge-warn-bg); color: var(--badge-warn-text); border: 1px solid var(--badge-warn-text); }
        .badge-ok { background: var(--badge-ok-bg); color: var(--badge-ok-text); border: 1px solid var(--badge-ok-text); }
        .badge-context { background: var(--bg-card-subtle); color: var(--text-main); border: 1px solid var(--border-color); font-size: 9.5px; }

        /* BSP Item Card */
        .bsp-item {
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 8px 9px;
            margin-bottom: 6px;
            background: var(--bg-card);
            transition: all 0.15s ease;
        }

        .bsp-item:hover {
            border-color: var(--border-focus);
            box-shadow: 0 2px 6px rgba(0,0,0,0.06);
        }

        .bsp-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 5px;
        }

        .bsp-method-name {
            font-size: 11.5px;
            font-weight: 700;
            word-break: break-word;
            color: var(--text-main);
        }

        .bsp-module-tag {
            font-size: 10px;
            color: var(--text-muted);
            margin-top: 1px;
            font-family: monospace;
        }

        .bsp-desc {
            font-size: 11px;
            color: var(--text-secondary);
            margin-top: 4px;
            word-break: break-word;
            line-height: 1.4;
        }

        /* Toast notification */
        .toast {
            position: fixed;
            bottom: 14px;
            left: 50%;
            transform: translateX(-50%);
            background: #10B981;
            color: #FFFFFF;
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
            box-shadow: 0 4px 12px rgba(0,0,0,0.25);
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease, transform 0.2s ease;
            z-index: 9999;
        }

        .toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(-2px);
        }

        /* Issue list item */
        .issue-card {
            border-left: 3.5px solid;
            padding: 7px 9px;
            margin-bottom: 6px;
            background: var(--bg-card-subtle);
            border-radius: 0 5px 5px 0;
            font-size: 11px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.03);
        }

        .issue-card.error { border-color: #EF4444; }
        .issue-card.warning { border-color: #F59E0B; }
        .issue-card.info { border-color: #3B82F6; }

        .issue-link {
            font-weight: 600;
            cursor: pointer;
            text-decoration: underline;
        }

                .form-group {
            margin-bottom: 7px;
        }

        .form-label {
            display: block;
            font-size: 10.5px;
            font-weight: 600;
            color: var(--text-secondary);
            margin-bottom: 3px;
            letter-spacing: 0.1px;
        }

        .form-hint {
            font-size: 9.5px;
            color: var(--text-muted);
            margin-top: -3px;
            margin-bottom: 5px;
            line-height: 1.35;
        }

        .bsp-signature {
            background: rgba(128, 128, 128, 0.08);
            border-radius: 4px;
            padding: 4px 6px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 10px;
            color: var(--text-main);
            margin: 4px 0;
            white-space: pre-wrap;
            word-break: normal;
            overflow-wrap: break-word;
        }

        .bsp-example {
            background: var(--code-bg);
            border-radius: 4px;
            padding: 4px 6px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 10px;
            color: var(--code-text);
            margin-top: 5px;
            white-space: pre;
            overflow-x: auto;
            word-break: normal;
            border-left: 2px solid var(--border-focus);
        }

        .tab-panel {
            display: none;
            animation: fadeIn 0.15s ease-in-out;
        }

        .tab-panel.active {
            display: block;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(2px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* Quick Start Guide */
        .quick-start-box {
            margin: 0 0 10px 0;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 7px;
            overflow: hidden;
            box-shadow: var(--card-shadow);
            transition: all 0.2s ease;
        }

        .quick-start-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 9px;
            cursor: pointer;
            user-select: none;
            background: var(--bg-card-subtle);
            border-bottom: 1px solid var(--border-light);
            transition: background 0.15s ease;
        }

        .quick-start-header:hover {
            background: var(--bg-sub);
        }

        .quick-start-box.collapsed .quick-start-header {
            border-bottom: none;
        }

        .quick-start-title {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 11px;
            font-weight: 700;
            color: var(--text-main);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            min-width: 0;
            flex: 1;
        }

        .quick-start-actions {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
        }

        .quick-start-toggle {
            background: transparent;
            border: none;
            color: var(--text-muted);
            font-size: 9.5px;
            display: flex;
            align-items: center;
            gap: 2px;
            cursor: pointer;
            padding: 1px 3px;
            width: auto;
            margin: 0;
            font-weight: 500;
            white-space: nowrap;
            flex-shrink: 0;
        }

        .quick-start-toggle:hover {
            color: var(--btn-primary);
        }

        .quick-start-dismiss {
            background: transparent;
            border: 1px solid var(--border-light);
            border-radius: 4px;
            color: var(--text-muted);
            font-size: 9px;
            padding: 1px 5px;
            cursor: pointer;
            width: auto;
            margin: 0;
            transition: all 0.15s ease;
            white-space: nowrap;
            line-height: 1.2;
        }

        .quick-start-dismiss:hover {
            color: #EF4444;
            border-color: #EF4444;
            background: rgba(239, 68, 68, 0.08);
        }

        .quick-start-body {
            padding: 8px 9px;
            display: flex;
            flex-direction: column;
            gap: 7px;
        }

        .quick-start-box.collapsed .quick-start-body {
            display: none;
        }

        .qs-step {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            font-size: 11px;
            line-height: 1.4;
        }

        .qs-num {
            flex-shrink: 0;
            width: 17px;
            height: 17px;
            border-radius: 50%;
            background: var(--btn-primary);
            color: var(--btn-primary-text);
            font-size: 10px;
            font-weight: 800;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-top: 1px;
            font-family: 'JetBrains Mono', monospace;
        }

        .qs-text {
            flex: 1;
            color: var(--text-secondary);
        }

        .qs-text strong {
            color: var(--text-main);
        }

        .qs-link {
            color: var(--btn-primary);
            text-decoration: underline;
            font-weight: 600;
            cursor: pointer;
        }

        /* Hotkeys Footer */
        .hotkeys-footer {
            margin-top: 12px;
            padding: 6px 8px;
            background: var(--bg-card-subtle);
            border: 1px solid var(--border-light);
            border-radius: 6px;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 7px;
            font-size: 10px;
            color: var(--text-muted);
        }

        .hotkeys-footer-title {
            font-weight: 600;
            color: var(--text-secondary);
            font-size: 10px;
        }

        .hotkey-item {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
        }

        .hotkey-item kbd {
            background: var(--bg-card);
            color: var(--text-main);
            border-color: var(--border-color);
            font-weight: 600;
        }

        /* Promo Badge Box in Settings */
        .promo-badge-box {
            margin-top: 9px;
            padding: 8px 10px;
            border-radius: 6px;
            background: var(--bg-card-subtle);
            border: 1px dashed var(--border-color);
            font-size: 11px;
        }

        .promo-header {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
        }

        .promo-gift-icon {
            font-size: 12px;
        }

        .promo-label {
            color: var(--text-secondary);
            font-size: 11px;
            font-weight: 500;
        }

        .promo-code {
            font-family: 'JetBrains Mono', monospace;
            font-weight: 700;
            color: var(--btn-primary);
            background: rgba(128, 128, 128, 0.12);
            padding: 1px 6px;
            border-radius: 4px;
            cursor: pointer;
            border: 1px solid var(--border-color);
            user-select: all;
            font-size: 11px;
        }

        .promo-copy-btn {
            padding: 2px 7px;
            font-size: 9.5px;
            border-radius: 4px;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            color: var(--text-secondary);
            cursor: pointer;
            line-height: 1.3;
            width: auto;
            margin: 0;
            font-weight: 500;
        }

        .promo-copy-btn:hover {
            color: var(--btn-primary);
            border-color: var(--border-focus);
        }

        .promo-hint {
            margin-top: 4px;
            font-size: 10px;
            color: var(--text-muted);
            line-height: 1.4;
        }

        .promo-link {
            color: var(--btn-primary);
            text-decoration: underline;
            text-underline-offset: 2px;
        }

        /* Welcome First-Launch Modal */
        .modal-backdrop {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(14, 12, 10, 0.78);
            backdrop-filter: blur(5px);
            -webkit-backdrop-filter: blur(5px);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 12px;
            animation: modalFadeIn 0.2s ease-out;
        }

        body.theme-warm-sand .modal-backdrop {
            background: rgba(44, 38, 33, 0.65);
        }

        @keyframes modalFadeIn {
            from { opacity: 0; transform: scale(0.97); }
            to { opacity: 1; transform: scale(1); }
        }

        .modal-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
            max-width: 440px;
            width: 100%;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            border-bottom: 1px solid var(--border-light);
            background: var(--bg-card-subtle);
        }

        .modal-brand {
            display: flex;
            align-items: center;
            gap: 7px;
        }

        .modal-title {
            font-size: 13px;
            font-weight: 700;
            color: var(--text-main);
        }

        .modal-close-btn {
            background: transparent;
            border: none;
            color: var(--text-muted);
            font-size: 16px;
            cursor: pointer;
            padding: 2px 6px;
            line-height: 1;
            width: auto;
            margin: 0;
        }

        .modal-close-btn:hover {
            color: var(--text-main);
        }

        .modal-body {
            padding: 12px 14px;
            font-size: 11px;
            line-height: 1.45;
            color: var(--text-main);
        }

        .modal-lead {
            margin: 0 0 10px 0;
            color: var(--text-secondary);
            font-size: 11.5px;
        }

        .modal-features {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .modal-feature-item {
            display: flex;
            gap: 9px;
            background: var(--bg-card-subtle);
            border: 1px solid var(--border-light);
            border-radius: 7px;
            padding: 8px 10px;
        }

        .modal-feature-icon {
            font-size: 16px;
            flex-shrink: 0;
            line-height: 1.2;
        }

        .modal-feature-title {
            font-size: 11.5px;
            font-weight: 700;
            color: var(--text-main);
            margin-bottom: 2px;
        }

        .modal-feature-desc {
            font-size: 10.5px;
            color: var(--text-secondary);
            line-height: 1.35;
        }

        .modal-footer {
            padding: 10px 14px;
            border-top: 1px solid var(--border-light);
            background: var(--bg-card-subtle);
            display: flex;
            justify-content: flex-end;
        }

        .modal-btn-primary {
            padding: 7px 16px;
            background: var(--btn-primary);
            color: var(--btn-primary-text);
            border: none;
            border-radius: 6px;
            font-size: 11.5px;
            font-weight: 700;
            cursor: pointer;
            width: auto;
            margin: 0;
            transition: background 0.15s ease;
        }

        .modal-btn-primary:hover {
            background: var(--btn-primary-hover);
        }

        /* AI Overview Dashboard */
        .ai-hero-card {
            background: linear-gradient(135deg, var(--bg-card) 0%, var(--bg-card-subtle) 100%);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 10px 12px;
            margin-bottom: 9px;
        }

        .ai-hero-title {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12.5px;
            font-weight: 700;
            color: var(--text-main);
            margin-bottom: 3px;
        }

        .ai-hero-subtitle {
            font-size: 10.5px;
            color: var(--text-secondary);
            line-height: 1.35;
        }

        .overview-action-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 9px 11px;
            margin-bottom: 8px;
            box-shadow: var(--card-shadow);
            transition: border-color 0.16s ease, transform 0.16s ease;
        }

        .overview-action-card:hover {
            border-color: var(--border-focus);
        }

        .action-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
            margin-bottom: 4px;
        }

        .action-card-title {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 12px;
            font-weight: 700;
            color: var(--text-main);
        }

        .action-card-desc {
            font-size: 10.5px;
            color: var(--text-secondary);
            line-height: 1.35;
            margin-bottom: 7px;
        }

        .action-card-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
            flex-wrap: wrap;
        }

        .kbd-guide {
            font-size: 10.5px;
            color: var(--text-muted);
        }

        .action-btn-primary {
            padding: 4px 10px;
            font-size: 10.5px;
            font-weight: 600;
            background: var(--btn-primary);
            color: var(--btn-primary-text);
            border: none;
            border-radius: 5px;
            cursor: pointer;
            width: auto;
            margin: 0;
            transition: background 0.15s ease;
        }

        .action-btn-primary:hover {
            background: var(--btn-primary-hover);
        }

        .action-btn-secondary {
            padding: 4px 9px;
            font-size: 10.5px;
            font-weight: 500;
            background: var(--bg-card-subtle);
            color: var(--text-main);
            border: 1px solid var(--border-color);
            border-radius: 5px;
            cursor: pointer;
            width: auto;
            margin: 0;
            transition: all 0.15s ease;
        }

        .action-btn-secondary:hover {
            border-color: var(--border-focus);
            background: var(--bg-sub);
        }

        .action-btn-sm {
            padding: 2px 7px;
            font-size: 10px;
            width: auto;
            margin: 0;
        }

        /* Action Pilot (Cockpit) Styles */
        .pilot-context-bar {
            display: flex;
            align-items: center;
            gap: 7px;
            background: var(--bg-card-subtle);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 5px 8px;
            margin-bottom: 8px;
            font-size: 10.5px;
            line-height: 1.3;
        }

        .pilot-context-dot {
            font-size: 9px;
            line-height: 1;
            flex-shrink: 0;
        }

        .pilot-context-info {
            display: flex;
            flex-direction: column;
            overflow: hidden;
            min-width: 0;
            flex: 1;
        }

        .pilot-context-file {
            font-weight: 700;
            color: var(--text-main);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .pilot-context-sel {
            font-size: 9.5px;
            color: var(--text-muted);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* 3 Killer Action Cards */
        .killer-actions-grid {
            display: flex;
            flex-direction: column;
            gap: 7px;
            margin-bottom: 9px;
        }

        .killer-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 8px 10px;
            cursor: pointer;
            transition: all 0.16s ease;
            box-shadow: var(--card-shadow);
            position: relative;
        }

        .killer-card:hover {
            border-color: var(--border-focus);
            transform: translateY(-1px);
            box-shadow: 0 3px 8px rgba(0,0,0,0.12);
        }

        .killer-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 3px;
        }

        .killer-card-badge {
            font-size: 9px;
            font-weight: 700;
            padding: 1.5px 5px;
            border-radius: 4px;
            background: rgba(230, 162, 60, 0.15);
            color: var(--btn-primary);
            border: 1px solid rgba(230, 162, 60, 0.3);
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .killer-card-title {
            font-size: 11.5px;
            font-weight: 700;
            color: var(--text-main);
            margin-bottom: 2px;
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .killer-card-desc {
            font-size: 10px;
            color: var(--text-secondary);
            line-height: 1.35;
            margin-bottom: 6px;
        }

        .killer-card-action {
            display: flex;
            align-items: center;
            justify-content: flex-end;
        }

        .killer-card-btn {
            background: var(--btn-primary);
            color: var(--btn-primary-text);
            border: none;
            border-radius: 5px;
            padding: 3.5px 9px;
            font-size: 10.5px;
            font-weight: 600;
            cursor: pointer;
            width: auto;
            margin: 0;
            transition: background 0.15s ease;
        }

        .killer-card-btn:hover {
            background: var(--btn-primary-hover);
        }

        /* Pilot Custom Prompt Box */
        .pilot-prompt-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 8px 10px;
            margin-bottom: 9px;
            box-shadow: var(--card-shadow);
        }

        .pilot-prompt-title {
            font-size: 10.5px;
            font-weight: 600;
            color: var(--text-secondary);
            margin-bottom: 5px;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .pilot-prompt-row {
            display: flex;
            gap: 5px;
            align-items: stretch;
        }

        .pilot-prompt-row textarea {
            flex: 1;
            min-height: 48px;
            height: 48px;
            margin-bottom: 0;
            font-size: 11px;
            padding: 5px 8px;
            resize: vertical;
        }

        .pilot-send-btn {
            width: 44px;
            flex-shrink: 0;
            margin: 0;
            background: var(--btn-primary);
            color: var(--btn-primary-text);
            border: none;
            border-radius: 5px;
            font-size: 15px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s ease;
        }

        .pilot-send-btn:hover {
            background: var(--btn-primary-hover);
        }

        .pilot-prompt-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 5px;
            font-size: 9.5px;
            color: var(--text-muted);
        }

        .pilot-model-select {
            background: var(--bg-card-subtle);
            border: 1px solid var(--border-color);
            color: var(--text-secondary);
            border-radius: 4px;
            font-size: 9.5px;
            padding: 2px 4px;
            width: auto;
            margin: 0;
        }

        /* Unified Live Output Studio */
        .output-studio {
            background: var(--bg-card);
            border: 1.5px solid var(--border-focus);
            border-radius: 8px;
            padding: 9px 10px;
            margin-bottom: 9px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: fadeIn 0.2s ease-out;
        }

        .studio-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 7px;
            gap: 6px;
        }

        .studio-badge {
            font-size: 10px;
            font-weight: 700;
            color: var(--badge-ok-text);
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .studio-meta {
            font-size: 9.5px;
            color: var(--text-muted);
            font-family: 'JetBrains Mono', monospace;
        }

        .studio-actions-bar {
            display: flex;
            gap: 5px;
            margin-bottom: 7px;
        }

        .studio-btn-primary {
            flex: 2;
            background: #047857;
            color: #FFFFFF;
            border: none;
            border-radius: 5px;
            padding: 6px 10px;
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            transition: background 0.15s ease;
        }

        .studio-btn-primary:hover {
            background: #065F46;
        }

        .studio-btn-secondary {
            flex: 1;
            background: var(--btn-sec);
            color: var(--btn-sec-text);
            border: 1px solid var(--border-color);
            border-radius: 5px;
            padding: 6px 8px;
            font-size: 10.5px;
            font-weight: 600;
            cursor: pointer;
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
        }

        .studio-btn-secondary:hover {
            border-color: var(--border-focus);
        }

        .studio-btn-ghost {
            background: transparent;
            color: var(--text-muted);
            border: 1px solid var(--border-light);
            border-radius: 5px;
            padding: 4px 8px;
            font-size: 11px;
            cursor: pointer;
            margin: 0;
            width: auto;
        }

        .studio-btn-ghost:hover {
            color: var(--text-main);
            border-color: var(--border-color);
        }

        .studio-code-details {
            margin-top: 5px;
        }

        .studio-code-details summary {
            font-size: 10px;
            color: var(--text-muted);
            cursor: pointer;
            margin-bottom: 4px;
            user-select: none;
        }

        .studio-code-pre {
            background: var(--code-bg);
            color: var(--code-text);
            border: 1px solid var(--border-color);
            border-radius: 5px;
            padding: 8px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 10.5px;
            line-height: 1.45;
            white-space: pre;
            overflow-x: auto;
            max-height: 220px;
            margin: 0;
        }

        /* Responsive Breakpoints for narrow sidebars */
        @media (max-width: 250px) {
            .header-badges .meta-pill {
                display: none;
            }
            .theme-label-text {
                display: none;
            }
            .header-badges {
                flex-shrink: 1;
            }
            .top-navbar {
                min-width: 0;
            }
            .brand-block {
                min-width: 0;
                flex-shrink: 1;
            }
            .brand-title {
                font-size: 11px;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .seg-label {
                font-size: 10px;
            }
            .seg-btn {
                padding: 4px 3px;
                gap: 3px;
            }
            .hotkeys-footer {
                align-items: flex-start;
            }
            .hotkey-item {
                white-space: normal;
                flex-wrap: wrap;
                min-width: 0;
            }
            .hotkey-item kbd {
                white-space: normal;
                overflow-wrap: anywhere;
            }
        }
${workspaceStyles}
    </style>
</head>
<body class="theme-espresso">
    <!-- Модальное окно первого запуска (Welcome Modal) -->
    <div id="welcomeModal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="welcomeTitle" style="display:none;">
        <div class="modal-card">
            <div class="modal-header">
                <div class="modal-brand">
                    <div class="brand-badge">1C</div>
            <div class="modal-title" id="welcomeTitle"><span data-i18n="Добро пожаловать в помощник NormaHub для 1С">Добро пожаловать в помощник NormaHub для 1С</span></div>
                </div>
                <button class="modal-close-btn" onclick="closeWelcomeModal()" type="button" title="Закрыть" data-i18n-title="Закрыть">✕</button>
            </div>
            <div class="modal-body">
                <div class="modal-lead"><span data-i18n="Инженерная среда для ускорения разработки на платформе «1С:Предприятие 8.3» и проверки стандартов ИТС.">
                    Инженерная среда для ускорения разработки на платформе «1С:Предприятие 8.3» и проверки стандартов ИТС.
                </span></div>
                <div class="modal-features">
                    <div class="modal-feature-item">
                        <div class="modal-feature-icon">⌨️</div>
                        <div class="modal-feature-content">
                            <div class="modal-feature-title"><span data-i18n="1. Автодополнение по Tab">1. Автодополнение по Tab</span></div>
                            <div class="modal-feature-desc"><span data-i18n="Пишите код в любых">Пишите код в любых </span><code>.bsl</code><span data-i18n="файлах — подсказки FIM появляются на лету с учетом метаданных и контекста смежных открытых модулей."> файлах — подсказки FIM появляются на лету с учетом метаданных и контекста смежных открытых модулей.</span></div>
                        </div>
                    </div>
                    <div class="modal-feature-item">
                        <div class="modal-feature-icon">⚡</div>
                        <div class="modal-feature-content">
                            <div class="modal-feature-title"><span data-i18n="2. ИИ и инструменты 1С">2. ИИ и инструменты 1С</span></div>
                            <div class="modal-feature-desc"><span data-i18n="ИИ формирует запросы по описанию. Оптимизация запросов, шаблоны расширений, BDD, аудит ИТС, БСП и разбор Техжурнала работают локально.">ИИ формирует запросы по описанию. Оптимизация запросов, шаблоны расширений, BDD, аудит ИТС, БСП и разбор Техжурнала работают локально.</span></div>
                        </div>
                    </div>
                    <div class="modal-feature-item">
                        <div class="modal-feature-icon">🎁</div>
                        <div class="modal-feature-content">
                            <div class="modal-feature-title"><span data-i18n="3. Быстрый шлюз NormaHub без VPN">3. Быстрый шлюз NormaHub без VPN</span></div>
                            <div class="modal-feature-desc"><span data-i18n="Для функций ИИ требуется API-ключ NormaHub. Доступность моделей и расходы проверяются в личном кабинете.">Для функций ИИ требуется API-ключ NormaHub. Доступность моделей и расходы проверяются в личном кабинете.</span></div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="modal-btn-primary" onclick="closeWelcomeModal()" type="button"><span data-i18n="Понятно, начать работу">Понятно, начать работу</span></button>
            </div>
        </div>
    </div>

    <!-- Верхняя компактная шапка с брендом и встроенными мета-бейджами -->
    <div class="top-navbar">
        <div class="brand-block">
            <div class="brand-badge">1C</div>
            <div class="brand-lockup">
                <div class="brand-title"><span data-i18n="NormaHub · Помощник 1С">NormaHub · Помощник 1С</span></div>
                <div class="brand-subtitle"><span data-i18n="Инструменты разработчика">Инструменты разработчика</span></div>
            </div>
        </div>
        <div class="header-badges">
            <label class="sr-only" for="uiLanguageSelector"><span data-i18n="Язык панели">Язык панели</span></label>
            <select id="uiLanguageSelector" class="pilot-model-select" aria-label="Язык панели" title="Язык интерфейса" onchange="changeUiLanguage(this.value)" data-i18n-aria-label="Язык панели" data-i18n-title="Язык интерфейса">
                <option value="ru">RU</option>
                <option value="en">EN</option>
            </select>
            <div class="meta-pill" title="Контекст метаданных используется при генерации, если найден в рабочей области" data-i18n-title="Контекст метаданных используется при генерации, если найден в рабочей области">
                <span id="metadataStatusDot" class="status-dot ${metadataStatus}"></span>
                <span id="metadataHeaderLabel" class="pill-text">${metadataLabel}</span>
            </div>
            <div class="meta-pill" title="Смежные открытые BSL-модули в рабочей области" data-i18n-title="Смежные открытые BSL-модули в рабочей области">
                <span class="status-dot ${openTabsCount > 0 ? 'online' : 'idle'}"></span>
                <span class="pill-num">${openTabsCount}</span>
                <span class="pill-text"><span data-i18n="вкл.">вкл.</span></span>
            </div>
            <button class="theme-toggle-btn" onclick="toggleTheme()" id="themeBtn" title="Переключить цветовую тему" aria-label="Включить светлую тему" data-i18n-title="Переключить цветовую тему" data-i18n-aria-label="Включить светлую тему">
                <span class="theme-icon">◐</span>
                <span id="themeLabel" class="theme-label-text"><span data-i18n="Светлая">Светлая</span></span>
            </button>
        </div>
    </div>

    <section class="workspace-hero" id="workspaceHero" aria-labelledby="workspaceTitle">
        <div class="workspace-hero-topline">
            <span class="workspace-eyebrow"><span data-i18n="РАБОЧАЯ ОБЛАСТЬ">РАБОЧАЯ ОБЛАСТЬ</span></span>
        </div>
        <h1 id="workspaceTitle" tabindex="-1"><span data-i18n="От задачи к коду.">От задачи к коду.</span></h1>
        <p><span data-i18n="Опишите запрос или выберите инструмент для вашего модуля.">Опишите запрос или выберите инструмент для вашего модуля.</span></p>
    </section>

    <!-- Блок быстрого старта (сворачиваемый и скрываемый навсегда) -->
    <div id="quickStartBox" class="quick-start-box collapsed">
        <div class="quick-start-header">
            <div class="quick-start-title" onclick="toggleQuickStart()">
                <span class="quick-start-icon">💡</span>
                <span><span data-i18n="Быстрый старт за 3 шага">Быстрый старт за 3 шага</span></span>
            </div>
            <div class="quick-start-actions">
                <button class="quick-start-toggle" id="quickStartToggleBtn" type="button" onclick="toggleQuickStart()" title="Свернуть или развернуть памятку" data-i18n-title="Свернуть или развернуть памятку">
                    <span id="quickStartToggleArrow">▼</span>
                </button>
                <button class="quick-start-dismiss" type="button" onclick="dismissQuickStartForever(event)" title="Скрыть навсегда" data-i18n-title="Скрыть навсегда"><span data-i18n="✕ Скрыть">
                    ✕ Скрыть
                </span></button>
            </div>
        </div>
        <div id="quickStartBody" class="quick-start-body">
            <div class="qs-step">
                <div class="qs-num">1</div>
                <div class="qs-text">
                    <strong><span data-i18n="Подключение:">Подключение:</span></strong><span data-i18n="Откройте"> Откройте </span><span class="qs-link" onclick="selectSubTool('settings')"><span data-i18n="настройки">настройки</span></span><span data-i18n="и сохраните API-ключ NormaHub для генерации запросов."> и сохраните API-ключ NormaHub для генерации запросов.
                </span></div>
            </div>
            <div class="qs-step">
                <div class="qs-num">2</div>
                <div class="qs-text">
                    <strong><span data-i18n="Автодополнение:">Автодополнение:</span></strong><span data-i18n="Пишите код в любом"> Пишите код в любом </span><code>.bsl</code><span data-i18n="файле в редакторе — умные подсказки появляются автоматически, принимайте по нажатию"> файле в редакторе — умные подсказки появляются автоматически, принимайте по нажатию </span><kbd>Tab</kbd>.
                </div>
            </div>
            <div class="qs-step">
                <div class="qs-num">3</div>
                <div class="qs-text">
                    <strong><span data-i18n="Инструменты:">Инструменты:</span></strong><span data-i18n="Выберите задачу в каталоге. БСП, шаблоны, аудит ИТС и разбор Техжурнала доступны без подключения ИИ."> Выберите задачу в каталоге. БСП, шаблоны, аудит ИТС и разбор Техжурнала доступны без подключения ИИ.
                </span></div>
            </div>
        </div>
    </div>

    <!-- Высокоуровневая сегментированная навигация: AI vs Инструменты 1С -->
    <nav class="category-segmented" aria-label="Основные разделы" data-i18n-aria-label="Основные разделы">
        <button id="cat-btn-ai" class="seg-btn active" type="button" onclick="selectCategory('ai')">
            <span class="seg-icon">⚡</span>
            <span class="seg-label"><span data-i18n="ИИ-помощник">ИИ-помощник</span></span>
        </button>
        <button id="cat-btn-tools" class="seg-btn" type="button" onclick="selectSubTool('tools')">
            <span class="seg-icon">🛠️</span>
            <span class="seg-label"><span data-i18n="Инструменты 1С">Инструменты 1С</span></span>
        </button>
        <button id="cat-btn-settings" class="seg-btn" type="button" onclick="selectSubTool('settings')"><span class="seg-label"><span data-i18n="Подключение">Подключение</span></span></button>
    </nav>
    <button class="secondary" id="cancelAiTask" type="button" onclick="vscode.postMessage({type:'cancelTask'})" style="display:none;"><span data-i18n="Отменить AI-задачу">Отменить AI-задачу</span></button>

    <div class="section-label" id="toolBreadcrumb"><span id="sectionLabel"><span data-i18n="Инструмент">Инструмент</span></span><span class="section-label-line"></span><button class="breadcrumb-back" type="button" onclick="selectSubTool('tools')"><span data-i18n="Каталог задач">Каталог задач</span></button></div>

    <!-- Выпадающий селектор конкретного инструмента -->
    <div class="tool-dropdown-wrapper" hidden>
        <label class="sr-only" for="toolSelector"><span data-i18n="Раздел помощника">Раздел помощника</span></label>
        <select id="toolSelector" class="tool-select" aria-hidden="true" tabindex="-1" onchange="selectSubTool(this.value)">
            <option value="ai-overview" data-i18n="Action Pilot · рабочая область">Action Pilot · рабочая область</option>
            <option value="queries-gen" data-i18n="✨ Генерация пакета запроса">✨ Генерация пакета запроса</option>
            <option value="queries-refactor" data-i18n="⚡ Подготовка пакета запроса">⚡ Подготовка пакета запроса</option>
            <option value="queries-batch" data-i18n="📋 Шаблон контроля дефицита">📋 Шаблон контроля дефицита</option>
            <option value="bdd" data-i18n="🧪 Сценарии тестов Vanessa BDD">🧪 Сценарии тестов Vanessa BDD</option>
            <option value="settings" data-i18n="⚙️ Шлюз NormaHub и статус">⚙️ Шлюз NormaHub и статус</option>
        </select>
        <select id="tabNavSelector" style="display:none;" onchange="switchTab(this.value)">
            <option value="queries" data-i18n="⚡ Запросы и проведение">⚡ Запросы и проведение</option>
            <option value="bsp" data-i18n="📦 База знаний БСП 3.1">📦 База знаний БСП 3.1</option>
            <option value="extensions" data-i18n="🧩 Расширения (&amp;cfe)">🧩 Расширения (&amp;cfe)</option>
            <option value="audit" data-i18n="🛡️ ИТС Аудит качества">🛡️ ИТС Аудит качества</option>
            <option value="bdd" data-i18n="🧪 Тесты Vanessa BDD">🧪 Тесты Vanessa BDD</option>
            <option value="techlog" data-i18n="📊 Техжурнал (ТЖ)">📊 Техжурнал (ТЖ)</option>
            <option value="metadata" data-i18n="🗂️ Граф метаданных">🗂️ Граф метаданных</option>
            <option value="sidecar" data-i18n="🔌 Sidecar и Конфигуратор">🔌 Sidecar и Конфигуратор</option>
            <option value="settings" data-i18n="⚙️ Настройки и баланс">⚙️ Настройки и баланс</option>
        </select>
    </div>

    <!-- Резервный контейнер для обратной совместимости -->
    <div id="tab-queries" style="display:none;"></div>

    <!-- AI ACTION PILOT: Главный командный пульт 1C Copilot Studio -->
    <div id="tab-ai-overview" class="tab-panel active">
        <!-- 1. Контекст редактора -->
        <div class="pilot-context-bar context-empty" id="editorContextBanner" data-context-state="empty">
            <span class="pilot-context-dot" id="pilotContextDot">●</span>
            <div class="pilot-context-info">
                <span class="pilot-context-file" id="pilotContextFile"><span data-i18n="BSL-модуль не выбран">BSL-модуль не выбран</span></span>
                <span class="pilot-context-sel" id="pilotContextSel"><span data-i18n="Откройте .bsl или .os, чтобы использовать контекст редактора">Откройте .bsl или .os, чтобы использовать контекст редактора</span></span>
            </div>
            <button class="action-btn-sm" type="button" onclick="refreshEditorContext()" title="Обновить контекст редактора" aria-label="Обновить контекст редактора" style="background:transparent; border:none; cursor:pointer;" data-i18n-title="Обновить контекст редактора" data-i18n-aria-label="Обновить контекст редактора"><span data-i18n="Обновить">Обновить</span></button>
        </div>

        <!-- 2. Студия вывода результата (появляется при любом действии) -->
        <div id="cockpitOutputStudio" class="output-studio" style="display:none;">
            <div class="studio-header">
                <div class="studio-badge" id="cockpitBadge"><span data-i18n="✓ Предпросмотр результата">✓ Предпросмотр результата</span></div>
                <div class="studio-meta" id="cockpitMeta"><span data-i18n="18 строк BSL">18 строк BSL</span></div>
            </div>
            <div class="studio-target" id="cockpitTarget"><span data-i18n="Выберите, куда применить результат.">Выберите, куда применить результат.</span></div>
            <div class="studio-actions-bar">
                <button class="studio-btn-primary context-required-action" type="button" onclick="insertCockpitCode()" disabled>
                    <span><span data-i18n="↵ Вставить в активный файл">↵ Вставить в активный файл</span></span>
                </button>
                <button class="studio-btn-secondary" type="button" onclick="copyCockpitCode()">
                <span><span data-i18n="Копировать">Копировать</span></span>
                </button>
                <button class="studio-btn-secondary" onclick="vscode.postMessage({type:'openResult',previewId:currentCockpitPreview.previewId})"><span data-i18n="Открыть отдельно">Открыть отдельно</span></button>
                <button id="reviewPreview" class="studio-btn-secondary" type="button" onclick="reviewCockpitCode()" hidden><span data-i18n="Сравнить изменения">Сравнить изменения</span></button>
                <span id="queryValidationSlot" hidden><button id="queryValidation" class="studio-btn-secondary" type="button" onclick="openQueryValidation()"><span data-i18n="Проверить результат">Проверить результат</span></button></span>
                <button class="studio-btn-ghost" type="button" onclick="clearCockpitOutput()" title="Закрыть" data-i18n-title="Закрыть">✕</button>
            </div>
            <details open class="studio-code-details">
                <summary><span data-i18n="Предпросмотр BSL-кода">Предпросмотр BSL-кода</span></summary>
                <pre class="studio-code-pre"><code id="cockpitCodePre"></code></pre>
            </details>
        </div>

        <!-- 3. Три Главных действия (Killer Actions) -->
        <div class="killer-actions-grid">
            <!-- Действие 1: Подготовить пакет -->
            <div class="killer-card">
                <div class="killer-card-header">
                    <div class="killer-card-title"><span aria-hidden="true">SQL</span> <span><span data-i18n="Подготовить пакет запроса">Подготовить пакет запроса</span></span></div>
                    <span class="killer-card-badge"><span data-i18n="Высокая нагрузка">Высокая нагрузка</span></span>
                </div>
                <div class="killer-card-desc"><span data-i18n="Вынесите виртуальную таблицу в пакет и сравните результат.">Вынесите виртуальную таблицу в пакет и сравните результат.</span></div>
                <div class="killer-card-action">
                    <button class="killer-card-btn" type="button" onclick="runCockpitAction('optimize-query')"><span data-i18n="Подготовить пакет">Подготовить пакет</span></button>
                </div>
            </div>

            <!-- Действие 2: Обернуть в расширение (&cfe) -->
            <div class="killer-card">
                <div class="killer-card-header">
                    <div class="killer-card-title"><span aria-hidden="true">&</span> <span><span data-i18n="Обернуть метод в расширение">Обернуть метод в расширение</span></span></div>
                    <span class="killer-card-badge"><span data-i18n="BSL-шаблон">BSL-шаблон</span></span>
                </div>
                <div class="killer-card-desc"><span data-i18n="Настройте директиву, метод и параметры перехвата.">Настройте директиву, метод и параметры перехвата.</span></div>
                <div class="killer-card-action">
                    <button class="killer-card-btn" type="button" onclick="runCockpitAction('create-extension')"><span data-i18n="Сформировать перехват">Сформировать перехват</span></button>
                </div>
            </div>

            <!-- Действие 3: Модуль проведения с контролем остатков -->
            <div class="killer-card">
                <div class="killer-card-header">
                    <div class="killer-card-title"><span aria-hidden="true">BSL</span> <span><span data-i18n="Запрос контроля дефицита">Запрос контроля дефицита</span></span></div>
                    <span class="killer-card-badge"><span data-i18n="Стандарт ИТС">Стандарт ИТС</span></span>
                </div>
                <div class="killer-card-desc"><span data-i18n="Задайте документ, измерения и ресурс для шаблона проверки дефицита.">Задайте документ, измерения и ресурс для шаблона проверки дефицита.</span></div>
                <div class="killer-card-action">
                    <button class="killer-card-btn" type="button" onclick="runCockpitAction('generate-posting')"><span data-i18n="Подготовить запрос">Подготовить запрос</span></button>
                </div>
            </div>
        </div>

        <!-- 4. Свободный AI Промпт-бар -->
        <div class="pilot-prompt-card">
        <div class="pilot-prompt-title"><span aria-hidden="true">AI</span> <span><span data-i18n="Сформировать пакет запроса 1С">Сформировать пакет запроса 1С</span></span></div>
        <div class="pilot-prompt-row">
            <textarea id="cockpitPromptInput" aria-label="Описание задачи для генерации запроса 1С" placeholder="Например: остатки товаров на дату документа по складам и организации" data-i18n-aria-label="Описание задачи для генерации запроса 1С" data-i18n-placeholder="Например: остатки товаров на дату документа по складам и организации"></textarea>
                <button id="btnSendCockpitPrompt" class="pilot-send-btn" type="button" onclick="runCockpitPrompt()" title="Сгенерировать (Ctrl+Enter)" data-i18n-title="Сгенерировать (Ctrl+Enter)">
                    <span><span data-i18n="Сформировать запрос">Сформировать запрос</span></span><span aria-hidden="true">↗</span>
                </button>
            </div>
            <div class="pilot-prompt-footer">
                <div class="pilot-model-wrapper">
                    <span><span data-i18n="Модель:">Модель:</span></span>
        <select id="cockpitModelSelect" class="pilot-model-select" onchange="syncModelSelection(this.value)">
            <option value="deepseek-v4.1-flash-1017" ${selectedModel === 'deepseek-v4.1-flash-1017' ? 'selected' : ''} data-i18n="DeepSeek v4.1 Flash 1017 (быстро)">DeepSeek v4.1 Flash 1017 (быстро)</option>
            <option value="gpt-6.1-sol" ${selectedModel === 'gpt-6.1-sol' ? 'selected' : ''}>GPT-6.1 Sol</option>
            <option value="gpt-6-sol" ${selectedModel === 'gpt-6-sol' ? 'selected' : ''}>GPT-6 Sol</option>
                    </select>
                </div>
                <span><kbd>Ctrl+Enter</kbd></span>
            </div>
        <div id="cockpitPromptStatus" class="pilot-prompt-status" role="status" aria-live="polite"></div>
        </div>

    </div>

    <section id="tab-tools" class="tab-panel" aria-labelledby="toolsTitle">
        <div class="catalog-heading"><span class="workspace-eyebrow"><span data-i18n="ИНСТРУМЕНТЫ 1С">ИНСТРУМЕНТЫ 1С</span></span><h1 id="toolsTitle"><span data-i18n="Что нужно сделать?">Что нужно сделать?</span></h1><p><span data-i18n="Генерация, проверка и диагностика — в одном месте.">Генерация, проверка и диагностика — в одном месте.</span></p></div>
        <label class="sr-only" for="toolSearch"><span data-i18n="Найти инструмент по задаче">Найти инструмент по задаче</span></label>
        <input id="toolSearch" type="search" placeholder="Найти инструмент…" oninput="renderToolCatalog()"  data-i18n-placeholder="Найти инструмент…"/>
        <div id="toolCatalog"></div>
    </section>

    <!-- ТАБ: ОПТИМИЗАЦИЯ ЗАПРОСА (ИТС) -->
    <div id="tab-queries-refactor" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title"><span data-i18n="Подготовка пакета запроса">Подготовка пакета запроса</span></div>
                <span class="badge badge-ok"><span data-i18n="Локальное преобразование">Локальное преобразование</span></span>
            </div>
            <div class="card-desc"><span data-i18n="Подготавливает пакет из одного SELECT с одним виртуальным JOIN. Сохраняет имена полей и NULL. Результат откройте отдельно: вызывающий код нужно адаптировать к пакету.">Подготавливает пакет из одного SELECT с одним виртуальным JOIN. Сохраняет имена полей и NULL. Результат откройте отдельно: вызывающий код нужно адаптировать к пакету.</span></div>
            <div class="form-group">
                <label class="form-label" for="refactorInput"><span data-i18n="Текст исходного запроса 1С:">Текст исходного запроса 1С:</span></label>
                <textarea id="refactorInput" placeholder="Вставьте один SELECT с соединением виртуальной таблицы..." data-i18n-placeholder="Вставьте один SELECT с соединением виртуальной таблицы..."></textarea>
            </div>
            <button onclick="refactorQuery()"><span data-i18n="Подготовить пакет">Подготовить пакет </span><kbd>Ctrl+Enter</kbd></button>
            <div id="refactorStatus" style="font-size:11px; color:var(--text-muted); margin-top:4px;"></div>
            <div id="refactorOutput" class="code-box" style="display:none;"></div>
            <div class="btn-group" id="refactorActions" style="display:none;">
                <button class="secondary" onclick="openResultFrom('refactorOutput')"><span data-i18n="Открыть отдельно">Открыть отдельно</span></button>
                <button class="secondary" onclick="insertCodeFrom('refactorOutput')"><span data-i18n="Вставить в модуль">Вставить в модуль</span></button>
                <button class="secondary" onclick="copyCodeFrom('refactorOutput')"><span data-i18n="Копировать">Копировать</span></button>
            </div>
        </div>
    </div>

    <!-- ТАБ: КОНСТРУКТОР ДВИЖЕНИЙ ПРОВЕДЕНИЯ -->
    <div id="tab-queries-batch" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title"><span data-i18n="Шаблон контроля дефицита">Шаблон контроля дефицита</span></div>
                <span class="badge badge-ok"><span data-i18n="BSL-шаблон">BSL-шаблон</span></span>
            </div>
            <div class="card-desc"><span data-i18n="Формирует пакет запроса для поиска дефицита. Укажите все измерения и один числовой ресурс. Блокировки и движения реализуются в логике документа.">Формирует пакет запроса для поиска дефицита. Укажите все измерения и один числовой ресурс. Блокировки и движения реализуются в логике документа.</span></div>
            
            <div class="form-group">
                <label class="form-label" for="batchEntity"><span data-i18n="Документ конфигурации:">Документ конфигурации:</span></label>
                <input type="text" id="batchEntity" placeholder="Например: РеализацияТоваровУслуг или ЗаказКлиента"  data-i18n-placeholder="Например: РеализацияТоваровУслуг или ЗаказКлиента"/>
            </div>

            <div class="form-group">
                <label class="form-label" for="batchTabular"><span data-i18n="Табличная часть документа:">Табличная часть документа:</span></label>
                <input type="text" id="batchTabular" placeholder="Например: Товары или Состав"  data-i18n-placeholder="Например: Товары или Состав"/>
            </div>

            <div class="form-group">
                <label class="form-label" for="batchRegister"><span data-i18n="Регистр накопления:">Регистр накопления:</span></label>
                <input type="text" id="batchRegister" placeholder="Например: ТоварыНаСкладах или Взаиморасчеты"  data-i18n-placeholder="Например: ТоварыНаСкладах или Взаиморасчеты"/>
            </div>

            <div class="form-group">
                <label class="form-label" for="batchRegisterType"><span data-i18n="Вид виртуальной таблицы:">Вид виртуальной таблицы:</span></label>
                <select id="batchRegisterType">
                    <option value="Остатки" data-i18n="Виртуальная таблица: Остатки (контроль остатков)">Виртуальная таблица: Остатки (контроль остатков)</option>
                </select>
            </div>

            <div class="form-group"><label class="form-label" for="batchSource"><span data-i18n="Источник строк:">Источник строк:</span></label><select id="batchSource"><option value="table" data-i18n="Текущие строки (модуль объекта, сервер)">Текущие строки (модуль объекта, сервер)</option><option value="document" data-i18n="Сохранённые строки базы по ссылке">Сохранённые строки базы по ссылке</option></select></div>
            <p class="card-desc" data-i18n="Сопоставление: Номенклатура=Товар, Склад=@Склад. @ берёт реквизит шапки; ресурс: Количество=Вес. Имена проверяются по метаданным проекта.">Сопоставление: Номенклатура=Товар, Склад=@Склад. @ берёт реквизит шапки; ресурс: Количество=Вес. Имена проверяются по метаданным проекта.</p>
            <div class="form-group"><label class="form-label" for="batchDimensions"><span data-i18n="Измерения регистра и источники (через запятую):">Измерения регистра и источники (через запятую):</span></label><input id="batchDimensions" placeholder="Например: Номенклатура, Склад"  data-i18n-placeholder="Например: Номенклатура, Склад"/></div>
            <div class="form-group"><label class="form-label" for="batchResource"><span data-i18n="Числовой ресурс:">Числовой ресурс:</span></label><input id="batchResource" placeholder="Например: Количество"  data-i18n-placeholder="Например: Количество"/></div>
            <button class="secondary" onclick="generateBatch()"><span data-i18n="Сформировать шаблон запроса">Сформировать шаблон запроса</span></button>
            <div id="batchOutput" class="code-box" style="display:none;"></div>
            <div class="btn-group" id="batchActions" style="display:none;">
                <button class="secondary" onclick="reviewCodeFrom('batchOutput')"><span data-i18n="Сравнить изменения">Сравнить изменения</span></button>
                <button class="secondary" onclick="openResultFrom('batchOutput')"><span data-i18n="Открыть отдельно">Открыть отдельно</span></button>
                <button class="secondary" onclick="insertCodeFrom('batchOutput')"><span data-i18n="Вставить в модуль">Вставить в модуль</span></button>
                <button class="secondary" onclick="copyCodeFrom('batchOutput')"><span data-i18n="Копировать">Копировать</span></button>
            </div>
        </div>
    </div>

    <!-- ТАБ 2: БСП 3.1 КАТАЛОГ И ИНСПЕКТОР -->
    <div id="tab-bsp" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title"><span data-i18n="База знаний БСП 3.1">База знаний БСП 3.1</span></div>
                <span id="bspCountBadge" class="badge badge-ok"><span data-i18n="40 методов">40 методов</span></span>
            </div>
            <div class="card-desc"><span data-i18n="Типовые функции Библиотеки Стандартных Подсистем. Исключают избыточные запросы и создание тяжелых объектов в памяти.">Типовые функции Библиотеки Стандартных Подсистем. Исключают избыточные запросы и создание тяжелых объектов в памяти.</span></div>
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:8px; line-height:1.4;"><span data-i18n="Перед применением примера проверьте наличие и сигнатуру метода в вашей версии БСП.">
                Перед применением примера проверьте наличие и сигнатуру метода в вашей версии БСП.
            </span></div>
            <div class="form-group">
                <label class="form-label" for="bspSearchInput"><span data-i18n="Быстрый поиск по методам и описанию:">Быстрый поиск по методам и описанию:</span></label>
                <input type="text" id="bspSearchInput" placeholder="Введите имя метода, реквизит или действие..." oninput="filterBsp()"  data-i18n-placeholder="Введите имя метода, реквизит или действие..."/>
            </div>
            <div class="chips-row" id="bspFilters">
                <div class="chip active" onclick="setBspSubsystem('', this)"><span data-i18n="Все методы">Все методы</span></div>
                <div class="chip" onclick="setBspSubsystem('ОбщегоНазначения', this)"><span data-i18n="Общего назначения">Общего назначения</span></div>
                <div class="chip" onclick="setBspSubsystem('СтроковыеФункции', this)"><span data-i18n="Строковые функции">Строковые функции</span></div>
                <div class="chip" onclick="setBspSubsystem('ДлительныеОперации', this)"><span data-i18n="Длительные операции">Длительные операции</span></div>
                <div class="chip" onclick="setBspSubsystem('Пользователи', this)"><span data-i18n="Пользователи">Пользователи</span></div>
                <div class="chip" onclick="setBspSubsystem('УправлениеДоступом', this)"><span data-i18n="Управление доступом">Управление доступом</span></div>
            </div>
            <div id="bspListContainer" style="max-height:380px; overflow-y:auto;"></div>
        </div>
    </div>

    <!-- ТАБ 3: РАСШИРЕНИЯ (&CFE) -->
    <div id="tab-extensions" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title"><span data-i18n="Конструктор перехвата в расширении">Конструктор перехвата в расширении</span></div>
                <span class="badge badge-ok">&cfe</span>
            </div>
            <div class="card-desc"><span data-i18n="BSL-шаблон перехвата &amp;Вместо, &amp;Перед или &amp;После. Сверьте сигнатуру и тип модуля с исходным методом. Сборка .cfe выполняется в Конфигураторе.">BSL-шаблон перехвата &amp;Вместо, &amp;Перед или &amp;После. Сверьте сигнатуру и тип модуля с исходным методом. Сборка .cfe выполняется в Конфигураторе.</span></div>
            
            <div class="form-group">
                <label class="form-label" for="extMethod"><span data-i18n="Имя перехватываемой процедуры или функции:">Имя перехватываемой процедуры или функции:</span></label>
                <input type="text" id="extMethod" placeholder="Например: ОбработкаПроведения или ПриЗаписи"  data-i18n-placeholder="Например: ОбработкаПроведения или ПриЗаписи"/>
            </div>

            <div class="form-group">
                <label class="form-label" for="extDirective"><span data-i18n="Директива перехвата (аннотация):">Директива перехвата (аннотация):</span></label>
                <select id="extDirective">
                    <option value="Вместо" data-i18n="&amp;Вместо (с обязательным вызовом ПродолжитьВызов)">&amp;Вместо (с обязательным вызовом ПродолжитьВызов)</option>
                    <option value="Перед" data-i18n="&amp;Перед (с контролем флага Отказ = Истина)">&amp;Перед (с контролем флага Отказ = Истина)</option>
                    <option value="После" data-i18n="&amp;После (постобработка после исполнения типового кода)">&amp;После (постобработка после исполнения типового кода)</option>
                </select>
            </div>

            <div class="form-group">
                <label class="form-label" for="extParams"><span data-i18n="Входные параметры метода (через запятую):">Входные параметры метода (через запятую):</span></label>
                <input type="text" id="extParams" placeholder="Например: Отказ, РежимПроведения"  data-i18n-placeholder="Например: Отказ, РежимПроведения"/>
                <div class="form-hint"><span data-i18n="Параметры должны совпадать с исходным методом. Пустое поле — известная сигнатура события или метод без параметров.">Параметры должны совпадать с исходным методом. Пустое поле — известная сигнатура события или метод без параметров.</span></div>
            </div>

            <div class="form-group"><label class="form-label" for="extKind"><span data-i18n="Вид метода:">Вид метода:</span></label><select id="extKind"><option value="procedure" data-i18n="Процедура">Процедура</option><option value="function" data-i18n="Функция (перехват &amp;Вместо)">Функция (перехват &amp;Вместо)</option></select></div>
            <div class="form-group"><label class="form-label" for="extModule"><span data-i18n="Тип модуля:">Тип модуля:</span></label><select id="extModule"><option value="МодульОбъекта" data-i18n="Модуль объекта">Модуль объекта</option><option value="МодульФормы" data-i18n="Модуль формы">Модуль формы</option><option value="ОбщийМодуль" data-i18n="Общий модуль">Общий модуль</option></select></div>
            <button onclick="generateExt()"><span data-i18n="Сгенерировать перехватчик">Сгенерировать перехватчик</span></button>
            <div id="extOutput" class="code-box" style="display:none;"></div>
            <div class="btn-group" id="extActions" style="display:none;">
                <button class="secondary" onclick="reviewCodeFrom('extOutput')"><span data-i18n="Сравнить изменения">Сравнить изменения</span></button>
                <button class="secondary" onclick="openResultFrom('extOutput')"><span data-i18n="Открыть отдельно">Открыть отдельно</span></button>
                <button class="secondary" onclick="insertCodeFrom('extOutput')"><span data-i18n="Вставить в модуль расширения">Вставить в модуль расширения</span></button>
                <button class="secondary" onclick="copyCodeFrom('extOutput')"><span data-i18n="Копировать">Копировать</span></button>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <div class="card-title"><span data-i18n="Добавление кнопки в командную панель">Добавление кнопки в командную панель</span></div>
                <span class="badge badge-context"><span data-i18n="Форма">Форма</span></span>
            </div>
            <div class="card-desc"><span data-i18n="Программное создание команды и кнопки в командной панели управляемой формы внутри обработчика ПриСозданииНаСервере.">Программное создание команды и кнопки в командной панели управляемой формы внутри обработчика ПриСозданииНаСервере.</span></div>
            
            <div class="form-group">
                <label class="form-label" for="btnFormName"><span data-i18n="Имя элемента кнопки:">Имя элемента кнопки:</span></label>
                <input type="text" id="btnFormName" placeholder="Например: КнопкаПечатиАкта или КнопкаЗаполнить"  data-i18n-placeholder="Например: КнопкаПечатиАкта или КнопкаЗаполнить"/>
            </div>

            <div class="form-group">
                <label class="form-label" for="btnFormTitle"><span data-i18n="Заголовок кнопки на форме:">Заголовок кнопки на форме:</span></label>
                <input type="text" id="btnFormTitle" placeholder="Например: Печать акта или Заполнить по остаткам"  data-i18n-placeholder="Например: Печать акта или Заполнить по остаткам"/>
            </div>

            <div class="form-group"><label class="form-label" for="btnFormParent"><span data-i18n="Имя командной панели формы:">Имя командной панели формы:</span></label><input id="btnFormParent" data-i18n-placeholder="Укажите имя существующей панели в вашей форме" placeholder="Укажите имя существующей панели в вашей форме" /></div>
            <div class="form-group">
                <label class="form-label" for="btnFormCmd"><span data-i18n="Имя команды формы:">Имя команды формы:</span></label>
                <input type="text" id="btnFormCmd" placeholder="Например: КомандаПечатиАкта или КомандаЗаполнить"  data-i18n-placeholder="Например: КомандаПечатиАкта или КомандаЗаполнить"/>
            </div>

            <button class="secondary" onclick="generateFormBtn()"><span data-i18n="Сгенерировать код ПриСозданииНаСервере">Сгенерировать код ПриСозданииНаСервере</span></button>
            <div id="btnFormOutput" class="code-box" style="display:none;"></div>
            <div class="btn-group" id="btnFormActions" style="display:none;">
                <button class="secondary" onclick="reviewCodeFrom('btnFormOutput')"><span data-i18n="Сравнить изменения">Сравнить изменения</span></button>
                <button class="secondary" onclick="openResultFrom('btnFormOutput')"><span data-i18n="Открыть отдельно">Открыть отдельно</span></button>
                <button class="secondary" onclick="insertCodeFrom('btnFormOutput')"><span data-i18n="Вставить в модуль">Вставить в модуль</span></button>
                <button class="secondary" onclick="copyCodeFrom('btnFormOutput')"><span data-i18n="Копировать">Копировать</span></button>
            </div>
        </div>
    </div>

    <!-- ТАБ 4: ИТС АУДИТ КАЧЕСТВА И БЕЗОПАСНОСТИ -->
    <div id="tab-audit" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title"><span data-i18n="Проверка BSL-кода">Проверка BSL-кода</span></div>
                <span class="badge badge-ok"><span data-i18n="Локальная проверка">Локальная проверка</span></span>
            </div>
            <button class="secondary" onclick="vscode.postMessage({type:'openAuditSettings'})"><span data-i18n="Настроить правила проверки">Настроить правила проверки</span></button>
            <div class="card-desc"><span data-i18n="Локальные проверки запросов в циклах, блокировок и модальных вызовов. Замечания — подсказки для ревью, без гарантии полного соответствия ИТС.">Локальные проверки запросов в циклах, блокировок и модальных вызовов. Замечания — подсказки для ревью, без гарантии полного соответствия ИТС.</span></div>
            <button onclick="auditActiveFile()"><span data-i18n="Проверить открытый файл модуля">Проверить открытый файл модуля</span></button>
            
            <div class="form-group" style="margin-top:8px;">
                <label class="form-label" for="auditSnippetInput"><span data-i18n="Или вставьте BSL-фрагмент для экспресс-проверки:">Или вставьте BSL-фрагмент для экспресс-проверки:</span></label>
                <textarea id="auditSnippetInput" placeholder="Вставьте BSL-фрагмент для проверки..." data-i18n-placeholder="Вставьте BSL-фрагмент для проверки..."></textarea>
            </div>
            <button class="secondary" onclick="auditSnippet()"><span data-i18n="Проверить фрагмент">Проверить фрагмент</span></button>
            <button class="secondary ai-task-action" type="button" onclick="explainSnippet()"><span data-i18n="Объяснить фрагмент с ИИ">Объяснить фрагмент с ИИ</span></button>
            <div id="explainOutput" class="code-box" role="status" style="display:none;"></div>
            <div id="auditOutputContainer" style="margin-top:8px;"></div>
        </div>
    </div>

    <!-- ТАБ 5: VANESSA BDD -->
    <div id="tab-bdd" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title"><span data-i18n="Черновик сценария Vanessa">Черновик сценария Vanessa</span></div>
                <span class="badge badge-ok">BDD Gherkin</span>
            </div>
            <div class="card-desc"><span data-i18n="Сохраните полное требование в каркасе .feature или запросите AI-черновик. Проверьте шаги по библиотеке Vanessa и заполните реальные тестовые данные.">Сохраните полное требование в каркасе .feature или запросите AI-черновик. Проверьте шаги по библиотеке Vanessa и заполните реальные тестовые данные.</span></div>
            
            <div class="form-group">
                <label class="form-label" for="bddEntity"><span data-i18n="Имя проверяемого документа:">Имя проверяемого документа:</span></label>
                <input type="text" id="bddEntity" placeholder="Например: Реализация товаров и услуг или Заказ клиента"  data-i18n-placeholder="Например: Реализация товаров и услуг или Заказ клиента"/>
            </div>

            <div class="form-group">
                <label class="form-label" for="bddTabular"><span data-i18n="Табличная часть документа:">Табличная часть документа:</span></label>
                <input type="text" id="bddTabular" placeholder="Например: Товары или Материалы"  data-i18n-placeholder="Например: Товары или Материалы"/>
            </div>

            <div class="form-group">
                <label class="form-label" for="bddRegister"><span data-i18n="Контролируемый регистр накопления:">Контролируемый регистр накопления:</span></label>
                <input type="text" id="bddRegister" placeholder="Например: ТоварыНаСкладах или Взаиморасчеты"  data-i18n-placeholder="Например: ТоварыНаСкладах или Взаиморасчеты"/>
            </div>

            <div class="form-group">
                <label class="form-label" for="bddPrompt"><span data-i18n="Условие теста или поведение системы:">Условие теста или поведение системы:</span></label>
                <textarea id="bddPrompt" placeholder="Например: Проверить отказ проведения при превышении остатка товара на складе Основной..." style="min-height:55px;" data-i18n-placeholder="Например: Проверить отказ проведения при превышении остатка товара на складе Основной..."></textarea>
            </div>

            <div class="form-group"><label class="form-label" for="bddSteps"><span data-i18n="Шаги из вашей библиотеки Vanessa (необязательно):">Шаги из вашей библиотеки Vanessa (необязательно):</span></label><textarea id="bddSteps" data-i18n-placeholder="Вставьте реальные шаги Дано / Когда / Тогда и таблицы данных." placeholder="Вставьте реальные шаги Дано / Когда / Тогда и таблицы данных."></textarea></div>
            <p id="bddStatus" role="status" class="card-desc"></p>
            <div class="form-group"><label class="form-label" for="bddMode"><span data-i18n="Способ подготовки:">Способ подготовки:</span></label><select id="bddMode"><option value="local" data-i18n="Локальный каркас с требованиями">Локальный каркас с требованиями</option><option value="ai" data-i18n="AI-черновик по полному требованию">AI-черновик по полному требованию</option></select></div>
            <div class="btn-group">
                <button class="ai-task-action" onclick="generateBdd(false)"><span data-i18n="Подготовить .feature">Подготовить .feature</span></button>
            </div>
            <div id="bddOutput" class="code-box" style="display:none;"></div>
            <div class="btn-group" id="bddActions" style="display:none;">
                <button class="secondary" onclick="openResultFrom('bddOutput')"><span data-i18n="Открыть отдельно">Открыть отдельно</span></button>
                <button class="secondary" onclick="copyCodeFrom('bddOutput')"><span data-i18n="Копировать .feature">Копировать .feature</span></button>
            </div>
        </div>
    </div>

    <!-- ТАБ 6: АНАЛИЗ ТЕХНОЛОГИЧЕСКОГО ЖУРНАЛА (ТЖ) -->
    <div id="tab-techlog" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title"><span data-i18n="Диагностика Технологического Журнала">Диагностика Технологического Журнала</span></div>
                <span class="badge badge-warn"><span data-i18n="Высокая нагрузка">Высокая нагрузка</span></span>
            </div>
            <div class="card-desc"><span data-i18n="Локальная сводка распознанных событий: блокировки, исключения и SQL дольше 1 секунды. Рекомендации требуют проверки по контексту инцидента.">Локальная сводка распознанных событий: блокировки, исключения и SQL дольше 1 секунды. Рекомендации требуют проверки по контексту инцидента.</span></div>
            <div class="form-group">
                <label class="form-label" for="techlogInput"><span data-i18n="Фрагмент лога технологического журнала:">Фрагмент лога технологического журнала:</span></label>
                <textarea id="techlogInput" style="min-height:90px;" placeholder="Вставьте строку или фрагмент лога ТЖ..." data-i18n-placeholder="Вставьте строку или фрагмент лога ТЖ..."></textarea>
            </div>
            <button onclick="analyzeTechLog()"><span data-i18n="Диагностировать инциденты">Диагностировать инциденты</span></button>
            <div id="techlogStatus" style="font-size:11px; color:var(--text-muted); margin-top:4px;"></div>
            <div id="techlogOutput" class="code-box" style="display:none;"></div>
        </div>
    </div>

    <!-- ТАБ 7: МЕТАДАННЫЕ КОНФИГУРАЦИИ -->
    <div id="tab-metadata" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title"><span data-i18n="Метаданные конфигурации">Метаданные конфигурации</span></div>
                <button class="sm secondary" onclick="scanMetadata()"><span data-i18n="Сканировать">Сканировать</span></button>
            </div>
            <div class="card-desc"><span data-i18n="Читает XML/EDT или metadata.json из текущего проекта. Повторное сканирование обновляет контекст. При отсутствии схемы генератор запросит уточнения.">Читает XML/EDT или metadata.json из текущего проекта. Повторное сканирование обновляет контекст. При отсутствии схемы генератор запросит уточнения.</span></div>
            <div id="metadataSummaryBox" class="code-box" style="max-height:160px;"><span data-i18n="Нажмите «Сканировать», чтобы прочитать структуру проекта или выгрузки.">Нажмите «Сканировать», чтобы прочитать структуру проекта или выгрузки.</span></div>
            <div class="btn-group" style="margin-top:6px;">
                <button class="secondary" onclick="openWorkspaceFile('metadata.json')"><span data-i18n="Открыть metadata.json">Открыть metadata.json</span></button>
            </div>
        </div>
    </div>

    <!-- ТАБ 8: SIDECAR И КОНФИГУРАТОР (EPF + TURBOCONF) -->
    <div id="tab-sidecar" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title"><span data-i18n="Статус локального помощника">Статус локального помощника</span></div>
                <button class="sm secondary" onclick="checkSidecar()"><span data-i18n="Проверить">Проверить</span></button>
            </div>
            <div id="sidecarStatusIndicator" style="font-size:11px; margin-bottom:8px;">
                <span class="badge badge-warn"><span data-i18n="Опрос статуса...">Опрос статуса...</span></span>
            </div>
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:6px;"><span data-i18n="Sidecar слушает">
                Sidecar слушает </span><code>http://127.0.0.1:18833</code><span data-i18n="для работы внутри Конфигуратора 1С и TurboConf."> для работы внутри Конфигуратора 1С и TurboConf.
            </span></div>
        </div>

        <div class="card">
            <div class="card-header">
                <div class="card-title"><span data-i18n="Интеграция с Конфигуратором 1С">Интеграция с Конфигуратором 1С</span></div>
                <span class="badge badge-context">EPF / TurboConf</span>
            </div>
            <div class="card-desc"><span data-i18n="Экспериментальная интеграция. Исходники .epf нужно собрать в Конфигураторе; TurboConf требует ручной установки. Откройте инструкции перед подключением.">Экспериментальная интеграция. Исходники .epf нужно собрать в Конфигураторе; TurboConf требует ручной установки. Откройте инструкции перед подключением.</span></div>
            <div class="btn-group">
                <button class="secondary" onclick="openWorkspaceFile('README.md')"><span data-i18n="Подключение MCP и Sidecar">Подключение MCP и Sidecar</span></button>
                <button class="secondary" onclick="openWorkspaceFile('epf/README.md')"><span data-i18n="Сборка обработки из исходников">Сборка обработки из исходников</span></button>
                <button class="secondary" onclick="openWorkspaceFile('turboconf/README.md')"><span data-i18n="TurboConf скрипт">TurboConf скрипт</span></button>
            </div>
        </div>
    </div>

    <!-- ТАБ 9: НАСТРОЙКИ, БАЛАНС И ШЛЮЗ -->
    <div id="tab-settings" class="tab-panel">
        <button class="secondary" type="button" onclick="vscode.postMessage({type:'manageRunnerProfile'})"><span data-i18n="Профиль проверки 1С">Профиль проверки 1С</span></button>
        <div class="card">
            <div class="card-header">
                <div class="card-title"><span data-i18n="Шлюз NormaHub">Шлюз NormaHub</span></div>
                <span id="gatewayStatusBadge" class="badge ${gatewayStatusBadge}">${gatewayStatusLabel}</span>
            </div>
            <div id="gatewayBalanceDisplay" style="font-size:15px; font-weight:700; color:${isGatewayActive ? '#10B981' : 'var(--text-muted)'}; margin: 4px 0 8px 0; font-family:'JetBrains Mono', monospace;">${balanceDisplay || 'Проверяем подключение…'}</div>
            <div class="card-desc" style="margin-bottom:8px;"><span data-i18n="AI-шлюз NormaHub. Оплата за фактически использованные токены. Баланс и расходы доступны в личном кабинете.">
                AI-шлюз NormaHub. Оплата за фактически использованные токены. Баланс и расходы доступны в личном кабинете.
            </span></div>
            <div class="btn-group">
                <button onclick="openBilling()"><span data-i18n="Управление балансом на normahub.cc">Управление балансом на normahub.cc</span></button>
            </div>

        </div>

        <div class="card">
            <div class="card-header">
                <div class="card-title"><span data-i18n="Выбор рабочей модели ИИ">Выбор рабочей модели ИИ</span></div>
                <span class="badge badge-context"><span data-i18n="Шлюз ИИ">Шлюз ИИ</span></span>
            </div>
            <div class="card-desc"><span data-i18n="Модель генерации и объяснений настраивается отдельно от модели автодополнения.">Модель генерации и объяснений настраивается отдельно от модели автодополнения.</span></div>
            <div class="form-group">
                <label class="form-label" for="modelSelector"><span data-i18n="Генерация и объяснения:">Генерация и объяснения:</span></label>
                <select id="modelSelector" onchange="changeModel()">
                    <option value="deepseek-v4.1-flash-1017" ${selectedModel === 'deepseek-v4.1-flash-1017' ? 'selected' : ''}>DeepSeek v4.1 Flash 1017</option>
                    <option value="gpt-6.1-sol" ${selectedModel === 'gpt-6.1-sol' ? 'selected' : ''}>GPT-6.1 Sol</option>
                    <option value="gpt-6-sol" ${selectedModel === 'gpt-6-sol' ? 'selected' : ''}>GPT-6 Sol</option>
                </select>
            </div>
        </div>

        <div class="card"><div class="card-title"><span data-i18n="Автодополнение BSL">Автодополнение BSL</span></div>
            <div class="form-group"><label class="form-label" for="autocompleteModelSelector"><span data-i18n="Модель ghost text:">Модель ghost text:</span></label><select id="autocompleteModelSelector" onchange="vscode.postMessage({type:'changeModel',purpose:'autocompleteModel',model:this.value})"></select></div>
            <button class="secondary" onclick="vscode.postMessage({type:'openExtensionSettings'})"><span data-i18n="Все настройки автодополнения">Все настройки автодополнения</span></button>
        </div>
        <div class="card">
            <div class="card-header">
                <div class="card-title"><span data-i18n="API-ключ NormaHub">API-ключ NormaHub</span></div>
                <span class="badge badge-context"><span data-i18n="Шифрование">Шифрование</span></span>
            </div>
            <div class="card-desc"><span data-i18n="Ключ сохраняется строго локально в защищённом системном хранилище VS Code.">Ключ сохраняется строго локально в защищённом системном хранилище VS Code.</span></div>
            <div class="form-group">
            <div class="form-label"><span data-i18n="Текущий ключ:">Текущий ключ: </span><code id="maskedApiKey">${maskedKey}</code></div>
                <input type="password" id="apiKeyInput" placeholder="Вставьте ключ вида nr_hub_..."  data-i18n-placeholder="Вставьте ключ вида nr_hub_..."/>
            </div>
            <button class="secondary" onclick="saveKey()"><span data-i18n="Сохранить ключ">Сохранить ключ</span></button>
            <button class="secondary" onclick="vscode.postMessage({type:'deleteKey'})"><span data-i18n="Удалить сохранённый ключ">Удалить сохранённый ключ</span></button>
            <p class="form-hint"><span data-i18n="Если NORMAHUB_API_KEY задан в окружении IDE, он используется после удаления сохранённого ключа.">Если NORMAHUB_API_KEY задан в окружении IDE, он используется после удаления сохранённого ключа.</span></p>
        </div>

        <div class="card">
            <div class="card-header">
                <div class="card-title"><span data-i18n="Справка и подсказки">Справка и подсказки</span></div>
                <span class="badge badge-context"><span data-i18n="Интерфейс">Интерфейс</span></span>
            </div>
            <div class="btn-group">
                <button class="secondary" onclick="selectSubTool('sidecar')"><span data-i18n="Интеграции: MCP, Sidecar и Конфигуратор">Интеграции: MCP, Sidecar и Конфигуратор</span></button>
                <button class="secondary" onclick="restoreQuickStart()"><span data-i18n="Показать памятку «Быстрый старт»">Показать памятку «Быстрый старт»</span></button>
                <button class="secondary" onclick="openWelcomeModal()"><span data-i18n="Открыть вводный гид">Открыть вводный гид</span></button>
            </div>
        </div>
    </div>

    <!-- Шпаргалка по горячим клавишам (Футер) -->
    <div class="hotkeys-footer">
        <div class="hotkeys-footer-title"><span data-i18n="Горячие клавиши:">Горячие клавиши:</span></div>
        <div class="hotkey-item" title="В редакторе BSL: примите предложенный фрагмент автодополнения" data-i18n-title="В редакторе BSL: примите предложенный фрагмент автодополнения"><kbd>Tab</kbd><span><span data-i18n="Автодополнение">Автодополнение</span></span></div>
        <div class="hotkey-item" title="Быстрый вызов генератора запросов 1С" data-i18n-title="Быстрый вызов генератора запросов 1С"><kbd>Ctrl+Alt+Q</kbd><span><span data-i18n="Запрос">Запрос</span></span></div>
        <div class="hotkey-item" title="Интеграция с TurboConf и Конфигуратором 1С" data-i18n-title="Интеграция с TurboConf и Конфигуратором 1С"><kbd>Ctrl+Alt+Space</kbd><span>TurboConf</span></div>
    </div>
    </div>

    <div id="toast" class="toast" role="status" aria-live="polite"></div>

    <script>
        const NL = String.fromCharCode(10);
        const vscode = acquireVsCodeApi();
        ${languageScript(this._language)}
        const bspModules = ${bspModulesJson};
        const workspaceTools = ${workspaceToolsJson};
        let activeBspSubsystem = '';

        // Theme management
        function initTheme() {
            let saved = 'espresso';
            try {
                saved = localStorage.getItem('normahub_1c_theme') || 'espresso';
            } catch (_) {}
            applyTheme(saved);
        }

        function toggleTheme() {
            const current = document.body.classList.contains('theme-warm-sand') ? 'warm-sand' : 'espresso';
            const next = current === 'warm-sand' ? 'espresso' : 'warm-sand';
            applyTheme(next);
            try {
                localStorage.setItem('normahub_1c_theme', next);
            } catch (_) {}
        }

        function applyTheme(theme) {
            document.body.classList.remove('theme-warm-sand', 'theme-espresso');
            const label = document.getElementById('themeLabel');

            if (theme === 'warm-sand') {
                document.body.classList.add('theme-warm-sand');
                if (label) { label.innerText = 'Тёмная'; }
            } else {
                document.body.classList.add('theme-espresso');
                if (label) { label.innerText = 'Светлая'; }
            }
            document.getElementById('themeBtn').setAttribute('aria-label', t(theme === 'warm-sand' ? 'Включить тёмную тему' : 'Включить светлую тему'));
        }

        function applySidebarStatus(message) {
            const gatewayBadge = document.getElementById('gatewayStatusBadge');
            const gatewayBalance = document.getElementById('gatewayBalanceDisplay');
            const metadataDot = document.getElementById('metadataStatusDot');
            const metadataLabel = document.getElementById('metadataHeaderLabel');
            const maskedKey = document.getElementById('maskedApiKey');
            const gatewayDot = document.getElementById('gatewayStatusDot');
            const gatewayRail = document.getElementById('gatewayRailStatus');

            if (gatewayBadge) {
                gatewayBadge.className = 'badge ' + (message.gatewayStatusBadge || 'badge-warn');
                gatewayBadge.innerText = message.gatewayStatusLabel || 'Статус неизвестен';
            }
            if (gatewayBalance) {
                gatewayBalance.innerText = message.balanceDisplay || 'Статус неизвестен';
                gatewayBalance.style.color = message.gatewayActive ? '#10B981' : 'var(--text-muted)';
            }
            if (metadataDot) metadataDot.className = 'status-dot ' + (message.metadataAvailable ? 'online' : 'idle');
            if (metadataLabel) metadataLabel.innerText = message.metadataLabel || 'Метаданные не загружены';
            if (maskedKey && message.maskedKey) maskedKey.innerText = message.maskedKey;
            if (gatewayDot) gatewayDot.className = 'rail-dot ' + (message.gatewayActive ? 'online' : (message.gatewayStatusBadge === 'badge-crit' ? 'warning' : ''));
            if (gatewayRail) gatewayRail.innerText = message.gatewayActive ? 'ИИ подключён' : (message.gatewayStatusLabel || 'Статус ИИ неизвестен');
        }

        // Data structures for tools by category
        let currentTool = 'ai-overview';

        function renderToolCatalog() {
            const container = document.getElementById('toolCatalog');
            if (!container) return;
            const query = (document.getElementById('toolSearch')?.value || '').toLowerCase().trim();
            container.innerHTML = '';
            const groups = {};
            workspaceTools.filter(tool => !query || [tool.name,tool.description,tool.group,t(tool.name),t(tool.description),t(tool.group)].join(' ').toLowerCase().includes(query))
                .forEach(tool => (groups[tool.group] ||= []).push(tool));
            Object.entries(groups).forEach(([group, tools]) => {
                const section = document.createElement('section');
                section.className = 'catalog-group';
                section.innerHTML = '<h2>' + t(group) + '</h2>';
                const grid = document.createElement('div');
                grid.className = 'catalog-grid';
                tools.forEach(tool => {
                    const card = document.createElement('button');
                    card.type = 'button';
                    card.className = 'catalog-card';
                    card.innerHTML = '<span class="catalog-symbol">' + tool.symbol + '</span><span class="catalog-card-copy"><strong>' + t(tool.name) + '</strong><small>' + t(tool.description) + '</small></span><span class="catalog-mode">' + t(tool.mode) + '</span>';
                    card.onclick = () => selectSubTool(tool.id);
                    grid.appendChild(card);
                });
                section.appendChild(grid);
                container.appendChild(section);
            });
            if (!container.children.length) container.innerHTML = '<div class="catalog-empty">Задачи не найдены. Измените запрос.</div>';
        }

        function selectCategory(cat, targetTool) {
            selectSubTool(targetTool || (cat === 'ai' ? 'ai-overview' : 'tools'));
        }

        function selectSubTool(toolId, options = {}) {
            if (toolId === 'queries-gen') toolId = 'ai-overview';
            const panel = document.getElementById('tab-' + toolId);
            if (!panel) return;
            const previousPanel = document.activeElement?.closest('.tab-panel');
            currentTool = toolId;
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            panel.classList.add('active');
            const navId = toolId === 'ai-overview' ? 'cat-btn-ai' : (toolId === 'settings' ? 'cat-btn-settings' : 'cat-btn-tools');
            document.querySelectorAll('.seg-btn').forEach(btn => {
                const active = btn.id === navId;
                btn.classList.toggle('active', active);
                if (active) btn.setAttribute('aria-current', 'page');
                else btn.removeAttribute('aria-current');
            });
            const selector = document.getElementById('toolSelector');
            if (selector && Array.from(selector.options).some(option => option.value === toolId)) selector.value = toolId;
            document.getElementById('workspaceHero').style.display = toolId === 'ai-overview' ? '' : 'none';
            document.getElementById('toolBreadcrumb').style.display = ['ai-overview', 'tools', 'settings'].includes(toolId) ? 'none' : 'flex';
            const toolInfo = workspaceTools.find(tool => tool.id === toolId);
            document.getElementById('sectionLabel').innerText = toolInfo?.name || 'Инструмент';
            if (toolId === 'tools') {
                if (options.returnTo) panel.dataset.returnTo = options.returnTo;
                renderToolCatalog();
            }
            if (toolId === 'bsp') {
                const bspContainer = document.getElementById('bspListContainer');
                if (bspContainer && bspContainer.children.length === 0) {
                    renderBspList();
                }
            }
            if (toolId === 'sidecar') {
                checkSidecar();
            }
            if (previousPanel && previousPanel !== panel) {
                const heading = panel.querySelector('h1, .card-title, textarea, input');
                if (heading) {
                    if (!heading.matches('input,textarea')) heading.setAttribute('tabindex', '-1');
                    heading.focus({ preventScroll: true });
                }
            }
        }

        // Backwards-compatible adapter for tests and legacy links
        function switchTab(name) {
            selectSubTool(name === 'queries' ? 'queries-refactor' : name);
        }

        // Quick Start Guide controls
        function toggleQuickStart() {
            const box = document.getElementById('quickStartBox');
            if (!box) return;
            const isCollapsed = box.classList.toggle('collapsed');
            const arr = document.getElementById('quickStartToggleArrow');
            if (arr) arr.innerText = isCollapsed ? '▼' : '▲';
            try {
                localStorage.setItem('1c_copilot_qs_collapsed', isCollapsed ? '1' : '0');
            } catch (_) {}
        }

        function dismissQuickStartForever(e) {
            if (e) e.stopPropagation();
            const box = document.getElementById('quickStartBox');
            if (box) box.style.display = 'none';
            try {
                localStorage.setItem('1c_copilot_qs_hidden_forever', '1');
            } catch (_) {}
            showToast('✓ Памятка скрыта. Вы можете вернуть её в настройках.');
        }

        function restoreQuickStart() {
            try {
                localStorage.removeItem('1c_copilot_qs_hidden_forever');
            } catch (_) {}
            const box = document.getElementById('quickStartBox');
            if (box) {
                box.style.display = 'block';
                box.classList.remove('collapsed');
            }
            showToast('✓ Памятка "Быстрый старт" восстановлена');
        }

        function initQuickStart() {
            try {
                if (localStorage.getItem('1c_copilot_qs_hidden_forever') === '1') {
                    const box = document.getElementById('quickStartBox');
                    if (box) box.style.display = 'none';
                    return;
                }
                if (localStorage.getItem('1c_copilot_qs_collapsed') === '1') {
                    const box = document.getElementById('quickStartBox');
                    if (box) {
                        box.classList.add('collapsed');
                        const arr = document.getElementById('quickStartToggleArrow');
                        if (arr) arr.innerText = '▼';
                    }
                }
            } catch (_) {}
        }

        // Welcome Modal controls
        function initWelcomeModal() {
            try {
                if (localStorage.getItem('1c_copilot_welcomed') !== '1') {
                    const modal = document.getElementById('welcomeModal');
                    if (modal) modal.style.display = 'flex';
                }
            } catch (_) {}
        }

        function closeWelcomeModal() {
            const modal = document.getElementById('welcomeModal');
            if (modal) modal.style.display = 'none';
            try {
                localStorage.setItem('1c_copilot_welcomed', '1');
            } catch (_) {}
            document.getElementById('workspaceHero').querySelector('h1').focus();
        }

        function openWelcomeModal() {
            const modal = document.getElementById('welcomeModal');
            if (modal) {
                modal.style.display = 'flex';
                modal.querySelector('.modal-btn-primary').focus();
            }
        }

        // AI Overview Helpers
        function showFimDemo() {
            const box = document.getElementById('fimDemoBox');
            if (box) {
                box.style.display = box.style.display === 'none' ? 'block' : 'none';
            }
        }

        // Toast feedback
        let toastTimer = null;
        function showToast(msg) {
            const t = document.getElementById('toast');
            if (!t) return;
            t.innerText = msg || '✓ Скопировано в буфер обмена!';
            t.classList.add('show');
            if (toastTimer) { clearTimeout(toastTimer); }
            toastTimer = setTimeout(() => {
                t.classList.remove('show');
                toastTimer = null;
            }, 1500);
        }

        initTheme();
        const homePanel = document.getElementById('tab-ai-overview');
        homePanel.insertBefore(document.querySelector('.pilot-prompt-card'), document.getElementById('cockpitOutputStudio'));
        document.querySelector('.category-segmented').after(document.getElementById('workspaceHero'));
        document.getElementById('tab-settings').appendChild(document.getElementById('quickStartBox'));
        initQuickStart();
        initWelcomeModal();
        selectCategory('ai', 'ai-overview');
        renderToolCatalog();

        // Code Box helpers
        function insertCodeFrom(id) {
            const elem = document.getElementById(id);
            const code = elem ? elem.innerText : '';
            const previewId = elem?.dataset.previewId;
            if (code && code.trim()) {
                vscode.postMessage({ type: 'insertCode', previewId });
            } else {
                showToast('⚠️ Нет кода для вставки');
            }
        }

        function copyCodeFrom(id) {
            const text = document.getElementById(id).innerText;
            if (text) {
                vscode.postMessage({ type: 'copyToClipboard', text });
                showToast('✓ Скопировано в буфер!');
            }
        }

        function refactorQuery() {
            const rawQuery = document.getElementById('refactorInput').value;
            if (!rawQuery.trim()) return;
            document.getElementById('refactorOutput').style.display = 'none';
            document.getElementById('refactorActions').style.display = 'none';
            clearCockpitOutput();
            document.getElementById('refactorStatus').innerText = 'Подготовка пакета запроса...';
            vscode.postMessage({ type: 'refactorQuery', rawQuery });
        }

        function generateBatch() {
            clearResult('batchOutput', 'batchActions');
            const entity = document.getElementById('batchEntity').value.trim();
            const tabular = document.getElementById('batchTabular').value.trim();
            const register = document.getElementById('batchRegister').value.trim();
            const dimensions = document.getElementById('batchDimensions').value.split(',').map(s => s.trim()).filter(Boolean);
            const resource = document.getElementById('batchResource').value.trim();
            vscode.postMessage({ type: 'generateBatchTemplate', entity, tabular, register, registerType:'Остатки', fields:[...dimensions,resource], sourceMode:document.getElementById('batchSource').value });
        }

        // BSP Tab
        function renderBspList() {
            const query = (document.getElementById('bspSearchInput').value || '').toLowerCase().trim();
            const container = document.getElementById('bspListContainer');
            container.innerHTML = '';

            const filtered = bspModules.filter(m => {
                if (activeBspSubsystem && !m.module.toLowerCase().includes(activeBspSubsystem.toLowerCase())) {
                    return false;
                }
                if (!query) return true;
                return m.module.toLowerCase().includes(query) ||
                       m.method.toLowerCase().includes(query) ||
                       m.description.toLowerCase().includes(query) || m.descriptionEnglish.toLowerCase().includes(query);
            });

            document.getElementById('bspCountBadge').innerText = filtered.length + ' методов';
            if (!filtered.length) {
                const empty = document.createElement('div');
                empty.className = 'bsp-empty';
                empty.textContent = 'Методы не найдены. Измените запрос или выберите другую подсистему.';
                container.appendChild(empty);
            }

            filtered.forEach(m => {
                const item = document.createElement('div');
                item.className = 'bsp-item';
                item.innerHTML = \`
                    <div class="bsp-header" style="display:block;">
                        <div class="bsp-method-name">\${m.method}()</div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:3px;">
                            <div class="bsp-module-tag">Общий модуль: <b>\${m.module}</b></div>
                            <span class="badge badge-context">\${m.context}</span>
                        </div>
                    </div>
                    <div class="bsp-signature"><code>\${m.signature}</code></div>
                    <div class="bsp-desc">\${uiLanguage === 'en' ? m.descriptionEnglish : m.description}</div>
                    <div class="bsp-example"><code>\${m.example}</code></div>
                    <div class="btn-group" style="margin-top:6px;">
                        <button class="sm" onclick="insertBspSnippet('\${encodeURIComponent(m.example)}')">Вставить в код</button>
                        <button class="sm secondary" onclick="copySnippet('\${encodeURIComponent(m.example)}')">Копировать вызов</button>
                    </div>
                \`;
                container.appendChild(item);
            });
            updateContextActions(Boolean(currentEditorContext.isBsl));
        }

        function filterBsp() { renderBspList(); }

        function setBspSubsystem(sub, el) {
            activeBspSubsystem = sub;
            document.querySelectorAll('#bspFilters .chip').forEach(c => c.classList.remove('active'));
            if (el) {
                el.classList.add('active');
            }
            renderBspList();
        }

        function insertBspSnippet(enc) {
            const code = decodeURIComponent(enc);
            vscode.postMessage({ type: 'insertBsp', code });
        }

        function copySnippet(enc) {
            const code = decodeURIComponent(enc);
            vscode.postMessage({ type: 'copyToClipboard', text: code });
            showToast('✓ Сниппет скопирован!');
        }

        // Extensions Tab
        function generateExt() {
            const method = document.getElementById('extMethod').value.trim();
            const directive = document.getElementById('extDirective').value;
            const params = document.getElementById('extParams').value.trim();
            clearResult('extOutput', 'extActions');
            vscode.postMessage({ type: 'generateExtension', method, directive, params, isFunction:document.getElementById('extKind').value === 'function', moduleType:document.getElementById('extModule').value });
        }

        function generateFormBtn() {
            const buttonName = document.getElementById('btnFormName').value.trim();
            const title = document.getElementById('btnFormTitle').value.trim();
            const commandName = document.getElementById('btnFormCmd').value.trim();
            clearResult('btnFormOutput', 'btnFormActions');
            vscode.postMessage({ type: 'generateFormButton', buttonName, title, commandName, parentName:document.getElementById('btnFormParent').value.trim() });
        }

        // Audit Tab
        function auditActiveFile() {
            vscode.postMessage({ type: 'auditSelection' });
        }

        function auditSnippet() {
            const code = document.getElementById('auditSnippetInput').value;
            vscode.postMessage({ type: 'auditCodeSnippet', code });
        }

        function jumpTo(line) {
            vscode.postMessage({ type: 'jumpToLine', line });
        }

        // Vanessa BDD
        function generateBdd(openEditor) {
            const entity = document.getElementById('bddEntity').value.trim();
            const tabular = document.getElementById('bddTabular').value.trim();
            const register = document.getElementById('bddRegister').value.trim();
            const prompt = document.getElementById('bddPrompt').value.trim();
            clearResult('bddOutput', 'bddActions');
            vscode.postMessage({ type: 'generateBdd', entity, tabular, register, prompt, openEditor, useAI:document.getElementById('bddMode').value === 'ai', stepsText:document.getElementById('bddSteps').value });
        }

        // Tech Log
        function analyzeTechLog() {
            const rawLog = document.getElementById('techlogInput').value;
            document.getElementById('techlogStatus').innerText = 'Анализ событий ТЖ...';
            vscode.postMessage({ type: 'analyzeTechLog', rawLog });
        }

        // Metadata
        function scanMetadata() {
            vscode.postMessage({ type: 'scanMetadata' });
        }

        // Sidecar
        function checkSidecar() {
            vscode.postMessage({ type: 'checkSidecarStatus' });
        }

        function openWorkspaceFile(relPath) {
            vscode.postMessage({ type: 'openWorkspaceFile', relativePath: relPath });
        }

        // Settings
        function saveKey() {
            const val = document.getElementById('apiKeyInput').value;
            if (val) vscode.postMessage({ type: 'saveKey', value: val });
        }
        function changeModel() {
            const model = document.getElementById('modelSelector').value;
            document.getElementById('cockpitModelSelect').value = model;
            vscode.postMessage({ type: 'changeModel', model, purpose:'reasoningModel' });
        }
        function openBilling() { vscode.postMessage({ type: 'openBilling' }); }
        function openB2B() { vscode.postMessage({ type: 'openB2B' }); }

        // ==========================================
        // ACTION PILOT CLIENT CONTROLLERS
        // ==========================================
        let currentCockpitCode = '';
        let currentCockpitPreview = {};
        let currentEditorContext = { fileName: '', isBsl: false, lineCount: 0, hasSelection: false, selectedText: '' };

        function updateEditorContextUI(ctx) {
            currentEditorContext = ctx || {};
            const dot = document.getElementById('pilotContextDot');
            const fileEl = document.getElementById('pilotContextFile');
            const selEl = document.getElementById('pilotContextSel');
            const banner = document.getElementById('editorContextBanner');
            const hasBslContext = Boolean(ctx && ctx.fileName && ctx.isBsl);
            if (!fileEl || !selEl || !banner) return;

            banner.classList.toggle('context-empty', !ctx || !ctx.fileName);
            banner.classList.toggle('context-warning', Boolean(ctx && ctx.fileName && !ctx.isBsl));
            banner.dataset.contextState = hasBslContext ? 'ready' : (ctx && ctx.fileName ? 'unsupported' : 'empty');

            if (hasBslContext) {
                if (dot) {
                    dot.innerText = '●';
                    dot.className = 'pilot-context-dot online';
                }
                fileEl.innerText = ctx.fileName + ' · BSL';
                if (ctx.hasSelection) {
                    selEl.innerText = 'Выделен фрагмент • ' + ctx.lineCount + ' строк кода';
                } else {
                    selEl.innerText = 'Модуль открыт • используется позиция курсора';
                }
            } else if (ctx && ctx.fileName) {
                if (dot) {
                    dot.innerText = '●';
                    dot.className = 'pilot-context-dot warning';
                }
                fileEl.innerText = ctx.fileName;
                selEl.innerText = 'Файл не поддерживает BSL-контекст для этих действий';
            } else {
                if (dot) {
                    dot.innerText = '●';
                    dot.className = 'pilot-context-dot';
                }
                fileEl.innerText = 'BSL-модуль не выбран';
                selEl.innerText = 'Откройте .bsl или .os, чтобы использовать контекст редактора';
            }

            updateContextActions(hasBslContext);
        }

        function updateContextActions(hasBslContext) {
            document.querySelectorAll('button[onclick^="insertCodeFrom"]').forEach(btn => {
                const match = btn.getAttribute('onclick').match(/'([^']+)'/);
                const box = match && document.getElementById(match[1]);
                btn.disabled = !box?.dataset.targetName;
                if (box?.dataset.targetName) btn.textContent = 'Применить в ' + box.dataset.targetName;
            });
            document.querySelectorAll('button[onclick^="insertBspSnippet"]').forEach(btn => { btn.disabled = !hasBslContext; });
            const apply = document.querySelector('button[onclick="insertCockpitCode()"]');
            if (apply) apply.disabled = !currentCockpitPreview.targetName || currentCockpitPreview.sourceCurrent === false;
            const reviewAction = document.getElementById('reviewPreview');
            if (reviewAction) { reviewAction.hidden = currentCockpitPreview.reviewAvailable !== true; reviewAction.disabled = currentCockpitPreview.sourceCurrent === false; }
            const validationAction = document.getElementById('queryValidation');
            if (validationAction) {
                document.getElementById('queryValidationSlot').hidden = currentCockpitPreview.comparisonAvailable !== true;
                validationAction.disabled = currentCockpitPreview.sourceCurrent === false;
            }
            const target = document.getElementById('cockpitTarget');
            if (target) target.innerText = currentCockpitPreview.sourceCurrent === false
                ? t('Исходный контекст изменился. Черновик можно открыть или скопировать; для вставки повторите генерацию.')
                : currentCockpitPreview.targetName ? 'Исходный модуль: ' + currentCockpitPreview.targetName + '. Версия проверяется перед применением.' : 'Откройте результат отдельно или скопируйте его.';
        }

        function refreshEditorContext() {
            vscode.postMessage({ type: 'getEditorContext' });
            showToast('✓ Контекст редактора обновлен');
        }

        function showInCockpitStudio(code, badgeText, metaText, preview = {}) {
            currentCockpitPreview = preview;
            currentCockpitCode = code || '';
            const studio = document.getElementById('cockpitOutputStudio');
            const badge = document.getElementById('cockpitBadge');
            const meta = document.getElementById('cockpitMeta');
            const pre = document.getElementById('cockpitCodePre');
            const target = document.getElementById('cockpitTarget');
            if (!studio) return;

            if (badge) badge.innerText = badgeText || 'Предпросмотр результата';
            const linesCount = currentCockpitCode.split(NL).length;
            if (meta) meta.innerText = linesCount + ' строк BSL' + (metaText ? ' • ' + metaText : '');
            if (pre) pre.innerText = currentCockpitCode;
            if (target) {
                target.innerText = currentEditorContext && currentEditorContext.isBsl
                    ? 'Результат можно вставить в активный BSL-модуль в позиции курсора или скопировать вручную.'
                    : 'BSL-модуль не выбран: скопируйте результат или откройте .bsl/.os перед вставкой.';
            }

            if (target) target.innerText = preview.targetName ? ('Применить в ' + preview.targetName + (preview.replacesSelection ? ': заменить исходное выделение.' : ' в исходной позиции курсора.')) : 'Откройте результат отдельно или скопируйте его.';
            studio.style.display = 'block';
            updateContextActions(Boolean(currentEditorContext.isBsl));
            studio.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        function insertCockpitCode() {
            if (!currentCockpitCode) return;
            if (currentCockpitPreview.sourceCurrent === false) { showToast(t('Исходный контекст изменился. Повторите генерацию.')); return; }
            if (!currentCockpitPreview.targetName) {
                showToast('Откройте BSL-модуль перед вставкой кода');
                return;
            }
            vscode.postMessage({ type: 'insertCode', previewId: currentCockpitPreview.previewId });
        }

        function copyCockpitCode() {
            if (!currentCockpitCode) return;
            vscode.postMessage({ type: 'copyToClipboard', text: currentCockpitCode });
            if (navigator.clipboard) { navigator.clipboard.writeText(currentCockpitCode); }
            showToast('✓ Код скопирован в буфер обмена!');
        }

        function reviewCockpitCode() {
            if (currentCockpitPreview.reviewAvailable !== true || currentCockpitPreview.sourceCurrent === false) return;
            vscode.postMessage({ type: 'reviewPreview', previewId: currentCockpitPreview.previewId });
        }

        function openQueryValidation() {
            if (currentCockpitPreview.comparisonAvailable !== true || currentCockpitPreview.sourceCurrent === false) return;
            vscode.postMessage({ type: 'openValidationMenu', previewId: currentCockpitPreview.previewId });
        }

        function clearCockpitOutput() {
            currentCockpitCode = '';
            currentCockpitPreview = {};
            const studio = document.getElementById('cockpitOutputStudio');
            if (studio) studio.style.display = 'none';
        }

        function syncModelSelection(val) {
            const mainSel = document.getElementById('modelSelector');
            if (mainSel && mainSel.value !== val) {
                mainSel.value = val;
                changeModel();
            } else {
                vscode.postMessage({ type: 'changeModel', model: val, purpose:'reasoningModel' });
                showToast('✓ Выбрана модель: ' + val);
            }
        }

        function runCockpitAction(action) {
            if (action === 'optimize-query') {
                selectSubTool('queries-refactor');
                const refactorInput = document.getElementById('refactorInput');
                if (refactorInput && currentEditorContext.hasSelection && currentEditorContext.selectedText) {
                    refactorInput.value = currentEditorContext.selectedText;
                }
                showToast(currentEditorContext.hasSelection ? '✓ Выделенный запрос открыт для оптимизации' : 'Откройте или вставьте запрос для оптимизации');
                return;
            } else if (action === 'create-extension') {
                selectSubTool('extensions');
                showToast('✓ Конструктор перехвата открыт');
                return;
            } else if (action === 'generate-posting') {
                selectSubTool('queries-batch');
                showToast('Конструктор запроса контроля дефицита открыт');
                return;
            }
        }

        function setQueryBusy(busy) {
            document.getElementById('btnSendCockpitPrompt').disabled = busy;
            document.querySelectorAll('.ai-task-action').forEach(btn => { btn.disabled = busy; });
            document.getElementById('cancelAiTask').style.display = busy ? '' : 'none';
            document.getElementById('cockpitPromptInput').setAttribute('aria-busy', String(busy));
        }

        function runCockpitPrompt() {
            const input = document.getElementById('cockpitPromptInput');
            const send = document.getElementById('btnSendCockpitPrompt');
            const status = document.getElementById('cockpitPromptStatus');
            if (send && send.disabled) return;
            if (!input || !input.value.trim()) {
                showToast('Введите описание задачи');
                return;
            }
            const promptText = input.value.trim();
            vscode.postMessage({ type: 'generateQuery', intent: promptText });
            if (status) status.innerText = 'Формируем пакет запроса по стандартам ИТС…';
            if (status) status.dataset.state = 'loading';
            setQueryBusy(true);
            showToast('Формируем пакет запроса…');
        }

        document.addEventListener('keydown', event => {
            const modal = document.getElementById('welcomeModal');
            if (modal.style.display === 'flex') {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeWelcomeModal();
                } else if (event.key === 'Tab') {
                    const controls = Array.from(modal.querySelectorAll('button, a[href]'));
                    const first = controls[0], last = controls[controls.length - 1];
                    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
                    else if (!modal.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
                }
                return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && document.activeElement === document.getElementById('cockpitPromptInput')) {
                event.preventDefault();
                runCockpitPrompt();
            } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && document.activeElement === document.getElementById('refactorInput')) {
                event.preventDefault();
                refactorQuery();
            } else if ((event.key === 'Enter' || event.key === ' ') && document.activeElement.matches('.chip, .qs-link, .quick-start-title')) {
                event.preventDefault();
                document.activeElement.click();
            }
        });

        function clearResult(boxId, actionsId) {
            const box = document.getElementById(boxId);
            box.style.display = 'none'; box.textContent = ''; box.dataset.previewId = ''; box.dataset.targetName = '';
            if (actionsId) document.getElementById(actionsId).style.display = 'none';
        }
        function reviewCodeFrom(id) { const box = document.getElementById(id); if (box?.dataset.previewId) vscode.postMessage({type:'reviewPreview', previewId:box.dataset.previewId}); }
        function openResultFrom(id) { vscode.postMessage({type:'openResult',previewId:document.getElementById(id).dataset.previewId}); }
        function explainSnippet() {
            const code = document.getElementById('auditSnippetInput').value || currentEditorContext.selectedText || '';
            document.getElementById('explainOutput').textContent = 'Анализируем фрагмент…';
            document.getElementById('explainOutput').style.display = 'block';
            vscode.postMessage({type:'explainSelection',code});
        }

        // Host Message Listener
        window.addEventListener('message', event => {
            const message = event.data;
            const results = {refactorResult:['refactorOutput','refactorActions'],batchResult:['batchOutput','batchActions'],extensionResult:['extOutput','extActions'],formBtnResult:['btnFormOutput','btnFormActions'],bddResult:['bddOutput','bddActions']};
            const result = results[message.type];
            if (result) {
                const box = document.getElementById(result[0]);
                box.dataset.previewId = message.previewId || '';
                box.dataset.targetName = message.targetName || '';
                if (message.error) { clearResult(result[0],result[1]); box.textContent = message.error; box.style.display = 'block'; clearCockpitOutput(); }
            }
            if (message.type === 'modelsChanged') {
                document.getElementById('modelSelector').value = message.reasoningModel;
                document.getElementById('cockpitModelSelect').value = message.reasoningModel;
                document.getElementById('autocompleteModelSelector').value = message.autocompleteModel;
            } else if (message.type === 'taskState') {
                setQueryBusy(message.busy);
            } else if (message.type === 'navigateTool') {
                selectSubTool(message.tool);
                if (message.selectedText) {
                    if (message.tool === 'queries-refactor') document.getElementById('refactorInput').value = message.selectedText;
                    if (message.tool === 'audit') document.getElementById('auditSnippetInput').value = message.selectedText;
                    if (message.tool === 'extensions') {
                        const signature = message.selectedText.match(/(?:^|\\n)\\s*(Процедура|Функция)\\s+([А-Яа-яЁёA-Za-z0-9_]+)\\s*\\(([^)]*)\\)/i);
                        if (signature) { document.getElementById('extMethod').value = signature[2]; document.getElementById('extParams').value = signature[3]; document.getElementById('extKind').value = signature[1].toLowerCase() === 'функция' ? 'function' : 'procedure'; }
                    }
                }
                if (message.explain) explainSnippet();
            } else if (message.type === 'explainResult') {
                const box = document.getElementById('explainOutput'); box.style.display = 'block'; box.textContent = message.error || [message.message, message.report].filter(Boolean).join(NL + NL);
            } else if (message.type === 'sidebarStatus') {
                applySidebarStatus(message);
            } else if (message.type === 'editorContext') {
                updateEditorContextUI(message);
            } else if (message.type === 'toast' && message.message) {
                showToast(message.message);
            } else if (message.type === 'queryResult') {
                setQueryBusy(false);
                const cockpitStatus = document.getElementById('cockpitPromptStatus');
                if (cockpitStatus) {
                    cockpitStatus.innerText = message.error || message.message || t('Готово. Проверьте результат перед вставкой.');
                    cockpitStatus.dataset.state = message.error || message.sourceCurrent === false ? 'error' : 'success';
                }
                if (message.code) showInCockpitStudio(message.code, 'Черновик запроса', 'Проверьте по конфигурации', message);
                else clearCockpitOutput();
            } else if (message.type === 'refactorResult') {
                document.getElementById('refactorStatus').innerText = '';
                const box = document.getElementById('refactorOutput');
                box.style.display = 'block';
                if (message.error) {
                    box.innerText = message.error;
                    document.getElementById('refactorActions').style.display = 'none';
                    clearCockpitOutput();
                } else {
                    box.innerText = message.code;
                    document.getElementById('refactorStatus').innerText = message.reason || '';
                    document.getElementById('refactorActions').style.display = message.changed ? 'flex' : 'none';
                    if (message.changed) showInCockpitStudio(message.code, 'Вариант пакета подготовлен', 'Сравните результат и план запроса', message);
                    else clearCockpitOutput();
                }
            } else if (message.type === 'batchResult') {
                const box = document.getElementById('batchOutput');
                if (box) {
                    box.style.display = 'block';
                    box.innerText = message.error || message.code || '';
                    const act = document.getElementById('batchActions');
                    if (act) act.style.display = message.code ? 'flex' : 'none';
                }
                if (message.code) {
                    showInCockpitStudio(message.code, 'Шаблон контроля дефицита', 'Проверьте схему и параметры', message);
                }
            } else if (message.type === 'extensionResult') {
                const box = document.getElementById('extOutput');
                box.style.display = 'block';
                box.innerText = message.error || message.code || '';
                document.getElementById('extActions').style.display = message.code ? 'flex' : 'none';
                if (message.code) {
                    showInCockpitStudio(message.code, 'BSL-шаблон перехвата', '', message);
                }
            } else if (message.type === 'formBtnResult') {
                const box = document.getElementById('btnFormOutput');
                if (box) {
                    box.style.display = 'block';
                    box.innerText = message.error || message.code || '';
                    const act = document.getElementById('btnFormActions');
                    if (act) act.style.display = message.code ? 'flex' : 'none';
                }
            } else if (message.type === 'auditResult') {
                const container = document.getElementById('auditOutputContainer');
                container.innerHTML = '';

                if (message.issues && message.issues.length) {
                    message.issues.forEach(iss => {
                        const card = document.createElement('div');
                        card.className = 'issue-card ' + (iss.severity || 'info');
                        const rule = document.createElement('span');
                        rule.className = 'badge ' + (iss.severity === 'error' ? 'badge-crit' : iss.severity === 'warning' ? 'badge-warn' : 'badge-ok');
                        rule.textContent = iss.rule;
                        const line = document.createElement(message.canJump === false ? 'span' : 'button');
                        line.className = 'issue-link';
                        line.textContent = t('Строка {line}',{line:iss.line});
                        if (message.canJump !== false) line.addEventListener('click', () => jumpTo(iss.line));
                        const description = document.createElement('div');
                        description.textContent = iss.message;
                        const suggestion = document.createElement('div');
                        suggestion.textContent = t('Рекомендация: {suggestion}',{suggestion:iss.suggestion});
                        card.append(rule, line, description, suggestion);
                        container.appendChild(card);
                    });
                } else {
                    const okBox = document.createElement('div');
                    okBox.className = 'code-box';
                    okBox.innerText = message.report || '✓ Замечаний не обнаружено!';
                    container.appendChild(okBox);
                }
            } else if (message.type === 'bddResult') {
                document.getElementById('bddStatus').textContent = message.error || message.message || '';
                const box = document.getElementById('bddOutput');
                box.style.display = 'block';
                box.innerText = message.error || message.feature || '';
                document.getElementById('bddActions').style.display = message.feature ? 'flex' : 'none';
            } else if (message.type === 'techLogResult') {
                document.getElementById('techlogStatus').innerText = '';
                const box = document.getElementById('techlogOutput');
                box.style.display = 'block';
                box.innerText = message.report || '';
            } else if (message.type === 'metadataResult') {
                const box = document.getElementById('metadataSummaryBox');
                box.innerText = message.error || message.summary || \`Обнаружено объектов: \${message.objectsCount}\`;
                const available = !message.error && message.objectsCount > 0;
                document.getElementById('metadataHeaderLabel').innerText = message.error ? 'Ошибка чтения метаданных' : (available ? 'Метаданные: ' + message.objectsCount + ' объектов' : 'Метаданные не найдены');
                document.getElementById('metadataStatusDot').className = 'status-dot ' + (available ? 'online' : 'idle');
            } else if (message.type === 'sidecarStatus') {
                const ind = document.getElementById('sidecarStatusIndicator');
                ind.textContent = message.online
                    ? 'Sidecar подключен · версия ' + (message.info?.version || 'неизвестна')
                    : 'Sidecar недоступен. ' + (message.error || 'Запустите: python3 -m sidecar.main');
            }
            updateContextActions(Boolean(currentEditorContext.isBsl));
        });
        // Register listeners before the handshake: the host may answer immediately.
        updateContextActions(false);
        document.querySelectorAll('.chip, .qs-link, .quick-start-title').forEach(el => {
            el.setAttribute('role', 'button');
            el.setAttribute('tabindex', '0');
        });
        document.getElementById('cockpitModelSelect').setAttribute('aria-label', 'Модель генерации запроса');
        document.getElementById('modelSelector').setAttribute('aria-label', 'Рабочая модель AI');
        document.getElementById('apiKeyInput').setAttribute('aria-label', 'API-ключ NormaHub');
        const autoModel = document.getElementById('autocompleteModelSelector');
        autoModel.innerHTML = document.getElementById('modelSelector').innerHTML;
        autoModel.value = '${autocompleteModel}';
        const mainModel = document.getElementById('modelSelector');
        const cockpitModel = document.getElementById('cockpitModelSelect');
        cockpitModel.innerHTML = mainModel.innerHTML;
        cockpitModel.value = mainModel.value;
        const toolSelector = document.getElementById('toolSelector');
        toolSelector.innerHTML = '';
        [{ id: 'ai-overview', name: 'Рабочая область' }, { id: 'tools', name: 'Инструменты' }, ...workspaceTools, { id: 'settings', name: 'Настройки' }].forEach(tool => {
            const option = document.createElement('option');
            option.value = tool.id;
            option.textContent = tool.name;
            toolSelector.appendChild(option);
        });
        toolSelector.value = currentTool;
        if (document.getElementById('welcomeModal').style.display === 'flex') {
            document.querySelector('.modal-btn-primary').focus();
        }
        initUiLanguage();
        vscode.postMessage({ type: 'webviewReady' });
    </script>
</body>
</html>`;
    }
}
