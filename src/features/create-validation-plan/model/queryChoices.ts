import { assertSingleQuery, decodeQueryLiteral, RUNNER_POLICY } from '../../../entities/runner/model/queryJob';

export interface QueryChoice { readonly start: number; readonly end: number; readonly format: 'query_text' | 'bsl_string_literal'; readonly query: string; readonly line: number; }

/** Complete BSL data literals, including CRLF continuations; never evaluate concatenation or surrounding BSL. */
export function queryChoices(code: string): readonly QueryChoice[] {
    if (typeof code !== 'string' || code.length > RUNNER_POLICY.candidateMaxChars) throw new Error('Текст кандидата слишком большой для выбора запроса.');
    const choices: QueryChoice[] = [];
    try { assertSingleQuery(code); if (code.length > 24000) throw new Error(); return [{ start: 0, end: code.length, format: 'query_text', query: code, line: 1 }]; } catch { /* BSL module */ }
    const skipTrivia = (start: number) => {
        let i = start;
        while (i < code.length) {
            if (/\s/.test(code[i])) i++;
            else if (code.slice(i, i + 2) === '//') { while (i < code.length && !/[\r\n]/.test(code[i])) i++; }
            else break;
        }
        return i;
    };
    let line = 1, previous = '';
    for (let i = 0; i < code.length;) {
        const ch = code[i];
        if (code.slice(i, i + 2) === '//') { while (i < code.length && !/[\r\n]/.test(code[i])) i++; continue; }
        if (ch === '\r' || ch === '\n') { if (ch === '\r' && code[i + 1] === '\n') i++; line++; i++; continue; }
        if (/\s/.test(ch)) { i++; continue; }
        if (ch !== '"') { previous = ch; i++; continue; }
        const start = i++, startLine = line; let closed = false;
        while (i < code.length) {
            if (code[i] === '"') {
                if (code[i + 1] === '"') { i += 2; continue; }
                i++; closed = true; break;
            }
            if (code[i] === '\r' || code[i] === '\n') { if (code[i] === '\r' && code[i + 1] === '\n') i++; line++; }
            i++;
        }
        if (closed && previous !== '+' && code[skipTrivia(i)] !== '+') {
            try {
                const query = decodeQueryLiteral(code.slice(start, i)); assertSingleQuery(query);
                if (query.length <= 24000) choices.push({ start, end: i, format: 'bsl_string_literal', query, line: startLine });
            } catch { /* Not a complete supported SELECT literal. */ }
        }
        previous = '"';
        if (choices.length > 64) throw new Error('Найдено более 64 запросов. Сократите кандидат.');
    }
    return choices;
}
