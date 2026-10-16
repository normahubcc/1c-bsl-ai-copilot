import * as vscode from 'vscode';
import { NormaHubClient } from './normahubClient';
import {
    buildInlineCompletionContext,
    renderInlineSystemPrompt,
    renderInlineUserPrompt,
    DEFAULT_INLINE_CONTEXT_BUDGETS,
} from './inlineCompletionContext';
import { normalizeInlineCompletion, DEFAULT_NORMALIZER_LIMITS } from './inlineCompletionNormalizer';
import {
    recordCompletionMetrics,
    formatMetricsLine,
    appendCompletionDebugLine,
    classifyCompletionError,
    CompletionMetrics,
} from './inlineCompletionMetrics';

/**
 * Identity of a single inline-completion request.
 * Used to discard stale responses: only the newest request for the
 * active document may produce a visible completion.
 */
export interface CompletionRequestIdentity {
    requestId: number;
    documentUri: string;
    documentVersion: number;
    line: number;
    character: number;
}

export function getCompletionRequestKey(identity: CompletionRequestIdentity): string {
    return `${identity.documentUri}#v${identity.documentVersion}@${identity.line}:${identity.character}#${identity.requestId}`;
}

interface ActiveCompletion {
    identity: CompletionRequestIdentity;
    abort: AbortController;
    debounceTimer: ReturnType<typeof setTimeout> | undefined;
    settled: boolean;
}

/**
 * Native VS Code Inline Completion Provider for 1C:Enterprise (BSL) - Senior Grade.
 *
 * Lifecycle (production-grade):
 *   each call → request identity → cancel previous slot → trailing debounce
 *   → revalidate (identity / token / document version) → build context
 *   → cancellable NormaHubClient.complete({ signal })
 *   → revalidate identity → return item only if still current, else null.
 *
 * Cancellation is silent: no toasts, no log noise, no secret leakage.
 */
