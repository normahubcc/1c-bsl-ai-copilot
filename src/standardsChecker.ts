import { StandardIssue } from './types';

/**
 * 1C:Enterprise ITS Development Standards Auditor.
 * Inspects BSL source code for performance bottlenecks, deadlocks, and anti-patterns.
 */
export class StandardsChecker {
    public static auditCode(code: string): StandardIssue[] {
        const issues: StandardIssue[] = [];
        const lines = code.split('\n');

        let inLoop = false;
        let loopStartLine = 0;
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
                loopStartLine = lineNum;
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
                    suggestion: 'Перенесите выгрузку данных в один пакетный запрос до цикла, либо используйте временную таблицу с соединением по массиву ссылок.'
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
        }

        return issues;
    }

    public static formatAuditReport(issues: StandardIssue[]): string {
        if (issues.length === 0) {
            return '✓ Замечаний по стандартам разработки фирмы «1С» (ИТС) не обнаружено.';
        }

        const lines: string[] = [
            `Найдено замечаний по стандартам ИТС: ${issues.length}\n`
        ];

        for (const iss of issues) {
            const badge = iss.severity === 'error' ? '🔴 [Критично]' : '🟡 [Предупреждение]';
            lines.push(`${badge} Строка ${iss.line} | ${iss.rule}: ${iss.message}`);
            lines.push(`   💡 Рекомендация: ${iss.suggestion}\n`);
        }

        return lines.join('\n');
    }
}
