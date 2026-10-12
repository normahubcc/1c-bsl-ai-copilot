const fs = require('fs');
const path = require('path');

// Mock vscode module for sidebarProvider
const mockVscode = {
    workspace: {
        getConfiguration: () => ({
            get: (key, def) => def
        }),
        workspaceFolders: [{ uri: { fsPath: process.cwd() } }]
    },
    Uri: {
        file: (p) => ({ fsPath: p })
    }
};

// We can load the HTML directly from dist/extension.js or construct it
const bundle = fs.readFileSync(path.join(__dirname, '..', 'dist', 'extension.js'), 'utf8');

const pos = bundle.indexOf('return`<!DOCTYPE html>');
const htmlClose = bundle.indexOf('</html>', pos);
const nextBacktick = bundle.indexOf('`', htmlClose);
const templateLiteral = bundle.substring(pos + 6, nextBacktick + 1);

// We need BSP modules from src/bspHelper or mock
const bspPath = path.join(__dirname, '..', 'src', 'bspHelper.ts');
const bspText = fs.readFileSync(bspPath, 'utf8');

// Extract modules or compile
const { execSync } = require('child_process');
execSync('npx esbuild ./src/bspHelper.ts --bundle --outfile=dist/bsp-helper.js --format=cjs --platform=node', {
    cwd: path.join(__dirname, '..')
});
const { BSPHelper } = require(path.join(__dirname, '..', 'dist', 'bsp-helper.js'));

const w = BSPHelper;
const D = { getOpenModulesCount: () => 2 };
const e = 'nr_hub_live_enterprise_qa_key_99';
const o = { status: 'active', balanceRub: 1450.50 };
const t = 'deepseek-v4.1-flash';
const n = 'nr_hub_l...y_99';
const s = '1450.50 ₽';
const a = JSON.stringify(w.STANDARD_MODULES);
const c = 2;

const fn = new Function('e', 'o', 't', 'n', 's', 'a', 'c', 'w', 'D', 'return ' + templateLiteral);
const htmlOutput = fn(e, o, t, n, s, a, c, w, D);

const outPath = path.join(__dirname, 'webview_test.html');
fs.writeFileSync(outPath, htmlOutput, 'utf8');
console.log('Generated webview HTML at:', outPath, 'Length:', htmlOutput.length);
