import { canonicalJson, immutable, record } from '../../../shared/lib/jsonContract';
import { RUNNER_POLICY } from './queryJob';

export function parseIsolationEvidence(value: unknown) {
    canonicalJson(value);
    const v = record(value, ['uid', 'memory', 'swap', 'pids', 'cpu', 'seccomp', 'noNewPrivileges', 'capabilities', 'rootReadOnly', 'interfaces'], 'kernel');
    if (v.uid !== 10001 || v.memory !== String(RUNNER_POLICY.memoryBytes) || v.swap !== '0' || v.pids !== String(RUNNER_POLICY.pids) ||
        typeof v.cpu !== 'string' || !/^([1-9]\d*) \1$/.test(v.cpu) || v.seccomp !== '2' || v.noNewPrivileges !== '1' ||
        v.capabilities !== '0000000000000000' || v.rootReadOnly !== true || JSON.stringify(v.interfaces) !== '["lo"]') {
        throw new Error('Effective kernel isolation does not meet the fixed profile.');
    }
    return immutable({ uid: 10001, memory: v.memory, swap: v.swap, pids: v.pids, cpu: v.cpu,
        seccomp: '2', noNewPrivileges: '1', capabilities: '0000000000000000', rootReadOnly: true, interfaces: ['lo'] });
}
export type IsolationEvidence = ReturnType<typeof parseIsolationEvidence>;
