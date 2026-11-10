import { createPublicKey, randomUUID } from 'node:crypto';
import { canonicalJson, identifier, immutable, record, schemaV1, text } from '../../../shared/lib/jsonContract';
import { parseRunnerProfile } from './queryJob';
import { runnerKeyId } from './receipt';

/** Public SPKI only: createPublicKey by itself also accepts private PEM and must not be used as the boundary. */
export function parseRunnerConnection(value: unknown) {
    canonicalJson(value);
    const v = record(value, ['schemaVersion', 'profile', 'publicKeyPem'], 'connection');
    schemaV1(v.schemaVersion);
    const profile = parseRunnerProfile(v.profile), pem = text(v.publicKeyPem, 'publicKeyPem', 2048).trim();
    if (!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----$/.test(pem)) throw new Error('Укажите публичный ключ SPKI. Приватные ключи не принимаются.');
    const key = createPublicKey(pem);
    if (runnerKeyId(key) !== profile.keyId) throw new Error('Публичный ключ не соответствует профилю оператора.');
    return immutable({ schemaVersion: 1 as const, profile, publicKeyPem: key.export({ type: 'spki', format: 'pem' }).toString() });
}

export function createRunnerPin(connection: unknown) {
    return immutable({ ...parseRunnerConnection(connection), revision: randomUUID(), pinnedAt: new Date().toISOString() });
}

export function parseRunnerPin(value: unknown) {
    canonicalJson(value);
    const v = record(value, ['schemaVersion', 'revision', 'pinnedAt', 'profile', 'publicKeyPem'], 'pin');
    schemaV1(v.schemaVersion);
    const pinnedAt = text(v.pinnedAt, 'pinnedAt', 24);
    if (!Number.isFinite(Date.parse(pinnedAt)) || new Date(pinnedAt).toISOString() !== pinnedAt) throw new Error('Invalid pin timestamp.');
    return immutable({ ...parseRunnerConnection({ schemaVersion: 1, profile: v.profile, publicKeyPem: v.publicKeyPem }),
        revision: identifier(v.revision, 'revision'), pinnedAt });
}
export type RunnerPin = ReturnType<typeof parseRunnerPin>;
