// Baseline harness for BSLInlineCompletionProvider (Prompt 1).
// Mocks the VS Code API boundary only; runtime code is untouched.
// Deterministic, no live key, no sleep-based assertions.
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const settings = { enableInlineCompletion: true, debounceMs: 0, autocompleteModel: 'deepseek-v4.1-flash' };

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
}
class Range {
  constructor(a, b) {
    if (typeof a === 'number') { this.start = new Position(a, b.c ?? b.character); this.end = new Position(arguments[2], arguments[3]); }
    else { this.start = a; this.end = b; }
  }
}
class InlineCompletionItem {
  constructor(insertText, range) { this.insertText = insertText; this.range = range; }
}

const api = {
  workspace: {
    workspaceFolders: [],
    textDocuments: [],
    getConfiguration: () => ({ get: (name, fallback) => (settings[name] !== undefined ? settings[name] : fallback) }),
  },
  languages: { registerInlineCompletionItemProvider: () => ({ dispose() {} }) },
  window: { showInformationMessage() {}, showWarningMessage() {}, showErrorMessage() {} },
  Position,
  Range,
  InlineCompletionItem,
};

const load = Module._load;
Module._load = function (name, ...args) {
  return name === 'vscode' ? api : load.call(this, name, ...args);
};
const { BSLInlineCompletionProvider } = require('../out/inlineCompletionProvider');
const { NormaHubClient } = require('../out/normahubClient');
const { MetadataScanner } = require('../out/metadataScanner');
const { MultiTabScanner } = require('../out/multiTabScanner');
const { BSPHelper } = require('../out/bspHelper');
Module._load = load;

function makeDocument(lines, opts = {}) {
  const full = lines.join('\n');
  return {
    fileName: opts.fileName || 'Модуль.bsl',
    languageId: opts.languageId || 'bsl',
    uri: { toString: () => opts.uri || 'file:///Модуль.bsl', fsPath: opts.uri || '/Модуль.bsl' },
    version: opts.version || 1,
    lineCount: lines.length,
    lineAt: (n) => ({ text: lines[n] ?? '' }),
    getText: (range) => {
      if (!range) { return full; }
      const off = (line, ch) => lines.slice(0, line).join('\n').length + (line > 0 ? 1 : 0) + ch;
      // Range mock stores Position objects; fall back to full text on misuse
      try {
        const s = off(range.start.line, range.start.character);
        const e = off(range.end.line, range.end.character);
        return full.substring(s, e);
      } catch { return full; }
    },
  };
}

const tokenLive = { isCancellationRequested: false };
const tokenCancelled = { isCancellationRequested: true };

