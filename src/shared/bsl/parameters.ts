import { identifier } from './text';

/** Parameter separators inside quoted default values are not argument separators. */
export function splitParameters(source: string): string[] {
    const result: string[] = []; let start = 0, quoted = false;
    for (let i = 0; i < source.length; i++) {
        if (source[i] === '"') {
            if (quoted && source[i + 1] === '"') { i++; continue; }
            quoted = !quoted;
        }
        if (source[i] === ',' && !quoted) { result.push(source.slice(start,i).trim()); start = i + 1; }
    }
    if (quoted) throw new Error('Незакрытая строка в значении параметра.');
    if (source.trim()) result.push(source.slice(start).trim());
    return result;
}

export function methodParameter(source: string): { declaration: string; name: string } {
    const value = source.trim();
    if (/[\r\n]/.test(value)) throw new Error('Параметр должен занимать одну строку.');
    const match = value.match(/^(?:(Знач|Val)\s+)?([А-Яа-яЁёA-Za-z_][А-Яа-яЁёA-Za-z_0-9]*)(?:\s*=\s*(.+))?$/i);
    if (!match) throw new Error('Параметр: укажите имя и необязательное константное значение по умолчанию.');
    const name = identifier(match[2], 'Параметр'), fallback = match[3];
    if (fallback !== undefined && !/^(?:Неопределено|Undefined|Истина|Ложь|True|False|[-+]?\d+(?:\.\d+)?|"(?:""|[^"])*"|'\d{8}(?:\d{6})?')$/i.test(fallback)) throw new Error('Значение параметра по умолчанию должно быть константой BSL.');
    return {name, declaration:`${match[1] ? 'Знач ' : ''}${name}${fallback === undefined ? '' : ' = '+fallback}`};
}
