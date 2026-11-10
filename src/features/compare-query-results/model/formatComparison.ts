import { QueryComparisonReceipt } from './queryComparisonJob';

/** User values are JSON-quoted, never interpreted as Markdown links, HTML or commands. */
export function formatQueryComparison(receipt: QueryComparisonReceipt, t: (text: string) => string): string {
    const result = receipt.comparison;
    const json = (value: unknown) => JSON.stringify(value, null, 2).replace(/`/g, '\\u0060');
    return [
        '# ' + t('Сравнение данных запроса'), '',
        t(result.status === 'equal' ? 'Предоставленные строки совпали.' : result.status === 'different' ? 'Обнаружены расхождения в строках.' : 'Колонки результатов не совпадают.'), '',
        '**' + t('Исполнение 1С не подтверждено. Контракт не утверждён.') + '**', '',
        t('Этот отчёт сравнивает импортированные данные. Он не разрешает применение кода.'), '',
        '- ' + t('Ожидаемых строк') + ': ' + result.expectedRowCount,
        '- ' + t('Полученных строк') + ': ' + result.actualRowCount,
        '- ' + t('Недостающих строк') + ': ' + (result.missingRows ?? t('Не определено')),
        '- ' + t('Лишних строк') + ': ' + (result.unexpectedRows ?? t('Не определено')),
        '- ' + t('Режим сравнения') + ': ' + result.mode,
        '- ' + t('Метаданные и профиль исполнения не проверены.'), '',
        '## ' + t('Требование и область контракта'), '', '```json', json({ intent: receipt.contract.intent,
            requirement: receipt.contract.requirement, scope: receipt.contract.scope,
            preconditions: receipt.contract.preconditions, assumptions: receipt.contract.assumptions }), '```', '',
        '## ' + t('Колонки и расхождения'), '', '```json', json({ expectedColumns: result.expectedColumns,
            actualColumns: result.actualColumns, differences: result.differences, truncated: result.truncated }), '```', '',
        '## ' + t('Идентичность проверки'), '', '```json', json({ jobId: receipt.jobId, candidate: receipt.candidate,
            contractHash: receipt.contractHash, inputHash: receipt.inputHash, expectedHash: result.expectedHash, actualHash: result.actualHash,
            receiptHash: receipt.receiptHash, startedAt: receipt.startedAt, finishedAt: receipt.finishedAt,
            scope: receipt.scope, engineStatus: receipt.engineStatus, executionVerified: false, approvalVerified: false, canApply: false }), '```', '',
        t('Отчёт относится к состоянию на момент сравнения. После изменения исходника требуется повторная проверка.'), ''
    ].join('\n');
}
