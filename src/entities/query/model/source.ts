import { BSLTokenizer, BSLTokenType } from '../../../bslTokenizer';
import { withoutComments } from '../../../shared/bsl/text';

export interface QuerySource { text: string; line: number; dynamic?: boolean; }

/** Inspect actual query literals assigned to .Текст; never treat arbitrary printed BSL as code. */
export function querySources(code: string): QuerySource[] {
    const plain = withoutComments(code);
    // JavaScript \b does not recognise Cyrillic word boundaries.
    if (/^\s*(?:ВЫБРАТЬ|SELECT|УНИЧТОЖИТЬ)(?:\s|$)/i.test(plain)) return [{text: code, line: 1}];
    const tokens = BSLTokenizer.tokenize(code).filter(t => t.type !== BSLTokenType.COMMENT);
    const sources: QuerySource[] = [];
    const receivers = new Map<string,boolean>();
    for (let i = 0; i < tokens.length - 3; i++) {
        const word = tokens[i].value.toLowerCase();
        if (/^(?:процедура|функция|procedure|function)$/.test(word)) receivers.clear();
        if (tokens[i].type === BSLTokenType.IDENTIFIER && tokens[i+1]?.value === '=' && tokens[i-1]?.value !== '.') receivers.set(word, /^(?:новый|new)$/i.test(tokens[i+2]?.value || '') && /^(?:запрос|query)$/i.test(tokens[i+3]?.value || ''));
        const receiver = tokens[i-1]?.value.toLowerCase() || '';
        if (!(receivers.get(receiver) ?? /^(?:запрос|query)$/.test(receiver))) continue;
        if (tokens[i].value !== '.' || !/^(?:Текст|Text)$/i.test(tokens[i + 1].value) || tokens[i + 2].value !== '=') continue;
        let end = i + 3;
        while (end < tokens.length && tokens[end].value !== ';') end++;
        const dynamic = tokens.slice(i + 3, end).some(t => t.type !== BSLTokenType.STRING_LITERAL && t.value !== '+');
        for (let j = i + 3; j < end; j++) {
            const token = tokens[j];
            if (token.type !== BSLTokenType.STRING_LITERAL || !token.value.startsWith('"')) continue;
            const chunks = [token.value];
            // The BSL lexer emits one literal token per physical line.
            while (tokens[j + 1]?.type === BSLTokenType.STRING_LITERAL && tokens[j + 1].value.startsWith('|')) chunks.push(tokens[++j].value);
            const text = chunks.map(chunk => chunk.slice(1, chunk.endsWith('"') ? -1 : undefined).replace(/""/g, '"')).join('\n');
            if (/^\s*(?:ВЫБРАТЬ|SELECT|УНИЧТОЖИТЬ)(?:\s|$)/i.test(text)) sources.push({text, line: token.line, dynamic});
        }
    }
    return sources;
}

/** Preserve offsets while hiding query string constants, comments and quoted identifiers. */
export function queryExecutable(text: string): string {
    return withoutComments(text).replace(/"(?:""|[^"])*"|'(?:''|[^'])*'/g, value => '0' + value.slice(1).replace(/[^\r\n]/g, ' '));
}
