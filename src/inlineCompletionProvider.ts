import * as vscode from 'vscode';
import { NormaHubClient } from './normahubClient';
import { MetadataScanner } from './metadataScanner';

/**
 * Native VS Code Inline Completion Provider for 1C:Enterprise (BSL).
 * Provides low-latency, context-aware ghost text completions.
 */
export class BSLInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private lastRequestTime = 0;
    private timer: NodeJS.Timeout | null = null;

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionList | vscode.InlineCompletionItem[] | null> {
        const config = vscode.workspace.getConfiguration('normahub1c');
        const isEnabled = config.get<boolean>('enableInlineCompletion', true);
        if (!isEnabled) {
            return null;
        }

        const apiKey = await NormaHubClient.getApiKey(this.context);
        if (!apiKey) {
            return null;
        }

        const lineText = document.lineAt(position.line).text;
        const textBeforeCursor = lineText.substring(0, position.character);

        // Don't trigger if line is completely empty or just whitespace
        if (!textBeforeCursor.trim() && position.line === 0) {
            return null;
        }

        // Debounce
        const debounceMs = config.get<number>('debounceMs', 250);
        const now = Date.now();
        if (now - this.lastRequestTime < debounceMs) {
            return null;
        }
        this.lastRequestTime = now;

        // Context window: up to 40 lines before, 10 lines after
        const startLine = Math.max(0, position.line - 40);
        const prefixRange = new vscode.Range(new vscode.Position(startLine, 0), position);
        const prefixText = document.getText(prefixRange);

        const endLine = Math.min(document.lineCount - 1, position.line + 10);
        const suffixRange = new vscode.Range(position, new vscode.Position(endLine, document.lineAt(endLine).text.length));
        const suffixText = document.getText(suffixRange);

        // Get metadata context if available
        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const metadata = await MetadataScanner.scanWorkspace(rootPath);
        const metadataSummary = MetadataScanner.formatForPrompt(metadata);

        const model = config.get<string>('autocompleteModel', 'deepseek-v4.1-flash');
        const systemPrompt = `Ты — профессиональный архитектор 1С:Предприятие 8.3.
Твоя задача — мгновенно дописать код BSL (1C:Enterprise) на позиции курсора.
Требования:
1. Выводи ТОЛЬКО продолжение кода. Никаких markdown блоков, никаких пояснений, никаких кавычек.
2. Соблюдай синтаксис 1С: Ключевые слова на русском (Если, Тогда, Иначе, КонецЕсли, Для Каждого, Цикл, КонецЦикла, Новый, Процедура, Функция).
3. Используй точные имена метаданных из контекста.

${metadataSummary}`;

        const userPrompt = `Код ДО курсора:
${prefixText}

Код ПОСЛЕ курсора:
${suffixText}

Допиши код с позиции курсора:`;

        try {
            if (token.isCancellationRequested) {
                return null;
            }

            const completion = await NormaHubClient.complete(
                apiKey,
                model,
                systemPrompt,
                userPrompt,
                0.1,
                150
            );

            if (token.isCancellationRequested || !completion.trim()) {
                return null;
            }

            // Clean up any stray markdown ticks if model emitted them
            let cleanText = completion.replace(/^```(bsl|1c)?\n?/, '').replace(/```$/, '');
            if (!cleanText.trim()) {
                return null;
            }

            const item = new vscode.InlineCompletionItem(
                cleanText,
                new vscode.Range(position, position)
            );

            return [item];
        } catch (_) {
            return null;
        }
    }
}
