import * as vscode from 'vscode';
import * as path from 'path';
import * as http from 'http';
import { NormaHubClient } from './normahubClient';
import { MetadataScanner } from './metadataScanner';
import { StandardsChecker } from './standardsChecker';
import { BSPHelper } from './bspHelper';
import { QueryBuilder } from './queryBuilder';
import { ExtensionGenerator, ExtensionDirective } from './extensionGenerator';
import { BDDGenerator } from './bddGenerator';
import { MultiTabScanner } from './multiTabScanner';
import { TechLogAnalyzer } from './techLogAnalyzer';
import { ConfigurationMetadata } from './types';
import { workspaceStyles } from './workspaceStyles';
import { workspaceTools } from './workspaceTools';

export class NormaHub1CSidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _queryPending = false;
    private _auditDocument?: { uri: vscode.Uri; version: number };

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {}

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        const updateHtml = async () => {
            const apiKey = await NormaHubClient.getApiKey(this._context);
            const config = vscode.workspace.getConfiguration('normahub1c');
            const selectedModel = config.get<string>('reasoningModel', 'gpt-6.1-sol');
            webviewView.webview.html = this._getHtmlForWebview(apiKey, undefined, selectedModel);
            return apiKey;
        };

        let apiKey = await NormaHubClient.getApiKey(this._context);
        let statusRefreshId = 0;

        const refreshSidebarStatus = async () => {
            const refreshId = ++statusRefreshId;
            const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
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

            webviewView.webview.postMessage({
                type: 'sidebarStatus',
                gatewayStatusLabel,
                gatewayStatusBadge,
                balanceDisplay,
                gatewayActive,
                maskedKey: apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : 'Не задан',
                metadataLabel: metadata.isDemoFallback
                    ? 'Примерные метаданные'
                    : (metadata.objects.length ? 'Метаданные доступны' : 'Метаданные не найдены'),
                metadataAvailable: metadata.objects.length > 0 && !metadata.isDemoFallback
            });
        };

        const refreshSidebarStatusSafely = async () => {
            try {
                await refreshSidebarStatus();
            } catch (err) {
                webviewView.webview.postMessage({
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
                webviewView.webview.postMessage({
                    type: 'editorContext',
                    fileName: docName,
                    isBsl,
                    lineCount,
                    hasSelection: !sel.isEmpty,
                    selectedText: selText
                });
            } else {
                webviewView.webview.postMessage({
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
            switch (data.type) {
                case 'getEditorContext':
                    sendEditorContext();
                    break;

                case 'webviewReady':
                    sendEditorContext();
                    await refreshSidebarStatusSafely();
                    break;

                case 'saveKey':
                    await NormaHubClient.setApiKey(this._context, data.value);
                    apiKey = await NormaHubClient.getApiKey(this._context);
                    vscode.window.showInformationMessage('API-ключ сохранен в защищенном SecretStorage.');
                    webviewView.webview.postMessage({ type: 'toast', message: 'API-ключ сохранен в защищенном хранилище' });
                    await refreshSidebarStatusSafely();
                    break;

                case 'changeModel':
                    await this._handleChangeModel(data.model);
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
                    await this._handleGenerateBatchTemplate(data.entity, data.tabular, data.register, data.registerType);
                    break;

                case 'generateExtension':
                    await this._handleGenerateExtension(data.method, data.directive, data.params);
                    break;

                case 'generateFormButton':
                    await this._handleGenerateFormButton(data.buttonName, data.title, data.commandName);
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
                    await this._handleInsertCode(data.code);
                    break;

                case 'copyToClipboard':
                    await vscode.env.clipboard.writeText(data.text);
                    break;

                case 'generateBdd':
                    await this._handleGenerateBdd(data.entity, data.tabular, data.register, data.prompt, data.openEditor);
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
        });
        await updateHtml();
    }

    private async _handleChangeModel(model: string) {
        const config = vscode.workspace.getConfiguration('normahub1c');
        await config.update('autocompleteModel', model, vscode.ConfigurationTarget.Global);
        await config.update('reasoningModel', model, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Модель NormaHub изменена на ${model}`);
    }

    private async _handleGenerateQuery(intent: string) {
        if (!this._view) return;
        if (this._queryPending) return;
        if (typeof intent !== 'string' || !intent.trim()) {
            this._view.webview.postMessage({ type: 'queryResult', error: 'Опишите задачу для запроса 1С.' });
            return;
        }
        this._queryPending = true;
        try {
        const apiKey = await NormaHubClient.getApiKey(this._context);
        if (!apiKey) {
            this._view.webview.postMessage({ type: 'queryResult', error: 'API-ключ не задан. Укажите его в настройках подключения.' });
            return;
        }

        const config = vscode.workspace.getConfiguration('normahub1c');
        const model = config.get<string>('reasoningModel', 'gpt-6.1-sol');

        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const metadata = await MetadataScanner.scanWorkspace(rootPath);
        const metaSummary = MetadataScanner.formatForPrompt(metadata);
        const bspSummary = BSPHelper.getBSPPromptInjection();
        const multiTabContext = MultiTabScanner.getOpenModulesContext(vscode.window.activeTextEditor?.document);

        const systemPrompt = `Ты — ведущий эксперт по языку запросов 1С:Предприятие 8.3 (Стандарты фирмы «1С» и БСП).
Пользователь описывает бизнес-задачу на русском языке. Сформируй чистый, оптимизированный код 1С с созданием объекта Запрос.
Требования стандартов ИТС:
1. Использовать параметры в виртуальных таблицах (Остатки(&Период, ), СрезПоследних(&Период, )).
2. Никогда не соединять виртуальные таблицы напрямую — выносить во временные таблицы (ПОМЕСТИТЬ ВТ_...) с ИНДЕКСИРОВАТЬ ПО.
3. Проверять значения на NULL через ЕСТЬNULL.
4. Добавить МенеджерВременныхТаблиц и установку параметров.
5. Выведи только готовый BSL-код создания и выполнения запроса.

${metaSummary}
${multiTabContext ? '\n' + multiTabContext : ''}

${bspSummary}`;

            this._view.webview.postMessage({ type: 'queryStatus', text: 'Генерация пакета запросов через NormaHub...' });
            const result = await NormaHubClient.complete(apiKey, model, systemPrompt, intent, 0.1, 1500);
            this._view.webview.postMessage(result.trim()
                ? { type: 'queryResult', code: result }
                : { type: 'queryResult', error: 'Модель вернула пустой ответ. Уточните задачу и повторите запрос.' });
        } catch (err: any) {
            this._view.webview.postMessage({ type: 'queryResult', error: err.message });
        } finally {
            this._queryPending = false;
        }
    }

    private async _handleRefactorQuery(rawQuery: string) {
        if (!this._view) return;
        if (!rawQuery || !rawQuery.trim()) {
            this._view.webview.postMessage({ type: 'refactorResult', error: 'Вставьте текст запроса 1С для оптимизации.' });
            return;
        }
        const result = QueryBuilder.refactorQuery(rawQuery);
        this._view.webview.postMessage({
            type: 'refactorResult',
            code: result.refactoredQuery,
            optimizations: result.appliedOptimizations
        });
    }

    private async _handleGenerateBatchTemplate(entity: string, tabular: string, register: string, registerType: string = 'Остатки') {
        const code = QueryBuilder.generateBatchQuery({
            entityName: entity || 'РеализацияТоваровУслуг',
            tabularSection: tabular || 'Товары',
            registerName: register || 'ТоварыНаСкладах',
            registerType: (registerType as 'Остатки' | 'Обороты' | 'СрезПоследних' | 'СрезПервых') || 'Остатки',
            fields: ['Номенклатура', 'Количество'],
            includeScaffolding: true
        });

        this._view?.webview.postMessage({ type: 'batchResult', code });
    }

    private async _handleGenerateExtension(method: string, directive: ExtensionDirective, paramsStr: string) {
        const params = paramsStr ? paramsStr.split(',').map(s => s.trim()).filter(Boolean) : ['Отказ'];
        const code = ExtensionGenerator.generateInterceptor({
            targetMethod: method || 'ОбработкаПроведения',
            directive: directive || 'Вместо',
            moduleType: 'МодульОбъекта',
            isFunction: false,
            parameters: params
        });

        this._view?.webview.postMessage({ type: 'extensionResult', code });
    }

    private async _handleGenerateFormButton(buttonName: string, title: string, commandName: string) {
        const code = ExtensionGenerator.generateFormButtonExtension(
            buttonName || 'КнопкаПечатиАкта',
            title || 'Печать акта',
            commandName || 'КомандаПечатиАкта'
        );
        this._view?.webview.postMessage({ type: 'formBtnResult', code });
    }

    private async _handleAuditSelection() {
        if (!this._view) return;
        this._auditDocument = undefined;
        const editor = vscode.window.activeTextEditor;
        if (!editor || !(['bsl', '1c', 'oscript'].includes(editor.document.languageId) || /\.(bsl|os)$/i.test(editor.document.fileName))) {
            this._view.webview.postMessage({ type: 'auditResult', report: 'Откройте модуль BSL для анализа.' });
            return;
        }

        const code = editor.selection.isEmpty
            ? editor.document.getText()
            : editor.document.getText(editor.selection);

        const lineOffset = editor.selection.isEmpty ? 0 : editor.selection.start.line;
        const issues = StandardsChecker.auditCode(code).map(issue => ({ ...issue, line: issue.line + lineOffset }));
        this._auditDocument = { uri: editor.document.uri, version: editor.document.version };
        const report = StandardsChecker.formatAuditReport(issues);
        this._view.webview.postMessage({ type: 'auditResult', issues, report, canJump: true });
    }

    private async _handleAuditCodeSnippet(code: string) {
        if (!this._view) return;
        this._auditDocument = undefined;
        if (!code || !code.trim()) {
            this._view.webview.postMessage({ type: 'auditResult', report: 'Вставьте код для проверки.' });
            return;
        }
        const issues = StandardsChecker.auditCode(code);
        const report = StandardsChecker.formatAuditReport(issues);
        this._view.webview.postMessage({ type: 'auditResult', issues, report, canJump: false });
    }

    private async _handleJumpToLine(lineNumber: number) {
        if (!this._auditDocument || !Number.isInteger(lineNumber) || lineNumber <= 0) return;
        const document = await vscode.workspace.openTextDocument(this._auditDocument.uri);
        if (document.version !== this._auditDocument.version) {
            this._view?.webview.postMessage({ type: 'toast', message: 'Модуль изменён после проверки. Запустите аудит повторно.' });
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

    private async _handleInsertCode(code: string) {
        const editor = vscode.window.activeTextEditor;
        if (!code || !code.trim()) {
            vscode.window.showWarningMessage('Нет кода для вставки.');
            this._view?.webview.postMessage({ type: 'toast', message: 'Нет кода для вставки' });
            return;
        }
        const isBslDocument = Boolean(editor && (
            ['bsl', '1c', 'oscript'].includes(editor.document.languageId) ||
            /\.(bsl|os)$/i.test(editor.document.fileName)
        ));
        if (editor && isBslDocument) {
            const inserted = await editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, code);
            });
            if (inserted) {
                vscode.window.showInformationMessage('Код успешно вставлен в модуль 1С.');
                this._view?.webview.postMessage({ type: 'toast', message: 'Код вставлен в активный BSL-модуль' });
            } else {
                vscode.window.showWarningMessage('Не удалось вставить код. Файл может быть только для чтения.');
                this._view?.webview.postMessage({ type: 'toast', message: 'Не удалось вставить: файл может быть только для чтения' });
            }
        } else {
            vscode.window.showWarningMessage('Откройте модуль 1С (.bsl или .os) для вставки кода.');
            if (this._view) {
                this._view.webview.postMessage({ type: 'toast', message: 'Откройте модуль .bsl или .os для вставки кода' });
            }
        }
    }

    private async _handleGenerateBdd(entity: string, tabular: string, register: string, prompt?: string, openEditor = true) {
        if (!this._view) return;
        let feature = '';
        if (prompt && prompt.trim()) {
            feature = BDDGenerator.parseNaturalLanguageToFeature(prompt.trim());
        } else {
            const targetEntity = (entity || '').trim() || 'РеализацияТоваровУслуг';
            const spec = BDDGenerator.generateDocumentScenario(
                targetEntity,
                (tabular || '').trim() || 'Товары',
                (register || '').trim() || 'ТоварыНаСкладах'
            );
            feature = BDDGenerator.generateFeature(spec);
        }

        this._view.webview.postMessage({ type: 'bddResult', feature });

        if (openEditor) {
            const doc = await vscode.workspace.openTextDocument({ content: feature, language: 'gherkin' });
            await vscode.window.showTextDocument(doc);
        }
    }

    private async _handleAnalyzeTechLog(rawLog: string) {
        if (!this._view) return;
        if (!rawLog || !rawLog.trim()) {
            this._view.webview.postMessage({ type: 'techLogResult', report: 'Вставьте текст лога ТЖ для анализа.' });
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
        const report = notice + TechLogAnalyzer.formatReport(diagnoses);
        this._view.webview.postMessage({ type: 'techLogResult', report, count: events.length, diagnosesCount: diagnoses.length });
    }

    private async _handleScanMetadata() {
        if (!this._view) return;
        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const metadata = await MetadataScanner.scanWorkspace(rootPath);
        this._view.webview.postMessage({
            type: 'metadataResult',
            name: metadata.name,
            version: metadata.version,
            objectsCount: metadata.objects.length,
            objects: metadata.objects,
            summary: MetadataScanner.formatForPrompt(metadata)
        });
    }

    private async _handleCheckSidecar() {
        if (!this._view) return;
        const req = http.get('http://127.0.0.1:18833/health', { timeout: 1500 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    this._view?.webview.postMessage({ type: 'sidecarStatus', online: true, info: parsed });
                } catch {
                    this._view?.webview.postMessage({ type: 'sidecarStatus', online: true, info: { status: 'ok', version: '1.0.0' } });
                }
            });
        });
        req.on('error', () => {
            this._view?.webview.postMessage({ type: 'sidecarStatus', online: false, error: 'Sidecar не отвечает на 127.0.0.1:18833' });
        });
    }

    private async _handleOpenWorkspaceFile(relativePath: string) {
        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        if (!rootPath || typeof relativePath !== 'string' || !relativePath.trim()) {
            vscode.window.showWarningMessage('Откройте рабочую область перед открытием файла.');
            return;
        }
        const fullPath = path.isAbsolute(relativePath) ? relativePath : path.join(rootPath, relativePath);
        const relativeToRoot = path.relative(rootPath, fullPath);
        if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
            vscode.window.showErrorMessage('Нельзя открыть файл за пределами рабочей области.');
            return;
        }
        try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
            await vscode.window.showTextDocument(doc);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Не удалось открыть файл: ${err.message}`);
        }
    }

    private _getHtmlForWebview(apiKey: string, balance: any, selectedModel: string, metadata?: ConfigurationMetadata): string {
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
        const bspModulesJson = JSON.stringify(BSPHelper.STANDARD_MODULES);
        const workspaceToolsJson = JSON.stringify(workspaceTools);
        const openTabsCount = MultiTabScanner.getOpenModulesCount();
        const metadataLabel = metadata?.isDemoFallback
            ? 'Примерные метаданные'
            : (metadata?.objects?.length ? 'Метаданные доступны' : 'Метаданные не найдены');
        const metadataStatus = metadata && !metadata.isDemoFallback && metadata.objects.length ? 'online' : 'idle';

        return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NormaHub · Помощник 1С</title>
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
            <div class="modal-title" id="welcomeTitle">Добро пожаловать в помощник NormaHub для 1С</div>
                </div>
                <button class="modal-close-btn" onclick="closeWelcomeModal()" type="button" title="Закрыть">✕</button>
            </div>
            <div class="modal-body">
                <div class="modal-lead">
                    Инженерная среда для ускорения разработки на платформе «1С:Предприятие 8.3» и проверки стандартов ИТС.
                </div>
                <div class="modal-features">
                    <div class="modal-feature-item">
                        <div class="modal-feature-icon">⌨️</div>
                        <div class="modal-feature-content">
                            <div class="modal-feature-title">1. Автодополнение по Tab</div>
                            <div class="modal-feature-desc">Пишите код в любых <code>.bsl</code> файлах — подсказки FIM появляются на лету с учетом метаданных и контекста смежных открытых модулей.</div>
                        </div>
                    </div>
                    <div class="modal-feature-item">
                        <div class="modal-feature-icon">⚡</div>
                        <div class="modal-feature-content">
                            <div class="modal-feature-title">2. ИИ и инструменты 1С</div>
                            <div class="modal-feature-desc">ИИ формирует запросы по описанию. Оптимизация запросов, шаблоны расширений, BDD, аудит ИТС, БСП и разбор Техжурнала работают локально.</div>
                        </div>
                    </div>
                    <div class="modal-feature-item">
                        <div class="modal-feature-icon">🎁</div>
                        <div class="modal-feature-content">
                            <div class="modal-feature-title">3. Быстрый шлюз NormaHub без VPN</div>
                            <div class="modal-feature-desc">Для функций ИИ используется единый шлюз. Новым пользователям доступен промокод <code>1CPROMO</code> на $0.10 при регистрации на normahub.cc.</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="modal-btn-primary" onclick="closeWelcomeModal()" type="button">Понятно, начать работу</button>
            </div>
        </div>
    </div>

    <!-- Верхняя компактная шапка с брендом и встроенными мета-бейджами -->
    <div class="top-navbar">
        <div class="brand-block">
            <div class="brand-badge">1C</div>
            <div class="brand-lockup">
                <div class="brand-title">NormaHub · Помощник 1С</div>
                <div class="brand-subtitle">Инструменты разработчика</div>
            </div>
        </div>
        <div class="header-badges">
            <div class="meta-pill" title="Контекст метаданных используется при генерации, если найден в рабочей области">
                <span id="metadataStatusDot" class="status-dot ${metadataStatus}"></span>
                <span id="metadataHeaderLabel" class="pill-text">${metadataLabel}</span>
            </div>
            <div class="meta-pill" title="Смежные открытые BSL-модули в рабочей области">
                <span class="status-dot ${openTabsCount > 0 ? 'online' : 'idle'}"></span>
                <span class="pill-num">${openTabsCount}</span>
                <span class="pill-text">вкл.</span>
            </div>
            <button class="theme-toggle-btn" onclick="toggleTheme()" id="themeBtn" title="Переключить цветовую тему" aria-label="Включить светлую тему">
                <span class="theme-icon">◐</span>
                <span id="themeLabel" class="theme-label-text">Светлая</span>
            </button>
        </div>
    </div>

    <section class="workspace-hero" id="workspaceHero" aria-labelledby="workspaceTitle">
        <div class="workspace-hero-topline">
            <span class="workspace-eyebrow">РАБОЧАЯ ОБЛАСТЬ</span>
        </div>
        <h1 id="workspaceTitle" tabindex="-1">От задачи к коду.</h1>
        <p>Опишите запрос или выберите инструмент для вашего модуля.</p>
    </section>

    <!-- Блок быстрого старта (сворачиваемый и скрываемый навсегда) -->
    <div id="quickStartBox" class="quick-start-box collapsed">
        <div class="quick-start-header">
            <div class="quick-start-title" onclick="toggleQuickStart()">
                <span class="quick-start-icon">💡</span>
                <span>Быстрый старт за 3 шага</span>
            </div>
            <div class="quick-start-actions">
                <button class="quick-start-toggle" id="quickStartToggleBtn" type="button" onclick="toggleQuickStart()" title="Свернуть или развернуть памятку">
                    <span id="quickStartToggleArrow">▼</span>
                </button>
                <button class="quick-start-dismiss" type="button" onclick="dismissQuickStartForever(event)" title="Скрыть навсегда">
                    ✕ Скрыть
                </button>
            </div>
        </div>
        <div id="quickStartBody" class="quick-start-body">
            <div class="qs-step">
                <div class="qs-num">1</div>
                <div class="qs-text">
                    <strong>Подключение:</strong> Откройте <span class="qs-link" onclick="selectSubTool('settings')">настройки</span> и сохраните API-ключ NormaHub для генерации запросов.
                </div>
            </div>
            <div class="qs-step">
                <div class="qs-num">2</div>
                <div class="qs-text">
                    <strong>Автодополнение:</strong> Пишите код в любом <code>.bsl</code> файле в редакторе — умные подсказки появляются автоматически, принимайте по нажатию <kbd>Tab</kbd>.
                </div>
            </div>
            <div class="qs-step">
                <div class="qs-num">3</div>
                <div class="qs-text">
                    <strong>Инструменты:</strong> Выберите задачу в каталоге. БСП, шаблоны, аудит ИТС и разбор Техжурнала доступны без подключения ИИ.
                </div>
            </div>
        </div>
    </div>

    <!-- Высокоуровневая сегментированная навигация: AI vs Инструменты 1С -->
    <nav class="category-segmented" aria-label="Основные разделы">
        <button id="cat-btn-ai" class="seg-btn active" type="button" onclick="selectCategory('ai')">
            <span class="seg-icon">⚡</span>
            <span class="seg-label">ИИ-помощник</span>
        </button>
        <button id="cat-btn-tools" class="seg-btn" type="button" onclick="selectSubTool('tools')">
            <span class="seg-icon">🛠️</span>
            <span class="seg-label">Инструменты 1С</span>
        </button>
        <button id="cat-btn-settings" class="seg-btn" type="button" onclick="selectSubTool('settings')"><span class="seg-label">Подключение</span></button>
    </nav>

    <div class="section-label" id="toolBreadcrumb"><span id="sectionLabel">Инструмент</span><span class="section-label-line"></span><button class="breadcrumb-back" type="button" onclick="selectSubTool('tools')">Каталог задач</button></div>

    <!-- Выпадающий селектор конкретного инструмента -->
    <div class="tool-dropdown-wrapper" hidden>
        <label class="sr-only" for="toolSelector">Раздел помощника</label>
        <select id="toolSelector" class="tool-select" aria-hidden="true" tabindex="-1" onchange="selectSubTool(this.value)">
            <option value="ai-overview">Action Pilot · рабочая область</option>
            <option value="queries-gen">✨ Генерация пакета запроса</option>
            <option value="queries-refactor">⚡ Оптимизация запроса (ИТС)</option>
            <option value="queries-batch">📋 Шаблонизатор движений регистров</option>
            <option value="bdd">🧪 Сценарии тестов Vanessa BDD</option>
            <option value="settings">⚙️ Шлюз NormaHub и статус</option>
        </select>
        <select id="tabNavSelector" style="display:none;" onchange="switchTab(this.value)">
            <option value="queries">⚡ Запросы и проведение</option>
            <option value="bsp">📦 База знаний БСП 3.1</option>
            <option value="extensions">🧩 Расширения (&cfe)</option>
            <option value="audit">🛡️ ИТС Аудит качества</option>
            <option value="bdd">🧪 Тесты Vanessa BDD</option>
            <option value="techlog">📊 Техжурнал (ТЖ)</option>
            <option value="metadata">🗂️ Граф метаданных</option>
            <option value="sidecar">🔌 Sidecar и Конфигуратор</option>
            <option value="settings">⚙️ Настройки и баланс</option>
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
                <span class="pilot-context-file" id="pilotContextFile">BSL-модуль не выбран</span>
                <span class="pilot-context-sel" id="pilotContextSel">Откройте .bsl или .os, чтобы использовать контекст редактора</span>
            </div>
            <button class="action-btn-sm" type="button" onclick="refreshEditorContext()" title="Обновить контекст редактора" aria-label="Обновить контекст редактора" style="background:transparent; border:none; cursor:pointer;">Обновить</button>
        </div>

        <!-- 2. Студия вывода результата (появляется при любом действии) -->
        <div id="cockpitOutputStudio" class="output-studio" style="display:none;">
            <div class="studio-header">
                <div class="studio-badge" id="cockpitBadge">✓ Код оптимизирован по стандартам ИТС</div>
                <div class="studio-meta" id="cockpitMeta">18 строк BSL</div>
            </div>
            <div class="studio-target" id="cockpitTarget">Выберите, куда применить результат.</div>
            <div class="studio-actions-bar">
                <button class="studio-btn-primary context-required-action" type="button" onclick="insertCockpitCode()" disabled>
                    <span>↵ Вставить в активный файл</span>
                </button>
                <button class="studio-btn-secondary" type="button" onclick="copyCockpitCode()">
                <span>Копировать</span>
                </button>
                <button class="studio-btn-ghost" type="button" onclick="clearCockpitOutput()" title="Закрыть">✕</button>
            </div>
            <details open class="studio-code-details">
                <summary>Предпросмотр BSL-кода</summary>
                <pre class="studio-code-pre"><code id="cockpitCodePre"></code></pre>
            </details>
        </div>

        <!-- 3. Три Главных действия (Killer Actions) -->
        <div class="killer-actions-grid">
            <!-- Действие 1: Оптимизировать запрос -->
            <div class="killer-card">
                <div class="killer-card-header">
                    <div class="killer-card-title"><span aria-hidden="true">SQL</span> <span>Оптимизировать запрос (ИТС)</span></div>
                    <span class="killer-card-badge">Высокая нагрузка</span>
                </div>
                <div class="killer-card-desc">Проверьте структуру запроса и получите оптимизированный вариант.</div>
                <div class="killer-card-action">
                    <button class="killer-card-btn" type="button" onclick="runCockpitAction('optimize-query')">Оптимизировать запрос</button>
                </div>
            </div>

            <!-- Действие 2: Обернуть в расширение (&cfe) -->
            <div class="killer-card">
                <div class="killer-card-header">
                    <div class="killer-card-title"><span aria-hidden="true">&amp;</span> <span>Обернуть метод в расширение</span></div>
                    <span class="killer-card-badge">&cfe перехват</span>
                </div>
                <div class="killer-card-desc">Настройте директиву, метод и параметры перехвата.</div>
                <div class="killer-card-action">
                    <button class="killer-card-btn" type="button" onclick="runCockpitAction('create-extension')">Сформировать перехват</button>
                </div>
            </div>

            <!-- Действие 3: Модуль проведения с контролем остатков -->
            <div class="killer-card">
                <div class="killer-card-header">
                    <div class="killer-card-title"><span aria-hidden="true">BSL</span> <span>Сформировать проведение с остатками</span></div>
                    <span class="killer-card-badge">Стандарт ИТС</span>
                </div>
                <div class="killer-card-desc">Шаблон обработки проведения с проверкой остатков и блокировками.</div>
                <div class="killer-card-action">
                    <button class="killer-card-btn" type="button" onclick="runCockpitAction('generate-posting')">Создать проведение</button>
                </div>
            </div>
        </div>

        <!-- 4. Свободный AI Промпт-бар -->
        <div class="pilot-prompt-card">
        <div class="pilot-prompt-title"><span aria-hidden="true">AI</span> <span>Сформировать пакет запроса 1С</span></div>
        <div class="pilot-prompt-row">
            <textarea id="cockpitPromptInput" aria-label="Описание задачи для генерации запроса 1С" placeholder="Например: остатки товаров на дату документа по складам и организации"></textarea>
                <button id="btnSendCockpitPrompt" class="pilot-send-btn" type="button" onclick="runCockpitPrompt()" title="Сгенерировать (Ctrl+Enter)">
                    <span>Сформировать запрос</span><span aria-hidden="true">↗</span>
                </button>
            </div>
            <div class="pilot-prompt-footer">
                <div class="pilot-model-wrapper">
                    <span>Модель:</span>
        <select id="cockpitModelSelect" class="pilot-model-select" onchange="syncModelSelection(this.value)">
            <option value="deepseek-v4.1-flash" ${selectedModel === 'deepseek-v4.1-flash' ? 'selected' : ''}>DeepSeek v4.1 Flash (быстро)</option>
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
        <div class="catalog-heading"><span class="workspace-eyebrow">ИНСТРУМЕНТЫ 1С</span><h1 id="toolsTitle">Что нужно сделать?</h1><p>Генерация, проверка и диагностика — в одном месте.</p></div>
        <label class="sr-only" for="toolSearch">Найти инструмент по задаче</label>
        <input id="toolSearch" type="search" placeholder="Найти инструмент…" oninput="renderToolCatalog()" />
        <div id="toolCatalog"></div>
    </section>

    <!-- ТАБ: ОПТИМИЗАЦИЯ ЗАПРОСА (ИТС) -->
    <div id="tab-queries-refactor" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title">Оптимизация запроса (ИТС)</div>
                <span class="badge badge-ok">ИТС Стандарт</span>
            </div>
            <div class="card-desc">Выносит прямые соединения с виртуальными таблицами во временные таблицы с индексацией и ЕСТЬNULL.</div>
            <div class="chips-row">
                <div class="chip" onclick="loadSampleRefactor('virtual_join')">Пример: Соединение с вирт. таблицей</div>
                <div class="chip" onclick="loadSampleRefactor('subquery')">Пример: Вложенный запрос в ГДЕ</div>
            </div>
            <div class="form-group">
                <label class="form-label" for="refactorInput">Текст исходного запроса 1С:</label>
                <textarea id="refactorInput" placeholder="Вставьте текст неоптимального запроса или выберите тестовый пример выше..."></textarea>
            </div>
            <button onclick="refactorQuery()">Оптимизировать запрос <kbd>Ctrl+Enter</kbd></button>
            <div id="refactorStatus" style="font-size:11px; color:var(--text-muted); margin-top:4px;"></div>
            <div id="refactorOutput" class="code-box" style="display:none;"></div>
            <div class="btn-group" id="refactorActions" style="display:none;">
                <button class="secondary" onclick="insertCodeFrom('refactorOutput')">Вставить в модуль</button>
                <button class="secondary" onclick="copyCodeFrom('refactorOutput')">Копировать</button>
            </div>
        </div>
    </div>

    <!-- ТАБ: AI ГЕНЕРАТОР ЗАПРОСОВ ПО ОПИСАНИЮ -->
    <div id="tab-queries-gen" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title">Генерация пакета запроса</div>
                <span class="badge badge-context">Нейросеть</span>
            </div>
        <div class="chips-row">
            <div class="chip" onclick="setQueryIntent('Остатки товаров на складах на дату документа с ценами', true)">Остатки на дату</div>
            <div class="chip" onclick="setQueryIntent('Обороты продаж номенклатуры за период по клиентам', true)">Обороты продаж</div>
            <div class="chip" onclick="setQueryIntent('Срез последних цен номенклатуры на дату', true)">Срез цен</div>
            <div class="chip" onclick="setQueryIntent('Контроль отрицательных остатков при проведении', true)">Контроль остатков</div>
            </div>
            <div class="form-group">
                <label class="form-label" for="queryIntent">Описание задачи на русском языке:</label>
                <textarea id="queryIntent" placeholder="Например: Выбрать остатки номенклатуры из регистра с фильтром по организации и сгруппировать по складам..."></textarea>
            </div>
            <button onclick="generateQuery()">Сформировать BSL-код запроса <kbd>Ctrl+Alt+Q</kbd></button>
            <div id="queryStatus" style="font-size:11px; color:var(--text-muted); margin-top:4px;"></div>
            <div id="queryOutput" class="code-box" style="display:none;"></div>
            <div class="btn-group" id="queryActions" style="display:none;">
                <button class="secondary" onclick="insertCodeFrom('queryOutput')">Вставить в модуль</button>
                <button class="secondary" onclick="copyCodeFrom('queryOutput')">Копировать</button>
            </div>
        </div>
    </div>

    <!-- ТАБ: КОНСТРУКТОР ДВИЖЕНИЙ ПРОВЕДЕНИЯ -->
    <div id="tab-queries-batch" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title">Конструктор движений проведения</div>
                <span class="badge badge-ok">Шаблон ИТС</span>
            </div>
            <div class="card-desc">Генерирует процедуру ОбработкаПроведения с блокировкой данных, выборкой табличной части во временную таблицу и остатками.</div>
            
            <div class="form-group">
                <label class="form-label" for="batchEntity">Документ конфигурации:</label>
                <input type="text" id="batchEntity" placeholder="Например: РеализацияТоваровУслуг или ЗаказКлиента" />
            </div>

            <div class="form-group">
                <label class="form-label" for="batchTabular">Табличная часть документа:</label>
                <input type="text" id="batchTabular" placeholder="Например: Товары или Состав" />
            </div>

            <div class="form-group">
                <label class="form-label" for="batchRegister">Регистр накопления:</label>
                <input type="text" id="batchRegister" placeholder="Например: ТоварыНаСкладах или Взаиморасчеты" />
            </div>

            <div class="form-group">
                <label class="form-label" for="batchRegisterType">Вид виртуальной таблицы:</label>
                <select id="batchRegisterType">
                    <option value="Остатки">Виртуальная таблица: Остатки (контроль остатков)</option>
                    <option value="Обороты">Виртуальная таблица: Обороты (учет партий/продаж)</option>
                    <option value="СрезПоследних">Виртуальная таблица: СрезПоследних (цены/курсы)</option>
                </select>
            </div>

            <button class="secondary" onclick="generateBatch()">Сформировать шаблон проведения</button>
            <div id="batchOutput" class="code-box" style="display:none;"></div>
            <div class="btn-group" id="batchActions" style="display:none;">
                <button class="secondary" onclick="insertCodeFrom('batchOutput')">Вставить в модуль</button>
                <button class="secondary" onclick="copyCodeFrom('batchOutput')">Копировать</button>
            </div>
        </div>
    </div>

    <!-- ТАБ 2: БСП 3.1 КАТАЛОГ И ИНСПЕКТОР -->
    <div id="tab-bsp" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title">База знаний БСП 3.1</div>
                <span id="bspCountBadge" class="badge badge-ok">40 методов</span>
            </div>
            <div class="card-desc">Типовые функции Библиотеки Стандартных Подсистем. Исключают избыточные запросы и создание тяжелых объектов в памяти.</div>
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:8px; line-height:1.4;">
                Имена общих модулей и функций соответствуют стандартам платформы 1С:Предприятие (формат <code>ИмяМодуля.ИмяМетода</code>).
            </div>
            <div class="form-group">
                <label class="form-label" for="bspSearchInput">Быстрый поиск по методам и описанию:</label>
                <input type="text" id="bspSearchInput" placeholder="Введите имя метода, реквизит или действие..." oninput="filterBsp()" />
            </div>
            <div class="chips-row" id="bspFilters">
                <div class="chip active" onclick="setBspSubsystem('', this)">Все методы</div>
                <div class="chip" onclick="setBspSubsystem('ОбщегоНазначения', this)">Общего назначения</div>
                <div class="chip" onclick="setBspSubsystem('СтроковыеФункции', this)">Строковые функции</div>
                <div class="chip" onclick="setBspSubsystem('ДлительныеОперации', this)">Длительные операции</div>
                <div class="chip" onclick="setBspSubsystem('Пользователи', this)">Пользователи</div>
                <div class="chip" onclick="setBspSubsystem('УправлениеДоступом', this)">Управление доступом</div>
            </div>
            <div id="bspListContainer" style="max-height:380px; overflow-y:auto;"></div>
        </div>
    </div>

    <!-- ТАБ 3: РАСШИРЕНИЯ (&CFE) -->
    <div id="tab-extensions" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title">Конструктор перехвата в расширении</div>
                <span class="badge badge-ok">&cfe</span>
            </div>
            <div class="card-desc">Генерация безопасных аннотаций перехвата (&Вместо, &Перед, &После, &ИзменениеИКонтроль) для модулей расширения без снятия типовой конфигурации с поддержки.</div>
            
            <div class="form-group">
                <label class="form-label" for="extMethod">Имя перехватываемой процедуры или функции:</label>
                <input type="text" id="extMethod" placeholder="Например: ОбработкаПроведения или ПриЗаписи" />
            </div>

            <div class="form-group">
                <label class="form-label" for="extDirective">Директива перехвата (аннотация):</label>
                <select id="extDirective">
                    <option value="Вместо">&Вместо (с обязательным вызовом ПродолжитьВызов)</option>
                    <option value="Перед">&Перед (с контролем флага Отказ = Истина)</option>
                    <option value="После">&После (постобработка после исполнения типового кода)</option>
                    <option value="ИзменениеИКонтроль">&ИзменениеИКонтроль (#Вставка/#КонецВставки)</option>
                </select>
            </div>

            <div class="form-group">
                <label class="form-label" for="extParams">Входные параметры метода (через запятую):</label>
                <input type="text" id="extParams" placeholder="Например: Отказ, РежимПроведения" />
                <div class="form-hint">Параметры должны точно совпадать с сигнатурой типового метода.</div>
            </div>

            <button onclick="generateExt()">Сгенерировать перехватчик</button>
            <div id="extOutput" class="code-box" style="display:none;"></div>
            <div class="btn-group" id="extActions" style="display:none;">
                <button class="secondary" onclick="insertCodeFrom('extOutput')">Вставить в модуль расширения</button>
                <button class="secondary" onclick="copyCodeFrom('extOutput')">Копировать</button>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <div class="card-title">Добавление кнопки в командную панель</div>
                <span class="badge badge-context">Форма</span>
            </div>
            <div class="card-desc">Программное создание команды и кнопки в командной панели управляемой формы внутри обработчика ПриСозданииНаСервере.</div>
            
            <div class="form-group">
                <label class="form-label" for="btnFormName">Имя элемента кнопки:</label>
                <input type="text" id="btnFormName" placeholder="Например: КнопкаПечатиАкта или КнопкаЗаполнить" />
            </div>

            <div class="form-group">
                <label class="form-label" for="btnFormTitle">Заголовок кнопки на форме:</label>
                <input type="text" id="btnFormTitle" placeholder="Например: Печать акта или Заполнить по остаткам" />
            </div>

            <div class="form-group">
                <label class="form-label" for="btnFormCmd">Имя команды формы:</label>
                <input type="text" id="btnFormCmd" placeholder="Например: КомандаПечатиАкта или КомандаЗаполнить" />
            </div>

            <button class="secondary" onclick="generateFormBtn()">Сгенерировать код ПриСозданииНаСервере</button>
            <div id="btnFormOutput" class="code-box" style="display:none;"></div>
            <div class="btn-group" id="btnFormActions" style="display:none;">
                <button class="secondary" onclick="insertCodeFrom('btnFormOutput')">Вставить в модуль</button>
                <button class="secondary" onclick="copyCodeFrom('btnFormOutput')">Копировать</button>
            </div>
        </div>
    </div>

    <!-- ТАБ 4: ИТС АУДИТ КАЧЕСТВА И БЕЗОПАСНОСТИ -->
    <div id="tab-audit" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title">Аудит стандартов ИТС и БСП</div>
                <span class="badge badge-ok">Локальная проверка</span>
            </div>
            <div class="card-desc">Автоматическая проверка кода на критические антипаттерны: запросы в циклах, управляемые блокировки, устаревшие модальные вызовы и мутабельные типы.</div>
            <button onclick="auditActiveFile()">Проверить открытый файл модуля</button>
            
            <div class="form-group" style="margin-top:8px;">
                <label class="form-label" for="auditSnippetInput">Или вставьте BSL-фрагмент для экспресс-проверки:</label>
                <div class="chips-row">
                    <div class="chip" onclick="loadSampleAudit('loop_and_modal')">Пример: Запрос в цикле и модальность</div>
                    <div class="chip" onclick="loadSampleAudit('heavy_objects')">Пример: Ссылка.ПолучитьОбъект()</div>
                </div>
                <textarea id="auditSnippetInput" placeholder="Вставьте процедуры, функции или выберите тестовый пример выше..."></textarea>
            </div>
            <button class="secondary" onclick="auditSnippet()">Проверить фрагмент</button>
            <div id="auditOutputContainer" style="margin-top:8px;"></div>
        </div>
    </div>

    <!-- ТАБ 5: VANESSA BDD -->
    <div id="tab-bdd" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title">Генератор тестов Vanessa Automation</div>
                <span class="badge badge-ok">BDD Gherkin</span>
            </div>
            <div class="card-desc">Формирование сценариев сквозного тестирования поведения документов на русском языке Gherkin для фреймворка Vanessa Automation.</div>
            
            <div class="form-group">
                <label class="form-label" for="bddEntity">Имя проверяемого документа:</label>
                <input type="text" id="bddEntity" placeholder="Например: Реализация товаров и услуг или Заказ клиента" />
            </div>

            <div class="form-group">
                <label class="form-label" for="bddTabular">Табличная часть документа:</label>
                <input type="text" id="bddTabular" placeholder="Например: Товары или Материалы" />
            </div>

            <div class="form-group">
                <label class="form-label" for="bddRegister">Контролируемый регистр накопления:</label>
                <input type="text" id="bddRegister" placeholder="Например: ТоварыНаСкладах или Взаиморасчеты" />
            </div>

            <div class="form-group">
                <label class="form-label" for="bddPrompt">Условие теста или поведение системы:</label>
                <textarea id="bddPrompt" placeholder="Например: Проверить отказ проведения при превышении остатка товара на складе Основной..." style="min-height:55px;"></textarea>
            </div>

            <div class="btn-group">
                <button onclick="generateBdd(true)">Сгенерировать .feature</button>
            <button class="secondary" onclick="generateBdd(false)">Предпросмотр .feature</button>
            </div>
            <div id="bddOutput" class="code-box" style="display:none;"></div>
            <div class="btn-group" id="bddActions" style="display:none;">
                <button class="secondary" onclick="copyCodeFrom('bddOutput')">Копировать .feature</button>
            </div>
        </div>
    </div>

    <!-- ТАБ 6: АНАЛИЗ ТЕХНОЛОГИЧЕСКОГО ЖУРНАЛА (ТЖ) -->
    <div id="tab-techlog" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title">Диагностика Технологического Журнала</div>
                <span class="badge badge-warn">Высокая нагрузка</span>
            </div>
            <div class="card-desc">Экспертный анализ инцидентов TLOCK (блокировки), TDEADLOCK (дедлоки), EXCP (исключения) и DBPOSTGR (медленные запросы PostgreSQL).</div>
            <div class="chips-row">
                <div class="chip" onclick="loadDemoTLog('TLOCK')">TLOCK</div>
                <div class="chip" onclick="loadDemoTLog('TDEADLOCK')">TDEADLOCK</div>
                <div class="chip" onclick="loadDemoTLog('EXCP')">EXCP</div>
                <div class="chip" onclick="loadDemoTLog('DBPOSTGR')">DBPOSTGR</div>
            </div>
            <div class="form-group">
                <label class="form-label" for="techlogInput">Фрагмент лога технологического журнала:</label>
                <textarea id="techlogInput" style="min-height:90px;" placeholder="Вставьте строку или фрагмент лога ТЖ..."></textarea>
            </div>
            <button onclick="analyzeTechLog()">Диагностировать инциденты</button>
            <div id="techlogStatus" style="font-size:11px; color:var(--text-muted); margin-top:4px;"></div>
            <div id="techlogOutput" class="code-box" style="display:none;"></div>
        </div>
    </div>

    <!-- ТАБ 7: МЕТАДАННЫЕ КОНФИГУРАЦИИ -->
    <div id="tab-metadata" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title">Граф метаданных 1С</div>
                <button class="sm secondary" onclick="scanMetadata()">Сканировать</button>
            </div>
            <div class="card-desc">Кэширует структуру объектов конфигурации (справочники, документы, регистры) для точной генерации запросов и реквизитов.</div>
            <div id="metadataSummaryBox" class="code-box" style="max-height:160px;">Нажмите «Сканировать», чтобы прочитать структуру проекта или выгрузки.</div>
            <div class="btn-group" style="margin-top:6px;">
                <button class="secondary" onclick="openWorkspaceFile('metadata.json')">Открыть metadata.json</button>
            </div>
        </div>
    </div>

    <!-- ТАБ 8: SIDECAR И КОНФИГУРАТОР (EPF + TURBOCONF) -->
    <div id="tab-sidecar" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title">Статус локального помощника</div>
                <button class="sm secondary" onclick="checkSidecar()">Проверить</button>
            </div>
            <div id="sidecarStatusIndicator" style="font-size:11px; margin-bottom:8px;">
                <span class="badge badge-warn">Опрос статуса...</span>
            </div>
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:6px;">
                Sidecar слушает <code>http://127.0.0.1:18833</code> для работы внутри Конфигуратора 1С и TurboConf.
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <div class="card-title">Интеграция с Конфигуратором 1С</div>
                <span class="badge badge-context">EPF / TurboConf</span>
            </div>
            <div class="card-desc">Запускайте обработку внутри 1С или используйте скрипт TurboConf по хоткею <code>Ctrl+Alt+Space</code>.</div>
            <div class="btn-group">
                <button class="secondary" onclick="openWorkspaceFile('epf/README.md')">Внешняя обработка (.epf)</button>
                <button class="secondary" onclick="openWorkspaceFile('turboconf/README.md')">TurboConf скрипт</button>
            </div>
        </div>
    </div>

    <!-- ТАБ 9: НАСТРОЙКИ, БАЛАНС И ШЛЮЗ -->
    <div id="tab-settings" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title">Шлюз NormaHub</div>
                <span id="gatewayStatusBadge" class="badge ${gatewayStatusBadge}">${gatewayStatusLabel}</span>
            </div>
            <div id="gatewayBalanceDisplay" style="font-size:15px; font-weight:700; color:${isGatewayActive ? '#10B981' : 'var(--text-muted)'}; margin: 4px 0 8px 0; font-family:'JetBrains Mono', monospace;">${balanceDisplay || 'Проверяем подключение…'}</div>
            <div class="card-desc" style="margin-bottom:8px;">
                AI-шлюз NormaHub. Оплата за фактически использованные токены. Баланс и расходы доступны в личном кабинете.
            </div>
            <div class="btn-group">
                <button onclick="openBilling()">Управление балансом на normahub.cc</button>
            </div>
            <div class="promo-badge-box">
                <div class="promo-header">
                    <span class="promo-gift-icon">🎁</span>
                    <span class="promo-label">Промокод на $0.10:</span>
                    <code class="promo-code" onclick="copyPromoCode()" title="Нажмите, чтобы скопировать">1CPROMO</code>
                    <button class="promo-copy-btn" onclick="copyPromoCode()" type="button" title="Скопировать промокод">Скопировать</button>
                </div>
                <div class="promo-hint">
                    <strong>Обратите внимание:</strong> Промокод <code>1CPROMO</code> дает бонус <strong>$0.10</strong> и указывается <u>исключительно при регистрации</u> нового аккаунта на <a href="https://normahub.cc" target="_blank" class="promo-link">normahub.cc</a> (внутри личного кабинета применить промокод невозможно).
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <div class="card-title">Выбор рабочей модели ИИ</div>
                <span class="badge badge-context">Шлюз ИИ</span>
            </div>
            <div class="card-desc">Выберите нейросеть для автодополнения и генерации кода в зависимости от сложности задачи.</div>
            <div class="form-group">
                <select id="modelSelector" onchange="changeModel()">
                    <option value="deepseek-v4.1-flash" ${selectedModel === 'deepseek-v4.1-flash' ? 'selected' : ''}>DeepSeek v4.1 Flash (★ Рекомендуется для 1С, ~0.04 ₽)</option>
                    <option value="gpt-6.1-sol" ${selectedModel === 'gpt-6.1-sol' ? 'selected' : ''}>GPT-6.1 Sol (Флагман OpenAI, сложнейшая логика)</option>
                    <option value="gpt-6-sol" ${selectedModel === 'gpt-6-sol' ? 'selected' : ''}>GPT-6 Sol (Высокая точность и рассуждения)</option>
                </select>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <div class="card-title">API-ключ NormaHub</div>
                <span class="badge badge-context">Шифрование</span>
            </div>
            <div class="card-desc">Ключ сохраняется строго локально в защищённом системном хранилище VS Code.</div>
            <div class="form-group">
            <div class="form-label">Текущий ключ: <code id="maskedApiKey">${maskedKey}</code></div>
                <input type="password" id="apiKeyInput" placeholder="Вставьте ключ вида nr_hub_..." />
            </div>
            <button class="secondary" onclick="saveKey()">Сохранить ключ локально</button>
        </div>

        <div class="card">
            <div class="card-header">
                <div class="card-title">Справка и подсказки</div>
                <span class="badge badge-context">Интерфейс</span>
            </div>
            <div class="btn-group">
                <button class="secondary" onclick="restoreQuickStart()">Показать памятку «Быстрый старт»</button>
                <button class="secondary" onclick="openWelcomeModal()">Открыть вводный гид</button>
            </div>
        </div>
    </div>

    <!-- Шпаргалка по горячим клавишам (Футер) -->
    <div class="hotkeys-footer">
        <div class="hotkeys-footer-title">Горячие клавиши:</div>
        <div class="hotkey-item" title="В редакторе BSL: примите предложенный фрагмент автодополнения"><kbd>Tab</kbd><span>Автодополнение</span></div>
        <div class="hotkey-item" title="Быстрый вызов генератора запросов 1С"><kbd>Ctrl+Alt+Q</kbd><span>Запрос</span></div>
        <div class="hotkey-item" title="Интеграция с TurboConf и Конфигуратором 1С"><kbd>Ctrl+Alt+Space</kbd><span>TurboConf</span></div>
    </div>
    </div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>

    <script>
        const NL = String.fromCharCode(10);
        const vscode = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : {
            postMessage: function(msg) {
                console.log('[1C Copilot Preview Action]', msg);
                if (typeof handleMockPreviewAction === 'function') {
                    handleMockPreviewAction(msg);
                }
            },
            getState: function() { return {}; },
            setState: function() {}
        };

        function handleMockPreviewAction(msg) {
            if (msg.type === 'copyToClipboard') {
                if (navigator.clipboard) { navigator.clipboard.writeText(msg.text); }
                showToast('✓ Скопировано в буфер обмена!');
            } else if (msg.type === 'insertCode') {
                showToast('✓ Вставка в активный BSL-модуль');
            } else if (msg.type === 'saveKey') {
                showToast('✓ Ключ сохранен в SecretStorage');
            } else if (msg.type === 'changeModel') {
                showToast('✓ Модель переключена: ' + msg.model);
            } else if (msg.type === 'refactorQuery') {
                setTimeout(() => {
                    const lines = [
                        '// ====================================================================',
                        '// ОПТИМИЗИРОВАННЫЙ ПАКЕТ ЗАПРОСОВ (ПО СТАНДАРТАМ ИТС 1С)',
                        '// 1. Создана временная таблица ВТ_Товары с явной индексацией',
                        '// 2. Исключено прямое соединение с виртуальной таблицей',
                        '// 3. Результат выборки защищен конструкцией ЕСТЬNULL',
                        '// ====================================================================',
                        '',
                        'ВЫБРАТЬ',
                        '    ДокументТаблица.Номенклатура КАК Номенклатура,',
                        '    ДокументТаблица.Количество КАК Количество',
                        'ПОМЕСТИТЬ ВТ_Товары',
                        'ИЗ',
                        '    &ТаблицаТовары КАК ДокументТаблица',
                        'ИНДЕКСИРОВАТЬ ПО',
                        '    Номенклатура',
                        ';',
                        '',
                        '////////////////////////////////////////////////////////////////////////////////',
                        'ВЫБРАТЬ',
                        '    ВТ.Номенклатура КАК Номенклатура,',
                        '    ВТ.Количество КАК ТребуемоеКоличество,',
                        '    ЕСТЬNULL(Остатки.КоличествоОстаток, 0) КАК ТекущийОстаток',
                        'ИЗ',
                        '    ВТ_Товары КАК ВТ',
                        '    ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.ТоварыНаСкладах.Остатки(',
                        '        &МоментВремени,',
                        '        Номенклатура В (ВЫБРАТЬ ВТ.Номенклатура ИЗ ВТ_Товары КАК ВТ)',
                        '    ) КАК Остатки',
                        '    ПО ВТ.Номенклатура = Остатки.Номенклатура;'
                    ];
                    window.dispatchEvent(new MessageEvent('message', {
                        data: {
                            type: 'refactorResult',
                            code: lines.join(NL),
                            optimizations: ['Виртуальная таблица параметризована', 'Создана ВТ_Товары с ИНДЕКСИРОВАТЬ ПО', 'Добавлена защита ЕСТЬNULL']
                        }
                    }));
                }, 120);
            } else if (msg.type === 'generateQuery') {
                setTimeout(() => {
                    const lines = [
                        '// Сформированный пакет запроса по стандартам ИТС 1С',
                        'Запрос = Новый Запрос;',
                        'Запрос.Текст = ',
                        '    "ВЫБРАТЬ',
                        '    |    ТЧ.Номенклатура КАК Номенклатура,',
                        '    |    ТЧ.Склад КАК Склад,',
                        '    |    СУММА(ТЧ.Количество) КАК Количество',
                        '    |ПОМЕСТИТЬ ВТ_ТоварыДокумента',
                        '    |ИЗ',
                        '    |    &ТабличнаяЧасть КАК ТЧ',
                        '    |СГРУППИРОВАТЬ ПО',
                        '    |    ТЧ.Номенклатура,',
                        '    |    ТЧ.Склад',
                        '    |ИНДЕКСИРОВАТЬ ПО',
                        '    |    Номенклатура,',
                        '    |    Склад',
                        '    |;',
                        '    |////////////////////////////////////////////////////////////////////////////////',
                        '    |ВЫБРАТЬ',
                        '    |    ВТ.Номенклатура КАК Номенклатура,',
                        '    |    ВТ.Склад КАК Склад,',
                        '    |    ВТ.Количество КАК КоличествоПлан,',
                        '    |    ЕСТЬNULL(Остатки.КоличествоОстаток, 0) КАК КоличествоФакт',
                        '    |ИЗ',
                        '    |    ВТ_ТоварыДокумента КАК ВТ',
                        '    |    ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.ТоварыНаСкладах.Остатки(',
                        '    |        &ГраницаОстатков,',
                        '    |        (Номенклатура, Склад) В (',
                        '    |            ВЫБРАТЬ ВТ.Номенклатура, ВТ.Склад ИЗ ВТ_ТоварыДокумента КАК ВТ',
                        '    |        )',
                        '    |    ) КАК Остатки',
                        '    |    ПО ВТ.Номенклатура = Остатки.Номенклатура',
                        '    |    И ВТ.Склад = Остатки.Склад";',
                        '',
                        'Запрос.УстановитьПараметр("ГраницаОстатков", ?(РежимПроведения = РежимПроведенияДокумента.Оперативный, Неопределено, МоментВремени()));',
                        'Запрос.УстановитьПараметр("ТабличнаяЧасть", Товары.Выгрузить());',
                        'Результат = Запрос.Выполнить();'
                    ];
                    window.dispatchEvent(new MessageEvent('message', {
                        data: {
                            type: 'queryResult',
                            code: lines.join(NL)
                        }
                    }));
                }, 120);
            } else if (msg.type === 'generateBatchTemplate') {
                setTimeout(() => {
                    const entity = msg.entity || 'РеализацияТоваровУслуг';
                    const tabular = msg.tabular || 'Товары';
                    const register = msg.register || 'ТоварыНаСкладах';
                    const registerType = msg.registerType || 'Остатки';
                    const isInfoReg = registerType === 'СрезПоследних' || registerType === 'СрезПервых' || register.startsWith('РегистрСведений.');
                    const regKind = isInfoReg ? 'РегистрСведений' : 'РегистрНакопления';
                    const cleanReg = register.replace(/^(РегистрНакопления|РегистрСведений)\./, '');
                    const resField = isInfoReg ? 'Значение' : (registerType === 'Обороты' ? 'КоличествоОборот' : 'КоличествоОстаток');

                    const lines = [
                        '// Шаблон проведения документа ' + entity,
                        'Движения.' + cleanReg + '.Записывать = Истина;',
                        isInfoReg ? '' : 'Движения.' + cleanReg + '.БлокироватьДляИзменения = Истина;',
                        '',
                        'Запрос = Новый Запрос;',
                        'Запрос.МенеджерВременныхТаблиц = Новый МенеджерВременныхТаблиц;',
                        'Запрос.Текст = ',
                        '    "ВЫБРАТЬ',
                        '    |    ДокументТаблица.Номенклатура КАК Номенклатура,',
                        '    |    СУММА(ДокументТаблица.Количество) КАК Количество',
                        '    |ПОМЕСТИТЬ ВТ_Товары',
                        '    |ИЗ',
                        '    |    Документ.' + entity + '.' + tabular + ' КАК ДокументТаблица',
                        '    |ГДЕ',
                        '    |    ДокументТаблица.Ссылка = &Ссылка',
                        '    |СГРУППИРОВАТЬ ПО',
                        '    |    ДокументТаблица.Номенклатура',
                        '    |ИНДЕКСИРОВАТЬ ПО',
                        '    |    Номенклатура',
                        '    |;',
                        '    |////////////////////////////////////////////////////////////////////////////////',
                        '    |ВЫБРАТЬ',
                        '    |    ВТ.Номенклатура КАК Номенклатура,',
                        '    |    ВТ.Количество КАК Требуется,',
                        '    |    ЕСТЬNULL(Остатки.' + resField + ', 0) КАК ' + (isInfoReg ? 'Значение' : 'Остаток'),
                        '    |ИЗ',
                        '    |    ВТ_Товары КАК ВТ',
                        '    |    ЛЕВОЕ СОЕДИНЕНИЕ ' + regKind + '.' + cleanReg + '.' + registerType + '(',
                        '    |        &МоментВремени,',
                        '    |        Номенклатура В (ВЫБРАТЬ ВТ.Номенклатура ИЗ ВТ_Товары КАК ВТ)',
                        '    |    ) КАК Остатки',
                        '    |    ПО ВТ.Номенклатура = Остатки.Номенклатура";',
                        '',
                        'Запрос.УстановитьПараметр("Ссылка", ЭтотОбъект.Ссылка);',
                        'Запрос.УстановитьПараметр("МоментВремени", ЭтотОбъект.МоментВремени());',
                        'Выборка = Запрос.Выполнить().Выбрать();'
                    ].filter(l => l !== '');
                    const out = document.getElementById('batchOutput');
                    if (out) {
                        out.style.display = 'block';
                        out.innerText = lines.join(NL);
                        const act = document.getElementById('batchActions');
                        if (act) act.style.display = 'flex';
                    }
                    window.dispatchEvent(new MessageEvent('message', {
                        data: {
                            type: 'batchResult',
                            code: lines.join(NL)
                        }
                    }));
                    showToast('✓ Шаблон проведения сформирован');
                }, 100);
            } else if (msg.type === 'generateExtension') {
                setTimeout(() => {
                    const lines = [
                        '&' + (msg.directive || 'Вместо') + '("' + (msg.method || 'ОбработкаПроведения') + '")',
                        'Процедура Расш_' + (msg.method || 'ОбработкаПроведения') + '(' + (msg.params || 'Отказ, РежимПроведения') + ')',
                        '    // Контроль условий перед вызовом типовой процедуры',
                        '    Если Отказ Тогда',
                        '        Возврат;',
                        '    КонецЕсли;',
                        '',
                        '    // Безопасный вызов типовой процедуры платформы',
                        '    ПродолжитьВызов(' + (msg.params || 'Отказ, РежимПроведения') + ');',
                        '',
                        '    // Пользовательский алгоритм расширения (&cfe)',
                        '    // Дополнительные движения и заполнение реквизитов...',
                        'КонецПроцедуры'
                    ];
                    window.dispatchEvent(new MessageEvent('message', {
                        data: {
                            type: 'extensionResult',
                            code: lines.join(NL)
                        }
                    }));
                }, 120);
            } else if (msg.type === 'generateFormButton') {
                setTimeout(() => {
                    const cmd = msg.commandName || 'КомандаПечатиАкта';
                    const title = msg.title || 'Печать акта';
                    const btn = msg.buttonName || 'КнопкаПечатиАкта';
                    const lines = [
                        '&НаСервере',
                        'Процедура Расш_ПриСозданииНаСервере(Отказ, СтандартнаяОбработка)',
                        '    // Программное добавление команды формы в расширении',
                        '    Команда = ЭтаФорма.Команды.Добавить("' + cmd + '");',
                        '    Команда.Действие = "Расш_' + cmd + '";',
                        '    Команда.Заголовок = "' + title + '";',
                        '',
                        '    // Программное добавление кнопки в командную панель формы',
                        '    Кнопка = ЭтаФорма.Элементы.Добавить("' + btn + '", Тип("КнопкаФормы"), ЭтаФорма.КоманднаяПанель);',
                        '    Кнопка.ИмяКоманды = "' + cmd + '";',
                        '    Кнопка.Вид = ВидКнопкиФормы.КнопкаКоманднойПанели;',
                        'КонецПроцедуры',
                        '',
                        '&НаКлиенте',
                        'Процедура Расш_' + cmd + '(Команда)',
                        '    // Обработчик команды формы',
                        '    ПоказатьОповещениеПользователя("' + title + '", , "Команда успешно выполнена.");',
                        'КонецПроцедуры'
                    ];
                    const out = document.getElementById('btnFormOutput');
                    if (out) {
                        out.style.display = 'block';
                        out.innerText = lines.join(NL);
                        const act = document.getElementById('btnFormActions');
                        if (act) act.style.display = 'flex';
                    }
                    showToast('✓ Код кнопки формы сформирован');
                }, 120);
            } else if (msg.type === 'auditSelection' || msg.type === 'auditCodeSnippet') {
                setTimeout(() => {
                    window.dispatchEvent(new MessageEvent('message', {
                        data: {
                            type: 'auditResult',
                            issues: [
                                { rule: 'ITS-PERF-001', severity: 'error', line: 2, message: 'Запрос внутри цикла: создание и выполнение запроса в цикле «Для Каждого» создает квадратичную нагрузку на СУБД.', suggestion: 'Выгрузите ссылки в массив и выполните один пакетный запрос с временной таблицей за пределами цикла.' },
                                { rule: 'ITS-LOCK-001', severity: 'warning', line: 7, message: 'Отсутствует управляемая блокировка данных БлокировкаДанных перед записью движений документа.', suggestion: 'Добавьте Блокировка = Новый БлокировкаДанных; Элемент = Блокировка.Добавить("РегистрНакопления.ТоварыНаСкладах");' },
                                { rule: 'ITS-BSP-001', severity: 'info', line: 12, message: 'Использование прямого обращения Ссылка.ПолучитьОбъект() вместо вызова БСП.', suggestion: 'Замените на ОбщегоНазначения.ЗначениеРеквизитаОбъекта(Ссылка, "Артикул").' }
                            ]
                        }
                    }));
                }, 120);
            } else if (msg.type === 'generateBdd') {
                setTimeout(() => {
                    const entity = msg.entity || 'Реализация товаров и услуг';
                    const tabular = msg.tabular || 'Товары';
                    const register = msg.register || 'ТоварыНаСкладах';
                    const lines = [
                        '# language: ru',
                        '',
                        'Функционал: Проведение документа ' + entity,
                        '  Как Менеджер по продажам',
                        '  Я хочу проводить документы с контролем остатков номенклатуры',
                        '  Чтобы исключить образование отрицательных остатков на складе',
                        '',
                        '  Контекст:',
                        '    Дано Я открыл сеанс пользователя "Администратор"',
                        '    И Я открыл навигационную панель',
                        '',
                        '  Сценарий: Проверка контроля отрицательных остатков при оперативном проведении',
                        '    Когда в командном интерфейсе я выбираю "Продажи" -> "Документы реализации"',
                        '    И Я нажимаю на кнопку "Создать"',
                        '    И В табличной части "' + tabular + '" добавляю строки:',
                        '      | Номенклатура     | Количество | Склад            |',
                        '      | "Товар тестовый" | 100        | "Основной склад" |',
                        '    И Я нажимаю на кнопку "Провести"',
                        '    Тогда открылось окно предупреждения "Недостаточно остатка по регистру ' + register + '"',
                        '    И Документ не проведен в информационной базе'
                    ];
                    const out = document.getElementById('bddOutput');
                    if (out) {
                        out.style.display = 'block';
                        out.innerText = lines.join(NL);
                        const act = document.getElementById('bddActions');
                        if (act) act.style.display = 'flex';
                    }
                    showToast('✓ BDD сценарий сформирован');
                }, 120);
            } else if (msg.type === 'analyzeTechLog') {
                setTimeout(() => {
                    const st = document.getElementById('techlogStatus');
                    if (st) st.innerText = 'Анализ завершен (2 события локализовано)';
                    const lines = [
                        '=== РЕЗУЛЬТАТ ДИАГНОСТИКИ ТЕХНОЛОГИЧЕСКОГО ЖУРНАЛА ===',
                        '',
                        '1. Инцидент: TLOCK (Транзакционная блокировка данных)',
                        '   - Ресурс: AccumRegister.ТоварыНаСкладах',
                        '   - Режим: Exclusive (Монопольная блокировка на запись)',
                        '   - Длительность ожидания: 1.42 сек (КРИТИЧЕСКИ ВЫСОКАЯ)',
                        '   - Очередь ожидающих сеансов: 14 пользователей',
                        '   - Модуль: Документ.РеализацияТоваровУслуг.МодульОбъекта : 142',
                        '',
                        '2. Архитектурные рекомендации по устранению:',
                        '   • Перевести регистр в управляемый режим блокировок данных;',
                        '   • Добавить сортировку строк табличной части документа по Номенклатуре перед записью движений;',
                        '   • Вынести чтение остатков в самое начало транзакции с предварительной установкой БлокировкаДанных.'
                    ];
                    const out = document.getElementById('techlogOutput');
                    if (out) {
                        out.style.display = 'block';
                        out.innerText = lines.join(NL);
                    }
                }, 120);
            } else if (msg.type === 'scanMetadata') {
                const box = document.getElementById('metadataSummaryBox');
                if (box) {
                    box.innerText = [
                    '✓ Структура метаданных конфигурации просканирована:',
                    '  • Справочники: 18 объектов',
                    '  • Документы: 14 объектов',
                    '  • Регистры накопления: 18 объектов',
                    '  • Регистры сведений: 5 объектов',
                    '  • Общие модули: 40 объектов БСП'
                ].join(NL);
                }
                showToast('✓ Метаданные загружены в контекст');
            } else if (msg.type === 'checkSidecarStatus') {
                const ind = document.getElementById('sidecarStatusIndicator');
                if (ind) {
                    ind.innerHTML = '<span class="badge badge-ok">● Sidecar активен и принимает запросы (127.0.0.1:18833)</span>';
                }
                showToast('✓ 1C Sidecar на связи');
            } else if (msg.type === 'openBilling') {
                window.open('https://normahub.cc', '_blank');
            }
        }
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
            document.getElementById('themeBtn').setAttribute('aria-label', theme === 'warm-sand' ? 'Включить тёмную тему' : 'Включить светлую тему');
        }

        function applySidebarStatus(message) {
            const gatewayBadge = document.getElementById('gatewayStatusBadge');
            const gatewayBalance = document.getElementById('gatewayBalanceDisplay');
            const metadataDot = document.getElementById('metadataRailDot');
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
            workspaceTools.filter(tool => !query || (tool.name + ' ' + tool.description + ' ' + tool.group).toLowerCase().includes(query))
                .forEach(tool => (groups[tool.group] ||= []).push(tool));
            Object.entries(groups).forEach(([group, tools]) => {
                const section = document.createElement('section');
                section.className = 'catalog-group';
                section.innerHTML = '<h2>' + group + '</h2>';
                const grid = document.createElement('div');
                grid.className = 'catalog-grid';
                tools.forEach(tool => {
                    const card = document.createElement('button');
                    card.type = 'button';
                    card.className = 'catalog-card';
                    card.innerHTML = '<span class="catalog-symbol">' + tool.symbol + '</span><span class="catalog-card-copy"><strong>' + tool.name + '</strong><small>' + tool.description + '</small></span><span class="catalog-mode">' + tool.mode + '</span>';
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

        function launchToolWithSample(toolId, sampleType) {
            selectSubTool(toolId);
            if (toolId === 'queries-refactor' && typeof loadSampleRefactor === 'function') {
                loadSampleRefactor(sampleType);
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
            if (code && code.trim()) {
                vscode.postMessage({ type: 'insertCode', code });
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

        // Queries Tab
        function setQueryIntent(text, focusInput = false) {
            document.getElementById('queryIntent').value = text;
            if (focusInput) document.getElementById('queryIntent').focus();
            document.getElementById('queryIntent').dispatchEvent(new Event('input', { bubbles: true }));
        }

        function generateQuery() {
            const intent = document.getElementById('queryIntent').value;
            if (document.getElementById('btnSendCockpitPrompt').disabled) return;
            if (!intent.trim()) return;
            clearCockpitOutput();
            document.getElementById('queryActions').style.display = 'none';
            setQueryBusy(true);
            document.getElementById('queryStatus').innerText = 'Генерация через NormaHub...';
            vscode.postMessage({ type: 'generateQuery', intent });
        }

        function refactorQuery() {
            const rawQuery = document.getElementById('refactorInput').value;
            if (!rawQuery.trim()) return;
            document.getElementById('refactorOutput').style.display = 'none';
            document.getElementById('refactorActions').style.display = 'none';
            clearCockpitOutput();
            document.getElementById('refactorStatus').innerText = 'Рефакторинг по стандартам ИТС...';
            vscode.postMessage({ type: 'refactorQuery', rawQuery });
        }

        function generateBatch() {
            const entity = document.getElementById('batchEntity').value.trim() || 'РеализацияТоваровУслуг';
            const tabular = document.getElementById('batchTabular').value.trim() || 'Товары';
            const register = document.getElementById('batchRegister').value.trim() || 'ТоварыНаСкладах';
            const registerType = document.getElementById('batchRegisterType').value;
            vscode.postMessage({ type: 'generateBatchTemplate', entity, tabular, register, registerType });
        }

        // Sample Loaders
        function loadSampleRefactor(type) {
            const input = document.getElementById('refactorInput');
            if (!input) return;
            if (type === 'virtual_join') {
                const sampleLines = [
                    'ВЫБРАТЬ',
                    '    ДокументТовары.Номенклатура КАК Номенклатура,',
                    '    ДокументТовары.Количество КАК Количество,',
                    '    Остатки.КоличествоОстаток КАК Остаток',
                    'ИЗ',
                    '    Документ.РеализацияТоваровУслуг.Товары КАК ДокументТовары',
                    '    ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.ТоварыНаСкладах.Остатки КАК Остатки',
                    '        ПО ДокументТовары.Номенклатура = Остатки.Номенклатура',
                    'ГДЕ',
                    '    ДокументТовары.Ссылка = &Ссылка'
                ];
                input.value = sampleLines.join(NL);
            } else {
                const sampleLines = [
                    'ВЫБРАТЬ',
                    '    Реализация.Ссылка КАК Документ,',
                    '    Реализация.СуммаДокумента КАК Сумма',
                    'ИЗ',
                    '    Документ.РеализацияТоваровУслуг КАК Реализация',
                    'ГДЕ',
                    '    Реализация.Контрагент В (',
                    '        ВЫБРАТЬ Контрагент ИЗ Справочник.Контрагенты ГДЕ Недействителен = Истина',
                    '    )'
                ];
                input.value = sampleLines.join(NL);
            }
            showToast('✓ Пример запроса загружен в поле');
        }

        function loadSampleAudit(type) {
            const input = document.getElementById('auditSnippetInput');
            if (!input) return;
            if (type === 'loop_and_modal') {
                const sampleLines = [
                    'Для Каждого Стр Из Объект.Товары Цикл',
                    '    Запрос = Новый Запрос;',
                    '    Запрос.Текст = "ВЫБРАТЬ Цена ИЗ РегистрСведений.ЦеныНоменклатуры.СрезПоследних(&Период, Номенклатура = &Номенклатура)";',
                    '    Запрос.УстановитьПараметр("Период", ТекущаяДата());',
                    '    Запрос.УстановитьПараметр("Номенклатура", Стр.Номенклатура);',
                    '    Выборка = Запрос.Выполнить().Выбрать();',
                    '    Если Выборка.Следующий() Тогда',
                    '        Стр.Цена = Выборка.Цена;',
                    '    КонецЕсли;',
                    'КонецЦикла;',
                    '',
                    'Предупреждение("Цены успешно пересчитаны!");'
                ];
                input.value = sampleLines.join(NL);
            } else {
                const sampleLines = [
                    'Выборка = Справочники.Номенклатура.Выбрать();',
                    'Пока Выборка.Следующий() Цикл',
                    '    ОбъектНоменклатуры = Выборка.Ссылка.ПолучитьОбъект();',
                    '    ОбъектНоменклатуры.Недействителен = Ложь;',
                    '    ОбъектНоменклатуры.Записать();',
                    'КонецЦикла;'
                ];
                input.value = sampleLines.join(NL);
            }
            showToast('✓ Тестовый BSL-пример загружен');
        }

        function copyPromoCode() {
            vscode.postMessage({ type: 'copyToClipboard', text: '1CPROMO' });
            showToast('✓ Промокод 1CPROMO скопирован!');
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
                       m.description.toLowerCase().includes(query);
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
                    <div class="bsp-desc">\${m.description}</div>
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
            vscode.postMessage({ type: 'insertCode', code });
        }

        function copySnippet(enc) {
            const code = decodeURIComponent(enc);
            vscode.postMessage({ type: 'copyToClipboard', text: code });
            showToast('✓ Сниппет скопирован!');
        }

        // Extensions Tab
        function generateExt() {
            const method = document.getElementById('extMethod').value.trim() || 'ОбработкаПроведения';
            const directive = document.getElementById('extDirective').value;
            const params = document.getElementById('extParams').value.trim() || 'Отказ, РежимПроведения';
            vscode.postMessage({ type: 'generateExtension', method, directive, params });
        }

        function generateFormBtn() {
            const buttonName = document.getElementById('btnFormName').value.trim() || 'КнопкаПечатиАкта';
            const title = document.getElementById('btnFormTitle').value.trim() || 'Печать акта';
            const commandName = document.getElementById('btnFormCmd').value.trim() || 'КомандаПечатиАкта';
            vscode.postMessage({ type: 'generateFormButton', buttonName, title, commandName });
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
            const entity = document.getElementById('bddEntity').value.trim() || 'Реализация товаров и услуг';
            const tabular = document.getElementById('bddTabular').value.trim() || 'Товары';
            const register = document.getElementById('bddRegister').value.trim() || 'ТоварыНаСкладах';
            const prompt = document.getElementById('bddPrompt').value.trim();
            vscode.postMessage({ type: 'generateBdd', entity, tabular, register, prompt, openEditor });
        }

        // Tech Log
        function loadDemoTLog(type) {
            const samples = {
                'TLOCK': '04:12.123000-1420000,TLOCK,3,process=rphost,t:clientID=12,Regions=AccumRegister.ТоварыНаСкладах,WaitConnections=14,Context=Документ.РеализацияТоваровУслуг.МодульОбъекта : 142',
                'TDEADLOCK': '12:45.892000-0,TDEADLOCK,4,process=rphost,WaitConnections=18,Context=Документ.ЗаказКлиента.МодульОбъекта : 88,Regions=Doc.ЗаказКлиента,AccumRegister.ТоварыНаСкладах',
                'EXCP': '08:15.004000-0,EXCP,2,process=rphost,ClientID=9,Exception=RuntimeError,Descr="Попытка передачи мутабельного значения типа ТаблицаЗначений с клиента на сервер",Context=Форма.ФормаДокумента.Модуль : 54',
                'DBPOSTGR': '19:22.451000-8450000,DBPOSTGR,3,process=rphost,Sql="SELECT * FROM _AccumReg1234 WHERE _Period >= \\'2026-01-01\\'",Context=РегистрНакопления.ТоварыНаСкладах.МодульМенеджера : 110'
            };
            document.getElementById('techlogInput').value = samples[type] || '';
        }

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
            vscode.postMessage({ type: 'changeModel', model });
        }
        function openBilling() { vscode.postMessage({ type: 'openBilling' }); }
        function openB2B() { vscode.postMessage({ type: 'openB2B' }); }

        // ==========================================
        // ACTION PILOT CLIENT CONTROLLERS
        // ==========================================
        let currentCockpitCode = '';
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
            document.querySelectorAll('.context-required-action, button[onclick^="insertCodeFrom"], button[onclick^="insertBspSnippet"]').forEach(btn => {
                btn.disabled = !hasBslContext;
                btn.title = hasBslContext ? '' : 'Сначала откройте BSL-модуль в редакторе';
            });
            const target = document.getElementById('cockpitTarget');
            if (target) target.innerText = hasBslContext
                ? 'Вставить в ' + currentEditorContext.fileName + ' в позиции курсора. Выделение не заменяется.'
                : 'Откройте BSL-модуль для вставки. Копирование доступно без редактора.';
        }

        function refreshEditorContext() {
            vscode.postMessage({ type: 'getEditorContext' });
            showToast('✓ Контекст редактора обновлен');
        }

        function showInCockpitStudio(code, badgeText, metaText) {
            currentCockpitCode = code || '';
            const studio = document.getElementById('cockpitOutputStudio');
            const badge = document.getElementById('cockpitBadge');
            const meta = document.getElementById('cockpitMeta');
            const pre = document.getElementById('cockpitCodePre');
            const target = document.getElementById('cockpitTarget');
            if (!studio) return;

            if (badge) badge.innerText = badgeText || '✓ Код сформирован по стандартам ИТС';
            const linesCount = currentCockpitCode.split(NL).length;
            if (meta) meta.innerText = linesCount + ' строк BSL' + (metaText ? ' • ' + metaText : '');
            if (pre) pre.innerText = currentCockpitCode;
            if (target) {
                target.innerText = currentEditorContext && currentEditorContext.isBsl
                    ? 'Результат можно вставить в активный BSL-модуль в позиции курсора или скопировать вручную.'
                    : 'BSL-модуль не выбран: скопируйте результат или откройте .bsl/.os перед вставкой.';
            }

            studio.style.display = 'block';
            studio.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        function insertCockpitCode() {
            if (!currentCockpitCode) return;
            if (!currentEditorContext || !currentEditorContext.isBsl) {
                showToast('Откройте BSL-модуль перед вставкой кода');
                return;
            }
            vscode.postMessage({ type: 'insertCode', code: currentCockpitCode });
        }

        function copyCockpitCode() {
            if (!currentCockpitCode) return;
            vscode.postMessage({ type: 'copyToClipboard', text: currentCockpitCode });
            if (navigator.clipboard) { navigator.clipboard.writeText(currentCockpitCode); }
            showToast('✓ Код скопирован в буфер обмена!');
        }

        function clearCockpitOutput() {
            currentCockpitCode = '';
            const studio = document.getElementById('cockpitOutputStudio');
            if (studio) studio.style.display = 'none';
        }

        function syncModelSelection(val) {
            const mainSel = document.getElementById('modelSelector');
            if (mainSel && mainSel.value !== val) {
                mainSel.value = val;
                changeModel();
            } else {
                vscode.postMessage({ type: 'changeModel', model: val });
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
                showToast('✓ Конструктор проведения открыт');
                return;
            }
        }

        function setQueryBusy(busy) {
            document.getElementById('btnSendCockpitPrompt').disabled = busy;
            document.querySelector('button[onclick="generateQuery()"]').disabled = busy;
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

        // Host Message Listener
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'sidebarStatus') {
                applySidebarStatus(message);
            } else if (message.type === 'editorContext') {
                updateEditorContextUI(message);
            } else if (message.type === 'toast' && message.message) {
                showToast(message.message);
            } else if (message.type === 'queryResult') {
                setQueryBusy(false);
                document.getElementById('queryStatus').innerText = '';
                const cockpitStatus = document.getElementById('cockpitPromptStatus');
                if (cockpitStatus) {
                    cockpitStatus.innerText = message.error ? message.error : 'Готово. Проверьте результат перед вставкой.';
                    cockpitStatus.dataset.state = message.error ? 'error' : 'success';
                }
                const box = document.getElementById('queryOutput');
                box.style.display = message.code || message.error ? 'block' : 'none';
                box.innerText = message.code || message.error || '';
                document.getElementById('queryActions').style.display = message.code ? 'flex' : 'none';
                if (message.code) showInCockpitStudio(message.code, 'Пакет запроса сформирован', 'Сформировано ИИ');
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
                    let out = message.code;
                    if (message.optimizations && message.optimizations.length) {
                        out = '// ПРИМЕНЕННЫЕ ОПТИМИЗАЦИИ ИТС:' + NL + '// ' + message.optimizations.join(NL + '// ') + NL + NL + out;
                    }
                    box.innerText = out;
                    document.getElementById('refactorActions').style.display = 'flex';
                    showInCockpitStudio(out, '✓ Запрос оптимизирован по стандартам ИТС', (message.optimizations ? message.optimizations.length + ' улучшений' : ''));
                }
            } else if (message.type === 'batchResult') {
                const box = document.getElementById('batchOutput');
                if (box) {
                    box.style.display = 'block';
                    box.innerText = message.code || '';
                    const act = document.getElementById('batchActions');
                    if (act) act.style.display = 'flex';
                }
                if (message.code) {
                    showInCockpitStudio(message.code, '✓ Модуль проведения сформирован', 'Блокировка + остатки');
                }
            } else if (message.type === 'extensionResult') {
                const box = document.getElementById('extOutput');
                box.style.display = 'block';
                box.innerText = message.code || '';
                document.getElementById('extActions').style.display = 'flex';
                if (message.code) {
                    showInCockpitStudio(message.code, '✓ Перехват &cfe сформирован', '&Вместо + ПродолжитьВызов');
                }
            } else if (message.type === 'formBtnResult') {
                const box = document.getElementById('btnFormOutput');
                if (box) {
                    box.style.display = 'block';
                    box.innerText = message.code || '';
                    const act = document.getElementById('btnFormActions');
                    if (act) act.style.display = 'flex';
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
                        line.textContent = 'Строка ' + iss.line;
                        if (message.canJump !== false) line.addEventListener('click', () => jumpTo(iss.line));
                        const description = document.createElement('div');
                        description.textContent = iss.message;
                        const suggestion = document.createElement('div');
                        suggestion.textContent = 'Рекомендация: ' + iss.suggestion;
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
                const box = document.getElementById('bddOutput');
                box.style.display = 'block';
                box.innerText = message.feature || '';
                document.getElementById('bddActions').style.display = 'flex';
            } else if (message.type === 'techLogResult') {
                document.getElementById('techlogStatus').innerText = '';
                const box = document.getElementById('techlogOutput');
                box.style.display = 'block';
                box.innerText = message.report || '';
            } else if (message.type === 'metadataResult') {
                const box = document.getElementById('metadataSummaryBox');
                box.innerText = message.summary || \`Обнаружено объектов: \${message.objectsCount}\`;
            } else if (message.type === 'sidecarStatus') {
                const ind = document.getElementById('sidecarStatusIndicator');
                ind.textContent = message.online
                    ? 'Sidecar подключен · версия ' + (message.info?.version || 'неизвестна')
                    : 'Sidecar недоступен. ' + (message.error || 'Запустите: python3 -m sidecar.main');
            }
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
        vscode.postMessage({ type: 'webviewReady' });
    </script>
</body>
</html>`;
    }
}
