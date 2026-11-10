import { ImportedRunnerEvidence } from './runnerSessions';
import type { compareQueryResults } from '../../compare-query-results/model/compareResults';

export type RunnerComparison = ReturnType<typeof compareQueryResults> | null;

export function formatSignedRunnerReport(evidence: ImportedRunnerEvidence, comparison: RunnerComparison, t: (text: string) => string): string {
    let state: ReturnType<ImportedRunnerEvidence['state']>;
    try { state = evidence.state(); } catch { state = 'trust_changed'; }
    const current = state === 'current', p = evidence.payload;
    const stateText = { current: 'Источник соответствует снимку задания.', source_changed: 'Исходник или контекст изменился. Результат больше не актуален.',
        trust_changed: 'Профиль отключён или изменён. Доверие к этому результату отозвано.',
        superseded: 'Задание заменено новым. Этот отчёт исторический.', expired: 'Срок актуальности результата истёк. Требуется новый запуск.' }[state];
    const json = (value: unknown) => JSON.stringify(value, null, 2).replace(/`/g, '\\u0060');
    return ['# ' + t('Результат проверки выбранного запроса'), '', '**' + t(stateText) + '**', '',
        t('Подпись оператора проверена для задания, созданного этим окном IDE.'), '',
        t(p.observation.status === 'completed' ? 'Выбранный текст запроса выполнен в 1С.' : 'Выполнение выбранного запроса не подтверждено успешным результатом.'), '',
        t('Полный BSL-модуль и бизнес-требование не утверждены. Этот отчёт не разрешает применение кода.'), '',
        '## ' + t('Сравнение с предложенным контрактом'), '',
        t(!comparison ? 'Сравнение не выполнено.' : comparison.status === 'equal' ? 'Предоставленные ожидания совпали с результатом движка.' : comparison.status === 'different' ? 'Движок вернул расхождения с ожиданием.' : 'Колонки результата не совпадают с контрактом.'), '',
        '```json', json(comparison), '```', '',
        '## ' + t('Выбранный запрос и требование'), '', '```json', json({ query: evidence.request.query,
            selection: p.selection, ...(p.schemaVersion === 2 ? { parameters: p.parameters, parametersHash: p.parametersHash } : {}), intent: evidence.request.contract.intent, requirement: evidence.request.contract.requirement,
            scope: evidence.request.contract.scope, preconditions: evidence.request.contract.preconditions,
            assumptions: evidence.request.contract.assumptions, engineReason: p.observation.reason }), '```', '',
        '## ' + t('Подпись, снимок и область проверки'), '', '```json', json({
            jobId: p.job.jobId, runnerId: p.runnerId, keyId: p.keyId, candidate: p.candidate, queryHash: p.queryHash,
            profileHash: p.job.profileHash, policyHash: p.job.policyHash, contractHash: p.contractHash,
            receiptHash: evidence.assessment.receiptHash, startedAt: p.startedAt, finishedAt: p.finishedAt, expiresAt: p.expiresAt,
            sourceStatus: state, signatureVerified: true, queryExecutionVerified: current && evidence.assessment.queryExecutionVerified,
            fullBslExecution: 'not_run', executionVerified: false, approvalVerified: false, canApply: false,
            isolation: p.isolation }), '```', '',
        t('В расширении актуальность обновляется при изменениях. Сохранённая копия отчёта является снимком на момент сохранения.'), ''
    ].join('\n');
}
