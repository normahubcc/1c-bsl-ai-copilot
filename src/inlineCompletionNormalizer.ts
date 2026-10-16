/**
 * Pure, conservative normalizer for inline-completion model output (Prompt 4).
 *
 * No VS Code API, no I/O, no logging — safe to unit-test exhaustively.
 * Philosophy: ghost text must be pure BSL. Anything ambiguous is dropped
 * (`null`) instead of shown. Low confidence never becomes visible text.
 */

export interface NormalizationInput {
    /** Code before the cursor (used for echo-dedup and block balance). */
    prefix: string;
    /** Code after the cursor (used for suffix-dedup). */
    suffix: string;
    /** Current line fragment before the cursor (echo-dedup). */
    currentLineBeforeCursor: string;
    /** Active compilation directive (e.g. `&НаКлиенте`). Informational:
     *  directive lines are recognized as code and never stripped. */
    scopeDirective?: string;
    maxLines: number;
    maxChars: number;
}

export interface NormalizedCompletion {
    text: string;
    lineCount: number;
    /** Length in code points (emoji-safe). */
    charCount: number;
    confidence: 'high' | 'medium';
    removedWrapper: boolean;
}

export const DEFAULT_NORMALIZER_LIMITS = {
    maxLines: 20,
    maxChars: 1000,
};

/** BSL keywords distinctive enough to mark a line as code on their own. */
const STRONG_KEYWORDS = [
    'процедура', 'функция', 'конецпроцедуры', 'конецфункции',
    'конецесли', 'конеццикла', 'конецпопытки', 'иначеесли',
    'попытка', 'исключение', 'продолжить', 'прервать',
    'перем', 'экспорт', 'новый', 'выполнить',
    'тогда', 'иначе', 'каждого', 'цикл', 'возврат',
];

/** Common words: only count together with a strong keyword or code punctuation. */
const WEAK_KEYWORDS = ['если', 'для', 'пока'];

const BLOCK_OPENERS = ['если', 'для', 'пока', 'попытка', 'процедура', 'функция'];
const BLOCK_CLOSERS = ['конецесли', 'конеццикла', 'конецпопытки', 'конецпроцедуры', 'конецфункции'];

function wordPattern(words: string[]): RegExp {
    return new RegExp(`(^|[^А-Яа-яЁёA-Za-z0-9_])(${words.join('|')})(?![А-Яа-яЁёA-Za-z0-9_])`, 'i');
}

const STRONG_RE = wordPattern(STRONG_KEYWORDS);
const WEAK_RE = wordPattern(WEAK_KEYWORDS);
const BLOCK_OPENER_RE = wordPattern(BLOCK_OPENERS);
const BLOCK_CLOSER_RE = wordPattern(BLOCK_CLOSERS);

