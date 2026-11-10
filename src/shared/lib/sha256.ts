import { createHash } from 'node:crypto';

export const TEXT_HASH_ENCODING = 'utf16le' as const;

/** Preserve every JS/editor code unit, including temporarily unpaired surrogates. Not a file-byte digest. */
export function sha256Text(value: string): string {
    return createHash('sha256').update(value, TEXT_HASH_ENCODING).digest('hex');
}
