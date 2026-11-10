import { StandardIssue } from './types';
import { BSPHelper } from './bspHelper';
import { QueryBuilder } from './queryBuilder';
import { BSLTokenizer } from './bslTokenizer';
import { withoutComments } from './shared/bsl/text';
import { lexicalChecks } from './entities/audit/model/lexicalChecks';
import { AuditOptions, applyAuditPolicy } from './entities/audit/model/policy';
import { querySources } from './entities/query/model/source';

/**
 * 1C:Enterprise ITS Development Standards & Performance Auditor (Senior Grade).
 * 
 * Inspects BSL source code using a lexical token stream:
 * 1. ITS-PERF-001: Query execution inside loops
 * 2. ITS-PERF-002: Virtual tables without parameters
 * 3. ITS-LOCK-001: Missing DataLock (БлокировкаДанных) in ОбработкаПроведения
 * 4. ITS-UI-003: Deprecated synchronous modal calls (Предупреждение/Вопрос)
 * 6. ITS-SEC-001: Dangerous dynamic query string concatenation (SQL/1C injection risk)
 * 7. ITS-BSP-001: Manual object fetching (ПолучитьОбъект) instead of lightweight BSP attribute reader
 */
export class StandardsChecker {
    public static auditCode(code: string, options: AuditOptions = {}): StandardIssue[] {
        const issues: StandardIssue[] = [];
        if (!withoutComments(code).trim()) return [{line:1,rule:'INPUT-EMPTY',severity:'info',message:'Нет исполняемого кода для проверки.',suggestion:'Вставьте модуль BSL или выделите фрагмент.'}];
        const tokens = BSLTokenizer.tokenize(code);
        issues.push(...lexicalChecks(tokens));

        // Add BSP suggestions
        const bspSuggestions = BSPHelper.analyzeForBSPOptimization(code, tokens);
        for (const bsp of bspSuggestions) {
            issues.push({
                line: bsp.line || 1,
                rule: 'ITS-BSP-001',
                severity: 'info',
                message: `Рекомендуется использование модуля БСП "${bsp.moduleName}": ${bsp.explanation}`,
                suggestion: `Замените на: ${bsp.recommendedCall}`
            });
        }

        // Only actual query sources, with source line offsets retained.
        for (const source of querySources(code)) {
            for (const qIssue of QueryBuilder.inspectQuery(source.text).issues) {
                if (source.dynamic && qIssue.code === 'QUERY-STRUCTURE') continue;
                issues.push({line: source.line + (qIssue.line || 1) - 1, rule:qIssue.code,
                    severity:qIssue.severity, message:qIssue.message, suggestion:qIssue.recommendation});
            }
        }

        return applyAuditPolicy(issues, tokens, options);
    }

    public static formatAuditReport(issues: StandardIssue[]): string {
        if (issues.length === 0) {
            return 'Совпадений по реализованным локальным проверкам нет. Полнота ИТС, синтаксис и поведение требуют отдельной проверки.';
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
