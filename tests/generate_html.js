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
const htmlOutput = provider._getHtmlForWebview('nr_hub_preview_key_1234', { status: 'active' }, 'gpt-6.1-sol');

const outPath = path.join(__dirname, 'webview_test.html');
fs.writeFileSync(outPath, htmlOutput, 'utf8');
console.log('Generated webview HTML at:', outPath, 'Length:', htmlOutput.length, 'Contains promo:', htmlOutput.includes('1CPROMO'));
