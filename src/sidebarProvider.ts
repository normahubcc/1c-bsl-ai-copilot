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

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'saveKey':
                    await NormaHubClient.setApiKey(this._context, data.value);
                    vscode.window.showInformationMessage('API-ключ сохранен в защищенном SecretStorage.');
                    await updateHtml();
                    break;

                case 'changeModel':
                    await this._handleChangeModel(data.model);
                    break;

                case 'openBilling':
                    vscode.env.openExternal(vscode.Uri.parse('https://normahub.cc/billing'));
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
        const model = config.get<string>('reasoningModel', 'claude-sonnet-5-5');

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
            registerType: (registerType as 'Остатки' | 'Обороты' | 'СрезПоследних') || 'Остатки',
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
            this._view?.webview.postMessage({ type: 'queryResult', code });
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
            buttonName || 'КнопкаПечать',
            title || 'Печать документа',
            commandName || 'КомандаПечать'
        );
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, code);
            });
            vscode.window.showInformationMessage('Код формы расширения вставлен в редактор.');
        } else {
            this._view?.webview.postMessage({ type: 'extensionResult', code });
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
            editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, code);
            });
            vscode.window.showInformationMessage('Код успешно вставлен в модуль 1С.');
        } else {
            vscode.window.showWarningMessage('Откройте файл модуля 1С для вставки кода.');
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
        const balanceDisplay = balance.status === 'active'
            ? `${balance.balanceRub.toFixed(2)} ₽`
            : 'Ключ не активен';

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
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--border-light);
        }

        .brand-block {
            display: flex;
            align-items: center;
            gap: 7px;
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
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.1px;
            color: var(--text-main);
        }

        .header-actions {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        /* Compact Top-Right Theme Switcher Button */
        .theme-toggle-btn {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            color: var(--text-main);
            cursor: pointer;
            border-radius: 6px;
            padding: 3px 8px;
            font-size: 10.5px;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            font-weight: 600;
            box-shadow: 0 1px 2px rgba(0,0,0,0.06);
            transition: all 0.18s ease;
        }

        .theme-toggle-btn:hover {
            border-color: var(--border-focus);
            transform: translateY(-1px);
        }

        .theme-toggle-btn .theme-icon {
            font-size: 11px;
            line-height: 1;
        }

        /* Quick Navigation Bar (Segmented & Dropdown) */
        .nav-controls {
            margin-bottom: 10px;
        }

        .nav-select-wrapper {
            margin-bottom: 6px;
        }

        .nav-select {
            width: 100%;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 6px 10px;
            font-size: 11.5px;
            font-weight: 600;
            color: var(--text-main);
            outline: none;
            cursor: pointer;
            transition: all 0.15s ease;
            box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }

        .nav-select:focus {
            border-color: var(--border-focus);
        }

        /* Segmented Pill Navigation Strip */
        .tabs {
            display: flex;
            gap: 3px;
            background: var(--bg-card-subtle);
            border: 1px solid var(--border-light);
            border-radius: 7px;
            padding: 2.5px;
            margin-bottom: 10px;
            overflow-x: auto;
            white-space: nowrap;
            scrollbar-width: none;
            -webkit-overflow-scrolling: touch;
        }

        .tabs::-webkit-scrollbar {
            display: none;
        }

        .tab {
            font-size: 11px;
            padding: 4px 8px;
            cursor: pointer;
            color: var(--text-muted);
            border-radius: 5px;
            user-select: none;
            white-space: nowrap;
            flex-shrink: 0;
            transition: all 0.15s ease;
            font-weight: 500;
            border: 1px solid transparent;
        }

        .tab:hover {
            color: var(--text-main);
            background: rgba(128, 128, 128, 0.08);
        }

        .tab.active {
            color: var(--tab-active-text);
            background: var(--tab-active-bg);
            font-weight: 600;
            border-color: var(--border-color);
            box-shadow: var(--tab-active-shadow);
        }

        /* Engineering Context Bar */
        .context-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 4px 8px;
            background: var(--bg-card);
            border: 1px solid var(--border-light);
            border-radius: 6px;
            padding: 5px 8px;
            margin-bottom: 10px;
            font-size: 10.5px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.03);
        }

        .context-item {
            display: flex;
            align-items: center;
            gap: 5px;
            color: var(--text-secondary);
            font-weight: 500;
            white-space: nowrap;
        }

        .status-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            display: inline-block;
        }

        .status-dot.online {
            background-color: #10B981;
            box-shadow: 0 0 6px rgba(16, 185, 129, 0.5);
        }

        .status-dot.idle {
            background-color: #9CA3AF;
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
            min-width: 80px;
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
            white-space: pre-wrap;
            max-height: 230px;
            overflow-y: auto;
            margin-top: 7px;
            line-height: 1.5;
            word-break: break-all;
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
    </style>
</head>
<body class="theme-espresso">
    <!-- Верхняя компактная шапка с брендом и кнопкой темы справа -->
    <div class="top-navbar">
        <div class="brand-block">
            <div class="brand-badge">1C</div>
            <div class="brand-title">BSL Studio</div>
        </div>
        <div class="header-actions">
            <button class="theme-toggle-btn" onclick="toggleTheme()" id="themeBtn" title="Переключить тему (Эспрессо / Песочная)">
                <span class="theme-icon">🎨</span>
                <span id="themeLabel">Песочная</span>
            </button>
        </div>
    </div>

    <!-- Индикатор активного инженерного контекста -->
    <div class="context-bar">
        <div class="context-item" title="Структура метаданных конфигурации 1С">
            <span class="status-dot online"></span> Метаданные 1С (50)
        </div>
        <div class="context-item" title="Смежные открытые BSL-модули в рабочей области">
            <span class="status-dot ${openTabsCount > 0 ? 'online' : 'idle'}"></span> Вкладок в контексте: ${openTabsCount}
        </div>
    </div>

    <!-- Улучшенная навигация: выпадающий селектор + лента табов с иконками -->
    <div class="nav-controls">
        <div class="nav-select-wrapper">
            <select id="tabNavSelector" class="nav-select" onchange="switchTab(this.value)">
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

        <div class="tabs">
            <div id="tab-btn-queries" class="tab active" onclick="switchTab('queries')" title="Пакетные запросы и оптимизация">⚡ Запросы</div>
            <div id="tab-btn-bsp" class="tab" onclick="switchTab('bsp')" title="Библиотека Стандартных Подсистем 3.1">📦 БСП</div>
            <div id="tab-btn-extensions" class="tab" onclick="switchTab('extensions')" title="Перехватчики расширений">&cfe</div>
            <div id="tab-btn-audit" class="tab" onclick="switchTab('audit')" title="Стандарты разработки фирмы 1С">🛡️ ИТС</div>
            <div id="tab-btn-bdd" class="tab" onclick="switchTab('bdd')" title="Vanessa Automation BDD">🧪 BDD</div>
            <div id="tab-btn-techlog" class="tab" onclick="switchTab('techlog')" title="Анализ Технологического Журнала">📊 ТЖ</div>
            <div id="tab-btn-metadata" class="tab" onclick="switchTab('metadata')" title="Метаданные конфигурации">🗂️ Мета</div>
            <div id="tab-btn-sidecar" class="tab" onclick="switchTab('sidecar')" title="1C Sidecar Daemon">🔌 Sidecar</div>
            <div id="tab-btn-settings" class="tab" onclick="switchTab('settings')" title="Баланс и выбор модели">⚙️ Баланс</div>
        </div>
    </div>

    <!-- ТАБ 1: ЗАПРОСЫ (AI + REFACTOR + BATCH) -->
    <div id="tab-queries" class="tab-panel active">
        <!-- Рефакторинг существующих запросов 1С -->
        <div class="card">
            <div class="card-header">
                <div class="card-title">Оптимизация запроса (ИТС)</div>
                <span class="badge badge-ok">ИТС Стандарт</span>
            </div>
            <div class="card-desc">Выносит прямые соединения с виртуальными таблицами во временные таблицы с индексацией и ЕСТЬNULL.</div>
            <textarea id="refactorInput" placeholder="Вставьте текст запроса 1С или соединение с виртуальной таблицей..."></textarea>
            <button onclick="refactorQuery()">Оптимизировать запрос <kbd>Ctrl+Enter</kbd></button>
            <div id="refactorStatus" style="font-size:11px; color:var(--text-muted); margin-top:4px;"></div>
            <div id="refactorOutput" class="code-box" style="display:none;"></div>
            <div class="btn-group" id="refactorActions" style="display:none;">
                <button class="secondary" onclick="insertCodeFrom('refactorOutput')">Вставить в модуль</button>
                <button class="secondary" onclick="copyCodeFrom('refactorOutput')">Копировать</button>
            </div>
        </div>

        <!-- AI Генератор по описанию -->
        <div class="card">
            <div class="card-title">Генерация пакета запроса</div>
            <div class="chips-row">
                <div class="chip" onclick="setQueryIntent('Остатки товаров на складах на дату документа с ценами')">Остатки на дату</div>
                <div class="chip" onclick="setQueryIntent('Обороты продаж номенклатуры за период по клиентам')">Обороты продаж</div>
                <div class="chip" onclick="setQueryIntent('Срез последних цен номенклатуры на дату')">Срез цен</div>
                <div class="chip" onclick="setQueryIntent('Контроль отрицательных остатков при проведении')">Контроль остатков</div>
            </div>
            <textarea id="queryIntent" placeholder="Опишите задачу на русском языке (например: Выбрать остатки номенклатуры из регистра с фильтром по организации)..."></textarea>
            <button onclick="generateQuery()">Сформировать BSL-код запроса <kbd>Ctrl+Alt+Q</kbd></button>
            <div id="queryStatus" style="font-size:11px; color:var(--text-muted); margin-top:4px;"></div>
            <div id="queryOutput" class="code-box" style="display:none;"></div>
            <div class="btn-group" id="queryActions" style="display:none;">
                <button class="secondary" onclick="insertCodeFrom('queryOutput')">Вставить в модуль</button>
                <button class="secondary" onclick="copyCodeFrom('queryOutput')">Копировать</button>
            </div>
        </div>

        <!-- Шаблонизатор проведения -->
        <div class="card">
            <div class="card-title">Конструктор движений проведения</div>
            <input type="text" id="batchEntity" placeholder="Документ" value="РеализацияТоваровУслуг" />
            <input type="text" id="batchTabular" placeholder="Табличная часть" value="Товары" />
            <input type="text" id="batchRegister" placeholder="Регистр накопления" value="ТоварыНаСкладах" />
            <select id="batchRegisterType">
                <option value="Остатки">Виртуальная таблица: Остатки</option>
                <option value="Обороты">Виртуальная таблица: Обороты</option>
                <option value="СрезПоследних">Виртуальная таблица: СрезПоследних</option>
            </select>
            <button class="secondary" onclick="generateBatch()">Вставить пакетный запрос проведения</button>
        </div>
    </div>

    <!-- ТАБ 2: БСП 3.1 КАТАЛОГ И ИНСПЕКТОР -->
    <div id="tab-bsp" class="tab-panel">
        <div class="card">
            <div class="card-header">
                <div class="card-title">База знаний БСП 3.1</div>
                <span id="bspCountBadge" class="badge badge-ok">40 методов</span>
            </div>
            <input type="text" id="bspSearchInput" placeholder="Поиск метода, модуля или действия..." oninput="filterBsp()" />
            <div class="chips-row" id="bspFilters">
                <div class="chip active" onclick="setBspSubsystem('', this)">Все</div>
                <div class="chip" onclick="setBspSubsystem('ОбщегоНазначения', this)">ОбщегоНазначения</div>
                <div class="chip" onclick="setBspSubsystem('СтроковыеФункции', this)">Строки</div>
                <div class="chip" onclick="setBspSubsystem('ДлительныеОперации', this)">Длительные</div>
                <div class="chip" onclick="setBspSubsystem('Пользователи', this)">Пользователи</div>
                <div class="chip" onclick="setBspSubsystem('УправлениеДоступом', this)">Доступ/RLS</div>
            </div>
            <div id="bspListContainer" style="max-height:360px; overflow-y:auto;"></div>
        </div>
    </div>

    <!-- ТАБ 3: РАСШИРЕНИЯ (&CFE) -->
    <div id="tab-extensions" class="tab-panel">
        <div class="card">
            <div class="card-title">Перехват метода в расширении</div>
            <input type="text" id="extMethod" placeholder="Имя процедуры" value="ОбработкаПроведения" />
            <select id="extDirective">
                <option value="Вместо">&Вместо (с вызовом ПродолжитьВызов)</option>
                <option value="Перед">&Перед (с контролем Отказ)</option>
                <option value="После">&После (постобработка после типового кода)</option>
                <option value="ИзменениеИКонтроль">&ИзменениеИКонтроль (#Вставка/#КонецВставки)</option>
            </select>
            <input type="text" id="extParams" placeholder="Параметры" value="Отказ, РежимПроведения" />
            <button onclick="generateExt()">Сгенерировать перехватчик</button>
            <div id="extOutput" class="code-box" style="display:none;"></div>
            <div class="btn-group" id="extActions" style="display:none;">
                <button class="secondary" onclick="insertCodeFrom('extOutput')">Вставить в модуль</button>
                <button class="secondary" onclick="copyCodeFrom('extOutput')">Копировать</button>
            </div>
        </div>

        <div class="card">
            <div class="card-title">Динамическая кнопка в форме</div>
            <input type="text" id="btnFormName" placeholder="Имя элемента" value="КнопкаПечать" />
            <input type="text" id="btnFormTitle" placeholder="Заголовок кнопки" value="Печать УПД" />
            <input type="text" id="btnFormCmd" placeholder="Имя команды" value="ПечатьУПД" />
            <button class="secondary" onclick="generateFormBtn()">Сгенерировать код ПриСозданииНаСервере</button>
        </div>
    </div>

    <!-- ТАБ 4: ИТС АУДИТ КАЧЕСТВА И БЕЗОПАСНОСТИ -->
    <div id="tab-audit" class="tab-panel">
        <div class="card">
            <div class="card-title">Аудит стандартов ИТС и БСП</div>
            <div class="card-desc">Проверяет запросы в циклах, управляемые блокировки, модальные окна, мутабельные типы и SQL-инъекции.</div>
            <button onclick="auditActiveFile()">Проверить открытый файл модуля</button>
            <textarea id="auditSnippetInput" style="margin-top:6px;" placeholder="Или вставьте сюда любой фрагмент BSL для экспресс-аудита..."></textarea>
            <button class="secondary" onclick="auditSnippet()">Проверить фрагмент</button>
            <div id="auditOutputContainer" style="margin-top:8px;"></div>
        </div>
    </div>

    <!-- ТАБ 5: VANESSA BDD -->
    <div id="tab-bdd" class="tab-panel">
        <div class="card">
            <div class="card-title">Генератор тестов Vanessa-Automation</div>
            <div class="card-desc">Создает сценарии сквозного тестирования документов на русском языке Gherkin.</div>
            <input type="text" id="bddEntity" placeholder="Документ" value="РеализацияТоваровУслуг" />
            <input type="text" id="bddTabular" placeholder="Табличная часть" value="Товары" />
            <input type="text" id="bddRegister" placeholder="Регистр остатков" value="ТоварыНаСкладах" />
            <textarea id="bddPrompt" placeholder="Или опишите тест словами: Проверить проведение при превышении остатка..." style="min-height:50px;"></textarea>
            <button onclick="generateBdd(true)">Сгенерировать и открыть .feature</button>
            <button class="secondary" onclick="generateBdd(false)">Сгенерировать в буфер</button>
            <div id="bddOutput" class="code-box" style="display:none;"></div>
            <div class="btn-group" id="bddActions" style="display:none;">
                <button class="secondary" onclick="copyCodeFrom('bddOutput')">Копировать .feature</button>
            </div>
        </div>
    </div>

    <!-- ТАБ 6: АНАЛИЗ ТЕХНОЛОГИЧЕСКОГО ЖУРНАЛА (ТЖ) -->
    <div id="tab-techlog" class="tab-panel">
        <div class="card">
            <div class="card-title">Диагностика Технологического Журнала</div>
            <div class="card-desc">Экспертный анализ инцидентов TLOCK, TDEADLOCK, EXCP и медленных SQL-запросов.</div>
            <div class="chips-row">
                <div class="chip" onclick="loadDemoTLog('TLOCK')">TLOCK</div>
                <div class="chip" onclick="loadDemoTLog('TDEADLOCK')">TDEADLOCK</div>
                <div class="chip" onclick="loadDemoTLog('EXCP')">EXCP</div>
                <div class="chip" onclick="loadDemoTLog('DBPOSTGR')">DBPOSTGR</div>
            </div>
            <textarea id="techlogInput" style="min-height:90px;" placeholder="Вставьте строку или фрагмент лога ТЖ..."></textarea>
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
            <div class="card-desc">Кэширует структуру объектов конфигурации для точной генерации запросов и реквизитов.</div>
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
            <div class="card-title">Интеграция с Конфигуратором 1С</div>
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
            <div class="card-title">Баланс NormaHub</div>
            <div style="font-size:18px; font-weight:700; color:#10B981; margin: 4px 0 8px 0;">${balanceDisplay}</div>
            <div class="btn-group">
                <button onclick="openBilling()">Пополнить баланс</button>
            </div>
        </div>

        <div class="card">
            <div class="card-title">Модель автокомплита / генерации</div>
            <select id="modelSelector" onchange="changeModel()">
                <option value="deepseek-v4.1-flash" ${selectedModel === 'deepseek-v4.1-flash' ? 'selected' : ''}>DeepSeek v4.1 Flash (★ Рекомендуется для 1С, ~0.04 ₽)</option>
                <option value="gpt-6.1-sol" ${selectedModel === 'gpt-6.1-sol' ? 'selected' : ''}>GPT-6.1 Sol (Флагман OpenAI, сложнейшая логика)</option>
                <option value="gpt-6-sol" ${selectedModel === 'gpt-6-sol' ? 'selected' : ''}>GPT-6 Sol (Высокая точность и рассуждения)</option>
                <option value="gpt-6-astra" ${selectedModel === 'gpt-6-astra' ? 'selected' : ''}>GPT-6 Astra (Баланс скорости и интеллекта)</option>
                <option value="glm-5.3-flash" ${selectedModel === 'glm-5.3-flash' ? 'selected' : ''}>GLM 5.3 Flash (Сверхскоростная Z.ai)</option>
                <option value="muse-spark-1.3" ${selectedModel === 'muse-spark-1.3' ? 'selected' : ''}>Muse Spark 1.3 (Креативность и документация)</option>
                <option value="claude-sonnet-5-5" ${selectedModel === 'claude-sonnet-5-5' ? 'selected' : ''}>Claude 3.5 Sonnet (Максимальный интеллект для ТЖ)</option>
            </select>
        </div>

        <div class="card">
            <div class="card-title">API-ключ NormaHub</div>
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">Текущий: ${maskedKey}</div>
            <input type="password" id="apiKeyInput" placeholder="nr_hub_..." />
            <button class="secondary" onclick="saveKey()">Сохранить ключ в SecretStorage</button>
        </div>
    </div>

    <div id="toast" class="toast">✓ Скопировано в буфер обмена!</div>

    <script>
        const vscode = acquireVsCodeApi();
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

        initTheme();

        // Toast feedback
        function showToast(msg) {
            const t = document.getElementById('toast');
            if (!t) return;
            t.innerText = msg || '✓ Скопировано в буфер обмена!';
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 1500);
        }

        // Tabs
        function switchTab(name) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            const btn = document.getElementById('tab-btn-' + name);
            if (btn) btn.classList.add('active');
            const panel = document.getElementById('tab-' + name);
            if (panel) panel.classList.add('active');

            const navSel = document.getElementById('tabNavSelector');
            if (navSel && navSel.value !== name) {
                navSel.value = name;
            }

            if (name === 'bsp') {
                const bspContainer = document.getElementById('bspListContainer');
                if (bspContainer && bspContainer.children.length === 0) {
                    renderBspList();
                }
            }
            if (name === 'sidecar') {
                checkSidecar();
            }
        }

        // Code Box helpers
        function insertCodeFrom(id) {
            const code = document.getElementById(id).innerText;
            if (code) {
                vscode.postMessage({ type: 'insertCode', code });
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
            const entity = document.getElementById('batchEntity').value;
            const tabular = document.getElementById('batchTabular').value;
            const register = document.getElementById('batchRegister').value;
            const registerType = document.getElementById('batchRegisterType').value;
            vscode.postMessage({ type: 'generateBatchTemplate', entity, tabular, register, registerType });
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
                    <div class="bsp-header">
                        <div>
                            <div class="bsp-method-name">\${m.module}.\${m.method}</div>
                            <div class="bsp-module-tag">\${m.signature}</div>
                        </div>
                        <span class="badge badge-context">\${m.context}</span>
                    </div>
                    <div class="bsp-desc">\${m.description}</div>
                    <div class="btn-group" style="margin-top:4px;">
                        <button class="sm" onclick="insertBspSnippet('\${encodeURIComponent(m.example)}')">Вставить</button>
                        <button class="sm secondary" onclick="copySnippet('\${encodeURIComponent(m.example)}')">Копировать</button>
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
            const method = document.getElementById('extMethod').value;
            const directive = document.getElementById('extDirective').value;
            const params = document.getElementById('extParams').value;
            vscode.postMessage({ type: 'generateExtension', method, directive, params });
        }

        function generateFormBtn() {
            const buttonName = document.getElementById('btnFormName').value;
            const title = document.getElementById('btnFormTitle').value;
            const commandName = document.getElementById('btnFormCmd').value;
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
            const entity = document.getElementById('bddEntity').value;
            const tabular = document.getElementById('bddTabular').value;
            const register = document.getElementById('bddRegister').value;
            const prompt = document.getElementById('bddPrompt').value;
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

        // Host Message Listener
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'queryResult') {
                document.getElementById('queryStatus').innerText = '';
                const box = document.getElementById('queryOutput');
                box.style.display = 'block';
                box.innerText = message.code || message.error || '';
                document.getElementById('queryActions').style.display = message.code ? 'flex' : 'none';
            } else if (message.type === 'refactorResult') {
                document.getElementById('refactorStatus').innerText = '';
                const box = document.getElementById('refactorOutput');
                box.style.display = 'block';
                if (message.error) {
                    box.innerText = message.error;
                } else {
                    let out = message.code;
                    if (message.optimizations && message.optimizations.length) {
                        out = '// ПРИМЕНЕННЫЕ ОПТИМИЗАЦИИ ИТС:\\n// ' + message.optimizations.join('\\n// ') + '\\n\\n' + out;
                    }
                    box.innerText = out;
                    document.getElementById('refactorActions').style.display = 'flex';
                }
            } else if (message.type === 'extensionResult') {
                const box = document.getElementById('extOutput');
                box.style.display = 'block';
                box.innerText = message.code || '';
                document.getElementById('extActions').style.display = 'flex';
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
