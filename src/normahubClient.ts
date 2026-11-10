import { boundedCompletionControls } from './shared/config/models';
import * as vscode from 'vscode';
import * as https from 'https';
import { NormaHubBalanceInfo } from './types';

const SECRET_API_KEY = 'normahub1c.apiKey';

/**
 * Rejection reason for requests cancelled via AbortSignal.
 * The provider maps it to a silent `null` (no user-facing error, no log noise).
 */
export class CompletionCancelledError extends Error {
    constructor() {
        super('Completion request cancelled');
        this.name = 'CompletionCancelledError';
    }
}

export interface CompletionRequestOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
    /** Counts and fixed status only. Never receives model text, prompts or credentials. */
    onDiagnostics?: (diagnostics: CompletionDiagnostics) => void;
}

export interface CompletionDiagnostics {
    readonly finishReason: 'stop' | 'length' | 'other' | 'missing';
    readonly maxTokens: number;
    readonly promptTokens?: number;
    readonly completionTokens?: number;
    readonly reasoningTokens?: number;
}

export class CompletionTruncatedError extends Error {
    readonly diagnostics: CompletionDiagnostics;
    constructor(diagnostics: CompletionDiagnostics) {
        super(diagnostics.reasoningTokens !== undefined && diagnostics.reasoningTokens >= diagnostics.maxTokens * 0.75
            ? 'Модель израсходовала лимит ответа преимущественно на рассуждение. Сократите контекст или задачу и повторите запрос.'
            : 'Ответ модели обрезан лимитом токенов. Сократите задачу.');
        this.name = 'CompletionTruncatedError';
        this.diagnostics = diagnostics;
    }
}

function tokenCount(value: unknown): number | undefined {
    return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000_000 ? value as number : undefined;
}

export class NormaHubClient {
    public static async getApiKey(context: vscode.ExtensionContext): Promise<string> {
        const secret = await context.secrets.get(SECRET_API_KEY);
        if (secret && secret.trim()) {
            return secret.trim();
        }
        const envKey = process.env.NORMAHUB_API_KEY;
        return envKey ? envKey.trim() : '';
    }

    public static async setApiKey(context: vscode.ExtensionContext, key: string): Promise<void> {
        if (key && key.trim()) {
            await context.secrets.store(SECRET_API_KEY, key.trim());
        } else {
            await context.secrets.delete(SECRET_API_KEY);
        }
    }

    private static readonly DEFAULT_BASE_URL = 'https://api.normahub.cc/v1';

    public static getBaseUrl(): string {
        return this.DEFAULT_BASE_URL;
    }

