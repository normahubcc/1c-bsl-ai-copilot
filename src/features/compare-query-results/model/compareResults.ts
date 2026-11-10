import { canonicalJson, immutable, jsonHash, oneOf } from '../../../shared/lib/jsonContract';
import { ComparisonMode } from '../../../entities/business-contract/model/contract';
import { parseResultSet, QueryResultSet } from '../../../entities/business-contract/model/resultSet';

export interface ResultDifference {
    readonly side: 'expected' | 'actual';
    readonly row: QueryResultSet['rows'][number];
    readonly count: number;
    readonly index?: number;
}

/** Compares provided values only; never claims the caller actually executed 1C or supplied the correct oracle. */
export function compareQueryResults(expectedValue: unknown, actualValue: unknown, requestedMode: unknown) {
    const mode: ComparisonMode = oneOf(requestedMode, ['multiset', 'ordered'], 'comparison mode');
    const expected = parseResultSet(expectedValue), actual = parseResultSet(actualValue);
    const columnsMatch = canonicalJson(expected.columns) === canonicalJson(actual.columns);
    const differences: ResultDifference[] = [];
    let missingRows = 0, unexpectedRows = 0, differenceEntries = 0;
    const add = (entry: ResultDifference) => {
        differenceEntries++;
        if (entry.side === 'expected') missingRows += entry.count;
        else unexpectedRows += entry.count;
        if (differences.length < 20) differences.push(entry);
    };
    if (columnsMatch && mode === 'ordered') {
        for (let index = 0; index < Math.max(expected.rows.length, actual.rows.length); index++) {
            const left = expected.rows[index], right = actual.rows[index];
            if (left !== undefined && right !== undefined && canonicalJson(left) === canonicalJson(right)) continue;
            if (left !== undefined) add({ side: 'expected', row: left, count: 1, index });
            if (right !== undefined) add({ side: 'actual', row: right, count: 1, index });
        }
    } else if (columnsMatch) {
        const entries = new Map<string, { row: QueryResultSet['rows'][number]; expected: number; actual: number }>();
        for (const [side, result] of [['expected', expected], ['actual', actual]] as const) {
            for (const row of result.rows) {
                const key = canonicalJson(row);
                const entry = entries.get(key) ?? { row, expected: 0, actual: 0 };
                entry[side]++;
                entries.set(key, entry);
            }
        }
        for (const entry of entries.values()) {
            const delta = entry.expected - entry.actual;
            if (delta) add({ side: delta > 0 ? 'expected' : 'actual', row: entry.row, count: Math.abs(delta) });
        }
    }
    return immutable({
        schemaVersion: 1 as const, scope: 'provided_data_only' as const,
        status: !columnsMatch ? 'schema_mismatch' as const : differenceEntries ? 'different' as const : 'equal' as const,
        mode, expectedHash: jsonHash(expected), actualHash: jsonHash(actual),
        expectedColumns: expected.columns, actualColumns: actual.columns,
        expectedRowCount: expected.rows.length, actualRowCount: actual.rows.length,
        missingRows: columnsMatch ? missingRows : null, unexpectedRows: columnsMatch ? unexpectedRows : null,
        differences, truncated: differenceEntries > differences.length,
        executionVerified: false as const, approvalVerified: false as const,
        limitations: ['Only the supplied typed values are compared.', 'No engine execution, independent oracle approval, metadata qualifiers or performance are established.']
    });
}
