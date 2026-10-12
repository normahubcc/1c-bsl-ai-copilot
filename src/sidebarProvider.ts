import * as vscode from 'vscode';
import { NormaHubClient } from './normahubClient';
import { MetadataScanner } from './metadataScanner';
import { StandardsChecker } from './standardsChecker';

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

                case 'auditSelection':
                    await this._handleAuditSelection();
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

        const systemPrompt = `Ты — ведущий эксперт по языку запросов 1С:Предприятие 8.3 (Стандарты фирмы «1С»).
Пользователь описывает бизнес-задачу на русском языке. Сформируй чистый, оптимизированный код 1С с созданием объекта Запрос.
Требования стандартов ИТС:
1. Использовать параметры в виртуальных таблицах (Остатки(&Период, ), СрезПоследних(&Период, )).
2. Никогда не соединять виртуальные таблицы напрямую — использовать МенеджерВременныхТаблиц.
3. Проверять значения на NULL через ЕСТЬNULL.
4. Добавить установку параметров через Запрос.УстановитьПараметр().
5. Выведи только готовый BSL-код создания и выполнения запроса.

${metaSummary}`;

        try {
            this._view.webview.postMessage({ type: 'queryStatus', text: 'Генерация запроса через NormaHub...' });
            const result = await NormaHubClient.complete(apiKey, model, systemPrompt, intent, 0.1, 1500);
            this._view.webview.postMessage({ type: 'queryResult', code: result });
        } catch (err: any) {
            this._view.webview.postMessage({ type: 'queryResult', error: err.message });
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

    private _getHtmlForWebview(apiKey: string, balance: any): string {
        const maskedKey = apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : 'Не задан';
        const balanceDisplay = balance.status === 'active'
            ? `${balance.balanceRub.toFixed(2)} ₽`
            : 'Ключ не активен';

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
            gap: 4px;
        }
        .tab {
            font-size: 11px;
            padding: 4px 8px;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            color: var(--vscode-descriptionForeground);
            user-select: none;
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
        input[type="password"], textarea {
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
            margin-top: 6px;
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
            max-height: 200px;
            overflow-y: auto;
            margin-top: 6px;
        }
        .balance-badge {
            font-size: 14px;
            font-weight: 600;
            color: #4ade80;
            margin-bottom: 6px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">1C BSL AI Copilot</div>
        <div class="badge">● Шлюз NormaHub</div>
    </div>

    <div class="tabs">
        <div class="tab active" data-tab="queryTab">Запросы 1С</div>
        <div class="tab" data-tab="auditTab">Аудит ИТС</div>
        <div class="tab" data-tab="accountTab">Баланс / Шлюз</div>
    </div>

    <!-- TAB 1: QUERY WIZARD -->
    <div class="tab-panel active" id="queryTab">
        <div class="card">
            <div class="card-title">Конструктор запросов 1С</div>
            <textarea id="queryIntent" placeholder="Опишите задачу (например: Выбрать остатки товаров на складе с ценами из регистра сведений на дату документа)..."></textarea>
            <button id="genQueryBtn">Сгенерировать запрос 1С</button>
            <div id="queryStatus" style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px;"></div>
            <div class="code-box" id="queryResultBox" style="display: none;"></div>
        </div>
    </div>

    <!-- TAB 2: STANDARDS AUDIT -->
    <div class="tab-panel" id="auditTab">
        <div class="card">
            <div class="card-title">Проверка стандартов ИТС</div>
            <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 6px;">
                Поиск запросов в циклах, отсутствия блокировок данных и неоптимальных виртуальных таблиц.
            </div>
            <button id="auditBtn">Проверить активный модуль</button>
            <div class="code-box" id="auditReportBox" style="display: none;"></div>
        </div>
    </div>

    <!-- TAB 3: ACCOUNT & BILLING -->
    <div class="tab-panel" id="accountTab">
        <div class="card">
            <div class="card-title">Баланс токенов (Pay-As-You-Go)</div>
            <div class="balance-badge" id="balanceVal">${balanceDisplay}</div>
            <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 8px;">
                Оплата только за реально сгенерированные токены. Без ежемесячной абонентской платы.
            </div>
            <button id="topupBtn">Пополнить баланс (СБП / Карты МИР)</button>
            <button class="secondary" id="b2bBtn">Счет для юрлиц с НДС 20% (Диадок)</button>
        </div>

        <div class="card">
            <div class="card-title">Авторизация</div>
            <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 4px;">
                Ключ: <code>${maskedKey}</code>
            </div>
            <input type="password" id="keyInput" placeholder="nr_hub_..." />
            <button id="saveKeyBtn">Сохранить в SecretStorage</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        // Tabs
        document.querySelectorAll('.tab').forEach(t => {
            t.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                t.classList.add('active');
                document.getElementById(t.getAttribute('data-tab')).classList.add('active');
            });
        });

        // Query wizard
        document.getElementById('genQueryBtn').addEventListener('click', () => {
            const val = document.getElementById('queryIntent').value.trim();
            if (!val) return;
            document.getElementById('queryStatus').textContent = 'Генерация...';
            document.getElementById('queryResultBox').style.display = 'none';
            vscode.postMessage({ type: 'generateQuery', intent: val });
        });

        // Audit
        document.getElementById('auditBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'auditSelection' });
        });

        // Keys & Billing
        document.getElementById('saveKeyBtn').addEventListener('click', () => {
            const val = document.getElementById('keyInput').value.trim();
            vscode.postMessage({ type: 'saveKey', value: val });
        });

        document.getElementById('topupBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'openBilling' });
        });

        document.getElementById('b2bBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'openB2B' });
        });

        window.addEventListener('message', ev => {
            const m = ev.data;
            if (m.type === 'queryResult') {
                const box = document.getElementById('queryResultBox');
                const st = document.getElementById('queryStatus');
                st.textContent = '';
                box.style.display = 'block';
                if (m.code) {
                    box.textContent = m.code;
                    box.style.color = 'var(--vscode-foreground)';
                } else {
                    box.textContent = 'Ошибка: ' + m.error;
                    box.style.color = '#f87171';
                }
            } else if (m.type === 'auditResult') {
                const box = document.getElementById('auditReportBox');
                box.style.display = 'block';
                box.textContent = m.report;
            }
        });
    </script>
</body>
</html>`;
    }
}
