import { ENGLISH } from './en';

export type UiLanguage = 'ru' | 'en';

export function isUiLanguage(value: unknown): value is UiLanguage {
    return value === 'ru' || value === 'en';
}

/** Self-contained so the same translator can be embedded in the Webview bundle. */
export function createTranslator(catalogue: Record<string, string>, language: UiLanguage) {
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = Object.entries(catalogue).filter(([key]) => /\{\w+\}/.test(key)).map(([key, value]) => {
        const names: string[] = [];
        let cursor = 0, expression = '';
        for (const match of key.matchAll(/\{(\w+)\}/g)) {
            expression += escape(key.slice(cursor, match.index)) + '([\\s\\S]+?)';
            names.push(match[1]); cursor = match.index! + match[0].length;
        }
        return { expression: new RegExp('^' + expression + escape(key.slice(cursor)) + '$'), names, value };
    });
    return (source: string, parameters: Record<string, string | number> = {}): string => {
        if (typeof source !== 'string') return source;
        const key = source.trim().replace(/\s+/g, ' ');
        let result = language === 'en' && Object.prototype.hasOwnProperty.call(catalogue, key) ? catalogue[key] : undefined;
        let values = parameters;
        if (language === 'en' && result === undefined) {
            for (const pattern of patterns) {
                const match = key.match(pattern.expression);
                if (!match) continue;
                result = pattern.value;
                values = { ...parameters };
                pattern.names.forEach((name, index) => {
                    const captured = match[index + 1];
                    values[name] = Object.prototype.hasOwnProperty.call(catalogue, captured) ? catalogue[captured] : captured;
                });
                break;
            }
        }
        const template = result ?? source;
        const formatted = template.replace(/\{(\w+)\}/g, (token, name) => Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : token);
        if (result === undefined) return formatted;
        return (source.match(/^\s*/)?.[0] || '') + formatted + (source.match(/\s*$/)?.[0] || '');
    };
}

const translators = { ru: createTranslator(ENGLISH, 'ru'), en: createTranslator(ENGLISH, 'en') };

export function translateText(source: string, language: UiLanguage): string {
    const t = translators[language];
    const exact = t(source);
    return exact === source ? source.split('\n').map(line => t(line)).join('\n') : exact;
}

/** Translate only presentation fields. Generated code, clipboard data and identifiers stay intact. */
export function localizeHostMessage<T extends Record<string, any>>(message: T, language: UiLanguage): T {
    if (language === 'ru') return message;
    const fields = new Set(['message', 'error', 'report', 'gatewayStatusLabel', 'balanceDisplay', 'metadataLabel', 'maskedKey', 'suggestion', 'description', 'title']);
    const visit = (value: any): any => {
        if (Array.isArray(value)) return value.map(visit);
        if (!value || typeof value !== 'object') return value;
        const result: Record<string, any> = {};
        for (const [key, item] of Object.entries(value)) {
            result[key] = fields.has(key) && !(message.type === 'explainResult' && key === 'report') && typeof item === 'string' ? translateText(item, language)
                : ['issues', 'diagnoses'].includes(key) ? visit(item) : item;
        }
        return result;
    };
    return visit(message);
}
