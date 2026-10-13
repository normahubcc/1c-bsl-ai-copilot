const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Compile bspHelper
execSync('npx esbuild ./src/bspHelper.ts --bundle --outfile=dist/bsp-helper.js --format=cjs --platform=node', {
    cwd: path.join(__dirname, '..')
});
const { BSPHelper } = require(path.join(__dirname, '..', 'dist', 'bsp-helper.js'));

// Read extension bundle
const bundle = fs.readFileSync(path.join(__dirname, '..', 'dist', 'extension.js'), 'utf8');
const pos = bundle.indexOf('return`<!DOCTYPE html>');
const funcIdx = bundle.lastIndexOf('_getHtmlForWebview(', pos);
const parenClose = bundle.indexOf(')', funcIdx);
const params = bundle.substring(funcIdx + 19, parenClose);
const braceOpen = bundle.indexOf('{', parenClose);
const htmlClose = bundle.indexOf('</html>', pos);
const nextBacktick = bundle.indexOf('`', htmlClose);
const body = bundle.substring(braceOpen + 1, nextBacktick + 1);

// Find whatever variable was used for BSPHelper.STANDARD_MODULES and getOpenModulesCount
const bspMatch = body.match(/([a-zA-Z0-9_$]+)\.STANDARD_MODULES/);
const bspVar = bspMatch ? bspMatch[1] : 'k';
const docMatch = body.match(/([a-zA-Z0-9_$]+)\.getOpenModulesCount/);
const docVar = docMatch ? docMatch[1] : 'D';

const fn = new Function(params, `
    const ${bspVar} = { STANDARD_MODULES: ${JSON.stringify(BSPHelper.STANDARD_MODULES)} };
    const ${docVar} = { getOpenModulesCount: () => 2 };
    ${body}
`);

const htmlOutput = fn('nr_hub_live_enterprise_secret_key_123', { status: 'active', balanceRub: 0, currency: 'USD' }, 'deepseek-v4.1-flash');

const outPath = path.join(__dirname, 'webview_test.html');
fs.writeFileSync(outPath, htmlOutput, 'utf8');
console.log('Generated webview HTML at:', outPath, 'Length:', htmlOutput.length, 'Contains promo:', htmlOutput.includes('1CPROMO'));
