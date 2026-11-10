import { array, canonicalJson, immutable, record, text } from '../../../shared/lib/jsonContract';
import { parseResultSet, QueryValue } from '../../business-contract/model/resultSet';

export type ScalarParameterValue = { readonly type: 'null' } | { readonly type: 'boolean'; readonly value: boolean } | { readonly type: 'string' | 'number' | 'date'; readonly value: string };
export interface QueryParameter { readonly name: string; readonly value: ScalarParameterValue; }
const NAME = /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$/;
export const FIXTURE_PARAMETERS = ['Дата', 'Ссылка'] as const;
const reserved = new Set<string>(FIXTURE_PARAMETERS.map(s => s.toLowerCase()));

/** SQL-like query strings/comments are data. Do not discover parameters inside them. */
export function queryParameterNames(query: string): readonly string[] {
    const names = new Map<string, string>(); let quoted = false;
    for (let i = 0; i < query.length; i++) {
        if (query[i] === '"') {
            if (quoted && query[i + 1] === '"') i++;
            else quoted = !quoted;
        } else if (!quoted && query.slice(i, i + 2) === '//') {
            while (i < query.length && !/[\r\n]/.test(query[i])) i++;
        } else if (!quoted && query[i] === '&') {
            const match = query.slice(i + 1).match(/^[\p{L}_][\p{L}\p{N}_]*/u);
            if (!match) throw new Error('Некорректное имя параметра запроса.');
            const name = match[0];
            if (name.length > 64 || !NAME.test(name)) throw new Error('Профиль поддерживает имена параметров до 64 символов: латиница, кириллица, цифры и _.');
            names.set(name.toLowerCase(), name); i += name.length;
        }
    }
    return [...names.values()];
}
export function additionalParameterNames(query: string): readonly string[] {
    return queryParameterNames(query).filter(n => !reserved.has(n.toLowerCase()));
}
export function parseScalarParameter(value: unknown): ScalarParameterValue {
    canonicalJson(value);
    const cell = parseResultSet({ columns: ['Value'], rows: [[value]] }).rows[0][0];
    if (!['string', 'number', 'boolean', 'date', 'null'].includes(cell.type)) throw new Error('Параметр: допустимы string, number, boolean, date или null.');
    if (cell.type === 'number' && cell.value.replace(/[-.]/g, '').length > 38) throw new Error('Параметр числа превышает лимит профиля 38 цифр.');
    if (cell.type === 'string' && (cell.value.includes('\0') || Buffer.from(cell.value, 'utf8').toString('utf8') !== cell.value)) throw new Error('Строковый параметр содержит неподдерживаемые символы.');
    return cell as ScalarParameterValue;
}
export function parseQueryParameters(value: unknown): readonly QueryParameter[] {
    const seen = new Set<string>();
    const parsed = array(value, 'parameters', 32).map((item, i) => {
        const p = record(item, ['name', 'value'], `parameters[${i}]`), name = text(p.name, 'parameter.name', 64);
        if (!NAME.test(name)) throw new Error('Некорректное имя параметра запроса.');
        const lower = name.toLowerCase();
        if (reserved.has(lower)) throw new Error('Параметры Дата и Ссылка задаются доверенной фикстурой и не переопределяются.');
        if (seen.has(lower)) throw new Error('Параметры запроса повторяются без учёта регистра.');
        seen.add(lower); return { name, value: parseScalarParameter(p.value) };
    });
    if (Buffer.byteLength(canonicalJson(parsed), 'utf8') > 128 * 1024) throw new Error('Параметры запроса превышают лимит 128 KiB.');
    return immutable(parsed.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
}
export function assertParameterBindings(query: string, parameters: readonly QueryParameter[]): void {
    const required = additionalParameterNames(query), used = new Set(required.map(n => n.toLowerCase()));
    if (required.length > 32) throw new Error('Запрос превышает лимит 32 дополнительных параметров.');
    const provided = new Set(parameters.map(p => p.name.toLowerCase()));
    if (required.some(n => !provided.has(n.toLowerCase()))) throw new Error('Задайте значения всех дополнительных параметров запроса.');
    if (parameters.some(p => !used.has(p.name.toLowerCase()))) throw new Error('Передан параметр, который не используется выбранным запросом.');
}
