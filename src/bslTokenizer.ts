/**
 * 1C:Enterprise (BSL) Lexer, Tokenizer, and AST Scope Analyzer.
 * 
 * Provides deterministic lexical analysis of 1C code without regex fragility:
 * - Proper string literal parsing with escaped quotes ("") and multiline pipes (|)
 * - Comment filtering (//)
 * - Compilation directives (&НаКлиенте, &НаСервере, &НаСервереБезКонтекста, &Вместо, etc.)
 * - Preprocessor instructions (#Если, #КонецЕсли, #Область, etc.)
 * - Method parameter parsing (Знач, default values)
 * - Scope analysis: local variables (Перем), parameters, current method, loop/try depth
 */

export enum BSLTokenType {
    KEYWORD = 'KEYWORD',
    DIRECTIVE = 'DIRECTIVE',
    PREPROCESSOR = 'PREPROCESSOR',
    IDENTIFIER = 'IDENTIFIER',
    STRING_LITERAL = 'STRING_LITERAL',
    NUMBER_LITERAL = 'NUMBER_LITERAL',
    DATE_LITERAL = 'DATE_LITERAL',
    COMMENT = 'COMMENT',
    OPERATOR = 'OPERATOR',
    PUNCTUATION = 'PUNCTUATION',
    UNKNOWN = 'UNKNOWN'
}

export interface BSLToken {
    type: BSLTokenType;
    value: string;
    line: number;
    column: number;
    offset: number;
}

export interface BSLMethodParameter {
    name: string;
    isVal: boolean;
    defaultValue?: string;
}

export interface BSLMethodInfo {
    name: string;
    isFunction: boolean;
    parameters: BSLMethodParameter[];
    directive?: string;
    startLine: number;
    endLine?: number;
    isExport: boolean;
}

export interface BSLScopeContext {
    currentMethod?: BSLMethodInfo;
    compilationDirective?: string;
    localVariables: string[];
    insideLoop: boolean;
    insideTry: boolean;
    referencedMetadata: string[];
}

export class BSLTokenizer {
    private static readonly KEYWORDS = new Set([
        'процедура', 'функция', 'конецпроцедуры', 'конецфункции',
        'если', 'тогда', 'иначеесли', 'иначе', 'конецесли',
        'для', 'каждого', 'из', 'по', 'цикл', 'конеццикла',
        'пока', 'попытка', 'исключение', 'конецпопытки',
        'возврат', 'продолжить', 'прервать', 'перем', 'экспорт',
        'новый', 'выполнить', 'и', 'или', 'не', 'истина', 'ложь', 'неопределено'
    ]);

