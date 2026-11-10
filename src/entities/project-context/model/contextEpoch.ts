let sequence = 0;
let globalEpoch = 0;
const epochs = new Map<string, number>();
const listeners = new Set<() => void>();

export function onProjectContextInvalidated(listener: () => void) {
    listeners.add(listener);
    return { dispose: () => { listeners.delete(listener); } };
}

/** Local observed invalidation only; not an atomic metadata tree snapshot. */
export function invalidateProjectContext(root?: string): void {
    sequence++;
    if (root) epochs.set(root, sequence);
    else globalEpoch = sequence;
    for (const listener of listeners) { try { listener(); } catch { /* observers do not affect invalidation */ } }
}

export function projectContextEpoch(root: string): string {
    return `${globalEpoch}:${epochs.get(root) || 0}`;
}
