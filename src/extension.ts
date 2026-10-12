import * as vscode from 'vscode';
import { BSLInlineCompletionProvider } from './inlineCompletionProvider';
import { NormaHub1CSidebarProvider } from './sidebarProvider';
import { NormaHubClient } from './normahubClient';
import { StandardsChecker } from './standardsChecker';
import { MetadataScanner } from './metadataScanner';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    // 1. Status Bar Item showing live balance in rubles
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'normahub1c.statusMenu';
    statusBarItem.tooltip = '1C BSL AI Copilot: Кликните для меню баланса и настроек';
    updateStatusBar(context);
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // 2. Inline Completion Provider (Ghost text for BSL/1C/OneScript)
    const bslSelector: vscode.DocumentSelector = [
        { scheme: 'file', language: 'bsl' },
        { scheme: 'file', language: '1c' },
        { scheme: 'file', language: 'oscript' },
        { scheme: 'untitled', language: 'bsl' }
    ];

    const inlineProvider = new BSLInlineCompletionProvider(context);
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(bslSelector, inlineProvider)
    );

    // 3. Webview Sidebar
    const sidebarProvider = new NormaHub1CSidebarProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('normahub1c.mainView', sidebarProvider)
    );

    // 4. Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('normahub1c.statusMenu', () => showStatusMenu(context)),
        vscode.commands.registerCommand('normahub1c.generateQuery', () => handleGenerateQueryCommand(context)),
        vscode.commands.registerCommand('normahub1c.auditStandards', () => handleAuditStandardsCommand()),
        vscode.commands.registerCommand('normahub1c.explainCode', () => handleExplainCodeCommand(context)),
        vscode.commands.registerCommand('normahub1c.scanMetadata', async () => {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
            MetadataScanner.clearCache();
            const meta = await MetadataScanner.scanWorkspace(root);
            vscode.window.showInformationMessage(`Метаданные 1С просканированы: найдено ${meta.objects.length} объектов.`);
        }),
        vscode.commands.registerCommand('normahub1c.topupBalance', () => {
            vscode.env.openExternal(vscode.Uri.parse('https://normahub.cc/billing'));
        }),
        vscode.commands.registerCommand('normahub1c.setApiKey', async () => {
            const key = await vscode.window.showInputBox({
                prompt: 'Введите ваш API-ключ NormaHub (формат nr_hub_...)',
                password: true,
                placeHolder: 'nr_hub_...'
            });
            if (key !== undefined) {
                await NormaHubClient.setApiKey(context, key);
                vscode.window.showInformationMessage('API-ключ сохранен в защищенном SecretStorage.');
                updateStatusBar(context);
            }
        })
    );
}

async function updateStatusBar(context: vscode.ExtensionContext) {
    const apiKey = await NormaHubClient.getApiKey(context);
    if (!apiKey) {
        statusBarItem.text = '$(hubot) 1С Copilot: [Укажите ключ]';
        return;
    }

    const info = await NormaHubClient.checkBalance(apiKey);
    if (info.status === 'active') {
        statusBarItem.text = `$(hubot) 1С Copilot: ${info.balanceRub.toFixed(2)} ₽`;
    } else {
        statusBarItem.text = `$(alert) 1С Copilot: ${info.error || 'Ошибка'}`;
    }
}

async function showStatusMenu(context: vscode.ExtensionContext) {
    const apiKey = await NormaHubClient.getApiKey(context);
    const balanceInfo = await NormaHubClient.checkBalance(apiKey);

    const items = [
        {
            label: `$(credit-card) Пополнить баланс (СБП / Карты МИР)`,
            detail: `Текущий баланс: ${balanceInfo.balanceRub.toFixed(2)} ₽. Оплата только за реальные токены.`,
            action: 'billing'
        },
        {
            label: `$(file-text) Выставить счет юрлицу с НДС 20% (Диадок)`,
            detail: `Безналичный расчет для организаций и франчайзи 1С`,
            action: 'b2b'
        },
        {
            label: `$(key) Настроить API-ключ NormaHub`,
            detail: apiKey ? `Активен ключ ${apiKey.slice(0, 6)}...` : 'Ключ не задан',
            action: 'setKey'
        },
        {
            label: `$(symbol-structure) Обновить метаданные конфигурации`,
            detail: `Повторно сканировать Configuration.xml в проекте`,
            action: 'scanMeta'
        }
    ];

    const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'NormaHub 1C BSL Copilot: Управление шлюзом'
    });

    if (!pick) return;

    if (pick.action === 'billing') {
        vscode.env.openExternal(vscode.Uri.parse('https://normahub.cc/billing'));
    } else if (pick.action === 'b2b') {
        vscode.env.openExternal(vscode.Uri.parse('https://normahub.cc'));
    } else if (pick.action === 'setKey') {
        vscode.commands.executeCommand('normahub1c.setApiKey');
    } else if (pick.action === 'scanMeta') {
        vscode.commands.executeCommand('normahub1c.scanMetadata');
    }
}

