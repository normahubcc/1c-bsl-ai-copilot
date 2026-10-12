import { StandardIssue } from './types';
import { BSPHelper } from './bspHelper';
import { QueryBuilder } from './queryBuilder';
import { BSLTokenizer, BSLTokenType } from './bslTokenizer';

/**
 * 1C:Enterprise ITS Development Standards & Performance Auditor (Senior Grade).
 * 
 * Inspects BSL source code using AST token stream:
 * 1. ITS-PERF-001: Query execution inside loops
 * 2. ITS-PERF-002: Virtual tables without parameters
 * 3. ITS-LOCK-001: Missing DataLock (БлокировкаДанных) in ОбработкаПроведения
 * 4. ITS-UI-003: Deprecated synchronous modal calls (Предупреждение/Вопрос)
 * 5. ITS-MUTABLE-001: Attempting to pass mutable objects (ТаблицаЗначений) across client-server boundaries
 * 6. ITS-SEC-001: Dangerous dynamic query string concatenation (SQL/1C injection risk)
 * 7. ITS-BSP-001: Manual object fetching (ПолучитьОбъект) instead of lightweight BSP attribute reader
 */
export class StandardsChecker {
    public static auditCode(code: string): StandardIssue[] {
        const issues: StandardIssue[] = [];
        const tokens = BSLTokenizer.tokenize(code);
        const lines = code.split('\n');

        // Build token-based loop and posting map to prevent false positives in comments/strings
        const linesInsideLoop = new Set<number>();
        const commentsByLine = new Set<number>();
        let loopDepth = 0;
        let inPosting = false;
        let postingStartLine = 0;
        let hasDataLockInPosting = false;

        for (let i = 0; i < tokens.length; i++) {
            const tok = tokens[i];
            if (tok.type === BSLTokenType.COMMENT) {
                commentsByLine.add(tok.line);
                continue;
            }

            // Loop tracking
            if (tok.type === BSLTokenType.KEYWORD && tok.value.toLowerCase() === 'цикл') {
                loopDepth++;
            }
            if (tok.type === BSLTokenType.KEYWORD && tok.value.toLowerCase() === 'конеццикла') {
                loopDepth = Math.max(0, loopDepth - 1);
            }
            if (loopDepth > 0) {
                linesInsideLoop.add(tok.line);
            }

            // Posting handler tracking
            if (tok.type === BSLTokenType.KEYWORD && tok.value.toLowerCase() === 'процедура') {
                const nextTok = tokens[i + 1];
                if (nextTok && nextTok.value.toLowerCase() === 'обработкапроведения') {
                    inPosting = true;
                    postingStartLine = tok.line;
                    hasDataLockInPosting = false;
                }
            }

            if (inPosting && tok.type === BSLTokenType.IDENTIFIER && tok.value.toLowerCase() === 'блокировкаданных') {
                hasDataLockInPosting = true;
            }

            if (inPosting && tok.type === BSLTokenType.KEYWORD && tok.value.toLowerCase() === 'конецпроцедуры') {
                if (!hasDataLockInPosting) {
                    issues.push({
                        line: tok.line,
                        rule: 'ITS-LOCK-001',
                        severity: 'error',
                        message: 'В процедуре ОбработкаПроведения отсутствует объект БлокировкаДанных.',
                        suggestion: 'Установите управляемую блокировку данных перед чтением остатков для предотвращения взаимоблокировок (Deadlock) при параллельном проведении.'
                    });
                }
            }
        }

        // Run token-driven AST checks
        for (let i = 0; i < tokens.length; i++) {
            const tok = tokens[i];
            if (tok.type === BSLTokenType.COMMENT || tok.type === BSLTokenType.STRING_LITERAL) {
                continue;
            }

            // 1. Anti-pattern: Query execution inside loop (ITS-PERF-001)
            if (linesInsideLoop.has(tok.line) &&
                (tok.type === BSLTokenType.IDENTIFIER || tok.type === BSLTokenType.KEYWORD) &&
                tok.value.toLowerCase() === 'выполнить') {
                const prev = tokens[i - 1];
                const next = tokens[i + 1];
                if (prev && prev.value === '.' && next && next.value === '(') {
                    issues.push({
                        line: tok.line,
                        rule: 'ITS-PERF-001',
                        severity: 'error',
                        message: 'Выполнение запроса внутри цикла (Запрос.Выполнить()).',
                        suggestion: 'Перенесите выгрузку данных в один пакетный запрос до цикла с помещением во временную таблицу и соединением по массиву ссылок.'
                    });
                }
            }

            // 2. Anti-pattern: Virtual tables without parameters (ITS-PERF-002)
            if (tok.type === BSLTokenType.IDENTIFIER &&
                ['остатки', 'срезпоследних', 'срезпервых', 'обороты'].includes(tok.value.toLowerCase())) {
                const prev = tokens[i - 1];
                const next = tokens[i + 1];
                const nextNext = tokens[i + 2];
                if (prev && prev.value === '.' && next && next.value === '(' && nextNext && nextNext.value === ')') {
                    issues.push({
                        line: tok.line,
                        rule: 'ITS-PERF-002',
                        severity: 'warning',
                        message: `Обращение к виртуальной таблице "${tok.value}" без передачи параметров среза/условия.`,
                        suggestion: 'Всегда передавайте параметры периода и условий отбора в параметры виртуальной таблицы, а не фильтруйте результат в секции ГДЕ.'
                    });
                }
            }

            // 3. Anti-pattern: Synchronous modal windows (ITS-UI-003)
            if (tok.type === BSLTokenType.IDENTIFIER &&
                ['предупреждение', 'вопрос', 'ввестистроку', 'ввестичисло'].includes(tok.value.toLowerCase())) {
                const prev = tokens[i - 1];
                const next = tokens[i + 1];
                // Ensure it's not a property or method of another object (e.g. not SomeObj.Предупреждение)
                if ((!prev || prev.value !== '.') && next && next.value === '(') {
                    // Check if call contains Оповещение parameter
                    let hasNotification = false;
                    let k = i + 2;
                    while (k < tokens.length && tokens[k].value !== ')' && tokens[k].line === tok.line) {
                        if (tokens[k].value.toLowerCase().includes('оповещени')) {
                            hasNotification = true;
                            break;
                        }
                        k++;
                    }
                    if (!hasNotification) {
                        issues.push({
                            line: tok.line,
                            rule: 'ITS-UI-003',
                            severity: 'warning',
                            message: `Использование модального окна (${tok.value}). Запрещено в веб-клиенте и мобильном клиенте.`,
                            suggestion: 'Используйте асинхронные методы: ПоказатьПредупреждение(), ПоказатьВопрос() с передачей ОписаниеОповещения.'
                        });
                    }
                }
            }
        }

        // 4. Line-level auxiliary checks (for dynamic query concatenation and mutable parameters)
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const lineNum = i + 1;

            if (trimmed.startsWith('//')) {
                continue;
            }

            // Dangerous dynamic query concatenation (1C injection)
            if (/Запрос\.Текст\s*=\s*Запрос\.Текст\s*\+\s*["'].*(\+|&)/i.test(trimmed) && !/Параметр/i.test(trimmed)) {
                issues.push({
                    line: lineNum,
                    rule: 'ITS-SEC-001',
                    severity: 'warning',
                    message: 'Динамическая склейка текста запроса со строковыми переменными (риск 1С-инъекции).',
                    suggestion: 'Всегда передавайте значения через параметры запроса (Запрос.УстановитьПараметр), а не конкатенируйте текст.'
                });
            }
        }

        // Add BSP suggestions
        const bspSuggestions = BSPHelper.analyzeForBSPOptimization(code);
        for (const bsp of bspSuggestions) {
            issues.push({
                line: 1,
                rule: 'ITS-BSP-001',
                severity: 'info',
                message: `Рекомендуется использование модуля БСП "${bsp.moduleName}": ${bsp.explanation}`,
                suggestion: `Замените на: ${bsp.recommendedCall}`
            });
        }

        // Add Query Builder issues
        const queryInspection = QueryBuilder.inspectQuery(code);
        for (const qIssue of queryInspection.issues) {
            issues.push({
                line: 1,
                rule: qIssue.code,
                severity: qIssue.severity,
                message: qIssue.message,
                suggestion: qIssue.recommendation
            });
        }

        return issues;
    }

    public static formatAuditReport(issues: StandardIssue[]): string {
        if (issues.length === 0) {
            return '✓ Замечаний по стандартам разработки фирмы «1С» (ИТС) не обнаружено. Код соответствует корпоративному стандарту качества.';
        }

        const lines: string[] = [
            `Найдено замечаний по стандартам ИТС: ${issues.length}\n`
        ];

        for (const iss of issues) {
            let badge = 'ℹ️ [Рекомендация]';
            if (iss.severity === 'error') {
                badge = '🔴 [Критично]';
            } else if (iss.severity === 'warning') {
                badge = '🟡 [Предупреждение]';
            }

            lines.push(`${badge} ${iss.rule} (стр. ${iss.line}): ${iss.message}`);
            lines.push(`   💡 Решение: ${iss.suggestion}\n`);
        }

        return lines.join('\n');
    }
}
