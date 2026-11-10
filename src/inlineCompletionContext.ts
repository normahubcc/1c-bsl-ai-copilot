import * as vscode from 'vscode';
import * as path from 'path';
import { MetadataScanner } from './metadataScanner';
import { workspaceRoot as resolveWorkspaceRoot } from './shared/config/workspace';
import { BSPHelper } from './bspHelper';
import { exportedSignatures, moduleIdentity } from './shared/bsl/moduleContext';
import { BSLTokenizer, BSLScopeAnalyzer, BSLScopeContext } from './bslTokenizer';

/**
 * Fast, deterministic context layer for inline completion (Prompt 3).
 *
 * Separates the lightweight autocomplete context from the deep
 * query-generation context: cached metadata trust, cached BSP injection,
 * version-keyed multi-tab signatures (no full source caching), per-section
 * budgets with unicode-safe truncation, and an explicit synthetic-fallback
 * policy. Never logs or returns user code outside the prompt itself.
 */

export type MetadataTrust = 'real' | 'fallback' | 'unavailable';

export interface TrustedMetadataContext {
    trust: MetadataTrust;
    /** Prompt-ready text. Empty unless trust === 'real' (or synthetic explicitly allowed). */
    summary: string;
    objectCount: number;
    sourcePath: string;
}

export interface ModuleSignature {
    moduleName: string;
    fileName: string;
    exportedMethods: string[];
    isCommonModule: boolean;
}

export type ScopeSnapshot = BSLScopeContext;

export interface InlineCompletionContextSnapshot {
    documentUri: string;
    documentVersion: number;
    position: { line: number; character: number };
    prefix: string;
    suffix: string;
    scope: ScopeSnapshot;
    metadata: TrustedMetadataContext;
    bsp: string;
    neighboringModules: ModuleSignature[];
    /** Rendered multi-tab section, already budget-trimmed by the builder. */
    multiTabSection: string;
    generatedAt: number;
    /** Wall-clock cost of context preparation (ms), excluding network. */
    contextBuildMs: number;
}

export interface InlineContextBudgets {
    prefixChars: number;
    suffixChars: number;
    metadataChars: number;
    bspChars: number;
    multiTabChars: number;
    maxNeighborModules: number;
    maxMethodsPerModule: number;
    /** Hard cap over the SUM of the variable sections above. */
    totalChars: number;
}

export const DEFAULT_INLINE_CONTEXT_BUDGETS: InlineContextBudgets = {
    prefixChars: 100000,
    suffixChars: 20000,
    metadataChars: 30000,
    bspChars: 25000,
    multiTabChars: 25000,
    maxNeighborModules: 6,
    maxMethodsPerModule: 8,
    totalChars: 200000,
};

export interface BuildInlineContextOptions {
    budgets?: Partial<InlineContextBudgets>;
    /** Default false: synthetic demo schema is never sent as project structure. */
    includeSyntheticFallback?: boolean;
    /** Overrides vscode.workspace.workspaceFolders[0] (used by tests). */
    workspaceRoot?: string;
}

/** Unicode-safe truncation by code points — never splits a surrogate pair. */
export function truncateCodePoints(text: string, maxChars: number, keep: 'head' | 'tail'): string {
    if (maxChars < 0) {
        return '';
    }
    const points = Array.from(text);
    if (points.length <= maxChars) {
        return text;
    }
    return keep === 'head' ? points.slice(0, maxChars).join('') : points.slice(points.length - maxChars).join('');
}

// ---------------------------------------------------------------------------
// Metadata trust layer (cached, mtime-invalidated)
// ---------------------------------------------------------------------------

interface MetaCacheEntry {
    mtimeMs: string;
    trust: MetadataTrust;
    /** Full untruncated summary; budgets apply at render time. */
    summary: string;
    objectCount: number;
    sourcePath: string;
}

const metaCache = new Map<string, MetaCacheEntry>();

/** Shared revision contract with the raw scanner prevents stale AI-query schemas. */
function getConfigMtimeMs(rootPath: string): string {
    return MetadataScanner.sourceRevision(rootPath);
}

function classifyTrust(isDemoFallback: boolean, objectCount: number): MetadataTrust {
    if (!isDemoFallback && objectCount > 0) {
        return 'real';
    }
    return isDemoFallback ? 'fallback' : 'unavailable';
}

const SYNTHETIC_BANNER =
    '// ВНИМАНИЕ: ниже — СИНТЕТИЧЕСКАЯ демо-схема (файлы конфигурации не найдены). ' +
    'НЕ считать реальной структурой проекта.\n';

