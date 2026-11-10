import { QueryCandidateArtifact } from '../../../entities/validation/model/queryComparison';
import { RunnerPin } from '../../../entities/runner/model/connection';
import { createRunnerChallenge, RunnerRequest, RunnerChallenge } from '../../../entities/runner/model/queryJob';
import { preparedJobEnvelope, requestFromHostPlan, parseSignedQueryResult } from '../../../entities/runner/model/preparedJob';
import { verifyRunnerEvidence } from '../../../entities/runner/model/receipt';

type Pending = { artifact: QueryCandidateArtifact; pinRevision: string; request: RunnerRequest; challenge: RunnerChallenge;
    active: boolean; receiptHash?: string; expired?: boolean };
export type RunnerEvidenceState = 'current' | 'source_changed' | 'trust_changed' | 'superseded' | 'expired';

/** Host-issued challenges and capabilities stay in memory; result files cannot create or restore them. */
export class RunnerSessions {
    private readonly pending = new Map<string, Pending>();
    constructor(private readonly getPin: (scope: string) => RunnerPin | undefined, private readonly now = () => Date.now()) {}

    prepare(preview: string, artifact: QueryCandidateArtifact, plan: unknown) {
        const pin = this.getPin(artifact.identity.scopeHash);
        if (!pin) throw new Error('Сначала подключите профиль проверки для проекта.');
        if (!artifact.isCurrent()) throw new Error('Исходный контекст изменился. Повторите генерацию.');
        const request = requestFromHostPlan(artifact, plan, pin.profile), challenge = createRunnerChallenge(request, pin.profile, this.now());
        const old = this.pending.get(preview);
        if (old) old.active = false;
        this.pending.delete(preview);
        const entry: Pending = { artifact, pinRevision: pin.revision, request, challenge, active: true };
        this.pending.set(preview, entry);
        if (this.pending.size > 16) {
            const key = this.pending.keys().next().value!;
            this.pending.get(key)!.active = false; this.pending.delete(key);
        }
        return preparedJobEnvelope(request, challenge);
    }
    has(preview: string): boolean { return this.pending.has(preview); }
    invalidate(preview: string) { const entry = this.pending.get(preview); if (entry) entry.active = false; }
    assertCurrent(preview: string): void { this.assertEntry(this.entry(preview)); }
    private entry(preview: string): Pending {
        const entry = this.pending.get(preview);
        if (!entry) throw new Error('Сначала подготовьте задание проверки в этом окне IDE.');
        return entry;
    }
    private state(entry: Pending, expiresAt?: string): RunnerEvidenceState {
        if (expiresAt && this.now() >= Date.parse(expiresAt)) entry.expired = true;
        if (!entry.active) return 'superseded';
        let pin: RunnerPin | undefined;
        try { pin = this.getPin(entry.artifact.identity.scopeHash); } catch { return 'trust_changed'; }
        if (!pin || pin.revision !== entry.pinRevision) return 'trust_changed';
        try { if (!entry.artifact.isCurrent()) return 'source_changed'; } catch { return 'source_changed'; }
        return entry.expired ? 'expired' : 'current';
    }
    private assertEntry(entry: Pending) {
        const state = this.state(entry);
        if (state === 'trust_changed') throw new Error('Профиль проверки изменён или отключён. Подготовьте новое задание.');
        if (state === 'superseded') throw new Error('Задание заменено новым. Импортируйте результат нового задания.');
        if (state !== 'current' && state !== 'expired') throw new Error('Исходный контекст изменился. Повторите генерацию.');
    }
    accept(preview: string, value: unknown) {
        const entry = this.entry(preview); this.assertEntry(entry);
        const input = parseSignedQueryResult(value);
        if (input.jobId !== entry.challenge.jobId) throw new Error('Результат относится к другому заданию этого окна IDE.');
        const pin = this.getPin(entry.artifact.identity.scopeHash)!;
        const evidence = verifyRunnerEvidence(input.receipt, entry.request, pin.profile, entry.challenge, pin.publicKeyPem, this.now());
        this.assertEntry(entry);
        if (entry.receiptHash && entry.receiptHash !== evidence.assessment.receiptHash) throw new Error('Для задания уже принят другой результат. Подготовьте новое задание.');
        entry.receiptHash = evidence.assessment.receiptHash;
        if (evidence.assessment.status === 'stale') entry.expired = true;
        return Object.freeze({ ...evidence, request: entry.request, state: () => this.state(entry, evidence.payload.expiresAt) });
    }
}
export type ImportedRunnerEvidence = ReturnType<RunnerSessions['accept']>;
