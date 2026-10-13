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

export class NormaHub1CSidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

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
            const balanceInfo = await NormaHubClient.checkBalance(apiKey);
            const config = vscode.workspace.getConfiguration('normahub1c');
            const selectedModel = config.get<string>('autocompleteModel', 'deepseek-v4.1-flash');
            webviewView.webview.html = this._getHtmlForWebview(apiKey, balanceInfo, selectedModel);
        };

        await updateHtml();

        const sendEditorContext = () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document) {
                const docName = editor.document.fileName.split(/[/\\]/).pop() || 'Модуль.bsl';
                const isBsl = docName.endsWith('.bsl') || docName.endsWith('.os');
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

                case 'saveKey':
                    await NormaHubClient.setApiKey(this._context, data.value);
                    vscode.window.showInformationMessage('API-ключ сохранен в защищенном SecretStorage.');
                    await updateHtml();
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
    }

    private async _handleChangeModel(model: string) {
        const config = vscode.workspace.getConfiguration('normahub1c');
        await config.update('autocompleteModel', model, vscode.ConfigurationTarget.Global);
        await config.update('reasoningModel', model, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Модель NormaHub изменена на ${model}`);
    }

    private async _handleGenerateQuery(intent: string) {
        if (!this._view) return;
        const apiKey = await NormaHubClient.getApiKey(this._context);
        if (!apiKey) {
            this._view.webview.postMessage({ type: 'queryResult', error: 'API-ключ не задан. Укажите ключ во вкладке «Баланс».' });
            return;
        }

        const config = vscode.workspace.getConfiguration('normahub1c');
        const model = config.get<string>('reasoningModel', 'gpt-6.1-sol');

        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const metadata = await MetadataScanner.scanWorkspace(rootPath);
        const metaSummary = MetadataScanner.formatForPrompt(metadata);
        const bspSummary = BSPHelper.getBSPPromptInjection();
        const multiTabContext = MultiTabScanner.getOpenModulesContext();

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

        try {
            this._view.webview.postMessage({ type: 'queryStatus', text: 'Генерация пакета запросов через NormaHub...' });
            const result = await NormaHubClient.complete(apiKey, model, systemPrompt, intent, 0.1, 1500);
            this._view.webview.postMessage({ type: 'queryResult', code: result });
        } catch (err: any) {
            this._view.webview.postMessage({ type: 'queryResult', error: err.message });
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

        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, code);
            });
            vscode.window.showInformationMessage('Шаблон пакетного запроса вставлен в редактор.');
        } else {
            this._view?.webview.postMessage({ type: 'batchResult', code });
        }
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

        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, code);
            });
            vscode.window.showInformationMessage(`Перехват &${directive} вставлен в редактор.`);
        } else {
            this._view?.webview.postMessage({ type: 'extensionResult', code });
        }
    }

    private async _handleGenerateFormButton(buttonName: string, title: string, commandName: string) {
        const code = ExtensionGenerator.generateFormButtonExtension(
            buttonName || 'КнопкаПечатиАкта',
            title || 'Печать акта',
            commandName || 'КомандаПечатиАкта'
        );
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, code);
            });
            vscode.window.showInformationMessage('Код формы расширения вставлен в редактор.');
        } else {
            this._view?.webview.postMessage({ type: 'formBtnResult', code });
        }
    }

    private async _handleAuditSelection() {
        if (!this._view) return;
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this._view.webview.postMessage({ type: 'auditResult', report: 'Откройте модуль BSL для анализа.' });
            return;
        }

        const code = editor.selection.isEmpty
            ? editor.document.getText()
            : editor.document.getText(editor.selection);

        const issues = StandardsChecker.auditCode(code);
        const report = StandardsChecker.formatAuditReport(issues);
        this._view.webview.postMessage({ type: 'auditResult', issues, report });
    }

    private async _handleAuditCodeSnippet(code: string) {
        if (!this._view) return;
        if (!code || !code.trim()) {
            this._view.webview.postMessage({ type: 'auditResult', report: 'Вставьте код для проверки.' });
            return;
        }
        const issues = StandardsChecker.auditCode(code);
        const report = StandardsChecker.formatAuditReport(issues);
        this._view.webview.postMessage({ type: 'auditResult', issues, report });
    }

    private async _handleJumpToLine(lineNumber: number) {
        const editor = vscode.window.activeTextEditor;
        if (editor && lineNumber > 0) {
            const line = Math.max(0, lineNumber - 1);
            const pos = new vscode.Position(line, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
    }

    private async _handleInsertCode(code: string) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            await editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, code);
            });
            vscode.window.showInformationMessage('Код успешно вставлен в модуль 1С.');
            if (this._view) {
                this._view.webview.postMessage({ type: 'toast', message: '✓ Код успешно вставлен в активный BSL-модуль' });
            }
        } else {
            vscode.window.showWarningMessage('Откройте файл модуля 1С (.bsl) для вставки кода.');
            if (this._view) {
                this._view.webview.postMessage({ type: 'toast', message: '⚠️ Откройте файл .bsl в редакторе для вставки' });
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
        const fullPath = path.isAbsolute(relativePath) ? relativePath : path.join(rootPath, relativePath);
        try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
            await vscode.window.showTextDocument(doc);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Не удалось открыть файл: ${err.message}`);
        }
    }

    private _getHtmlForWebview(apiKey: string, balance: any, selectedModel: string): string {
        const maskedKey = apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : 'Не задан';
        const isGatewayActive = balance && balance.status === 'active';
        const isInsufficient = balance && balance.status === 'insufficient_funds';
        const balanceDisplay = isGatewayActive
            ? 'Pay-As-You-Go (Шлюз активен)'
            : (isInsufficient ? 'Баланс исчерпан на normahub.cc' : (apiKey ? (balance?.error || 'Ошибка ключа') : 'Ключ не настроен'));
        const gatewayStatusLabel = isGatewayActive
            ? '● Шлюз подключен'
            : (isInsufficient ? '⚠️ Баланс исчерпан' : (apiKey ? '❌ Ошибка' : '○ Не настроен'));
        const gatewayStatusBadge = isGatewayActive ? 'badge-ok' : (isInsufficient ? 'badge-warn' : (apiKey ? 'badge-crit' : 'badge-warn'));

        // Serialize all 40+ BSP standard modules for instant, zero-latency client-side search
        const bspModulesJson = JSON.stringify(BSPHelper.STANDARD_MODULES);
        const openTabsCount = MultiTabScanner.getOpenModulesCount();

        return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>1C BSL AI Copilot</title>
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

        /* Metadata Accordion Drawer */
        .metadata-drawer {
            background: var(--bg-card-subtle);
            border: 1px solid var(--border-light);
            border-radius: 6px;
            padding: 5px 8px;
            margin-bottom: 9px;
            font-size: 10px;
        }

        .metadata-drawer summary {
            cursor: pointer;
            font-weight: 600;
            color: var(--text-secondary);
            user-select: none;
            outline: none;
        }

        .metadata-drawer summary:hover {
            color: var(--text-main);
        }

        .metadata-drawer-body {
            margin-top: 7px;
            display: flex;
            flex-direction: column;
            gap: 5px;
        }

        .metadata-drawer-body .form-group {
            margin-bottom: 0;
        }

        .metadata-drawer-body input {
            padding: 4px 6px;
            font-size: 10.5px;
            margin-bottom: 2px;
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
            color: #10B981;
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
            background: #10B981;
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
            background: #059669;
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
            .meta-pill .pill-text {
                display: none;
            }
            .theme-label-text {
                display: none;
            }
            .brand-title {
                font-size: 11px;
            }
            .seg-label {
                font-size: 10px;
            }
            .seg-btn {
                padding: 4px 3px;
                gap: 3px;
            }
        }
    </style>
</head>
<body class="theme-espresso">
    <!-- Модальное окно первого запуска (Welcome Modal) -->
    <div id="welcomeModal" class="modal-backdrop" style="display:none;">
        <div class="modal-card">
            <div class="modal-header">
                <div class="modal-brand">
                    <div class="brand-badge">1C</div>
                    <div class="modal-title">Добро пожаловать в BSL Studio</div>
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
                            <div class="modal-feature-title">2. Разделение на AI и Инструменты 1С</div>
                            <div class="modal-feature-desc">Переключайтесь между генеративным ИИ (запросы, рефакторинг, тесты BDD) и 100% офлайн-инструментами (база БСП 3.1, &cfe перехваты, аудит ИТС, Техжурнал).</div>
                        </div>
                    </div>
                    <div class="modal-feature-item">
                        <div class="modal-feature-icon">🎁</div>
                        <div class="modal-feature-content">
                            <div class="modal-feature-title">3. Быстрый шлюз NormaHub без VPN</div>
                            <div class="modal-feature-desc">Для AI-функций используется единый API-шлюз. Новым пользователям доступен промокод <code>1CPROMO</code> на $0.10 при регистрации на normahub.cc.</div>
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
            <div class="brand-title">BSL Studio</div>
        </div>
        <div class="header-badges">
            <div class="meta-pill" title="Загруженная структура метаданных конфигурации 1С">
                <span class="status-dot online"></span>
                <span class="pill-num">50</span>
                <span class="pill-text">мета</span>
            </div>
            <div class="meta-pill" title="Смежные открытые BSL-модули в рабочей области">
                <span class="status-dot ${openTabsCount > 0 ? 'online' : 'idle'}"></span>
                <span class="pill-num">${openTabsCount}</span>
                <span class="pill-text">вкл.</span>
            </div>
            <button class="theme-toggle-btn" onclick="toggleTheme()" id="themeBtn" title="Переключить тему (Эспрессо / Песочная)">
                <span class="theme-icon">🎨</span>
                <span id="themeLabel" class="theme-label-text">Песочная</span>
            </button>
        </div>
    </div>

    <!-- Блок быстрого старта (сворачиваемый и скрываемый навсегда) -->
    <div id="quickStartBox" class="quick-start-box">
        <div class="quick-start-header">
            <div class="quick-start-title" onclick="toggleQuickStart()">
                <span class="quick-start-icon">💡</span>
                <span>Быстрый старт за 3 шага</span>
            </div>
            <div class="quick-start-actions">
                <button class="quick-start-toggle" id="quickStartToggleBtn" type="button" onclick="toggleQuickStart()" title="Свернуть или развернуть памятку">
                    <span id="quickStartToggleArrow">▲</span>
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
                    <strong>Ключ и статус:</strong> В категории AI откройте <span class="qs-link" onclick="selectSubTool('settings')">⚙️ Шлюз NormaHub</span>. Новым разработчикам доступен промокод <code>1CPROMO</code> на $0.10 при регистрации на normahub.cc.
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
                    <strong>Инструменты:</strong> Переключитесь на <strong>🛠️ Инструменты 1С</strong> для доступа к базе БСП 3.1, перехватам &cfe, аудиту ИТС и разбору Техжурнала без интернета.
                </div>
            </div>
        </div>
    </div>

    <!-- Высокоуровневая сегментированная навигация: AI vs Инструменты 1С -->
    <div class="category-segmented">
        <button id="cat-btn-ai" class="seg-btn active" type="button" onclick="selectCategory('ai')">
            <span class="seg-icon">⚡</span>
            <span class="seg-label">AI Ассистент</span>
        </button>
        <button id="cat-btn-tools" class="seg-btn" type="button" onclick="selectCategory('tools')">
            <span class="seg-icon">🛠️</span>
            <span class="seg-label">Инструменты 1С</span>
        </button>
    </div>

    <!-- Выпадающий селектор конкретного инструмента -->
    <div class="tool-dropdown-wrapper">
        <select id="toolSelector" class="tool-select" onchange="selectSubTool(this.value)">
            <option value="ai-overview">⚡ Action Pilot (Главный пульт AI)</option>
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
        <div class="pilot-context-bar" id="editorContextBanner">
            <span class="pilot-context-dot" id="pilotContextDot">🟢</span>
            <div class="pilot-context-info">
                <span class="pilot-context-file" id="pilotContextFile">Документ.РеализацияТоваровУслуг (МодульОбъекта)</span>
                <span class="pilot-context-sel" id="pilotContextSel">Выделен фрагмент кода • 14 строк BSL</span>
            </div>
            <button class="action-btn-sm" type="button" onclick="refreshEditorContext()" title="Обновить контекст" style="background:transparent; border:none; cursor:pointer;">🔄</button>
        </div>

        <!-- 2. Студия вывода результата (появляется при любом действии) -->
        <div id="cockpitOutputStudio" class="output-studio" style="display:none;">
            <div class="studio-header">
                <div class="studio-badge" id="cockpitBadge">✓ Код оптимизирован по стандартам ИТС</div>
                <div class="studio-meta" id="cockpitMeta">18 строк BSL</div>
            </div>
            <div class="studio-actions-bar">
                <button class="studio-btn-primary" type="button" onclick="insertCockpitCode()">
                    <span>↵ Вставить в активный файл</span>
                </button>
                <button class="studio-btn-secondary" type="button" onclick="copyCockpitCode()">
                    <span>📋 Скопировать</span>
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
            <div class="killer-card" onclick="runCockpitAction('optimize-query')">
                <div class="killer-card-header">
                    <div class="killer-card-title"><span>⚡</span> <span>Оптимизировать запрос (ИТС)</span></div>
                    <span class="killer-card-badge">Высокая нагрузка</span>
                </div>
                <div class="killer-card-desc">Выносит вирт. таблицы во временные таблицы (ВТ_) с индексацией и ЕСТЬNULL</div>
                <div class="killer-card-action">
                    <button class="killer-card-btn" type="button">⚡ Применить к запросу</button>
                </div>
            </div>

            <!-- Действие 2: Обернуть в расширение (&cfe) -->
            <div class="killer-card" onclick="runCockpitAction('create-extension')">
                <div class="killer-card-header">
                    <div class="killer-card-title"><span>🛡️</span> <span>Обернуть метод в расширение</span></div>
                    <span class="killer-card-badge">&cfe перехват</span>
                </div>
                <div class="killer-card-desc">Генерирует &Вместо с вызовом ПродолжитьВызов() и канонической сигнатурой 1С</div>
                <div class="killer-card-action">
                    <button class="killer-card-btn" type="button">🛡️ Сформировать &cfe</button>
                </div>
            </div>

            <!-- Действие 3: Модуль проведения с контролем остатков -->
            <div class="killer-card" onclick="runCockpitAction('generate-posting')">
                <div class="killer-card-header">
                    <div class="killer-card-title"><span>📦</span> <span>Сформировать проведение с остатками</span></div>
                    <span class="killer-card-badge">Стандарт ИТС</span>
                </div>
                <div class="killer-card-desc">БлокировкаДанных + выборка табчасти + остатки + проверка на минус</div>
                <div class="killer-card-action">
                    <button class="killer-card-btn" type="button">📦 Создать проведение</button>
                </div>
            </div>
        </div>

        <!-- 4. Свободный AI Промпт-бар -->
        <div class="pilot-prompt-card">
            <div class="pilot-prompt-title"><span>💬</span> <span>Свободный запрос к AI Copilot:</span></div>
            <div class="pilot-prompt-row">
                <textarea id="cockpitPromptInput" placeholder="Опишите задачу или вставьте код... (например: Напиши парсер JSON в структуру или проверь алгоритм)"></textarea>
                <button id="btnSendCockpitPrompt" class="pilot-send-btn" type="button" onclick="runCockpitPrompt()" title="Сгенерировать (Ctrl+Enter)">
                    <span>🚀</span>
                </button>
            </div>
            <div class="pilot-prompt-footer">
                <div class="pilot-model-wrapper">
                    <span>🧠 Модель:</span>
                    <select id="cockpitModelSelect" class="pilot-model-select" onchange="syncModelSelection(this.value)">
                        <option value="deepseek-v4.1-flash">DeepSeek v4.1 Flash (★ 1С)</option>
                        <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (Архитектура)</option>
                        <option value="gpt-6.1-sol">GPT-6.1 Sol (Флагман)</option>
                    </select>
                </div>
                <span><kbd>Ctrl+Enter</kbd></span>
            </div>
        </div>

        <!-- 5. Опциональный спойлер параметров метаданных -->
        <details class="metadata-drawer">
            <summary>⚙️ Уточнить имена метаданных (документ, регистр)...</summary>
            <div class="metadata-drawer-body">
                <div class="form-group">
                    <label class="form-label" for="drawerEntity">Документ конфигурации:</label>
                    <input type="text" id="drawerEntity" value="РеализацияТоваровУслуг" />
                </div>
                <div class="form-group">
                    <label class="form-label" for="drawerTabular">Табличная часть:</label>
                    <input type="text" id="drawerTabular" value="Товары" />
                </div>
                <div class="form-group">
                    <label class="form-label" for="drawerRegister">Регистр накопления:</label>
                    <input type="text" id="drawerRegister" value="ТоварыНаСкладах" />
                </div>
            </div>
        </details>
    </div>

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
                <div class="chip" onclick="setQueryIntent('Остатки товаров на складах на дату документа с ценами')">Остатки на дату</div>
                <div class="chip" onclick="setQueryIntent('Обороты продаж номенклатуры за период по клиентам')">Обороты продаж</div>
                <div class="chip" onclick="setQueryIntent('Срез последних цен номенклатуры на дату')">Срез цен</div>
                <div class="chip" onclick="setQueryIntent('Контроль отрицательных остатков при проведении')">Контроль остатков</div>
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
                <span class="badge badge-ok">Linter</span>
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
                <button class="secondary" onclick="generateBdd(false)">В буфер обмена</button>
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
                <span class="badge badge-warn">High-Load</span>
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
                <div class="card-title">Статус 1C Global Sidecar</div>
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
                <span class="badge ${gatewayStatusBadge}">${gatewayStatusLabel}</span>
            </div>
            <div style="font-size:15px; font-weight:700; color:${isGatewayActive ? '#10B981' : 'var(--text-muted)'}; margin: 4px 0 8px 0; font-family:'JetBrains Mono', monospace;">${balanceDisplay}</div>
            <div class="card-desc" style="margin-bottom:8px;">
                Официальный AI-шлюз без VPN. Тарификация Pay-As-You-Go с посекундным списанием токенов.
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
                <span class="badge badge-context">LLM Gateway</span>
            </div>
            <div class="card-desc">Выберите нейросеть для автодополнения и генерации кода в зависимости от сложности задачи.</div>
            <div class="form-group">
                <select id="modelSelector" onchange="changeModel()">
                    <option value="deepseek-v4.1-flash" ${selectedModel === 'deepseek-v4.1-flash' ? 'selected' : ''}>DeepSeek v4.1 Flash (★ Рекомендуется для 1С, ~0.04 ₽)</option>
                    <option value="claude-sonnet-5-5" ${selectedModel === 'claude-sonnet-5-5' ? 'selected' : ''}>Claude Sonnet 5.5 (Архитектура, расширения и рефакторинг)</option>
                    <option value="gpt-6.1-sol" ${selectedModel === 'gpt-6.1-sol' ? 'selected' : ''}>GPT-6.1 Sol (Флагман OpenAI, сложнейшая логика)</option>
                    <option value="gpt-6-sol" ${selectedModel === 'gpt-6-sol' ? 'selected' : ''}>GPT-6 Sol (Высокая точность и рассуждения)</option>
                    <option value="gpt-6-astra" ${selectedModel === 'gpt-6-astra' ? 'selected' : ''}>GPT-6 Astra (Баланс скорости и интеллекта)</option>
                    <option value="glm-5.3-flash" ${selectedModel === 'glm-5.3-flash' ? 'selected' : ''}>GLM 5.3 Flash (Сверхскоростная Z.ai)</option>
                    <option value="muse-spark-1.3" ${selectedModel === 'muse-spark-1.3' ? 'selected' : ''}>Muse Spark 1.3 (Креативность и документация)</option>
                </select>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <div class="card-title">API-ключ NormaHub</div>
                <span class="badge badge-context">Шифрование</span>
            </div>
            <div class="card-desc">Ключ сохраняется строго локально в зашифрованном системном хранилище VS Code SecretStorage.</div>
            <div class="form-group">
                <div class="form-label">Текущий ключ: <code>${maskedKey}</code></div>
                <input type="password" id="apiKeyInput" placeholder="Вставьте ключ вида nr_hub_..." />
            </div>
            <button class="secondary" onclick="saveKey()">Сохранить ключ в SecretStorage</button>
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
<div id="toast" class="toast">✓ Скопировано в буфер обмена!</div>

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
                if (label) { label.innerText = 'Песочная'; }
            }
        }

        // Data structures for tools by category
        const categoryTools = {
            'ai': [
                { id: 'ai-overview', name: '⚡ Action Pilot (Главный пульт AI)' },
                { id: 'queries-gen', name: '✨ Генерация пакета запроса' },
                { id: 'queries-refactor', name: '⚡ Оптимизация запроса (ИТС)' },
                { id: 'queries-batch', name: '📋 Шаблонизатор движений регистров' },
                { id: 'bdd', name: '🧪 Сценарии тестов Vanessa BDD' },
                { id: 'settings', name: '⚙️ Шлюз NormaHub и статус' }
            ],
            'tools': [
                { id: 'bsp', name: '📦 База знаний БСП 3.1 (40+ методов, офлайн)' },
                { id: 'extensions', name: '🧩 Перехватчики расширений (&cfe)' },
                { id: 'audit', name: '🛡️ Стандарты разработки фирмы 1С (ИТС)' },
                { id: 'techlog', name: '📊 Анализ Техжурнала 1С (ТЖ)' },
                { id: 'metadata', name: '🗂️ Граф метаданных конфигурации' },
                { id: 'sidecar', name: '🔌 1C Sidecar Daemon (:18833)' }
            ]
        };

        let currentCategory = 'ai';
        let currentTool = 'ai-overview';

        function selectCategory(cat, targetTool) {
            currentCategory = cat;
            document.querySelectorAll('.seg-btn').forEach(btn => btn.classList.remove('active'));
            const activeBtn = document.getElementById('cat-btn-' + cat);
            if (activeBtn) activeBtn.classList.add('active');

            // Populate toolSelector
            const selector = document.getElementById('toolSelector');
            if (selector) {
                selector.innerHTML = '';
                const list = categoryTools[cat] || [];
                list.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = t.name;
                    selector.appendChild(opt);
                });
            }

            const defaultTool = targetTool || (cat === 'ai' ? 'ai-overview' : 'bsp');
            selectSubTool(defaultTool);
        }

        function selectSubTool(toolId) {
            currentTool = toolId;
            let foundCat = 'ai';
            if (categoryTools['tools'].some(t => t.id === toolId)) {
                foundCat = 'tools';
            }

            if (foundCat !== currentCategory) {
                currentCategory = foundCat;
                document.querySelectorAll('.seg-btn').forEach(btn => btn.classList.remove('active'));
                const activeBtn = document.getElementById('cat-btn-' + foundCat);
                if (activeBtn) activeBtn.classList.add('active');

                const selector = document.getElementById('toolSelector');
                if (selector) {
                    selector.innerHTML = '';
                    categoryTools[foundCat].forEach(t => {
                        const opt = document.createElement('option');
                        opt.value = t.id;
                        opt.textContent = t.name;
                        selector.appendChild(opt);
                    });
                }
            }

            const selector = document.getElementById('toolSelector');
            if (selector && selector.value !== toolId) {
                selector.value = toolId;
            }

            const legacyNav = document.getElementById('tabNavSelector');
            if (legacyNav) {
                legacyNav.value = toolId;
            }

            // Hide all tab-panels and show target
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            const panel = document.getElementById('tab-' + toolId);
            if (panel) {
                panel.classList.add('active');
            }

            // Trigger lazy-load actions
            if (toolId === 'bsp') {
                const bspContainer = document.getElementById('bspListContainer');
                if (bspContainer && bspContainer.children.length === 0) {
                    renderBspList();
                }
            }
            if (toolId === 'sidecar') {
                checkSidecar();
            }
        }

        // Backwards-compatible adapter for tests and legacy links
        function switchTab(name) {
            if (name === 'queries') {
                selectCategory('ai', 'queries-refactor');
            } else if (name === 'queries-gen') {
                selectCategory('ai', 'queries-gen');
            } else if (name === 'queries-refactor') {
                selectCategory('ai', 'queries-refactor');
            } else if (name === 'queries-batch') {
                selectCategory('ai', 'queries-batch');
            } else if (name === 'bdd') {
                selectCategory('ai', 'bdd');
            } else if (name === 'settings') {
                selectCategory('ai', 'settings');
            } else if (categoryTools['tools'].some(t => t.id === name)) {
                selectCategory('tools', name);
            } else {
                selectCategory('ai', name);
            }
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
            showToast('✓ Приятной работы с 1C BSL Studio!');
        }

        function openWelcomeModal() {
            const modal = document.getElementById('welcomeModal');
            if (modal) modal.style.display = 'flex';
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
        function showToast(msg) {
            const t = document.getElementById('toast');
            if (!t) return;
            t.innerText = msg || '✓ Скопировано в буфер обмена!';
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 1500);
        }

        initTheme();
        initQuickStart();
        initWelcomeModal();
        selectCategory('ai', 'ai-overview');

        // Code Box helpers
        function insertCodeFrom(id) {
            const elem = document.getElementById(id);
            const code = elem ? elem.innerText : '';
            if (code && code.trim()) {
                vscode.postMessage({ type: 'insertCode', code });
                showToast('✓ Вставка в позицию курсора активного модуля');
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
        function setQueryIntent(text) {
            document.getElementById('queryIntent').value = text;
        }

        function generateQuery() {
            const intent = document.getElementById('queryIntent').value;
            if (!intent.trim()) return;
            document.getElementById('queryStatus').innerText = 'Генерация через NormaHub...';
            vscode.postMessage({ type: 'generateQuery', intent });
        }

        function refactorQuery() {
            const rawQuery = document.getElementById('refactorInput').value;
            if (!rawQuery.trim()) return;
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
            if (!fileEl || !selEl) return;

            if (ctx && ctx.fileName) {
                if (dot) dot.innerText = '🟢';
                fileEl.innerText = ctx.fileName + (ctx.isBsl ? ' (BSL модуль)' : '');
                if (ctx.hasSelection) {
                    selEl.innerText = 'Выделен фрагмент • ' + ctx.lineCount + ' строк кода';
                } else {
                    selEl.innerText = 'Модуль открыт в редакторе • позиция курсора';
                }
            } else {
                if (dot) dot.innerText = '⚪';
                fileEl.innerText = 'Нет активного редактора BSL';
                selEl.innerText = 'Откройте файл .bsl или выделите фрагмент запроса';
            }
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
            if (!studio) return;

            if (badge) badge.innerText = badgeText || '✓ Код сформирован по стандартам ИТС';
            const linesCount = currentCockpitCode.split(NL).length;
            if (meta) meta.innerText = linesCount + ' строк BSL' + (metaText ? ' • ' + metaText : '');
            if (pre) pre.innerText = currentCockpitCode;

            studio.style.display = 'block';
            studio.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        function insertCockpitCode() {
            if (!currentCockpitCode) return;
            vscode.postMessage({ type: 'insertCode', code: currentCockpitCode });
            showToast('✓ Код вставлен в активный модуль редактора!');
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
            const entity = (document.getElementById('drawerEntity') ? document.getElementById('drawerEntity').value : 'РеализацияТоваровУслуг') || 'РеализацияТоваровУслуг';
            const tabular = (document.getElementById('drawerTabular') ? document.getElementById('drawerTabular').value : 'Товары') || 'Товары';
            const register = (document.getElementById('drawerRegister') ? document.getElementById('drawerRegister').value : 'ТоварыНаСкладах') || 'ТоварыНаСкладах';

            if (action === 'optimize-query') {
                const queryText = (currentEditorContext.hasSelection && currentEditorContext.selectedText)
                    ? currentEditorContext.selectedText
                    : (document.getElementById('refactorInput') && document.getElementById('refactorInput').value
                        ? document.getElementById('refactorInput').value
                        : [
                            'ВЫБРАТЬ',
                            '    ДокументТаблица.Номенклатура КАК Номенклатура,',
                            '    ДокументТаблица.Количество КАК Количество,',
                            '    Остатки.КоличествоОстаток КАК Остаток',
                            'ИЗ',
                            '    Документ.' + entity + '.' + tabular + ' КАК ДокументТаблица',
                            '    ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.' + register + '.Остатки(&МоментВремени) КАК Остатки',
                            '    ПО ДокументТаблица.Номенклатура = Остатки.Номенклатура'
                          ].join(NL));
                
                vscode.postMessage({ type: 'refactorQuery', rawQuery: queryText });
                showToast('⚡ Оптимизация запроса по стандартам ИТС...');
            } else if (action === 'create-extension') {
                vscode.postMessage({
                    type: 'generateExtension',
                    method: 'ОбработкаПроведения',
                    directive: 'Вместо',
                    params: 'Отказ, РежимПроведения'
                });
                showToast('🛡️ Генерация безопасного перехвата &Вместо...');
            } else if (action === 'generate-posting') {
                vscode.postMessage({
                    type: 'generateBatchTemplate',
                    entity: entity,
                    tabular: tabular,
                    register: register,
                    registerType: 'Остатки'
                });
                showToast('📦 Формирование проведения с блокировкой и остатками...');
            }
        }

        function runCockpitPrompt() {
            const input = document.getElementById('cockpitPromptInput');
            if (!input || !input.value.trim()) {
                showToast('Введите описание задачи');
                return;
            }
            const promptText = input.value.trim();
            vscode.postMessage({ type: 'generateQuery', intent: promptText });
            showToast('🚀 Генерация решения...');
        }

        // Host Message Listener
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'editorContext') {
                updateEditorContextUI(message);
            } else if (message.type === 'toast' && message.message) {
                showToast(message.message);
            } else if (message.type === 'queryResult') {
                document.getElementById('queryStatus').innerText = '';
                const box = document.getElementById('queryOutput');
                box.style.display = 'block';
                box.innerText = message.code || message.error || '';
                document.getElementById('queryActions').style.display = message.code ? 'flex' : 'none';
                if (message.code) {
                    showInCockpitStudio(message.code, '✓ Пакет запроса сформирован', 'Сгенерировано AI');
                }
            } else if (message.type === 'refactorResult') {
                document.getElementById('refactorStatus').innerText = '';
                const box = document.getElementById('refactorOutput');
                box.style.display = 'block';
                if (message.error) {
                    box.innerText = message.error;
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
                        card.innerHTML = \`
                            <div>
                                <span class="badge \${iss.severity === 'error' ? 'badge-crit' : iss.severity === 'warning' ? 'badge-warn' : 'badge-ok'}">\${iss.rule}</span>
                                <span class="issue-link" onclick="jumpTo(\${iss.line})">Строка \${iss.line}</span>
                            </div>
                            <div style="margin-top:3px; font-weight:500;">\${iss.message}</div>
                            <div style="margin-top:2px; color:var(--text-muted); font-size:10px;">Рекомендация: \${iss.suggestion}</div>
                        \`;
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
                if (message.online) {
                    ind.innerHTML = '<span class="badge badge-ok">● Онлайн (:18833)</span> ' +
                                    '<span style="color:var(--text-muted); font-size:10px;">Версия: ' + (message.info.version || '1.0.0') + '</span>';
                } else {
                    ind.innerHTML = '<span class="badge badge-crit">● Офлайн</span> ' +
                                    '<span style="color:var(--text-muted); font-size:10px;">' + (message.error || 'Запустите: python3 -m sidecar.main') + '</span>';
                }
            }
        });
    </script>
</body>
</html>`;
    }
}
