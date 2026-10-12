import * as vscode from 'vscode';
import { NormaHubClient } from './normahubClient';
import { MetadataScanner } from './metadataScanner';
import { StandardsChecker } from './standardsChecker';
import { BSPHelper } from './bspHelper';
import { QueryBuilder } from './queryBuilder';
import { ExtensionGenerator, ExtensionDirective } from './extensionGenerator';
import { BDDGenerator } from './bddGenerator';
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
            webviewView.webview.html = this._getHtmlForWebview(apiKey, balanceInfo);
        };

        await updateHtml();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'saveKey':
                    await NormaHubClient.setApiKey(this._context, data.value);
                    vscode.window.showInformationMessage('API-ключ сохранен в SecretStorage.');
                    await updateHtml();
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

                case 'generateBatchTemplate':
                    await this._handleGenerateBatchTemplate(data.entity, data.tabular, data.register);
                    break;

                case 'generateExtension':
                    await this._handleGenerateExtension(data.method, data.directive, data.params);
                    break;

                case 'auditSelection':
                    await this._handleAuditSelection();
                    break;

                case 'insertBspSnippet':
                    await this._handleInsertBspSnippet(data.example);
                    break;

                case 'generateBdd':
                    await this._handleGenerateBdd(data.entity, data.tabular, data.register, data.openEditor);
                    break;

                case 'analyzeTechLog':
                    await this._handleAnalyzeTechLog(data.rawLog);
                    break;
            }
        });
    }

    private async _handleGenerateQuery(intent: string) {
        if (!this._view) return;
        const apiKey = await NormaHubClient.getApiKey(this._context);
        if (!apiKey) {
            this._view.webview.postMessage({ type: 'queryResult', error: 'API-ключ не задан. Укажите ключ во вкладке Настройка.' });
            return;
        }

        const config = vscode.workspace.getConfiguration('normahub1c');
        const model = config.get<string>('reasoningModel', 'claude-sonnet-5-5');

        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const metadata = await MetadataScanner.scanWorkspace(rootPath);
        const metaSummary = MetadataScanner.formatForPrompt(metadata);
        const bspSummary = BSPHelper.getBSPPromptInjection();

        const systemPrompt = `Ты — ведущий эксперт по языку запросов 1С:Предприятие 8.3 (Стандарты фирмы «1С» и БСП).
Пользователь описывает бизнес-задачу на русском языке. Сформируй чистый, оптимизированный код 1С с созданием объекта Запрос.
Требования стандартов ИТС:
1. Использовать параметры в виртуальных таблицах (Остатки(&Период, ), СрезПоследних(&Период, )).
2. Никогда не соединять виртуальные таблицы напрямую — выносить во временные таблицы (ПОМЕСТИТЬ ВТ_...) с ИНДЕКСИРОВАТЬ ПО.
3. Проверять значения на NULL через ЕСТЬNULL.
4. Добавить МенеджерВременныхТаблиц и установку параметров.
5. Выведи только готовый BSL-код создания и выполнения запроса.

${metaSummary}

${bspSummary}`;

        try {
            this._view.webview.postMessage({ type: 'queryStatus', text: 'Генерация пакета запросов через NormaHub...' });
            const result = await NormaHubClient.complete(apiKey, model, systemPrompt, intent, 0.1, 1500);
            this._view.webview.postMessage({ type: 'queryResult', code: result });
        } catch (err: any) {
            this._view.webview.postMessage({ type: 'queryResult', error: err.message });
        }
    }

    private async _handleGenerateBatchTemplate(entity: string, tabular: string, register: string) {
        const code = QueryBuilder.generateBatchQuery({
            entityName: entity || 'РеализацияТоваровУслуг',
            tabularSection: tabular || 'Товары',
            registerName: register || 'ТоварыНаСкладах',
            registerType: 'Остатки',
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

    private async _handleInsertBspSnippet(snippet: string) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, snippet);
            });
            vscode.window.showInformationMessage('Вызов метода БСП вставлен в редактор.');
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
        this._view.webview.postMessage({ type: 'auditResult', report });
    }

    private async _handleGenerateBdd(entity: string, tabular: string, register: string, openEditor = true) {
        if (!this._view) return;
        const targetEntity = (entity || '').trim() || 'РеализацияТоваровУслуг';
        const spec = BDDGenerator.generateDocumentScenario(
            targetEntity,
            (tabular || '').trim() || 'Товары',
            (register || '').trim() || 'ТоварыНаСкладах'
        );
        const feature = BDDGenerator.generateFeature(spec);
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
        const events = TechLogAnalyzer.parseLog(rawLog);
        const diagnoses = TechLogAnalyzer.diagnose(events);
        const report = TechLogAnalyzer.formatReport(diagnoses);
        this._view.webview.postMessage({ type: 'techLogResult', report, count: events.length });
    }

    private _getHtmlForWebview(apiKey: string, balance: any): string {
        const maskedKey = apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : 'Не задан';
        const balanceDisplay = balance.status === 'active'
            ? `${balance.balanceRub.toFixed(2)} ₽`
            : 'Ключ не активен';

        const bspCardsHtml = BSPHelper.STANDARD_MODULES.slice(0, 5).map(m => `
            <div class="bsp-item">
                <div class="bsp-header">
                    <strong>${m.module}.${m.method}</strong>
                    <span class="tag">${m.context}</span>
                </div>
                <div class="bsp-desc">${m.description}</div>
                <button class="secondary" style="margin-top:4px; padding:3px 6px; font-size:11px;" onclick="insertBsp('${encodeURIComponent(m.example)}')">Вставить пример</button>
            </div>
        `).join('');

        return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>1C BSL AI Copilot</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
            padding: 10px;
            margin: 0;
            line-height: 1.4;
        }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--vscode-widget-border, #333);
            padding-bottom: 8px;
            margin-bottom: 10px;
        }
        .title {
            font-weight: 600;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .badge {
            font-size: 11px;
            color: #4ade80;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .tabs {
            display: flex;
            border-bottom: 1px solid var(--vscode-widget-border, #333);
            margin-bottom: 10px;
            gap: 2px;
            overflow-x: auto;
        }
        .tab {
            font-size: 11px;
            padding: 4px 6px;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            color: var(--vscode-descriptionForeground);
            user-select: none;
            white-space: nowrap;
        }
        .tab.active {
            color: var(--vscode-foreground);
            border-bottom-color: var(--vscode-activityBar-activeBorder, #007acc);
            font-weight: 600;
        }
        .tab-panel {
            display: none;
        }
        .tab-panel.active {
            display: block;
        }
        .card {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border, #2d2d2d);
            border-radius: 4px;
            padding: 10px;
            margin-bottom: 10px;
        }
        .card-title {
            font-size: 11px;
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            margin-bottom: 6px;
        }
        input[type="text"], input[type="password"], textarea, select {
            width: 100%;
            box-sizing: border-box;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, #444);
            padding: 5px 8px;
            border-radius: 2px;
            font-size: 12px;
            outline: none;
            font-family: inherit;
            margin-bottom: 6px;
        }
        textarea {
            resize: vertical;
            min-height: 60px;
            font-family: var(--vscode-editor-font-family, monospace);
        }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 10px;
            border-radius: 2px;
            cursor: pointer;
            font-size: 12px;
            width: 100%;
            margin-top: 4px;
            font-weight: 500;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .code-box {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border, #333);
            border-radius: 2px;
            padding: 8px;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 11px;
            white-space: pre-wrap;
            max-height: 180px;
            overflow-y: auto;
            margin-top: 6px;
        }
        .balance-badge {
            font-size: 14px;
            font-weight: 600;
            color: #4ade80;
            margin-bottom: 6px;
        }
        .bsp-item {
            border: 1px solid var(--vscode-widget-border, #333);
            border-radius: 3px;
            padding: 6px;
            margin-bottom: 6px;
            background: var(--vscode-sideBar-background);
        }
        .bsp-header {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
        }
        .bsp-desc {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }
        .tag {
            font-size: 9px;
            background: #2563eb;
            color: #fff;
            padding: 1px 4px;
            border-radius: 2px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">1C BSL Copilot</div>
        <div class="badge">● Pay-As-You-Go</div>
    </div>

    <div class="tabs">
        <div class="tab active" onclick="switchTab('queries')">Запросы</div>
        <div class="tab" onclick="switchTab('bsp')">БСП</div>
        <div class="tab" onclick="switchTab('extensions')">Расширения</div>
        <div class="tab" onclick="switchTab('audit')">ИТС Аудит</div>
        <div class="tab" onclick="switchTab('bdd')">Vanessa BDD</div>
        <div class="tab" onclick="switchTab('techlog')">Анализ ТЖ</div>
        <div class="tab" onclick="switchTab('settings')">Баланс</div>
    </div>

    <!-- ТАБ 1: ЗАПРОСЫ -->
    <div id="tab-queries" class="tab-panel active">
        <div class="card">
            <div class="card-title">Генератор запросов 1С</div>
            <textarea id="queryIntent" placeholder="Например: Выбрать номенклатуру с остатками и ценами с фильтром по складу"></textarea>
            <button onclick="generateQuery()">Сформировать запрос</button>
            <div id="queryStatus" style="font-size:11px; color:#9ca3af; margin-top:4px;"></div>
            <div id="queryOutput" class="code-box" style="display:none;"></div>
        </div>

        <div class="card">
            <div class="card-title">Шаблон пакетного запроса (ИТС)</div>
            <input type="text" id="batchEntity" placeholder="Документ (РеализацияТоваровУслуг)" value="РеализацияТоваровУслуг" />
            <input type="text" id="batchTabular" placeholder="Табличная часть (Товары)" value="Товары" />
            <input type="text" id="batchRegister" placeholder="Регистр (ТоварыНаСкладах)" value="ТоварыНаСкладах" />
            <button class="secondary" onclick="generateBatch()">Вставить пакетный запрос с ВТ</button>
        </div>
    </div>

    <!-- ТАБ 2: БСП -->
    <div id="tab-bsp" class="tab-panel">
        <div class="card">
            <div class="card-title">Библиотека Стандартных Подсистем</div>
            <div style="font-size:11px; color:var(--vscode-descriptionForeground); margin-bottom:8px;">
                Используйте готовые методы БСП вместо создания тяжелых объектов в памяти:
            </div>
            ${bspCardsHtml}
        </div>
    </div>

    <!-- ТАБ 3: РАСШИРЕНИЯ CFE -->
    <div id="tab-extensions" class="tab-panel">
        <div class="card">
            <div class="card-title">Генератор перехватов (&cfe)</div>
            <input type="text" id="extMethod" placeholder="Имя процедуры (ОбработкаПроведения)" value="ОбработкаПроведения" />
            <select id="extDirective">
                <option value="Вместо">&Вместо (с ПродолжитьВызов)</option>
                <option value="Перед">&Перед (с проверкой Отказ)</option>
                <option value="После">&После (постобработка)</option>
                <option value="ИзменениеИКонтроль">&ИзменениеИКонтроль (#Вставка)</option>
            </select>
            <input type="text" id="extParams" placeholder="Параметры (Отказ, РежимПроведения)" value="Отказ, РежимПроведения" />
            <button onclick="generateExt()">Вставить перехват в модуль</button>
            <div id="extOutput" class="code-box" style="display:none;"></div>
        </div>
    </div>

    <!-- ТАБ 4: АУДИТ ИТС -->
    <div id="tab-audit" class="tab-panel">
        <div class="card">
            <div class="card-title">Аудит стандартов ИТС и БСП</div>
            <div style="font-size:11px; color:var(--vscode-descriptionForeground); margin-bottom:8px;">
                Проверяет запросы в циклах, управляемые блокировки, мутабельные значения и использование БСП.
            </div>
            <button onclick="auditSelection()">Проверить активный файл</button>
            <div id="auditOutput" class="code-box" style="display:none;"></div>
        </div>
    </div>

    <!-- ТАБ 5: VANESSA BDD -->
    <div id="tab-bdd" class="tab-panel">
        <div class="card">
            <div class="card-title">Генератор тестов Vanessa-Automation</div>
            <div style="font-size:11px; color:var(--vscode-descriptionForeground); margin-bottom:8px;">
                Формирует русскоязычные BDD-сценарии (.feature) с таблицами данных и проверкой движений регистров.
            </div>
            <input type="text" id="bddEntity" placeholder="Имя документа (РеализацияТоваровУслуг)" value="РеализацияТоваровУслуг" />
            <input type="text" id="bddTabular" placeholder="Табличная часть (Товары)" value="Товары" />
            <input type="text" id="bddRegister" placeholder="Контролируемый регистр (ТоварыНаСкладах)" value="ТоварыНаСкладах" />
            <button onclick="generateBdd(true)">Сгенерировать и открыть .feature</button>
            <div id="bddOutput" class="code-box" style="display:none;"></div>
        </div>
    </div>

    <!-- ТАБ 6: АНАЛИЗ ТЖ -->
    <div id="tab-techlog" class="tab-panel">
        <div class="card">
            <div class="card-title">Диагностика Технологического Журнала (ТЖ)</div>
            <div style="font-size:11px; color:var(--vscode-descriptionForeground); margin-bottom:8px;">
                Экспертный анализ инцидентов: TLOCK, TDEADLOCK, EXCP, SDBL/DBPOSTGR/DBMSSQL с рекомендациями High-Load.
            </div>
            <textarea id="techlogInput" style="min-height:80px;" placeholder="Вставьте строку или блок событий ТЖ..."></textarea>
            <button onclick="analyzeTechLog()">Диагностировать инциденты</button>
            <div id="techlogOutput" class="code-box" style="display:none;"></div>
        </div>
    </div>

    <!-- ТАБ 5: НАСТРОЙКИ И БАЛАНС -->
    <div id="tab-settings" class="tab-panel">
        <div class="card">
            <div class="card-title">Баланс NormaHub</div>
            <div class="balance-badge">${balanceDisplay}</div>
            <button onclick="openBilling()">Пополнить (СБП / МИР)</button>
            <button class="secondary" onclick="openB2B()">Счет с НДС 20% (Диадок)</button>
        </div>

        <div class="card">
            <div class="card-title">API-ключ</div>
            <div style="font-size:11px; color:#9ca3af; margin-bottom:4px;">Текущий: ${maskedKey}</div>
            <input type="password" id="apiKeyInput" placeholder="nr_hub_..." />
            <button class="secondary" onclick="saveKey()">Сохранить ключ</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function switchTab(name) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            event.target.classList.add('active');
            document.getElementById('tab-' + name).classList.add('active');
        }

        function generateQuery() {
            const intent = document.getElementById('queryIntent').value;
            if (!intent.trim()) return;
            document.getElementById('queryStatus').innerText = 'Генерация через NormaHub...';
            vscode.postMessage({ type: 'generateQuery', intent });
        }

        function generateBatch() {
            const entity = document.getElementById('batchEntity').value;
            const tabular = document.getElementById('batchTabular').value;
            const register = document.getElementById('batchRegister').value;
            vscode.postMessage({ type: 'generateBatchTemplate', entity, tabular, register });
        }

        function generateExt() {
            const method = document.getElementById('extMethod').value;
            const directive = document.getElementById('extDirective').value;
            const params = document.getElementById('extParams').value;
            vscode.postMessage({ type: 'generateExtension', method, directive, params });
        }

        function insertBsp(exampleEnc) {
            const example = decodeURIComponent(exampleEnc);
            vscode.postMessage({ type: 'insertBspSnippet', example });
        }

        function auditSelection() {
            vscode.postMessage({ type: 'auditSelection' });
        }

        function generateBdd(openEditor) {
            const entity = document.getElementById('bddEntity').value;
            const tabular = document.getElementById('bddTabular').value;
            const register = document.getElementById('bddRegister').value;
            vscode.postMessage({ type: 'generateBdd', entity, tabular, register, openEditor });
        }

        function analyzeTechLog() {
            const rawLog = document.getElementById('techlogInput').value;
            vscode.postMessage({ type: 'analyzeTechLog', rawLog });
        }

        function saveKey() {
            const val = document.getElementById('apiKeyInput').value;
            if (val) vscode.postMessage({ type: 'saveKey', value: val });
        }

        function openBilling() { vscode.postMessage({ type: 'openBilling' }); }
        function openB2B() { vscode.postMessage({ type: 'openB2B' }); }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'queryResult') {
                document.getElementById('queryStatus').innerText = '';
                const box = document.getElementById('queryOutput');
                box.style.display = 'block';
                box.innerText = message.code || message.error || '';
            } else if (message.type === 'extensionResult') {
                const box = document.getElementById('extOutput');
                box.style.display = 'block';
                box.innerText = message.code || '';
            } else if (message.type === 'auditResult') {
                const box = document.getElementById('auditOutput');
                box.style.display = 'block';
                box.innerText = message.report || '';
            } else if (message.type === 'bddResult') {
                const box = document.getElementById('bddOutput');
                box.style.display = 'block';
                box.innerText = message.feature || '';
            } else if (message.type === 'techLogResult') {
                const box = document.getElementById('techlogOutput');
                box.style.display = 'block';
                box.innerText = message.report || '';
            }
        });
    </script>
</body>
</html>`;
    }
}