    /**
     * Tokenizes full BSL code into a sequential stream of tokens.
     */
    public static tokenize(source: string): BSLToken[] {
        const tokens: BSLToken[] = [];
        let i = 0;
        let line = 1;
        let lineStart = 0;

        while (i < source.length) {
            const ch = source[i];
            const col = i - lineStart + 1;

            // Handle Newlines
            if (ch === '\n') {
                line++;
                i++;
                lineStart = i;
                continue;
            }
            if (ch === '\r') {
                if (source[i + 1] === '\n') {
                    i++;
                }
                line++;
                i++;
                lineStart = i;
                continue;
            }

            // Whitespace
            if (ch === ' ' || ch === '\t') {
                i++;
                continue;
            }

            // Single line Comment //
            if (ch === '/' && source[i + 1] === '/') {
                const start = i;
                while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
                    i++;
                }
                tokens.push({
                    type: BSLTokenType.COMMENT,
                    value: source.substring(start, i),
                    line,
                    column: col,
                    offset: start
                });
                continue;
            }

            // Compilation Directive &НаКлиенте, &НаСервере, &Вместо...
            if (ch === '&') {
                const start = i;
                i++;
                while (i < source.length && /[а-яА-ЯёЁa-zA-Z0-9_]/.test(source[i])) {
                    i++;
                }
                tokens.push({
                    type: BSLTokenType.DIRECTIVE,
                    value: source.substring(start, i),
                    line,
                    column: col,
                    offset: start
                });
                continue;
            }

            // Preprocessor Instruction #Если, #Область, #КонецОбласти...
            if (ch === '#') {
                const start = i;
                i++;
                while (i < source.length && /[а-яА-ЯёЁa-zA-Z0-9_]/.test(source[i])) {
                    i++;
                }
                tokens.push({
                    type: BSLTokenType.PREPROCESSOR,
                    value: source.substring(start, i),
                    line,
                    column: col,
                    offset: start
                });
                continue;
            }

            // String Literal with escaped quotes "" and multiline pipe |
            if (ch === '"' || ch === '|') {
                const start = i;
                i++;
                let insideQuotes = (ch === '"');

                while (i < source.length) {
                    if (source[i] === '"') {
                        if (source[i + 1] === '"') {
                            // Escaped quote: ""
                            i += 2;
                            continue;
                        } else {
                            // End of quote
                            insideQuotes = false;
                            i++;
                            break;
                        }
                    } else if (source[i] === '\n' || source[i] === '\r') {
                        // End of line without closing quote
                        break;
                    } else {
                        i++;
                    }
                }

                tokens.push({
                    type: BSLTokenType.STRING_LITERAL,
                    value: source.substring(start, i),
                    line,
                    column: col,
                    offset: start
                });
                continue;
            }

            // Date Literal '20260101'
            if (ch === "'") {
                const start = i;
                i++;
                while (i < source.length && source[i] !== "'" && source[i] !== '\n') {
                    i++;
                }
                if (source[i] === "'") i++;
                tokens.push({
                    type: BSLTokenType.DATE_LITERAL,
                    value: source.substring(start, i),
                    line,
                    column: col,
                    offset: start
                });
                continue;
            }

            // Number Literal
            if (/[0-9]/.test(ch)) {
                const start = i;
                while (i < source.length && /[0-9.]/.test(source[i])) {
                    i++;
                }
                tokens.push({
                    type: BSLTokenType.NUMBER_LITERAL,
                    value: source.substring(start, i),
                    line,
                    column: col,
                    offset: start
                });
                continue;
            }

            // Identifiers and Keywords
            if (/[а-яА-ЯёЁa-zA-Z_]/.test(ch)) {
                const start = i;
                while (i < source.length && /[а-яА-ЯёЁa-zA-Z0-9_]/.test(source[i])) {
                    i++;
                }
                const val = source.substring(start, i);
                const isKw = this.KEYWORDS.has(val.toLowerCase());

                tokens.push({
                    type: isKw ? BSLTokenType.KEYWORD : BSLTokenType.IDENTIFIER,
                    value: val,
                    line,
                    column: col,
                    offset: start
                });
                continue;
            }

            // Multi-character and single-character Operators & Punctuation
            if (ch === '<' && source[i + 1] === '>') {
                tokens.push({ type: BSLTokenType.OPERATOR, value: '<>', line, column: col, offset: i });
                i += 2;
                continue;
            }
            if ((ch === '<' || ch === '>') && source[i + 1] === '=') {
                tokens.push({ type: BSLTokenType.OPERATOR, value: ch + '=', line, column: col, offset: i });
                i += 2;
                continue;
            }

            if ('=+-*/%<>'.includes(ch)) {
                tokens.push({ type: BSLTokenType.OPERATOR, value: ch, line, column: col, offset: i });
                i++;
                continue;
            }

            if (';,().[]'.includes(ch)) {
                tokens.push({ type: BSLTokenType.PUNCTUATION, value: ch, line, column: col, offset: i });
                i++;
                continue;
            }

            // Unknown single character
            tokens.push({ type: BSLTokenType.UNKNOWN, value: ch, line, column: col, offset: i });
            i++;
        }

        return tokens;
    }
}

