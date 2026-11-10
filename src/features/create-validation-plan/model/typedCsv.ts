import { parseResultSet, QueryResultSet, QueryValue } from '../../../entities/business-contract/model/resultSet';

interface Cell { text: string; quoted: boolean; }
const TYPES = ['string', 'number', 'boolean', 'date', 'reference'] as const;
export interface ColumnSpec { name: string; type: typeof TYPES[number]; }

/** Semicolon CSV: quoting preserves strings, embedded newlines and literal NULL. No numeric JS conversion. */
function records(input: string): Cell[][] {
    if (input.length > 2 * 1024 * 1024) throw new Error('Таблица превышает 2 MiB.');
    const source = input.replace(/^\uFEFF/, ''); const rows: Cell[][] = [];
    let row: Cell[] = [], value = '', quoted = false, inside = false, closed = false, started = false;
    const cell = () => { row.push({ text: value, quoted }); value = ''; quoted = inside = closed = started = false; };
    const record = () => { cell(); rows.push(row); row = []; if (rows.length > 2001) throw new Error('Допускается не более 2000 строк.'); };
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (inside) {
            if (c === '"') { if (source[i + 1] === '"') { value += '"'; i++; } else { inside = false; closed = true; } }
            else value += c;
        } else if (c === ';') cell();
        else if (c === '\n' || c === '\r') { if (c === '\r' && source[i + 1] === '\n') i++; record(); }
        else if (c === '"' && !started && !closed) { inside = quoted = started = true; }
        else { if (closed || c === '"') throw new Error('Некорректные кавычки CSV.'); value += c; started = true; }
        if (row.length > 64 || value.length > 17000) throw new Error('Превышен размер колонки CSV.');
    }
    if (inside) throw new Error('Незакрытая строка CSV.');
    if (started || closed || row.length || value) record();
    return rows;
}
export function parseColumns(header: string): readonly ColumnSpec[] {
    const parsed = records(header);
    if (parsed.length !== 1) throw new Error('Укажите одну строку колонок Имя:тип через точку с запятой.');
    const columns = parsed[0].map(c => {
        const parts = c.text.trim().split(':');
        if (parts.length !== 2 || !TYPES.includes(parts[1].trim() as ColumnSpec['type'])) throw new Error('Тип колонки: string, number, boolean, date или reference.');
        return { name: parts[0].trim(), type: parts[1].trim() as ColumnSpec['type'] };
    });
    parseResultSet({ columns: columns.map(c => c.name), rows: [] }); return columns;
}
function value(cell: Cell, column: ColumnSpec): QueryValue {
    const text = cell.text, token = text.trim();
    if (!cell.quoted && token === 'NULL') return { type: 'null' };
    if (!cell.quoted && token === 'UNDEFINED') return { type: 'undefined' };
    if (column.type === 'string') return { type: 'string', value: text };
    if (column.type === 'number') return { type: 'number', value: token.replace(',', '.') };
    if (column.type === 'date') return { type: 'date', value: token };
    if (column.type === 'boolean') {
        if (!/^(true|false|истина|ложь)$/i.test(token)) throw new Error('Логическое значение: true или false.');
        return { type: 'boolean', value: /^(true|истина)$/i.test(token) };
    }
    const match = token.match(/^([^#]+)#([a-f\d-]{36})$/i);
    if (token.startsWith('EMPTYREF:')) return { type: 'empty_reference', metadata: token.slice(9) };
    if (!match) throw new Error('Ссылка: Справочник.Имя#UUID или EMPTYREF:Справочник.Имя.');
    return { type: 'reference', metadata: match[1], id: match[2] };
}
export function parseTypedCsv(input: string): QueryResultSet {
    const rows = records(input);
    if (!rows.length) throw new Error('Укажите колонки CSV с типами.');
    const escape = (cell: Cell) => '"' + cell.text.replace(/"/g, '""') + '"';
    const columns = parseColumns(rows[0].map(escape).join(';'));
    return parseResultSet({ columns: columns.map(c => c.name), rows: rows.slice(1).map(row => {
        if (row.length !== columns.length) throw new Error('Число ячеек строки не совпадает с колонками.');
        return row.map((c, i) => value(c, columns[i]));
    }) });
}
