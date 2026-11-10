import * as vscode from 'vscode';
import { BSLInlineCompletionProvider } from './inlineCompletionProvider';
import { NormaHub1CSidebarProvider } from './sidebarProvider';
import { NormaHubClient } from './normahubClient';
import { StandardsChecker } from './standardsChecker';
import { MetadataScanner } from './metadataScanner';
import { clearInlineCompletionContextCache } from './inlineCompletionContext';
import { workspaceRoot } from './shared/config/workspace';
import { watchMetadataChanges } from './features/project-context/model/watchMetadata';
import { preferredUiLanguage } from './features/ui-language/model/preferences';
import { translateText, UiLanguage } from './shared/i18n/translator';
import { watchEditorTargetLifecycle } from './features/apply-code/model/targetLifecycle';

let statusBarItem: vscode.StatusBarItem;
let diagnostics: vscode.DiagnosticCollection;
let extensionUiLanguage: UiLanguage = 'ru';
let statusBarSource = '';
const uiText = (source: string) => translateText(source, extensionUiLanguage);
function setStatusBarText(source: string) {
    statusBarSource = source;
    statusBarItem.text = uiText(source);
}

const BSL_DOCUMENT_SELECTOR: vscode.DocumentSelector = [
    { scheme: 'file', language: 'bsl' },
    { scheme: 'file', language: '1c' },
    { scheme: 'file', language: 'oscript' },
    { scheme: 'untitled', language: 'bsl' },
    { scheme: 'untitled', language: '1c' },
    { scheme: 'untitled', language: 'oscript' }
];

export function activate(context: vscode.ExtensionContext) {
    extensionUiLanguage = preferredUiLanguage(context);
    diagnostics = vscode.languages.createDiagnosticCollection('normahub1c');
    context.subscriptions.push(diagnostics);
    context.subscriptions.push(...watchMetadataChanges());
    context.subscriptions.push(watchEditorTargetLifecycle());

    // 1. Gateway access status; actual balance is managed in the external account.
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'normahub1c.statusMenu';
    statusBarItem.tooltip = uiText('1C BSL AI Copilot: Кликните для меню баланса и настроек');
    updateStatusBar(context);
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // 2. Inline Completion Provider (Ghost text for BSL/1C/OneScript)
    const inlineProvider = new BSLInlineCompletionProvider(context);
    context.subscriptions.push(
        inlineProvider,
        vscode.commands.registerCommand('normahub1c.inlineAccepted', (uri: string, version: number) => inlineProvider.markAccepted(uri, version)),
        vscode.languages.registerInlineCompletionItemProvider(BSL_DOCUMENT_SELECTOR, inlineProvider),
        vscode.languages.registerCodeActionsProvider(BSL_DOCUMENT_SELECTOR, new BSLCodeActionProvider(), {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
        }),
        vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
        vscode.workspace.onDidChangeTextDocument(event => updateDiagnostics(event.document)),
        vscode.workspace.onDidCloseTextDocument(document => diagnostics.delete(document.uri))
    );

    for (const document of vscode.workspace.textDocuments) {
        updateDiagnostics(document);
    }
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('normahub1c.auditDisabledRules')) for (const document of vscode.workspace.textDocuments) updateDiagnostics(document);
    }));

    // 3. Webview Sidebar
    const sidebarProvider = new NormaHub1CSidebarProvider(context.extensionUri, context, language => {
        extensionUiLanguage = language;
        setStatusBarText(statusBarSource);
        statusBarItem.tooltip = uiText('1C BSL AI Copilot: Кликните для меню баланса и настроек');
        for (const document of vscode.workspace.textDocuments) updateDiagnostics(document);
    });
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('normahub1c.mainView', sidebarProvider)
    );

    if (context.secrets.onDidChange) context.subscriptions.push(context.secrets.onDidChange(() => { void updateStatusBar(context); }));

    // 4. Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('normahub1c.statusMenu', () => showStatusMenu(context)),
        vscode.commands.registerCommand('normahub1c.reviewLastPreview', () => sidebarProvider.reviewLatestPreview()),
        vscode.commands.registerCommand('normahub1c.manageQueryRunner', () => sidebarProvider.manageRunnerProfile()),
        vscode.commands.registerCommand('normahub1c.generateQuery', () => sidebarProvider.openTool('queries-gen')),
        vscode.commands.registerCommand('normahub1c.generateBatchQuery', () => sidebarProvider.openTool('queries-batch')),
        vscode.commands.registerCommand('normahub1c.generateExtensionMethod', () => sidebarProvider.openTool('extensions')),
        vscode.commands.registerCommand('normahub1c.bspAssistant', () => sidebarProvider.openTool('bsp')),
        vscode.commands.registerCommand('normahub1c.auditStandards', () => sidebarProvider.openTool('audit')),
        vscode.commands.registerCommand('normahub1c.inspectQuery', () => sidebarProvider.openTool('audit')),
        vscode.commands.registerCommand('normahub1c.refactorQuery', () => sidebarProvider.openTool('queries-refactor')),
        vscode.commands.registerCommand('normahub1c.generateVanessaFeature', () => sidebarProvider.openTool('bdd')),
        vscode.commands.registerCommand('normahub1c.analyzeTechLog', () => sidebarProvider.openTool('techlog')),
        vscode.commands.registerCommand('normahub1c.explainCode', () => sidebarProvider.openTool('audit', true)),
        vscode.commands.registerCommand('normahub1c.showAuditRecommendation', (issue: { rule: string; suggestion: string }) => {
            vscode.window.showInformationMessage(`${issue.rule}: ${uiText(issue.suggestion)}`);
        }),
        vscode.commands.registerCommand('normahub1c.scanMetadata', async () => {
            const root = workspaceRoot();
            MetadataScanner.clearCache();
            clearInlineCompletionContextCache();
            const meta = await MetadataScanner.scanWorkspace(root);
            vscode.window.showInformationMessage(uiText(meta.objects.length ? `Метаданные 1С: ${meta.objects.length} объектов.` : 'Метаданные не найдены. Откройте XML/EDT-проект или добавьте metadata.json.'));
        }),
        vscode.commands.registerCommand('normahub1c.topupBalance', () => {
            vscode.env.openExternal(vscode.Uri.parse('https://normahub.cc'));
        }),
        vscode.commands.registerCommand('normahub1c.setApiKey', async () => {
            const key = await vscode.window.showInputBox({
                prompt: uiText('Введите ваш API-ключ NormaHub (формат nr_hub_...)'),
                password: true,
                placeHolder: 'nr_hub_...'
            });
            if (key !== undefined) {
                await NormaHubClient.setApiKey(context, key);
                vscode.window.showInformationMessage(uiText('API-ключ сохранен в защищенном SecretStorage.'));
                updateStatusBar(context);
            }
        })
    );
}