export class BSLScopeAnalyzer {
    /**
     * Extracts rich AST scope context at the specified line and column.
     */
    public static analyzeScopeAtPosition(tokens: BSLToken[], targetLine: number, targetCol: number): BSLScopeContext {
        let currentMethod: BSLMethodInfo | undefined;
        let lastDirective: string | undefined;
        const localVariables = new Set<string>();
        const referencedMetadata = new Set<string>();

        let loopDepth = 0;
        let tryDepth = 0;

        let i = 0;
        while (i < tokens.length) {
            const token = tokens[i];

            // If we've passed target position, stop scope accumulation
            if (token.line > targetLine || (token.line === targetLine && token.column > targetCol)) {
                break;
            }

            // Track Directives (&НаКлиенте, &НаСервере...)
            if (token.type === BSLTokenType.DIRECTIVE) {
                lastDirective = token.value;
                i++;
                continue;
            }

            // Track Method definitions: Процедура / Функция
            if (token.type === BSLTokenType.KEYWORD &&
                (token.value.toLowerCase() === 'процедура' || token.value.toLowerCase() === 'функция')) {
                const isFunction = token.value.toLowerCase() === 'функция';
                const startLine = token.line;
                i++;

                // Skip to identifier
                while (i < tokens.length && tokens[i].type !== BSLTokenType.IDENTIFIER) {
                    i++;
                }

                if (i < tokens.length) {
                    const methodName = tokens[i].value;
                    i++;

                    // Parse parameters in parenthesis
                    const parameters: BSLMethodParameter[] = [];
                    if (i < tokens.length && tokens[i].value === '(') {
                        i++;
                        let isVal = false;
                        let paramName = '';

                        while (i < tokens.length && tokens[i].value !== ')') {
                            const pTok = tokens[i];
                            if (pTok.type === BSLTokenType.KEYWORD && pTok.value.toLowerCase() === 'знач') {
                                isVal = true;
                            } else if (pTok.type === BSLTokenType.IDENTIFIER) {
                                paramName = pTok.value;
                                parameters.push({ name: paramName, isVal });
                                localVariables.add(paramName);
                                isVal = false;
                            }
                            i++;
                        }
                    }

                    // Check for Экспорт
                    let isExport = false;
                    while (i < tokens.length && tokens[i].line === startLine) {
                        if (tokens[i].value.toLowerCase() === 'экспорт') {
                            isExport = true;
                        }
                        i++;
                    }

                    currentMethod = {
                        name: methodName,
                        isFunction,
                        parameters,
                        directive: lastDirective,
                        startLine,
                        isExport
                    };
                    lastDirective = undefined;
                }
                continue;
            }

            // End of Method: КонецПроцедуры / КонецФункции
            if (token.type === BSLTokenType.KEYWORD &&
                (token.value.toLowerCase() === 'конецпроцедуры' || token.value.toLowerCase() === 'конецфункции')) {
                if (currentMethod) {
                    currentMethod.endLine = token.line;
                    if (token.line < targetLine) {
                        currentMethod = undefined;
                        localVariables.clear();
                    }
                }
                i++;
                continue;
            }

            // Local variables declaration: Перем А, Б, В;
            if (token.type === BSLTokenType.KEYWORD && token.value.toLowerCase() === 'перем') {
                i++;
                while (i < tokens.length && tokens[i].value !== ';') {
                    if (tokens[i].type === BSLTokenType.IDENTIFIER) {
                        localVariables.add(tokens[i].value);
                    }
                    i++;
                }
                continue;
            }

            // Variable assignments: Имя = ...
            if (token.type === BSLTokenType.IDENTIFIER && tokens[i + 1]?.value === '=' && tokens[i + 1]?.type === BSLTokenType.OPERATOR) {
                localVariables.add(token.value);
            }

            // Track loop depth
            if (token.type === BSLTokenType.KEYWORD && (token.value.toLowerCase() === 'цикл')) {
                loopDepth++;
            }
            if (token.type === BSLTokenType.KEYWORD && (token.value.toLowerCase() === 'конеццикла')) {
                loopDepth = Math.max(0, loopDepth - 1);
            }

            // Track try depth
            if (token.type === BSLTokenType.KEYWORD && (token.value.toLowerCase() === 'попытка')) {
                tryDepth++;
            }
            if (token.type === BSLTokenType.KEYWORD && (token.value.toLowerCase() === 'конецпопытки')) {
                tryDepth = Math.max(0, tryDepth - 1);
            }

            // Extract 1C metadata references (Справочники.Номенклатура, Документы.ЗаказКлиента)
            if (token.type === BSLTokenType.IDENTIFIER &&
                ['справочники', 'документы', 'регистрынакопления', 'регистрысведений'].includes(token.value.toLowerCase())) {
                if (tokens[i + 1]?.value === '.' && tokens[i + 2]?.type === BSLTokenType.IDENTIFIER) {
                    referencedMetadata.add(`${token.value}.${tokens[i + 2].value}`);
                }
            }

            i++;
        }

        return {
            currentMethod,
            compilationDirective: currentMethod?.directive,
            localVariables: Array.from(localVariables),
            insideLoop: loopDepth > 0,
            insideTry: tryDepth > 0,
            referencedMetadata: Array.from(referencedMetadata)
        };
    }
}
