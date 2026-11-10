import { hash } from '../../../shared/lib/jsonContract';
import { createRunnerPin, parseRunnerPin, RunnerPin } from '../../../entities/runner/model/connection';

export interface RunnerPinStorage {
    get(key: string): unknown;
    update(key: string, value: unknown): PromiseLike<void>;
}
type State = { blocked: Set<string>; mutating: Set<string>; listeners: Set<() => void> };
const states = new WeakMap<RunnerPinStorage, State>();

/** Extension-owned global state, never effective workspace settings or fields from a result packet. */
export class RunnerTrustStore {
    private readonly state: State;
    constructor(private readonly storage: RunnerPinStorage) {
        const prior = states.get(storage);
        this.state = prior ?? { blocked: new Set(), mutating: new Set(), listeners: new Set() };
        states.set(storage, this.state);
    }
    private key(scope: string) { return 'normahub.runnerTrust.v1.' + hash(scope, 'scopeHash'); }
    get(scope: string): RunnerPin | undefined {
        const key = this.key(scope);
        if (this.state.blocked.has(scope)) return undefined;
        const raw = this.storage.get(key);
        if (raw === undefined) return undefined;
        try {
            const pin = parseRunnerPin(raw);
            return pin.profile.projectId === scope ? pin : undefined;
        } catch { return undefined; }
    }
    subscribe(listener: () => void) {
        this.state.listeners.add(listener);
        return { dispose: () => { this.state.listeners.delete(listener); } };
    }
    async pin(scope: string, connection: unknown): Promise<RunnerPin> {
        const pin = createRunnerPin(connection);
        if (pin.profile.projectId !== scope) throw new Error('Профиль оператора относится к другому проекту.');
        await this.write(scope, pin);
        return pin;
    }
    async revoke(scope: string): Promise<void> { await this.write(scope, undefined); }
    private notify() { for (const listener of this.state.listeners) { try { listener(); } catch { /* observers cannot authorize a failed write */ } } }
    private async write(scope: string, value: unknown) {
        const key = this.key(scope);
        if (this.state.mutating.has(scope)) throw new Error('Профиль проверки уже изменяется.');
        this.state.mutating.add(scope); this.state.blocked.add(scope); this.notify();
        try {
            await this.storage.update(key, value);
            this.state.blocked.delete(scope);
        } finally {
            // On persistence failure remain blocked: a Memento cache may have changed before rejecting.
            this.state.mutating.delete(scope); this.notify();
        }
    }
}
