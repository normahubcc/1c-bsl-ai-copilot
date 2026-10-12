import * as vscode from 'vscode';
import { BSLInlineCompletionProvider } from './inlineCompletionProvider';
import { NormaHub1CSidebarProvider } from './sidebarProvider';
import { NormaHubClient } from './normahubClient';
import { StandardsChecker } from './standardsChecker';
import { MetadataScanner } from './metadataScanner';
import { BSPHelper } from './bspHelper';
import { QueryBuilder } from './queryBuilder';
import { ExtensionGenerator, ExtensionDirective } from './extensionGenerator';

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
        vscode.commands.registerCommand('normahub1c.generateBatchQuery', () => handleGenerateBatchQueryCommand()),
        vscode.commands.registerCommand('normahub1c.generateExtensionMethod', () => handleGenerateExtensionMethodCommand()),
        vscode.commands.registerCommand('normahub1c.bspAssistant', () => handleBSPAssistantCommand()),
        vscode.commands.registerCommand('normahub1c.auditStandards', () => handleAuditStandardsCommand()),
        vscode.commands.registerCommand('normahub1c.inspectQuery', () => handleInspectQueryCommand()),
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
            label: `$(symbol-namespace) Сгенерировать перехват для расширения (&Вместо / &ИзменениеИКонтроль)`,
            detail: `Создать безопасный метод расширения конфигурации (cfe)`,
            action: 'extension'
        },
        {
            label: `$(database) Мастер пакетного запроса с временными таблицами`,
            detail: `Создать запрос по стандартам ИТС с индексами и контролем остатков`,
            action: 'batchQuery'
        },
        {
            label: `$(book) Справочник методов БСП (Библиотека Стандартных Подсистем)`,
            detail: `Быстрый подбор функций ОбщегоНазначения, ДлительныеОперации и др.`,
            action: 'bsp'
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
        placeHolder: 'NormaHub 1C BSL Copilot: Управление инструментами разработчика'
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
    } else if (pick.action === 'extension') {
        vscode.commands.executeCommand('normahub1c.generateExtensionMethod');
    } else if (pick.action === 'batchQuery') {
        vscode.commands.executeCommand('normahub1c.generateBatchQuery');
    } else if (pick.action === 'bsp') {
        vscode.commands.executeCommand('normahub1c.bspAssistant');
    }
}

async function handleGenerateBatchQueryCommand() {
    const editor = vscode.window.activeTextEditor;
    const entity = await vscode.window.showInputBox({
        prompt: 'Имя документа или справочника',
        placeHolder: 'Например: РеализацияТоваровУслуг',
        value: 'РеализацияТоваровУслуг'
    });
    if (!entity) return;

    const tabular = await vscode.window.showInputBox({
        prompt: 'Имя табличной части',
        placeHolder: 'Например: Товары',
        value: 'Товары'
    });
    if (!tabular) return;

    const register = await vscode.window.showInputBox({
        prompt: 'Имя регистра накопления для контроля остатков',
        placeHolder: 'Например: ТоварыНаСкладах',
        value: 'ТоварыНаСкладах'
    });
    if (!register) return;

    const code = QueryBuilder.generateBatchQuery({
        entityName: entity,
        tabularSection: tabular,
        registerName: register,
        registerType: 'Остатки',
        fields: ['Номенклатура', 'Количество'],
        includeScaffolding: true
    });

    if (editor) {
        editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, code);
        });
        vscode.window.showInformationMessage('Пакетный запрос 1С по стандартам ИТС успешно вставлен в редактор.');
    } else {
        const doc = await vscode.workspace.openTextDocument({ content: code, language: 'bsl' });
        await vscode.window.showTextDocument(doc);
    }
}

async function handleGenerateExtensionMethodCommand() {
    const editor = vscode.window.activeTextEditor;
    const methodName = await vscode.window.showInputBox({
        prompt: 'Имя типовой процедуры или функции для перехвата',
        placeHolder: 'Например: ОбработкаПроведения или ПриСозданииНаСервере',
        value: 'ОбработкаПроведения'
    });
    if (!methodName) return;

    const directives: ExtensionDirective[] = ['Вместо', 'Перед', 'После', 'ИзменениеИКонтроль'];
    const chosenDirective = await vscode.window.showQuickPick(directives, {
        placeHolder: 'Выберите директиву расширения 1С'
    });
    if (!chosenDirective) return;

    const paramsStr = await vscode.window.showInputBox({
        prompt: 'Параметры процедуры через запятую',
        placeHolder: 'Например: Отказ, РежимПроведения',
        value: methodName.includes('Проведения') ? 'Отказ, РежимПроведения' : 'Отказ, СтандартнаяОбработка'
    });

    const params = paramsStr ? paramsStr.split(',').map(s => s.trim()).filter(Boolean) : [];

    const interceptor = ExtensionGenerator.generateInterceptor({
        targetMethod: methodName,
        directive: chosenDirective as ExtensionDirective,
        moduleType: 'МодульОбъекта',
        isFunction: false,
        parameters: params
    });

    if (editor) {
        editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, interceptor);
        });
        vscode.window.showInformationMessage(`Перехват &${chosenDirective} для расширения 1С добавлен.`);
    } else {
        const doc = await vscode.workspace.openTextDocument({ content: interceptor, language: 'bsl' });
        await vscode.window.showTextDocument(doc);
    }
}

