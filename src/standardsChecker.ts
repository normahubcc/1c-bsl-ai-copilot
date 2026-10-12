import { StandardIssue } from './types';
import { BSPHelper } from './bspHelper';
import { QueryBuilder } from './queryBuilder';

/**
 * 1C:Enterprise ITS Development Standards & Performance Auditor (Senior Grade).
 * 
 * Inspects BSL source code for:
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
        const lines = code.split('\n');

        let inLoop = false;
        let inPostingHandler = false;
        let hasDataLock = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const lineNum = i + 1;

            // Check posting handler
            if (trimmed.includes('Процедура ОбработкаПроведения')) {
                inPostingHandler = true;
                hasDataLock = false;
            }
            if (inPostingHandler && trimmed.includes('Новый БлокировкаДанных')) {
                hasDataLock = true;
            }
            if (inPostingHandler && trimmed.includes('КонецПроцедуры')) {
                if (!hasDataLock) {
                    issues.push({
                        line: lineNum,
                        rule: 'ITS-LOCK-001',
                        severity: 'error',
                        message: 'В процедуре ОбработкаПроведения отсутствует объект БлокировкаДанных.',
                        suggestion: 'Установите управляемую блокировку данных перед чтением остатков для предотвращения взаимоблокировок (Deadlock) при параллельном проведении.'
                    });
                }
                inPostingHandler = false;
            }

            // Check loop boundaries
            if (/^\s*(Для\s+Каждого|Для\s+\w+\s*=|Пока\s+)/i.test(trimmed)) {
                inLoop = true;
            }
            if (/^\s*КонецЦикла;/i.test(trimmed)) {
                inLoop = false;
            }

            // 1. Anti-pattern: Query execution inside loop
            if (inLoop && /\.Выполнить\s*\(\s*\)/i.test(trimmed)) {
                issues.push({
                    line: lineNum,
                    rule: 'ITS-PERF-001',
                    severity: 'error',
                    message: 'Выполнение запроса внутри цикла (Запрос.Выполнить()).',
                    suggestion: 'Перенесите выгрузку данных в один пакетный запрос до цикла с помещением во временную таблицу и соединением по массиву ссылок.'
                });
            }

            // 2. Anti-pattern: Virtual tables without parameters
            if (/\.(Остатки|СрезПоследних|СрезПервых|Обороты)\s*\(\s*\)/i.test(trimmed)) {
                issues.push({
                    line: lineNum,
                    rule: 'ITS-PERF-002',
                    severity: 'warning',
                    message: 'Обращение к виртуальной таблице без передачи параметров среза/условия.',
                    suggestion: 'Всегда передавайте параметры периода и условий отбора в параметры виртуальной таблицы, а не фильтруйте результат в секции ГДЕ.'
                });
            }

            // 3. Anti-pattern: Synchronous modal windows
            if (/(Предупреждение|Вопрос|ВвестиСтроку|ВвестиЧисло)\s*\(/i.test(trimmed) && !/Оповещение/i.test(trimmed)) {
                issues.push({
                    line: lineNum,
                    rule: 'ITS-UI-003',
                    severity: 'warning',
                    message: 'Использование модальных окон (Предупреждение/Вопрос). Запрещено в веб-клиенте и мобильном клиенте.',
                    suggestion: 'Используйте асинхронные методы: ПоказатьПредупреждение(), ПоказатьВопрос() с передачей ОписаниеОповещения.'
                });
            }

            // 4. Anti-pattern: Passing mutable objects
            if (/&(НаСервере|НаСервереБезКонтекста)/i.test(trimmed)) {
                const nextLines = lines.slice(i, i + 5).join(' ');
                if (/(ТаблицаЗначений|ДеревоЗначений)/i.test(nextLines) && /Функция|Процедура/i.test(nextLines)) {
                    issues.push({
                        line: lineNum,
                        rule: 'ITS-MUTABLE-001',
                        severity: 'error',
                        message: 'Обнаружена потенциальная передача мутабельного объекта (ТаблицаЗначений) между клиентом и сервером.',
                        suggestion: 'Таблицы значений не сериализуются между клиентом и сервером. Передавайте Массив Структур либо сериализуйте данные в Соответствие.'
                    });
                }
            }

            // 5. Anti-pattern: Dangerous dynamic query concatenation (1C injection)
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