export class BSLInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private lastRequestId = 0;
    private active: ActiveCompletion | null = null;

    constructor(private readonly context: vscode.ExtensionContext) {}

    private cancelActive(): void {
        const prev = this.active;
        if (!prev || prev.settled) {
            return;
        }
        prev.settled = true;
        try {
            prev.abort.abort();
        } catch (_) {
            // Abort must never throw into the new request path.
        }
        if (prev.debounceTimer !== undefined) {
            clearTimeout(prev.debounceTimer);
            prev.debounceTimer = undefined;
        }
    }

    private release(slot: ActiveCompletion): void {
        if (this.active === slot) {
            this.active = null;
        }
        if (slot.debounceTimer !== undefined) {
            clearTimeout(slot.debounceTimer);
            slot.debounceTimer = undefined;
        }
    }

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

        // Don't trigger if line is completely empty or just whitespace at start of empty doc
        if (!textBeforeCursor.trim() && position.line === 0) {
            return null;
        }

        if (token.isCancellationRequested) {
            return null;
        }

        // 1. Request identity + cancel the previous slot (same or other document).
        const identity: CompletionRequestIdentity = {
            requestId: ++this.lastRequestId,
            documentUri: document.uri.toString(),
            documentVersion: document.version,
            line: position.line,
            character: position.character,
        };
        this.cancelActive();
        const slot: ActiveCompletion = {
            identity,
            abort: new AbortController(),
            debounceTimer: undefined,
            settled: false,
        };
        this.active = slot;

        // 2. Trailing debounce, restarted on every keystroke.
        //    Every call waits exactly debounceMs (never longer): a burst of
        //    keystrokes collapses into a single network request for the last
        //    position, so no stale request is ever sent or billed.
        const debounceMs = config.get<number>('debounceMs', 250);
        const waitMs = debounceMs > 0 ? debounceMs : 0;
        const model = config.get<string>('autocompleteModel', 'deepseek-v4.1-flash');
        const requestTimeoutMs = config.get<number>('requestTimeoutMs', 25000);
        const contextBudgetChars = config.get<number>('contextBudgetChars', DEFAULT_INLINE_CONTEXT_BUDGETS.totalChars);
        const debug = config.get<boolean>('completionDebug', false);

        // Diagnostics: numbers and enums only — never code, prompts or keys.
        const invokedAt = Date.now();
        const emit = (outcome: Partial<CompletionMetrics> & { errorClass?: string }) => {
            const m: CompletionMetrics = {
                requestId: identity.requestId,
                model,
                contextBuildMs: 0,
                debounceWaitMs: 0,
                totalMs: Date.now() - invokedAt,
                cancelled: false,
                empty: false,
                normalized: false,
                ...outcome,
            };
            recordCompletionMetrics(m);
            if (debug) {
                appendCompletionDebugLine(formatMetricsLine(m));
            }
        };

        const waited = await this.waitDebounce(slot, token, waitMs);
        if (waited.cancelled || slot.settled || this.active !== slot) {
            this.release(slot);
            emit({ debounceWaitMs: waited.waitedMs, cancelled: true });
            return null;
        }
        if (token.isCancellationRequested || slot.abort.signal.aborted) {
            this.release(slot);
            emit({ debounceWaitMs: waited.waitedMs, cancelled: true });
            return null;
        }
        if (document.version !== identity.documentVersion) {
            // Document changed while debouncing — this request is stale.
            slot.settled = true;
            this.release(slot);
            emit({ debounceWaitMs: waited.waitedMs, cancelled: true });
            return null;
        }

        // Fast autocomplete context: cached trusted metadata (fallback excluded),
        // cached BSP, version-keyed neighbor signatures, per-section budgets.
        let systemPrompt: string;
        let userPrompt: string;
        let snapshotPrefix = '';
        let snapshotSuffix = '';
        let contextBuildMs = 0;
        const ctxStartedAt = Date.now();
        try {
            const snapshot = await buildInlineCompletionContext(document, position, {
                budgets: { totalChars: contextBudgetChars },
            });
            contextBuildMs = snapshot.contextBuildMs;
            if (slot.settled || this.active !== slot || token.isCancellationRequested) {
                this.release(slot);
                emit({ debounceWaitMs: waited.waitedMs, contextBuildMs, cancelled: true });
                return null;
            }
            if (document.version !== identity.documentVersion) {
                slot.settled = true;
                this.release(slot);
                emit({ debounceWaitMs: waited.waitedMs, contextBuildMs, cancelled: true });
                return null;
            }
            systemPrompt = renderInlineSystemPrompt(snapshot);
            userPrompt = renderInlineUserPrompt(snapshot.prefix, snapshot.suffix);
            snapshotPrefix = snapshot.prefix;
            snapshotSuffix = snapshot.suffix;
        } catch (_) {
            // Document changed under us (e.g. lines removed) — drop silently.
            slot.settled = true;
            this.release(slot);
            emit({
                debounceWaitMs: waited.waitedMs,
                contextBuildMs: Date.now() - ctxStartedAt,
                errorClass: 'context',
            });
            return null;
        }

        // 3. Cancellable network request. VS Code token → AbortController.
        const tokenListener =
            typeof token.onCancellationRequested === 'function'
                ? token.onCancellationRequested(() => {
                    if (!slot.settled) {
                        slot.settled = true;
                        try {
                            slot.abort.abort();
                        } catch (_) {}
                    }
                })
                : undefined;

        let completion: string;
        let networkMs = 0;
        const netStartedAt = Date.now();
        try {
            if (token.isCancellationRequested || slot.abort.signal.aborted) {
                this.release(slot);
                emit({ debounceWaitMs: waited.waitedMs, contextBuildMs, cancelled: true });
                return null;
            }

            completion = await NormaHubClient.complete(
                apiKey,
                model,
                systemPrompt,
                userPrompt,
                0.1,
                800,
                { signal: slot.abort.signal, timeoutMs: requestTimeoutMs }
            );
            networkMs = Date.now() - netStartedAt;
        } catch (err) {
            // Cancelled, timeout and gateway errors are all silent for ghost text.
            networkMs = Date.now() - netStartedAt;
            const errorClass = classifyCompletionError(err);
            const cancelled =
                errorClass === 'cancelled' ||
                slot.settled ||
                slot.abort.signal.aborted ||
                token.isCancellationRequested;
            this.release(slot);
            emit({ debounceWaitMs: waited.waitedMs, contextBuildMs, networkMs, cancelled, errorClass });
            return null;
        } finally {
            try {
                tokenListener?.dispose();
            } catch (_) {}
        }

        // 4. Post-flight identity check: only the newest request may complete.
        if (slot.settled || slot.abort.signal.aborted || token.isCancellationRequested) {
            this.release(slot);
            emit({ debounceWaitMs: waited.waitedMs, contextBuildMs, networkMs, cancelled: true });
            return null;
        }
        if (this.active !== slot) {
            this.release(slot);
            emit({ debounceWaitMs: waited.waitedMs, contextBuildMs, networkMs, cancelled: true });
            return null;
        }
        this.release(slot);

        // 5. Normalize: only safe, conservative BSL text becomes ghost text.
        //    Anything ambiguous is dropped silently (counted in diagnostics,
        //    never shown to the user, never logged).
        if (!completion.trim()) {
            emit({ debounceWaitMs: waited.waitedMs, contextBuildMs, networkMs, empty: true });
            return null;
        }
        const maxCompletionLines = config.get<number>('maxCompletionLines', DEFAULT_NORMALIZER_LIMITS.maxLines);
        const maxCompletionChars = config.get<number>('maxCompletionChars', DEFAULT_NORMALIZER_LIMITS.maxChars);
        let currentLineBeforeCursor = '';
        try {
            const lineText = document.lineAt(position.line).text;
            currentLineBeforeCursor = lineText.substring(0, position.character);
        } catch (_) {
            currentLineBeforeCursor = '';
        }
        const normalized = normalizeInlineCompletion(completion, {
            prefix: snapshotPrefix,
            suffix: snapshotSuffix,
            currentLineBeforeCursor,
            maxLines: maxCompletionLines,
            maxChars: maxCompletionChars,
        });
        if (!normalized) {
            emit({ debounceWaitMs: waited.waitedMs, contextBuildMs, networkMs });
            return null;
        }

        emit({ debounceWaitMs: waited.waitedMs, contextBuildMs, networkMs, normalized: true });

        const item = new vscode.InlineCompletionItem(
            normalized.text,
            new vscode.Range(position, position)
        );

        return [item];
    }

    /**
     * Trailing-debounce wait. `cancelled` is true when the wait was cut short
     * by a newer request (abort), the VS Code token, or disposal.
     * Never rejects — no unhandled promise rejections by construction.
     */
    private waitDebounce(
        slot: ActiveCompletion,
        token: vscode.CancellationToken,
        waitMs: number
    ): Promise<{ cancelled: boolean; waitedMs: number }> {
        return new Promise<{ cancelled: boolean; waitedMs: number }>((resolve) => {
            const startedAt = Date.now();
            const done = (cancelled: boolean) => {
                resolve({ cancelled, waitedMs: Date.now() - startedAt });
            };
            if (waitMs <= 0) {
                done(false);
                return;
            }
            let finished = false;
            const finish = (cancelled: boolean) => {
                if (finished) {
                    return;
                }
                finished = true;
                if (slot.debounceTimer !== undefined) {
                    clearTimeout(slot.debounceTimer);
                    slot.debounceTimer = undefined;
                }
                try {
                    tokenDisp?.dispose();
                } catch (_) {}
                try {
                    slot.abort.signal.removeEventListener('abort', onAbort);
                } catch (_) {}
                done(cancelled);
            };
            const onAbort = () => finish(true);
            const tokenDisp =
                typeof token.onCancellationRequested === 'function'
                    ? token.onCancellationRequested(() => {
                        slot.settled = true;
                        finish(true);
                    })
                    : undefined;
            slot.debounceTimer = setTimeout(() => finish(false), waitMs);
            try {
                slot.abort.signal.addEventListener('abort', onAbort, { once: true });
            } catch (_) {
                finish(true);
                return;
            }
            if (slot.abort.signal.aborted || token.isCancellationRequested || slot.settled) {
                finish(true);
            }
        });
    }
}