async function handleBSPAssistantCommand() {
    const editor = vscode.window.activeTextEditor;
    const items = BSPHelper.STANDARD_MODULES.map(m => ({
        label: `${m.module}.${m.method}`,
        detail: m.description,
        description: `[${m.context}]`,
        example: m.example
    }));

    const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Выберите метод БСП для вставки примера использования'
    });

    if (!pick) return;

    if (editor) {
        editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, pick.example);
        });
        vscode.window.showInformationMessage(`Пример вызова ${pick.label} вставлен.`);
    }
}

async function handleInspectQueryCommand() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Откройте файл с текстом запроса 1С.');
        return;
    }

    const code = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
    const result = QueryBuilder.inspectQuery(code);

    if (result.isValid && result.issues.length === 0) {
        vscode.window.showInformationMessage('✓ Запрос полностью соответствует стандартам оптимизации ИТС.');
        return;
    }

    const report = result.issues.map(i => `[${i.code}] ${i.message}\nРекомендация: ${i.recommendation}`).join('\n\n');
    vscode.window.showWarningMessage(`Найдено замечаний по запросу: ${result.issues.length}. Подробности в выводе.`, 'Показать отчет').then(sel => {
        if (sel === 'Показать отчет') {
            const channel = vscode.window.createOutputChannel('1C Query Audit');
            channel.clear();
            channel.appendLine(report);
            channel.show();
        }
    });
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
    const bspSummary = BSPHelper.getBSPPromptInjection();

    const systemPrompt = `Ты — ведущий эксперт по языку запросов 1С:Предприятие 8.3 (Стандарты фирмы «1С» и БСП).
Сформируй оптимизированный BSL-код создания и выполнения объекта Запрос.
Требования стандартов ИТС:
- Использовать параметры в виртуальных таблицах.
- Никогда не соединять виртуальные таблицы напрямую — выносить во временные таблицы (ПОМЕСТИТЬ ВТ_...) с обязательным ИНДЕКСИРОВАТЬ ПО.
- Использовать МенеджерВременныхТаблиц.
- Обрабатывать NULL через ЕСТЬNULL(Поле, 0).
- Уничтожать временные таблицы в конце (УНИЧТОЖИТЬ ВТ_...).
- Выведи только готовый BSL-код.

${metaSummary}

${bspSummary}`;

    try {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '1C Copilot: Генерация пакета запросов по стандартам ИТС...'
        }, async () => {
            const queryCode = await NormaHubClient.complete(apiKey, model, systemPrompt, intent, 0.1, 1500);
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                editor.edit(editBuilder => {
                    editBuilder.insert(editor.selection.active, queryCode);
                });
            } else {
                const doc = await vscode.workspace.openTextDocument({ content: queryCode, language: 'bsl' });
                await vscode.window.showTextDocument(doc);
            }
        });
    } catch (err: any) {
        vscode.window.showErrorMessage(`Ошибка генерации: ${err.message}`);
    }
}

function handleAuditStandardsCommand() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Откройте модуль BSL для аудита стандартов ИТС.');
        return;
    }

    const code = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
    const issues = StandardsChecker.auditCode(code);
    const report = StandardsChecker.formatAuditReport(issues);

    const channel = vscode.window.createOutputChannel('1C ITS Standards Audit');
    channel.clear();
    channel.appendLine(report);
    channel.show();

    if (issues.length > 0) {
        vscode.window.showWarningMessage(`Обнаружено замечаний по стандартам ИТС: ${issues.length}. Отчет открыт в панели вывода.`);
    } else {
        vscode.window.showInformationMessage('✓ Код полностью соответствует стандартам разработки ИТС фирмы «1С».');
    }
}

async function handleExplainCodeCommand(context: vscode.ExtensionContext) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selection = editor.selection;
    const code = editor.document.getText(selection);
    if (!code.trim()) {
        vscode.window.showWarningMessage('Выделите фрагмент BSL-кода для анализа.');
        return;
    }

    const apiKey = await NormaHubClient.getApiKey(context);
    if (!apiKey) {
        vscode.window.showErrorMessage('API-ключ не задан.');
        return;
    }

    const config = vscode.workspace.getConfiguration('normahub1c');
    const model = config.get<string>('reasoningModel', 'claude-sonnet-5-5');

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '1C Copilot: Анализ архитектуры BSL-кода...'
    }, async () => {
        try {
            const prompt = `Объясни назначение и логику следующего BSL-кода 1С:Предприятие 8.3.
Укажи, соблюдаются ли стандарты ИТС и БСП, есть ли потенциальные проблемы производительности или блокировок:

${code}`;
            const explanation = await NormaHubClient.complete(apiKey, model, 'Ты — главный архитектор 1С:Предприятие.', prompt, 0.2, 1000);
            const channel = vscode.window.createOutputChannel('1C Code Analysis');
            channel.clear();
            channel.appendLine(explanation);
            channel.show();
        } catch (err: any) {
            vscode.window.showErrorMessage(`Ошибка анализа: ${err.message}`);
        }
    });
}
