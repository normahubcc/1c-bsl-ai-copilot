import * as vscode from 'vscode';
import { CompletionCancelledError } from './normahubClient';

/**
 * Internal diagnostics for inline completion (Prompt 5).
 *
 * Privacy invariant (enforced by construction + tests): metrics carry only
 * numbers, booleans and fixed enums/model names. API keys, prompts, prefixes,
 * suffixes and completion text can never enter this module — there is simply
 * no field for them.
 */

export type CompletionErrorClass =
    | 'cancelled'
    | 'timeout'
    | 'unauthorized'
    | 'rate-limited'
    | 'gateway'
    | 'parse'
    | 'context'
    | 'unknown';

export interface CompletionMetrics {
    requestId: number;
    model: string;
    contextBuildMs: number;
    debounceWaitMs: number;
    networkMs?: number;
    totalMs: number;
    cancelled: boolean;
    empty: boolean;
    normalized: boolean;
    /** Not observable via InlineCompletionItemProvider API — always undefined for now. */
    accepted?: boolean;
    errorClass?: string;
}

/**
 * Backpressure policy: a single global slot. A newer request always cancels
 * the previous one, so bursts can never build a queue or multiply paid calls.
 */
export const MAX_ACTIVE_COMPLETION_REQUESTS = 1;

const RING_LIMIT = 200;

export function classifyCompletionError(err: unknown): CompletionErrorClass {
    if (
        err instanceof CompletionCancelledError ||
        (err instanceof Error && err.name === 'AbortError')
    ) {
        return 'cancelled';
    }
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? '');
    if (/таймаут/i.test(msg)) {
        return 'timeout';
    }
    const http = msg.match(/HTTP\s(\d{3})/);
    if (http) {
        const code = Number(http[1]);
        if (code === 401 || code === 403) {
            return 'unauthorized';
        }
        if (code === 429) {
            return 'rate-limited';
        }
        // 402 (billing block), 4xx and 5xx are server-side refusals.
        return 'gateway';
    }
    if (/парсинг/i.test(msg)) {
        return 'parse';
    }
    return 'unknown';
}

const ring: CompletionMetrics[] = [];

export function recordCompletionMetrics(m: CompletionMetrics): void {
    ring.push(m);
    if (ring.length > RING_LIMIT) {
        ring.splice(0, ring.length - RING_LIMIT);
    }
}

export function getCompletionMetrics(): CompletionMetrics[] {
    return [...ring];
}

export function resetCompletionMetrics(): void {
    ring.length = 0;
}

export function percentile(sortedAsc: number[], p: number): number {
    if (sortedAsc.length === 0) {
        return 0;
    }
    const rank = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
    return sortedAsc[rank];
}

export interface CompletionMetricsSummary {
    total: number;
    cancelled: number;
    surfaced: number;
    droppedInvalid: number;
    networkCalls: number;
    errors: Partial<Record<CompletionErrorClass, number>>;
    totalMs: { p50: number; p95: number; p99: number };
    contextBuildMs: { p50: number; p95: number; p99: number };
    networkMs: { p50: number; p95: number; p99: number };
}

function pct(values: number[]): { p50: number; p95: number; p99: number } {
    const sorted = [...values].sort((a, b) => a - b);
    return { p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99) };
}

export function summarizeCompletionMetrics(all: CompletionMetrics[]): CompletionMetricsSummary {
    const errors: Partial<Record<CompletionErrorClass, number>> = {};
    let cancelled = 0;
    let surfaced = 0;
    let networkCalls = 0;
    const nets: number[] = [];
    for (const m of all) {
        if (m.cancelled) {
            cancelled++;
        }
        if (m.normalized) {
            surfaced++;
        }
        if (m.networkMs !== undefined) {
            networkCalls++;
            nets.push(m.networkMs);
        }
        if (m.errorClass) {
            const key = m.errorClass as CompletionErrorClass;
            errors[key] = (errors[key] ?? 0) + 1;
        }
    }
    return {
        total: all.length,
        cancelled,
        surfaced,
        droppedInvalid: all.filter((m) => !m.cancelled && !m.normalized && !m.empty).length,
        networkCalls,
        errors,
        totalMs: pct(all.map((m) => m.totalMs)),
        contextBuildMs: pct(all.map((m) => m.contextBuildMs)),
        networkMs: pct(nets),
    };
}

/** Sanitized one-liner: numbers and enums only — physically cannot leak code. */
export function formatMetricsLine(m: CompletionMetrics): string {
    return (
        `#${m.requestId} model=${m.model} total=${m.totalMs}ms ` +
        `debounce=${m.debounceWaitMs}ms ctx=${m.contextBuildMs}ms ` +
        `net=${m.networkMs !== undefined ? `${m.networkMs}ms` : '-'} ` +
        `cancelled=${m.cancelled} empty=${m.empty} normalized=${m.normalized} ` +
        `err=${m.errorClass ?? '-'}`
    );
}

let debugChannel: vscode.OutputChannel | null = null;

/** Appends a sanitized line. Called only when `completionDebug` is enabled (default off). */
export function appendCompletionDebugLine(line: string): void {
    try {
        if (!debugChannel) {
            debugChannel = vscode.window.createOutputChannel('1C Inline Completion');
        }
        debugChannel.appendLine(line);
    } catch (_) {
        // Diagnostics must never break completion.
    }
}