const CALL_PATTERN = /[A-Za-zА-Яа-яЁё0-9_"]\s*\(/;
const IDENTIFIER_LINE = /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*(\.[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*)*;?$/;
const PUNCT_ONLY_LINE = /^[\s()[\],;.]+$/;
const PREPROCESSOR_LINE = /^#[А-Яа-яЁёA-Za-z_]/;

/** Returns true when the line is recognizably BSL code (not prose). */
function isCodeLikeLine(line: string): boolean {
    const t = line.trim();
    if (!t) {
        return false;
    }
    if (t.startsWith('//')) {
        return true;
    }
    if (/^&[А-Яа-яЁёA-Za-z0-9_]+/.test(t)) {
        return true;
    }
    if (PREPROCESSOR_LINE.test(t)) {
        return true;
    }
    if (t.startsWith('|') && !/^\s*\|.*\|\s*$/.test(line)) {
        return true; // BSL multiline-string continuation (not a markdown table row)
    }
    if (STRONG_RE.test(t)) {
        return true;
    }
    if (t.includes(';')) {
        return true; // BSL statements end with `;`; prose does not use it
    }
    if (CALL_PATTERN.test(t)) {
        return true;
    }
    if (PUNCT_ONLY_LINE.test(t)) {
        return true; // lone closers like `);` / `)` / `;`
    }
    if (IDENTIFIER_LINE.test(t)) {
        return true; // single (possibly dotted) identifier fragment
    }
    if (WEAK_RE.test(t)) {
        return true; // weak keyword alone is a plausible control-flow start
    }
    return false;
}

/** Leading explanatory line, e.g. `Вот продолжение кода:` — BSL never ends a line with `:`. */
function isIntroLine(line: string): boolean {
    const t = line.trim();
    if (!t || t.startsWith('//')) {
        return false;
    }
    if (/^(?:вот|ниже|конечно|разумеется|хорошо|пожалуйста|смотрите?|продолжение|вставка|код|ответ|результат|пример|держите?|готово|here(?:'s| is)|the (?:code|continuation)|continuation|result|sure|of course)[\w\s,«»"—–-]*:\s*$/i.test(t)) {
        return true;
    }
    // NB: `\b` is ASCII-only and never matches after Cyrillic — use an explicit boundary.
    if (/^(?:вот(?![А-Яа-яЁёA-Za-z0-9_])|here(?:'s| is)(?![A-Za-z0-9_]))[^;=\n()]*$/i.test(t)) {
        return true; // deictic intro without colon ("Вот код"); never a bare BSL variable
    }
    return /^[^;=\n()]*:\s*$/.test(t);
}

function isMarkdownLine(line: string): boolean {
    const t = line.trim();
    if (/^#{1,6}\s/.test(t) || /^>\s?/.test(t) || /^\*\*.+\*\*\s*$/.test(t)) {
        return true;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
        return true; // markdown table row (BSL `|…` continuations never close with `|`)
    }
    if (/^\s*(?:[-*+]\s+|\d{1,3}\.\s+)\S/.test(line)) {
        return true; // list item: BSL unary minus never takes a space (`-Сумма`, not `- Сумма`)
    }
    return false;
}

interface StringScan {
    /** Code with string literals and `//` comments blanked out (same length). */
    clean: string;
    unclosedQuote: boolean;
}

interface PrefixState {
    paren: number;
    bracket: number;
    inString: boolean;
}

/** Bracket/string state at the END of the prefix (negatives clamped: user code is trusted). */
function prefixDepth(prefix: string): PrefixState {
    const scan = blankStringsAndComments(prefix, false);
    let paren = 0;
    let bracket = 0;
    for (const ch of scan.clean) {
        if (ch === '(') {
            paren++;
        } else if (ch === ')') {
            paren = Math.max(0, paren - 1);
        } else if (ch === '[') {
            bracket++;
        } else if (ch === ']') {
            bracket = Math.max(0, bracket - 1);
        }
    }
    return { paren, bracket, inString: scan.unclosedQuote };
}

/** Single pass that understands BSL `"…"` (with `""` escapes) and `//` comments. */
function blankStringsAndComments(text: string, startInString: boolean): StringScan {
    const out: string[] = [];
    let unclosedQuote = startInString;
    let inString = startInString;
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (inString) {
            out.push(' ');
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    out.push(' ');
                    i += 2;
                    continue;
                }
                inString = false;
                unclosedQuote = false;
            }
            i++;
            continue;
        }
        if (ch === '"') {
            inString = true;
            unclosedQuote = true;
            out.push(' ');
            i++;
            continue;
        }
        if (ch === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') {
                out.push(text[i] === '\n' ? '\n' : ' ');
                i++;
            }
            continue;
        }
        if (ch === '\n') {
            unclosedQuote = false; // BSL strings do not span lines (except `|` continuation)
        }
        out.push(ch);
        i++;
    }
    return { clean: out.join(''), unclosedQuote: inString || unclosedQuote };
}

function countMatches(re: RegExp, text: string): number {
    let n = 0;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        n++;
        if (m[0].length === 0) {
            re.lastIndex++;
        }
    }
    return n;
}

export function normalizeInlineCompletion(
    raw: unknown,
    input: NormalizationInput
): NormalizedCompletion | null {
    if (typeof raw !== 'string') {
        return null;
    }
    let removedWrapper = false;
    let text = raw;

    // 1. Fence stripping (safe: whole leading/trailing fence lines only).
    const lines0 = text.split('\n');
    while (lines0.length > 0 && lines0[0].trim() === '') {
        lines0.shift();
    }
    while (lines0.length > 0 && lines0[lines0.length - 1].trim() === '') {
        lines0.pop();
    }
    if (lines0.length === 0) {
        return null;
    }
    const fenceOpen = lines0[0].trim().match(/^```\s*([A-Za-z0-9_+-]*)\s*$/);
    if (fenceOpen) {
        const lang = (fenceOpen[1] || '').toLowerCase();
        if (lang !== '' && lang !== 'bsl' && lang !== '1c' && lang !== 'onec' && lang !== '1с') {
            return null; // wrong-language block (```json / ```python / …)
        }
        lines0.shift();
        removedWrapper = true;
    }
    if (lines0.length > 0 && lines0[lines0.length - 1].trim() === '```') {
        lines0.pop();
        removedWrapper = true;
    }
    text = lines0.join('\n');
    if (text.includes('```')) {
        return null; // stray fence inside — do not guess
    }
    if (!text.trim()) {
        return null;
    }

    // 2. Leading explanation lines.
    const lines = text.split('\n');
    while (lines.length > 0) {
        const first = lines[0].trim();
        if (first === '') {
            lines.shift();
            continue;
        }
        if (isIntroLine(lines[0])) {
            lines.shift();
            removedWrapper = true;
            continue;
        }
        break;
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
    }
    if (lines.length === 0) {
        return null;
    }

    // 3. Markdown / JSON / plain-text gates.
    for (const line of lines) {
        if (line.trim() !== '' && isMarkdownLine(line)) {
            return null;
        }
    }
    const compact = lines.filter((l) => l.trim() !== '').join('\n').trim();
    if (/^[{[]/.test(compact)) {
        return null; // JSON or bracketed data, never BSL ghost text
    }

    // 4. Every remaining non-blank line must read as BSL.
    for (const line of lines) {
        if (line.trim() === '') {
            continue;
        }
        if (!isCodeLikeLine(line)) {
            return null;
        }
    }

    // 5. Comments-only responses carry no completable code.
    if (!lines.some((l) => l.trim() !== '' && !l.trim().startsWith('//'))) {
        return null;
    }

    text = lines.join('\n');

    // 6. Obvious echo-dedup (anchored; never rewrites inner code).
    const fragRaw = input.currentLineBeforeCursor;
    const frag = fragRaw.trim();
    if (frag.length >= 2) {
        if (text.startsWith(fragRaw) && fragRaw.length > 0) {
            text = text.slice(fragRaw.length);
            removedWrapper = true;
        } else {
            const leftTrimmed = text.replace(/^\s+/, '');
            if (leftTrimmed.startsWith(frag)) {
                text = leftTrimmed.slice(frag.length);
                removedWrapper = true;
            }
        }
    }
    const suffixFirst = (input.suffix || '').split('\n')[0].trim();
    if (suffixFirst.length >= 3 && text.trimEnd().endsWith(suffixFirst)) {
        text = text.trimEnd().slice(0, text.trimEnd().length - suffixFirst.length);
        removedWrapper = true;
    }
    text = text.replace(/^\s*\n/, '').trim();
    if (!text) {
        return null; // pure echo of the current line/suffix
    }

    // 7. Size limits from configuration.
    const outLines = text.split('\n');
    if (outLines.length > input.maxLines || Array.from(text).length > input.maxChars) {
        return null;
    }

    // 8. Structural invariants over a string/comment-aware scan that CONTINUES
    //    from the prefix state: the fragment may legitimately close brackets or
    //    string literals opened before the cursor (e.g. `"ok");` after `Сообщить(`).
    //    Unclosed opens are fine (continuations); over-closing is malformed.
    const start = prefixDepth(input.prefix);
    const scan = blankStringsAndComments(text, start.inString);
    if (scan.unclosedQuote) {
        return null;
    }
    if (/[{}]/.test(scan.clean)) {
        return null; // braces are never BSL outside string literals
    }
    let paren = start.paren;
    let bracket = start.bracket;
    for (const ch of scan.clean) {
        if (ch === '(') {
            paren++;
        } else if (ch === ')') {
            if (--paren < 0) {
                return null;
            }
        } else if (ch === '[') {
            bracket++;
        } else if (ch === ']') {
            if (--bracket < 0) {
                return null;
            }
        }
    }
    if (/;\s*$/.test(text) && (paren > start.paren || bracket > start.bracket)) {
        // `;` terminates the statement: the fragment may close prefix brackets
        // but must not leave newly opened ones dangling past it.
        return null;
    }

    // 9. Block balance against the prefix: closers must not outnumber openers
    //    (unclosed openers are fine — completions are continuations).
    const combined = blankStringsAndComments(`${input.prefix}\n${text}`, false).clean;
    const openers = countMatches(new RegExp(BLOCK_OPENER_RE.source, 'gi'), combined);
    const closers = countMatches(new RegExp(BLOCK_CLOSER_RE.source, 'gi'), combined);
    if (closers > openers) {
        return null;
    }

    return {
        text,
        lineCount: outLines.length,
        charCount: Array.from(text).length,
        confidence: removedWrapper ? 'medium' : 'high',
        removedWrapper,
    };
}