async function getTrustedMetadata(
    rootPath: string,
    budgets: InlineContextBudgets,
    includeSyntheticFallback: boolean
): Promise<TrustedMetadataContext> {
    const key = rootPath ? path.resolve(rootPath) : '';
    const mtimeMs = getConfigMtimeMs(rootPath);
    const cached = metaCache.get(key);

    let entry = cached && cached.mtimeMs === mtimeMs ? cached : undefined;
    if (!entry) {
        if (key && (!cached || cached.mtimeMs !== mtimeMs)) {
            // Configuration source changed (or first sight): drop the raw scan cache.
            MetadataScanner.clearCache(rootPath);
        }
        const meta = await MetadataScanner.scanWorkspace(rootPath);
        const trust = classifyTrust(!!meta.isDemoFallback, meta.objects.length);
        entry = {
            mtimeMs,
            trust,
            summary: MetadataScanner.formatForPrompt(meta),
            objectCount: meta.objects.length,
            sourcePath: meta.sourcePath || key,
        };
        metaCache.set(key, entry);
    }

    if (entry.trust === 'real') {
        return {
            trust: 'real',
            summary: truncateCodePoints(entry.summary, budgets.metadataChars, 'head'),
            objectCount: entry.objectCount,
            sourcePath: entry.sourcePath,
        };
    }
    if (entry.trust === 'fallback' && includeSyntheticFallback) {
        return {
            trust: 'fallback',
            summary: SYNTHETIC_BANNER + truncateCodePoints(entry.summary, budgets.metadataChars, 'head'),
            objectCount: entry.objectCount,
            sourcePath: entry.sourcePath,
        };
    }
    return { trust: entry.trust, summary: '', objectCount: entry.objectCount, sourcePath: entry.sourcePath };
}

// ---------------------------------------------------------------------------
// BSP injection (static content — cache the full text once)
// ---------------------------------------------------------------------------

let bspCache: string | null = null;

function getCachedBsp(): string {
    if (bspCache === null) {
        bspCache = BSPHelper.getBSPPromptInjection();
    }
    return bspCache;
}

// ---------------------------------------------------------------------------
// Multi-tab signatures (version-keyed; full source is never cached)
// ---------------------------------------------------------------------------

interface SignatureCacheEntry {
    maxMethods: number;
    document: vscode.TextDocument;
    version: number;
    moduleName: string;
    fileName: string;
    exportedMethods: string[];
    isCommonModule: boolean;
}

const signatureCache = new Map<string, SignatureCacheEntry>();

function parseExportedMethods(text: string, cap: number): string[] {
    return exportedSignatures(text, cap);
}

/** Neighboring open modules, active document excluded. Exported signatures win over prose. */
export function getNeighboringModules(
    activeDocument: vscode.TextDocument,
    budgets: InlineContextBudgets
): ModuleSignature[] {
    const out: ModuleSignature[] = [];
    if (budgets.maxNeighborModules <= 0) return out;
    const seen = new Set<string>();
    const activeUri = activeDocument.uri.toString();
    const docs = vscode.workspace.textDocuments || [];
    const folders = vscode.workspace.workspaceFolders || [];
    const activeRoot = vscode.workspace.getWorkspaceFolder?.(activeDocument.uri) || (activeDocument.uri.scheme !== 'file' && folders.length === 1 ? folders[0] : undefined);
    if (folders.length > 1 && !activeRoot) return [];
    if (activeDocument.uri.scheme === 'file' && !activeRoot) return [];

    for (const doc of docs) {
        if (!doc || doc.uri.toString() === activeUri) {
            continue;
        }
        const neighborRoot = vscode.workspace.getWorkspaceFolder?.(doc.uri);
        if (activeRoot && neighborRoot?.uri.toString() !== activeRoot.uri.toString()) continue;
        const fileName = (doc as vscode.TextDocument).fileName || '';
        if (!fileName.endsWith('.bsl') && !fileName.endsWith('.os')) {
            continue;
        }
        if (doc.isClosed) continue;
        const key = doc.uri.toString();
        seen.add(key);
        const cached = signatureCache.get(key);
        if (cached && cached.document === doc && cached.version === doc.version && cached.maxMethods >= budgets.maxMethodsPerModule) {
            out.push({
                moduleName: cached.moduleName,
                fileName: cached.fileName,
                exportedMethods: cached.exportedMethods.slice(0, budgets.maxMethodsPerModule),
                isCommonModule: cached.isCommonModule,
            });
        } else {
            let text = '';
            try {
                if ((doc as unknown as { isClosed?: boolean }).isClosed) {
                    continue;
                }
                text = doc.getText();
            } catch (_) {
                continue;
            }
            if (!text) {
                continue;
            }
            const identity = moduleIdentity(fileName);
            const entry: SignatureCacheEntry = {
                maxMethods: budgets.maxMethodsPerModule, document: doc, version: doc.version,
                moduleName: identity.moduleName,
                fileName: path.basename(fileName),
                exportedMethods: parseExportedMethods(text, budgets.maxMethodsPerModule),
                isCommonModule: identity.isCommonModule,
            };
            signatureCache.set(key, entry);
            out.push({
                moduleName: entry.moduleName,
                fileName: entry.fileName,
                exportedMethods: [...entry.exportedMethods],
                isCommonModule: entry.isCommonModule,
            });
        }
        if (out.length >= budgets.maxNeighborModules) {
            break;
        }
    }

    for (const tracked of [...signatureCache.keys()]) {
        if (!seen.has(tracked)) {
            signatureCache.delete(tracked);
        }
    }
    return out;
}

