import { randomUUID } from 'node:crypto';
import { immutable, jsonHash } from '../../../shared/lib/jsonContract';
import { parseQueryCandidateIdentity, parseQueryComparisonPackage, QueryCandidateLease } from '../../../entities/validation/model/queryComparison';
import { compareQueryResults } from './compareResults';

export type ComparisonJobState = 'created' | 'comparing' | 'completed' | 'failed' | 'cancelled' | 'stale';

/** Local provided-data comparison only. It cannot execute a candidate or authorize apply. */
export class QueryComparisonJob {
    readonly jobId = randomUUID();
    readonly candidate;
    private readonly current: () => boolean;
    private state: ComparisonJobState = 'created';

    constructor(lease: QueryCandidateLease) {
        this.candidate = parseQueryCandidateIdentity(lease.identity);
        this.current = lease.isCurrent;
        this.assertCurrent();
    }

    get status(): ComparisonJobState { return this.state; }

    cancel(): void {
        if (this.state === 'created' || this.state === 'comparing') this.state = 'cancelled';
    }

    assertCurrent(): void {
        this.assertNotCancelled();
        let current = false;
        try { current = this.current(); } catch { /* A failed host guard is stale, never current. */ }
        this.assertNotCancelled();
        if (!current) { this.state = 'stale'; throw new Error('Исходный контекст изменился. Повторите генерацию.'); }
    }

    private assertNotCancelled(): void {
        if (this.state === 'cancelled') throw new Error('Сравнение отменено.');
    }

    run(value: unknown) {
        if (this.state !== 'created') throw new Error('Это задание сравнения уже завершено или отменено.');
        this.assertCurrent();
        this.state = 'comparing';
        const startedAt = new Date().toISOString();
        try {
            const input = parseQueryComparisonPackage(value);
            if (jsonHash(input.candidate) !== jsonHash(this.candidate)) throw new Error('Данные проверки относятся к другому кандидату. Экспортируйте новое задание.');
            if (input.contract.projectId !== this.candidate.scopeHash) throw new Error('Контракт относится к другому проекту. Проверьте projectId в задании.');
            const comparison = compareQueryResults(input.contract.assertion.expected, input.actual, input.contract.assertion.mode);
            this.assertCurrent();
            const receipt = immutable({ schemaVersion: 1 as const, jobId: this.jobId, kind: 'local_query_comparison' as const,
                candidate: this.candidate, contractHash: jsonHash(input.contract), inputHash: jsonHash(input),
                contract: input.contract, comparison, startedAt, finishedAt: new Date().toISOString(),
                scope: 'provided_data_only' as const, engineStatus: 'not_run' as const,
                metadataScopeStatus: 'not_verified' as const, profileStatus: 'not_verified' as const,
                executionVerified: false as const, approvalVerified: false as const, canApply: false as const });
            this.state = 'completed';
            return immutable({ ...receipt, receiptHash: jsonHash(receipt) });
        } catch (error) {
            if (this.state === 'comparing') this.state = 'failed';
            throw error;
        }
    }
}

export type QueryComparisonReceipt = ReturnType<QueryComparisonJob['run']>;
