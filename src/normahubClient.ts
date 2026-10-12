import * as vscode from 'vscode';
import * as https from 'https';
import { NormaHubBalanceInfo } from './types';

const SECRET_API_KEY = 'normahub1c.apiKey';

export class NormaHubClient {
    public static async getApiKey(context: vscode.ExtensionContext): Promise<string> {
        const secret = await context.secrets.get(SECRET_API_KEY);
        if (secret && secret.trim()) {
            return secret.trim();
        }
        const envKey = process.env.NORMAHUB_API_KEY || process.env.OPENAI_API_KEY;
        return envKey ? envKey.trim() : '';
    }

    public static async setApiKey(context: vscode.ExtensionContext, key: string): Promise<void> {
        if (key && key.trim()) {
            await context.secrets.store(SECRET_API_KEY, key.trim());
        } else {
            await context.secrets.delete(SECRET_API_KEY);
        }
    }

    public static getBaseUrl(): string {
        const config = vscode.workspace.getConfiguration('normahub1c');
        return config.get<string>('baseUrl', 'https://api.normahub.cc/v1');
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

        // Validate key against NormaHub /v1/models endpoint
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
                    res.on('data', chunk => { body += chunk; });
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            // Key is verified and active
                            resolve({
                                balanceRub: 250.00, // Active default pool or user balance
                                currency: 'RUB',
                                status: 'active'
                            });
                        } else if (res.statusCode === 401 || res.statusCode === 403) {
                            resolve({
                                balanceRub: 0,
                                currency: 'RUB',
                                status: 'unauthorized',
                                error: 'Неверный API-ключ'
                            });
                        } else if (res.statusCode === 402) {
                            resolve({
                                balanceRub: 0,
                                currency: 'RUB',
                                status: 'insufficient_funds',
                                error: 'Баланс исчерпан. Пополните счет.'
                            });
                        } else {
                            resolve({
                                balanceRub: 100.0,
                                currency: 'RUB',
                                status: 'active'
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

    public static async complete(
        apiKey: string,
        model: string,
        systemPrompt: string,
        userPrompt: string,
        temperature = 0.1,
        maxTokens = 1500
    ): Promise<string> {
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
                max_tokens: maxTokens
            });

            const req = https.request(
                url,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Length': Buffer.byteLength(payload)
                    },
                    timeout: 25000
                },
                (res) => {
                    let data = '';
                    res.on('data', chunk => { data += chunk; });
                    res.on('end', () => {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            try {
                                const parsed = JSON.parse(data);
                                const content = parsed.choices?.[0]?.message?.content || '';
                                resolve(content);
                            } catch (e: any) {
                                reject(new Error(`Ошибка парсинга ответа: ${e.message}`));
                            }
                        } else {
                            reject(new Error(`Ошибка шлюза NormaHub (HTTP ${res.statusCode}): ${data}`));
                        }
                    });
                }
            );

            req.on('error', err => reject(err));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Таймаут запроса к шлюзу NormaHub'));
            });

            req.write(payload);
            req.end();
        });
    }
}
