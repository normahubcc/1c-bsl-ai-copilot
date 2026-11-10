import { executeVerification } from './app/verification/api/executeVerification';
import { TextDecoder } from 'node:util';

// One bounded JSON request. Never accepts a shell command, path, URL, credentials or model route.
const chunks: Buffer[] = [];
let bytes = 0;
process.stdin.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) {
        process.stdout.write(JSON.stringify({ error: { code: 'REQUEST_TOO_LARGE', message: 'Maximum request size is 2 MiB.' } }));
        process.exit(1);
    }
    chunks.push(chunk);
});
process.stdin.on('end', () => {
    try {
        const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        process.stdout.write(JSON.stringify({ result: executeVerification(input) }));
    } catch (error) {
        process.stdout.write(JSON.stringify({ error: { code: 'INVALID_REQUEST', message: error instanceof SyntaxError ? 'Malformed JSON.' : error instanceof Error ? error.message : 'Verification failed.' } }));
        process.exitCode = 1;
    }
});
