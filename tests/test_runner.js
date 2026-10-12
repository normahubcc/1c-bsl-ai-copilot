/**
 * Master test runner for 1C BSL AI Copilot.
 * Executes the complete TypeScript-compiled test suite in dist/test-suite.js
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const testSuitePath = path.join(__dirname, '..', 'dist', 'test-suite.js');

execSync('npx esbuild ./tests/suite.ts --bundle --outfile=dist/test-suite.js --external:vscode --format=cjs --platform=node', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
});

require(testSuitePath);