export function renderNeighborModulesSection(modules: ModuleSignature[], budgetChars: number): string {
    if (modules.length === 0) {
        return '';
    }
    const lines = ['СМЕЖНЫЕ ОТКРЫТЫЕ МОДУЛИ В РАБОЧЕЙ ОБЛАСТИ (MULTI-TAB CONTEXT):'];
    for (const m of modules) {
        lines.push(`- Модуль "${m.moduleName}" (${m.fileName}):`);
        lines.push(
            m.exportedMethods.length > 0
                ? `  Экспортные методы: ${m.exportedMethods.join(', ')}`
                : '  (Открыт в соседней вкладке)'
        );
    }
    return truncateCodePoints(lines.join('\n'), budgetChars, 'head');
}

// ---------------------------------------------------------------------------
// Snapshot builder + prompt renderer
// ---------------------------------------------------------------------------

export function getInlineContextKey(
    snapshot: Pick<InlineCompletionContextSnapshot, 'documentUri' | 'documentVersion' | 'position'>
): string {
    return `${snapshot.documentUri}#v${snapshot.documentVersion}@${snapshot.position.line}:${snapshot.position.character}`;
}

export async function buildInlineCompletionContext(
    document: vscode.TextDocument,
    position: vscode.Position,
    options?: BuildInlineContextOptions
): Promise<InlineCompletionContextSnapshot> {
    const startedAt = Date.now();
    const budgets: InlineContextBudgets = { ...DEFAULT_INLINE_CONTEXT_BUDGETS, ...(options?.budgets || {}) };
    const rootPath =
        options?.workspaceRoot ??
        resolveWorkspaceRoot(document);

    // Same window as before: 50 lines before, 15 lines after; budgets trim the tails.
    const startLine = Math.max(0, position.line - 50);
    const prefixRange = new vscode.Range(new vscode.Position(startLine, 0), position);
    const rawPrefix = document.getText(prefixRange);

    const endLine = Math.min(document.lineCount - 1, position.line + 15);
    const suffixRange = new vscode.Range(
        position,
        new vscode.Position(endLine, document.lineAt(endLine).text.length)
    );
    const rawSuffix = document.getText(suffixRange);
    const fullDocText = document.getText();

    const tokens = BSLTokenizer.tokenize(fullDocText);
    const scope = BSLScopeAnalyzer.analyzeScopeAtPosition(tokens, position.line + 1, position.character + 1);

    const metadata = await getTrustedMetadata(rootPath, budgets, !!options?.includeSyntheticFallback);
    const neighbors = getNeighboringModules(document, budgets);

    // Deterministic total-budget enforcement. Priority (trimmed last):
    // current-method context (prefix) > suffix > real metadata > neighbor signatures > BSP.
    let prefix = truncateCodePoints(rawPrefix, budgets.prefixChars, 'tail');
    let suffix = truncateCodePoints(rawSuffix, budgets.suffixChars, 'head');
    let metaSummary = metadata.summary;
    let multiTab = renderNeighborModulesSection(neighbors, budgets.multiTabChars);
    let bsp = truncateCodePoints(getCachedBsp(), budgets.bspChars, 'head');

    let over =
        prefix.length + suffix.length + metaSummary.length + multiTab.length + bsp.length - budgets.totalChars;
    const trimmable: Array<{ get: () => string; set: (v: string) => void; keep: 'head' | 'tail' }> = [
        { get: () => bsp, set: (v) => { bsp = v; }, keep: 'head' },
        { get: () => multiTab, set: (v) => { multiTab = v; }, keep: 'head' },
        { get: () => metaSummary, set: (v) => { metaSummary = v; }, keep: 'head' },
        { get: () => suffix, set: (v) => { suffix = v; }, keep: 'head' },
        { get: () => prefix, set: (v) => { prefix = v; }, keep: 'tail' },
    ];
    for (const section of trimmable) {
        if (over <= 0) {
            break;
        }
        const current = section.get();
        if (current.length === 0) {
            continue;
        }
        const cut = Math.min(current.length, over);
        section.set(truncateCodePoints(current, current.length - cut, section.keep));
        over -= cut;
    }

    const finishedAt = Date.now();
    return {
        documentUri: document.uri.toString(),
        documentVersion: document.version,
        position: { line: position.line, character: position.character },
        prefix,
        suffix,
        scope,
        metadata: { ...metadata, summary: metaSummary },
        bsp,
        neighboringModules: neighbors,
        multiTabSection: multiTab,
        generatedAt: finishedAt,
        contextBuildMs: finishedAt - startedAt,
    };
}

