import * as path from 'path';
import { withoutComments } from './text';

/** Keep offsets while hiding strings/comments from declaration matching. */
export function maskNonCode(source: string): string {
    const text = withoutComments(source);
    let quoted = false, output = '';
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '"') {
            output += ' ';
            if (quoted && text[i + 1] === '"') { output += ' '; i++; }
            else quoted = !quoted;
        } else output += quoted && !/[\r\n]/.test(text[i]) ? ' ' : text[i];
    }
    return output;
}

export function exportedSignatures(source: string, cap: number): string[] {
    if (cap <= 0) return [];
    const text = maskNonCode(source), output: string[] = [];
    const declaration = /(?:^|[\s;])(?:Процедура|Функция)\s+([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*)\s*\(([^)]*)\)\s*(?:Экспорт|Export)(?=\s|$)/gi;
    for (const match of text.matchAll(declaration)) {
        const start = match.index! + match[0].indexOf('(') + 1;
        const end = match.index! + match[0].lastIndexOf(')');
        const params = withoutComments(source.slice(start, end)).trim().replace(/\s+/g, ' ');
        output.push(`${match[1]}(${params})`);
        if (output.length >= cap) break;
    }
    return output;
}

export function moduleIdentity(fileName: string) {
    const normalized = fileName.replace(/\\/g, '/');
    const common = normalized.match(/\/(?:CommonModules|ОбщиеМодули)\/([^/]+)\/(?:Ext\/)?[^/]+\.(?:bsl|os|1c)$/i);
    const base = path.posix.basename(normalized, path.posix.extname(normalized));
    return { moduleName: common?.[1] || base, isCommonModule: !!common || /клиент|сервер|общ/i.test(base) };
}
