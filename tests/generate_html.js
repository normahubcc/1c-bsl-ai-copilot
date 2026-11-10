const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Module = require('module');

// Render through the actual provider, including its bundled visual modules.
execSync('npm run compile', {
    cwd: path.join(__dirname, '..')
});
const load = Module._load;
Module._load = function (name, ...args) {
    return name === 'vscode' ? { workspace: { textDocuments: [] } } : load.call(this, name, ...args);
};
const { NormaHub1CSidebarProvider } = require('../out/sidebarProvider');
Module._load = load;
const provider = new NormaHub1CSidebarProvider({}, {});
const htmlOutput = provider._getHtmlForWebview('FAKE_TEST_KEY_NEVER_USE', { status: 'active' }, 'gpt-6.1-sol');

const outPath = process.env.WEBVIEW_TEST_HTML || path.join(require('os').tmpdir(), '1c-copilot-webview-test.html');
fs.writeFileSync(outPath, htmlOutput, 'utf8');
console.log('Generated webview HTML at:', outPath, 'Length:', htmlOutput.length);
