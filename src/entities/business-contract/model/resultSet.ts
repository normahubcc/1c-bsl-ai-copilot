import { array, canonicalJson, immutable, oneOf, record, text } from '../../../shared/lib/jsonContract';

export type QueryValue =
    | { readonly type: 'null' | 'undefined' }
    | { readonly type: 'boolean'; readonly value: boolean }
    | { readonly type: 'string' | 'number' | 'date'; readonly value: string }
    | { readonly type: 'reference'; readonly metadata: string; readonly id: string }
    | { readonly type: 'empty_reference'; readonly metadata: string };

export interface QueryResultSet {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly QueryValue[])[];
}

const VALUE_TYPES = ['null', 'undefined', 'boolean', 'string', 'number', 'date', 'reference', 'empty_reference'] as const;

function decimal(value: unknown, path: string): string {
    const source = text(value, path, 258);
    if (!/^-?\d{1,128}(?:\.\d{1,128})?$/.test(source)) throw new Error(`${path}: use a decimal string without exponent.`);
    const negative = source.startsWith('-');
    const [integer, fraction = ''] = (negative ? source.slice(1) : source).split('.');
    const whole = integer.replace(/^0+(?=\d)/, '');
    const tail = fraction.replace(/0+$/, '');
    const result = whole + (tail ? '.' + tail : '');
    return negative && result !== '0' ? '-' + result : result;
}

function localDate(value: unknown, path: string): string {
    const source = text(value, path, 19);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(source)) throw new Error(`${path}: expected a local 1C date without timezone.`);
    const [year, month, day, hour, minute, second] = source.split(/[-T:]/).map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) throw new Error(`${path}: invalid calendar date.`);
    return source;
}

function metadata(value: unknown, path: string): string {
    const result = text(value, path, 256);
    if (!/^[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)+$/u.test(result)) throw new Error(`${path}: expected a qualified metadata name.`);
    return result;
}

function parseValue(value: unknown, path: string): QueryValue {
    const cell = record(value, ['type', 'value', 'metadata', 'id'], path);
    const type = oneOf(cell.type, VALUE_TYPES, `${path}.type`);
    if (type === 'null' || type === 'undefined') {
        record(value, ['type'], path);
        return { type };
    }
    if (type === 'reference' || type === 'empty_reference') {
        record(value, type === 'reference' ? ['type', 'metadata', 'id'] : ['type', 'metadata'], path);
        const name = metadata(cell.metadata, `${path}.metadata`);
        if (type === 'empty_reference') return { type, metadata: name };
        const id = text(cell.id, `${path}.id`, 36);
        if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) || /^0{8}(?:-0{4}){3}-0{12}$/.test(id)) throw new Error(`${path}.id: expected nonempty UUID; use empty_reference explicitly.`);
        return { type, metadata: name, id: id.toLowerCase() };
    }
    record(value, ['type', 'value'], path);
    if (type === 'boolean') {
        if (typeof cell.value !== 'boolean') throw new Error(`${path}.value: expected boolean.`);
        return { type, value: cell.value };
    }
    if (type === 'string') {
        if (typeof cell.value !== 'string' || cell.value.length > 16384) throw new Error(`${path}.value: expected string (max 16384).`);
        return { type, value: cell.value };
    }
    return { type, value: type === 'number' ? decimal(cell.value, `${path}.value`) : localDate(cell.value, `${path}.value`) };
}

export function parseResultSet(value: unknown): QueryResultSet {
    canonicalJson(value);
    const source = record(value, ['columns', 'rows'], 'result');
    const columns = array(source.columns, 'columns', 64).map((column, index) => text(column, `columns[${index}]`, 128));
    if (!columns.length || new Set(columns.map(column => column.toLowerCase())).size !== columns.length) throw new Error('Columns must be nonempty and unique ignoring case.');
    const rows = array(source.rows, 'rows', 2000).map((row, index) => {
        const cells = array(row, `rows[${index}]`, columns.length);
        if (cells.length !== columns.length) throw new Error(`rows[${index}]: column count differs.`);
        return cells.map((cell, col) => parseValue(cell, `rows[${index}][${col}]`));
    });
    return immutable({ columns, rows });
}
