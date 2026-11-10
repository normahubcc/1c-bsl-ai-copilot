/** Small, runtime-independent helpers shared by generators and diagnostics. */
const reserved = new Set(('процедура функция конецпроцедуры конецфункции если тогда иначеесли иначе конецесли для каждого из по цикл конеццикла пока попытка исключение конецпопытки возврат продолжить прервать перем экспорт новый выполнить и или не истина ложь неопределено знач procedure function endprocedure endfunction if then elsif else endif for each in to do enddo while try except endtry return continue break var export new execute and or not true false undefined val').split(' '));

export function identifier(value: string, label = 'Имя'): string {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!/^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*$/.test(name)) {
        throw new Error(`${label}: укажите идентификатор 1С без пробелов и спецсимволов.`);
    }
    if (reserved.has(name.toLowerCase())) throw new Error(`${label}: ключевое слово BSL нельзя использовать как имя.`);
    return name;
}

export function bslString(value: string): string {
    return `"${value.replace(/"/g, '""').replace(/\r\n?/g, '\n').replace(/\n/g, '\n|')}"`;
}

/** Hide lexical ranges in one pass while preserving source offsets and line breaks. */
export function maskedText(source: string, ranges: readonly {offset: number; value: string}[]): string {
    const parts: string[] = []; let cursor = 0;
    for (const range of ranges) {
        parts.push(source.slice(cursor, range.offset), range.value.replace(/[^\r\n]/g, ' '));
        cursor = range.offset + range.value.length;
    }
    parts.push(source.slice(cursor));
    return parts.join('');
}

/** Preserve offsets/newlines and quoted text; comments cannot create diagnostics. */
export function withoutComments(text: string): string {
    let result = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '"') {
            result += text[i];
            if (quoted && text[i + 1] === '"') { result += text[++i]; continue; }
            quoted = !quoted;
        } else if (!quoted && text[i] === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') { result += ' '; i++; }
            if (i < text.length) result += '\n';
        } else result += text[i];
    }
    return result;
}