export function renderInlineSystemPrompt(snapshot: InlineCompletionContextSnapshot): string {
    const scope = snapshot.scope;
    let methodScopeDesc = 'Глобальный контекст модуля';
    if (scope.currentMethod) {
        const paramsStr = scope.currentMethod.parameters
            .map((p) => `${p.isVal ? 'Знач ' : ''}${p.name}`)
            .join(', ');
        const typeStr = scope.currentMethod.isFunction ? 'Функция' : 'Процедура';
        methodScopeDesc = `${scope.compilationDirective ? scope.compilationDirective + '\n' : ''}${typeStr} ${scope.currentMethod.name}(${paramsStr})`;
    }
    const localVarsStr = scope.localVariables.length > 0 ? scope.localVariables.join(', ') : 'Не объявлены';
    const multiTab = snapshot.multiTabSection;

    return `Ты — ведущий системный архитектор 1С:Предприятие 8.3 (Стандарты фирмы «1С» и БСП).
Твоя задача — мгновенно дописать код BSL (1C:Enterprise) на позиции курсора.

ТЕКУЩИЙ КОНТЕКСТ ВЫПОЛНЕНИЯ (AST SCOPE):
- Метод: ${methodScopeDesc}
- Доступные переменные и параметры: ${localVarsStr}
- Внутри цикла: ${scope.insideLoop ? 'Да' : 'Нет'}
- Внутри попытки: ${scope.insideTry ? 'Да' : 'Нет'}

ТРЕБОВАНИЯ СТАНДАРТОВ 1С:
1. Выводи ТОЛЬКО прямое продолжение кода. Никаких markdown блоков, никаких пояснений, никаких обратных кавычек.
2. Синтаксис: Ключевые слова на русском (Если, Тогда, Иначе, КонецЕсли, Для Каждого, Цикл, КонецЦикла, Новый, Процедура, Функция, Возврат).
3. Строго соблюдай директиву компиляции (${scope.compilationDirective || 'Сервер'}).
4. Запрещено передавать мутабельные объекты (ТаблицаЗначений) между клиентом и сервером.
5. При чтении реквизитов использовать функции БСП (ОбщегоНазначения.ЗначениеРеквизитаОбъекта), а не ПолучитьОбъект().

КОНТЕКСТ МЕТАДАННЫХ БАЗЫ:
${snapshot.metadata.summary}
${multiTab ? '\n' + multiTab : ''}

${snapshot.bsp}`;
}

export function renderInlineUserPrompt(prefix: string, suffix: string): string {
    return suffix.trim()
        ? `КОД ДО КУРСОРА:\n${prefix}\n\nКОД ПОСЛЕ КУРСОРА:\n${suffix}\n\nНапиши ТОЛЬКО код для вставки на позиции курсора без обратных кавычек.`
        : `КОД ДО КУРСОРА:\n${prefix}\n\nНапиши ТОЛЬКО код продолжения на позиции курсора без обратных кавычек.`;
}

/** Full invalidation: workspace switch, config change (via mtime), manual rescan, explicit clear. */
export function clearInlineCompletionContextCache(workspaceRoot?: string): void {
    bspCache = null;
    signatureCache.clear();
    if (workspaceRoot !== undefined) {
        metaCache.delete(workspaceRoot ? path.resolve(workspaceRoot) : '');
    } else {
        metaCache.clear();
    }
}