async function run() {
  let apiKey = 'nr_hub_test';
  let completeCalls = 0;
  let completeImpl = async () => 'Сообщить("ok");';

  MetadataScanner.scanWorkspace = async () => ({ name: 'Test', version: '8.3', objects: [], isDemoFallback: false });
  MultiTabScanner.getOpenModulesContext = () => '';
  BSPHelper.getBSPPromptInjection = () => '// BSP';
  NormaHubClient.getApiKey = async () => apiKey;
  NormaHubClient.complete = async (...a) => { completeCalls++; return completeImpl(...a); };

  const freshProvider = () => new BSLInlineCompletionProvider({ secrets: {}, subscriptions: [] });
  const reset = () => {
    completeCalls = 0;
    settings.enableInlineCompletion = true;
    settings.debounceMs = 0;
    apiKey = 'nr_hub_test';
    completeImpl = async () => 'Сообщить("ok");';
  };

  // 1. disabled setting
  reset();
  settings.enableInlineCompletion = false;
  {
    const r = await freshProvider().provideInlineCompletionItems(
      makeDocument(['Процедура Т()', 'Сообщить(']), new Position(1, 9), {}, tokenLive);
    assert.equal(r, null);
    assert.equal(completeCalls, 0, 'disabled must not call network');
  }
  console.log('  ✓ disabled setting → null, zero network');

  // 2. missing API key (SecretStorage empty + env cleared)
  reset();
  apiKey = '';
  {
    const envA = process.env.NORMAHUB_API_KEY; const envB = process.env.OPENAI_API_KEY;
    delete process.env.NORMAHUB_API_KEY; delete process.env.OPENAI_API_KEY;
    NormaHubClient.getApiKey = async () => '';
    const r = await freshProvider().provideInlineCompletionItems(
      makeDocument(['Процедура Т()', 'Сообщить(']), new Position(1, 9), {}, tokenLive);
    assert.equal(r, null);
    assert.equal(completeCalls, 0);
    NormaHubClient.getApiKey = async () => apiKey;
    if (envA !== undefined) { process.env.NORMAHUB_API_KEY = envA; }
    if (envB !== undefined) { process.env.OPENAI_API_KEY = envB; }
  }
  console.log('  ✓ missing API key → null, zero network');

  // 3. first-line empty input
  reset();
  {
    const r = await freshProvider().provideInlineCompletionItems(
      makeDocument(['   ']), new Position(0, 3), {}, tokenLive);
    assert.equal(r, null);
    assert.equal(completeCalls, 0);
  }
  console.log('  ✓ first-line empty input → null');

  // 4. valid BSL context (provider returns NORMALIZED text: echoed `Сообщить(` is deduped)
  reset();
  {
    const doc = makeDocument(['Процедура Т()', '    Сообщить(']);
    const pos = new Position(1, 13);
    const r = await freshProvider().provideInlineCompletionItems(doc, pos, {}, tokenLive);
    assert.ok(Array.isArray(r) && r.length === 1);
    assert.equal(r[0].range.start.line, pos.line);
    assert.equal(r[0].range.start.character, pos.character);
    assert.equal(String(r[0].insertText), '"ok");');
    assert.equal(completeCalls, 1);
  }
  console.log('  ✓ valid BSL context → single normalized item with cursor range');

  // 5. cancellation before request
  reset();
  {
    const r = await freshProvider().provideInlineCompletionItems(
      makeDocument(['Процедура Т()', 'Сообщить(']), new Position(1, 9), {}, tokenCancelled);
    assert.equal(r, null);
    assert.equal(completeCalls, 0, 'cancelled token must not reach network');
  }
  console.log('  ✓ cancellation before request → null, zero network');

  // 6. empty API response
  reset();
  completeImpl = async () => '   ';
  {
    const r = await freshProvider().provideInlineCompletionItems(
      makeDocument(['Процедура Т()', 'Сообщить(']), new Position(1, 9), {}, tokenLive);
    assert.equal(r, null);
  }
  console.log('  ✓ empty API response → null');

  // 7. markdown fence cleanup + echo-dedup (normalized provider output)
  reset();
  completeImpl = async () => '```bsl\nСообщить("ok");\n```';
  {
    const r = await freshProvider().provideInlineCompletionItems(
      makeDocument(['Процедура Т()', 'Сообщить(']), new Position(1, 9), {}, tokenLive);
    assert.ok(r && r.length === 1);
    assert.ok(!String(r[0].insertText).includes('```'), 'fences must be stripped');
    assert.equal(String(r[0].insertText), '"ok");', 'echo of the pre-cursor line is deduped');
  }
  console.log('  ✓ markdown fence cleanup → fences stripped, echo deduped');

  // 8. API error never throws into VS Code
  reset();
  completeImpl = async () => { throw new Error('HTTP 429'); };
  {
    const r = await freshProvider().provideInlineCompletionItems(
      makeDocument(['Процедура Т()', 'Сообщить(']), new Position(1, 9), {}, tokenLive);
    assert.equal(r, null);
  }
  console.log('  ✓ API error → null (no throw)');

  // 9. no internal languageId guard (registration is the only guard — baseline lock)
  reset();
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'inlineCompletionProvider.ts'), 'utf-8');
    assert.ok(!src.includes('languageId'), 'provider must not inspect languageId internally (baseline)');
    const ext = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf-8');
    for (const frag of ["language: 'bsl'", "language: '1c'", "language: 'oscript'", "scheme: 'untitled'"]) {
      assert.ok(ext.includes(frag), `registration must contain ${frag}`);
    }
    // Behavioural pin: provider serves whatever document it is given
    const r = await freshProvider().provideInlineCompletionItems(
      makeDocument(['{"a": 1'], { languageId: 'json', fileName: 'x.json' }), new Position(0, 7), {}, tokenLive);
    assert.ok(r && r.length === 1, 'baseline: no internal guard — filtering lives in extension.ts selector');
  }
  console.log('  ✓ unsupported-document guard lives only in registration (pinned)');

  console.log('Inline completion baseline: 9/9 passed (no live key, deterministic).');
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
