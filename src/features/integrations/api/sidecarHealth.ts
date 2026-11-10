import * as http from 'http';

export interface SidecarStatus { online: boolean; info?: { version: string }; error?: string }

export function checkSidecarHealth(): Promise<SidecarStatus> {
    return new Promise(resolve => {
        let done = false;
        const finish = (result: SidecarStatus) => { if (!done) { done = true; resolve(result); } };
        const token = process.env.SIDECAR_AUTH_TOKEN;
        const req = http.get('http://127.0.0.1:18833/health', {
            timeout: 1500, headers: token ? { Authorization: `Bearer ${token}` } : {}
        }, res => {
            let data = '';
            res.on('data', chunk => {
                data += chunk;
                if (data.length > 16384) { finish({ online: false, error: 'Некорректный ответ локального сервиса.' }); req.destroy(); }
            });
            res.on('error', () => finish({ online: false, error: 'Ответ Sidecar прерван.' }));
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    finish({ online: false, error: res.statusCode === 401 ? 'Sidecar требует SIDECAR_AUTH_TOKEN в окружении расширения.' : `Sidecar ответил HTTP ${res.statusCode}.` });
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.status !== 'ok' || parsed.service !== '1c-configurator-sidecar' || typeof parsed.version !== 'string') throw new Error();
                    finish({ online: true, info: { version: parsed.version } });
                } catch { finish({ online: false, error: 'На порту 18833 не распознан Sidecar.' }); }
            });
        });
        req.on('error', () => finish({ online: false, error: 'Sidecar недоступен на 127.0.0.1:18833.' }));
        req.on('timeout', () => { finish({ online: false, error: 'Таймаут проверки Sidecar.' }); req.destroy(); });
    });
}
