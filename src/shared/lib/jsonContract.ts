import { createHash } from 'node:crypto';
import { types } from 'node:util';

/** JSON-only boundary: reject accessors, exotic prototypes, cycles and excessive input. */
export function canonicalJson(value: unknown): string {
    let nodes = 0;
    let bytes = 0;
    const maxBytes = 2 * 1024 * 1024;
    const account = (length: number) => {
        bytes += length;
        if (bytes > maxBytes) throw new Error('JSON exceeds 2 MiB.');
    };
    const encodeString = (value: string) => {
        if (value.length > maxBytes) throw new Error('JSON exceeds 2 MiB.');
        const encoded = JSON.stringify(value);
        account(Buffer.byteLength(encoded, 'utf8'));
        return encoded;
    };
    const ancestors = new Set<object>();
    const visit = (item: unknown, depth: number): string => {
        if (++nodes > 200000 || depth > 24) throw new Error('JSON exceeds structural limits.');
        if (typeof item === 'string') return encodeString(item);
        if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) {
            const encoded = JSON.stringify(item);
            account(encoded.length);
            return encoded;
        }
        if (!item || typeof item !== 'object') throw new Error('Only finite JSON values are supported.');
        if (types.isProxy(item)) throw new Error('JSON proxies are not supported.');
        if (ancestors.has(item)) throw new Error('Cyclic JSON is not supported.');
        const prototype = Object.getPrototypeOf(item);
        if (Array.isArray(item) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error('Expected plain JSON containers.');
        if (Object.getOwnPropertySymbols(item).length) throw new Error('JSON symbol properties are not supported.');
        ancestors.add(item);
        const descriptors = Object.getOwnPropertyDescriptors(item);
        for (const descriptor of Object.values(descriptors)) {
            if (!('value' in descriptor)) throw new Error('JSON accessors are not supported.');
        }
        let result: string;
        if (Array.isArray(item)) {
            const keys = Object.keys(item);
            if (Object.getOwnPropertyNames(item).length !== item.length + 1 || keys.length !== item.length || keys.some((key, index) => key !== String(index))) throw new Error('Expected a dense JSON array without extra properties.');
            account(2 + Math.max(0, item.length - 1));
            result = '[' + Array.prototype.map.call(item, child => visit(child, depth + 1)).join(',') + ']';
        } else {
            const keys = Object.keys(item).sort();
            account(2 + Math.max(0, keys.length - 1));
            result = '{' + keys.map(key => {
                const encodedKey = encodeString(key);
                account(1);
                return encodedKey + ':' + visit(descriptors[key].value, depth + 1);
            }).join(',') + '}';
        }
        ancestors.delete(item);
        return result;
    };
    const result = visit(value, 0);
    if (Buffer.byteLength(result, 'utf8') > maxBytes) throw new Error('JSON exceeds 2 MiB.');
    return result;
}

export function jsonHash(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function record(value: unknown, allowed: readonly string[], path: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: expected an object.`);
    if (types.isProxy(value)) throw new Error(`${path}: proxies are unsupported.`);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path}: expected a plain object.`);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!allowed.includes(key)) throw new Error(`${path}: unsupported property.`);
        if (!('value' in descriptor)) throw new Error(`${path}: accessors are unsupported.`);
    }
    return value as Record<string, unknown>;
}

export function text(value: unknown, path: string, max = 1024): string {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /\u0000/.test(value)) throw new Error(`${path}: expected nonempty text (max ${max}).`);
    return value;
}

export function identifier(value: unknown, path: string): string {
    const result = text(value, path, 160);
    if (!/^[\p{L}\p{N}_.:/@-]+$/u.test(result)) throw new Error(`${path}: invalid identifier.`);
    return result;
}

export function hash(value: unknown, path: string): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${path}: expected lowercase SHA-256.`);
    return value;
}

export function array(value: unknown, path: string, max: number): unknown[] {
    if (!Array.isArray(value) || value.length > max) throw new Error(`${path}: expected an array (max ${max}).`);
    return value;
}

export function oneOf<T extends string>(value: unknown, choices: readonly T[], path: string): T {
    if (typeof value !== 'string' || !choices.includes(value as T)) throw new Error(`${path}: unsupported value.`);
    return value as T;
}

export function positiveInteger(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`${path}: expected a positive safe integer.`);
    return value;
}

export function schemaV1(value: unknown): void {
    if (value !== 1) throw new Error('Unsupported schemaVersion; expected 1.');
}

export function immutable<T>(value: T): T {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) immutable(child);
        Object.freeze(value);
    }
    return value;
}
