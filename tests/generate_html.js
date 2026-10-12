const fs = require('path');
const path = require('path');
const { execSync } = require('child_process');

// Compile bspHelper
execSync('npx esbuild ./src/bspHelper.ts --bundle --outfile=dist/bsp-helper.js --format=cjs --platform=node', {
    cwd: path.join(__dirname, '..')
});
const { BSPHelper } = require(path.join(__dirname, '..', 'dist', 'bsp-helper.js'));

// Read extension bundle
const bundle = require('fs').readFileSync(path.join(__dirname, '..', 'dist', 'extension.js'), 'utf8');
const pos = bundle.indexOf('return`<!DOCTYPE html>');
const htmlClose = bundle.indexOf('</html>', pos);
const nextBacktick = bundle.indexOf('`', htmlClose);
const templateLiteral = bundle.substring(pos + 6, nextBacktick + 1);

const c = 2;                             // Open modules count
const n = '1 450.50 ₽';                  // balanceDisplay
const t = 'deepseek-v4.1-flash';         // selectedModel
const s = 'nr_hub_l...y_99';             // maskedKey
const a = JSON.stringify(BSPHelper.STANDARD_MODULES); // bspModulesJson

const fn = new Function('c', 'n', 't', 's', 'a', 'return ' + templateLiteral);
const htmlOutput = fn(c, n, t, s, a);

const outPath = path.join(__dirname, 'webview_test.html');
require('fs').writeFileSync(outPath, htmlOutput, 'utf8');
console.log('Generated webview HTML at:', outPath, 'Length:', htmlOutput.length);