function isBSLDocument(document: vscode.TextDocument): boolean {
    return ['bsl', '1c', 'oscript'].includes(document.languageId)
        || /\.(bsl|os)$/i.test(document.fileName);
}

function updateDiagnostics(document: vscode.TextDocument): void {
    if (!diagnostics || !isBSLDocument(document)) {
        return;
    }

    const issues = StandardsChecker.auditCode(document.getText(), {disabledRules:vscode.workspace.getConfiguration('normahub1c', document.uri).get<string[]>('auditDisabledRules', [])}).filter(issue => issue.rule !== 'INPUT-EMPTY');
    const items = issues.map(issue => {
        const line = Math.max(0, Math.min(document.lineCount - 1, issue.line - 1));
        const end = document.lineAt(line).range.end;
        const severity = issue.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : issue.severity === 'warning'
                ? vscode.DiagnosticSeverity.Warning
                : vscode.DiagnosticSeverity.Information;
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(new vscode.Position(line, 0), end),
            `[${issue.rule}] ${uiText(issue.message)}`,
            severity
        );
        diagnostic.code = issue.rule;
        diagnostic.source = '1C ITS';
        diagnostic.relatedInformation = [new vscode.DiagnosticRelatedInformation(
            new vscode.Location(document.uri, new vscode.Range(line, 0, line, 0)),
            uiText(issue.suggestion)
        )];
        return diagnostic;
    });
    diagnostics.set(document.uri, items);
}

class BSLCodeActionProvider implements vscode.CodeActionProvider {
    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];
        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source !== '1C ITS' || !diagnostic.code) {
                continue;
            }
            const issue = StandardsChecker.auditCode(document.getText(), {disabledRules:vscode.workspace.getConfiguration('normahub1c', document.uri).get<string[]>('auditDisabledRules', [])}).find(item => item.rule === diagnostic.code && item.line - 1 === diagnostic.range.start.line);
            if (!issue) {
                continue;
            }
            const action = new vscode.CodeAction(
                uiText(`1C ITS: показать рекомендацию для ${issue.rule}`),
                vscode.CodeActionKind.QuickFix
            );
            action.diagnostics = [diagnostic];
            action.command = {
                command: 'normahub1c.showAuditRecommendation',
                title: uiText('Показать рекомендацию'),
                arguments: [issue]
            };
            actions.push(action);
        }
        return actions;
    }
}

async function updateStatusBar(context: vscode.ExtensionContext) {
    const apiKey = await NormaHubClient.getApiKey(context);
    if (!apiKey) {
        setStatusBarText('$(hubot) 1С Copilot: [Ключ не задан]');
        return;
    }

    const info = await NormaHubClient.checkBalance(apiKey);
    if (info.status === 'active') {
        setStatusBarText('$(hubot) 1С Copilot: Активен');
    } else {
        setStatusBarText(`$(alert) 1С Copilot: ${info.error || 'Ошибка ключа'}`);
    }
}

async function showStatusMenu(context: vscode.ExtensionContext) {
    const apiKey = await NormaHubClient.getApiKey(context);
    const balanceInfo = await NormaHubClient.checkBalance(apiKey);

    const items = [
        {
            label: `$(credit-card) Личный кабинет и баланс (normahub.cc)`,
            detail: `Шлюз: ${balanceInfo.status === 'active' ? 'Подключен (Pay-As-You-Go)' : (balanceInfo.error || 'Ключ не задан')}. Управление токенами на normahub.cc.`,
            action: 'billing'
        },

        {
            label: `$(symbol-namespace) Подготовить перехват для расширения (&Вместо / &Перед / &После)`,
            detail: `Подготовить BSL-шаблон перехвата в модуле расширения`,
            action: 'extension'
        },
        {
            label: `$(database) Мастер пакетного запроса с временными таблицами`,
            detail: `Подготовить шаблон запроса контроля дефицита с явными полями`,
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

    const pick = await vscode.window.showQuickPick(items.map(item => ({...item,label:uiText(item.label),detail:uiText(item.detail)})), {
        placeHolder: uiText('NormaHub 1C BSL Copilot: Управление инструментами разработчика')
    });

    if (!pick) return;

    if (pick.action === 'billing') {
        vscode.env.openExternal(vscode.Uri.parse('https://normahub.cc'));
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