async function handleGenerateQueryCommand(context: vscode.ExtensionContext) {
    const intent = await vscode.window.showInputBox({
        prompt: 'Опишите задачу для запроса 1С на русском языке',
        placeHolder: 'Например: Выбрать остатки номенклатуры на складе с ценами на дату документа'
    });
    if (!intent || !intent.trim()) return;

    const apiKey = await NormaHubClient.getApiKey(context);
    if (!apiKey) {
        vscode.window.showErrorMessage('API-ключ не задан. Нажмите на статус-бар 1C Copilot.');
        return;
    }

    const config = vscode.workspace.getConfiguration('normahub1c');
    const model = config.get<string>('reasoningModel', 'claude-sonnet-5-5');

    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const metadata = await MetadataScanner.scanWorkspace(rootPath);
    const metaSummary = MetadataScanner.formatForPrompt(metadata);

    const systemPrompt = `Ты — ведущий эксперт по языку запросов 1С:Предприятие 8.3 (Стандарты фирмы «1С»).
Сформируй оптимизированный BSL-код создания и выполнения объекта Запрос.
Требования стандартов ИТС:
- Использовать параметры в виртуальных таблицах.
- Использовать МенеджерВременныхТаблиц при сложных соединениях.
- Использовать ЕСТЬNULL для агрегатов.
- Добавить Запрос.УстановитьПараметр() для всех параметров.

${metaSummary}`;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: '1C Copilot: Генерация запроса 1С по стандартам ИТС...',
            cancellable: false
        },
        async () => {
            try {
                const code = await NormaHubClient.complete(apiKey, model, systemPrompt, intent, 0.1, 1500);
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    editor.edit(editBuilder => {
                        editBuilder.insert(editor.selection.active, `\n${code}\n`);
                    });
                } else {
                    const doc = await vscode.workspace.openTextDocument({
                        content: code,
                        language: 'bsl'
                    });
                    await vscode.window.showTextDocument(doc);
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`Ошибка генерации: ${err.message}`);
            }
        }
    );
}

function handleAuditStandardsCommand() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Откройте файл с кодом BSL для проверки.');
        return;
    }

    const code = editor.selection.isEmpty
        ? editor.document.getText()
        : editor.document.getText(editor.selection);

    const issues = StandardsChecker.auditCode(code);
    const report = StandardsChecker.formatAuditReport(issues);

    if (issues.length === 0) {
        vscode.window.showInformationMessage('✓ Код полностью соответствует стандартам разработки фирмы «1С» (ИТС).');
    } else {
        vscode.workspace.openTextDocument({
            content: report,
            language: 'markdown'
        }).then(doc => vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside }));
    }
}

async function handleExplainCodeCommand(context: vscode.ExtensionContext) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('Выделите фрагмент BSL-кода для объяснения.');
        return;
    }

    const apiKey = await NormaHubClient.getApiKey(context);
    if (!apiKey) {
        vscode.window.showErrorMessage('API-ключ не задан. Укажите ключ через статус-бар.');
        return;
    }

    const selectedCode = editor.document.getText(editor.selection);
    const config = vscode.workspace.getConfiguration('normahub1c');
    const model = config.get<string>('reasoningModel', 'claude-sonnet-5-5');

    const systemPrompt = `Ты — сеньор-разработчик 1С:Предприятие 8.3.
Объясни назначение выделенного фрагмента кода BSL, укажи контекст исполнения (&НаКлиенте / &НаСервере), используемые регистры и потенциальные узкие места производительности.`;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: '1C Copilot: Анализ фрагмента кода 1С...',
            cancellable: false
        },
        async () => {
            try {
                const explanation = await NormaHubClient.complete(apiKey, model, systemPrompt, selectedCode, 0.2, 1200);
                const doc = await vscode.workspace.openTextDocument({
                    content: `# Инженерный разбор кода 1С\n\n${explanation}`,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
            } catch (err: any) {
                vscode.window.showErrorMessage(`Ошибка анализа: ${err.message}`);
            }
        }
    );
}
