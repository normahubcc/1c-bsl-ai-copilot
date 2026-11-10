import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { TextDecoder } from 'node:util';
import { canonicalJson } from './jsonContract';

const MAX_BYTES = 2 * 1024 * 1024;

/** Bounded local input; no shell, URL fetch or whole-file allocation before enforcing the limit. */
export async function readLocalText(path: string, assertCurrent: () => void, regularFileMessage = 'Выберите обычный файл.'): Promise<string> {
    assertCurrent();
    const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    try {
        assertCurrent();
        const stat = await file.stat();
        if (!stat.isFile()) throw new Error(regularFileMessage);
        if (stat.size > MAX_BYTES) throw new Error('Файл проверки превышает 2 MiB.');
        const chunks: Buffer[] = [];
        let total = 0;
        while (true) {
            assertCurrent();
            const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_BYTES + 1 - total));
            const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
            assertCurrent();
            if (!bytesRead) break;
            total += bytesRead;
            if (total > MAX_BYTES) throw new Error('Файл проверки превышает 2 MiB.');
            chunks.push(chunk.subarray(0, bytesRead));
        }
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total)); }
        catch { throw new Error('Файл проверки должен быть в UTF-8.'); }
        assertCurrent();
        return text;
    } finally { await file.close(); }
}

export async function readLocalJson(path: string, assertCurrent: () => void): Promise<unknown> {
    const text = await readLocalText(path, assertCurrent, 'Выберите обычный JSON-файл.');
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error('Некорректный JSON в файле проверки.'); }
    canonicalJson(parsed); assertCurrent(); return parsed;
}