    public static async checkBalance(apiKey: string): Promise<NormaHubBalanceInfo> {
        if (!apiKey) {
            return {
                balanceRub: 0,
                currency: 'RUB',
                status: 'invalid_key',
                error: 'API-ключ не задан'
            };
        }

        // Probe the authenticated model-list endpoint; this does not establish account balance.
        return new Promise((resolve) => {
            const baseUrl = this.getBaseUrl();
            const url = new URL(`${baseUrl}/models`);

            const req = https.get(
                url,
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'User-Agent': 'NormaHub-1C-Copilot/1.0'
                    },
                    timeout: 4000
                },
                (res) => {
                    let body = '';
                    const interrupted = () => resolve({ balanceRub: 0, currency: 'USD', status: 'invalid_key', error: 'Ответ шлюза прерван.' });
                    res.on('error', interrupted);
                    res.on('aborted', interrupted);
                    res.on('data', chunk => { body += chunk; });
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            try {
                                const models = JSON.parse(body);
                                if (!models || !Array.isArray(models.data)) throw new Error('Invalid model list');
                            } catch {
                                resolve({ balanceRub: 0, currency: 'USD', status: 'invalid_key', error: 'Шлюз вернул некорректный список моделей.' });
                                return;
                            }
                            // A valid model list establishes connectivity, not credit or inference permission.
                            resolve({
                                balanceRub: 0,
                                currency: 'USD',
                                status: 'active'
                            });
                        } else if (res.statusCode === 401 || res.statusCode === 403) {
                            resolve({
                                balanceRub: 0,
                                currency: 'USD',
                                status: 'unauthorized',
                                error: 'Неверный API-ключ'
                            });
                        } else if (res.statusCode === 402) {
                            resolve({
                                balanceRub: 0,
                                currency: 'USD',
                                status: 'insufficient_funds',
                                error: 'Баланс исчерпан на normahub.cc'
                            });
                        } else {
                            resolve({
                                balanceRub: 0,
                                currency: 'USD',
                                status: 'invalid_key',
                                error: `Код ответа шлюза: ${res.statusCode}`
                            });
                        }
                    });
                }
            );

            req.on('error', (err) => {
                resolve({
                    balanceRub: 0,
                    currency: 'RUB',
                    status: 'invalid_key',
                    error: err.message
                });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({
                    balanceRub: 0,
                    currency: 'RUB',
                    status: 'invalid_key',
                    error: 'Таймаут соединения со шлюзом'
                });
            });
        });
    }

    public static isCancelledError(err: unknown): boolean {
        return err instanceof CompletionCancelledError
            || (err instanceof Error && err.name === 'AbortError');
    }

    public static async complete(
        apiKey: string,
        model: string,
        systemPrompt: string,
        userPrompt: string,
        temperature = 0.1,
        maxTokens = 1500,
        options?: CompletionRequestOptions
    ): Promise<string> {
        const signal = options?.signal;
        const timeoutMs = options?.timeoutMs ?? 25000;

        if (signal?.aborted) {
            return Promise.reject(new CompletionCancelledError());
        }

        return new Promise((resolve, reject) => {
            const baseUrl = this.getBaseUrl();
            const url = new URL(`${baseUrl}/chat/completions`);
            const payload = JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature,
                max_tokens: maxTokens,
                ...boundedCompletionControls(model)
            });

            let settled = false;
            const settleResolve = (v: string) => {
                if (!settled) { settled = true; cleanup(); resolve(v); }
            };
            const settleReject = (e: Error) => {
                if (!settled) { settled = true; cleanup(); reject(e); }
            };

            const req = https.request(
                url,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Length': Buffer.byteLength(payload)
                    },
                    timeout: timeoutMs
                },
                (res) => {
                    let data = '';
                    res.on('data', chunk => {
                        data += chunk;
                        if (data.length > 2 * 1024 * 1024) { settleReject(new Error('Ответ шлюза превышает допустимый размер.')); req.destroy(); }
                    });
                    res.on('error', () => settleReject(new Error('Ответ шлюза прерван.')));
                    res.on('end', () => {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            try {
                                const parsed = JSON.parse(data);
                                const finish = parsed.choices?.[0]?.finish_reason;
                                const diagnostics: CompletionDiagnostics = Object.freeze({
                                    finishReason: finish === 'stop' || finish === 'length' ? finish : finish == null ? 'missing' : 'other',
                                    maxTokens,
                                    ...(tokenCount(parsed.usage?.prompt_tokens) !== undefined ? { promptTokens: tokenCount(parsed.usage.prompt_tokens) } : {}),
                                    ...(tokenCount(parsed.usage?.completion_tokens) !== undefined ? { completionTokens: tokenCount(parsed.usage.completion_tokens) } : {}),
                                    ...(tokenCount(parsed.usage?.completion_tokens_details?.reasoning_tokens) !== undefined
                                        ? { reasoningTokens: tokenCount(parsed.usage.completion_tokens_details.reasoning_tokens) } : {})
                                });
                                try { options?.onDiagnostics?.(diagnostics); } catch { /* Diagnostics cannot break inference. */ }
                                if (finish === 'length') throw new CompletionTruncatedError(diagnostics);
                                const content = parsed.choices?.[0]?.message?.content || '';
                                if (typeof content !== 'string') throw new Error('Ожидался текстовый ответ модели');
                                settleResolve(content);
                            } catch (e: any) {
                                settleReject(e instanceof CompletionTruncatedError ? e : new Error(`Ошибка парсинга ответа: ${e.message}`));
                            }
                        } else {
                            settleReject(new Error(`Ошибка шлюза NormaHub (HTTP ${res.statusCode})`));
                        }
                    });
                }
            );

            const onAbort = () => {
                try { req.destroy(); } catch (_) {}
                settleReject(new CompletionCancelledError());
            };

            const cleanup = () => {
                try { signal?.removeEventListener('abort', onAbort); } catch (_) {}
            };

            signal?.addEventListener('abort', onAbort, { once: true });

            req.on('error', (err: any) => {
                // Node emits the abort-driven socket error after destroy(); map it to cancellation.
                if (signal?.aborted) {
                    settleReject(new CompletionCancelledError());
                } else {
                    settleReject(err);
                }
            });
            req.on('timeout', () => {
                try { req.destroy(); } catch (_) {}
                settleReject(new Error('Таймаут запроса к шлюзу NormaHub'));
            });

            req.write(payload);
            req.end();
        });
    }
}
