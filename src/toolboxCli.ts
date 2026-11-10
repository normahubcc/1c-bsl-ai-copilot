import { executeTool } from './entities/toolbox/api/executeTool';

// One JSON request and response per process. Python uses pipes, never a shell.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
    input += chunk;
    if (Buffer.byteLength(input, 'utf8') > 2 * 1024 * 1024) { process.stderr.write('Request too large\n'); process.exit(1); }
});
process.stdin.on('end', async () => {
    try {
        const request = JSON.parse(input);
        const result = await executeTool(request.name, request.arguments === undefined ? {} : request.arguments);
        process.stdout.write(JSON.stringify({ result }));
    } catch (error) {
        process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : 'Tool failed' }));
        process.exitCode = 1;
    }
});
