// Metrics & policy tests for inline completion (Prompt 5):
// error classification, secret-free diagnostics, model separation,
// backpressure bound. Fake transport only.
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const settings = {
  enableInlineCompletion: true,
  debounceMs: 0,
  autocompleteModel: 'deepseek-v4.1-flash',
  completionDebug: false,
};
const channels = [];
const api = {
  workspace: {
    workspaceFolders: [],
    textDocuments: [],
    getConfiguration: () => ({ get: (name, fallback) => (settings[name] !== undefined ? settings[name] : fallback) }),
  },
  languages: {},
  window: {
    showInformationMessage() {}, showWarningMessage() {}, showErrorMessage() {},
    createOutputChannel: (name) => {
      const lines = [];
      channels.push({ name, lines });
      return { appendLine: (s) => lines.push(s), append: () => {}, show: () => {}, dispose: () => {} };
    },
  },
  Position: class { constructor(line, character) { this.line = line; this.character = character; } },
  Range: class { constructor(a, b) { this.start = a; this.end = b; } },
  InlineCompletionItem: class { constructor(insertText, range) { this.insertText = insertText; this.range = range; } },
};

const load = Module._load;
Module._load = function (name, ...args) {
  return name === 'vscode' ? api : load.call(this, name, ...args);
};
const { BSLInlineCompletionProvider } = require('../out/inlineCompletionProvider');
const { NormaHubClient, CompletionCancelledError } = require('../out/normahubClient');
const { MetadataScanner } = require('../out/metadataScanner');
const { MultiTabScanner } = require('../out/multiTabScanner');
const { BSPHelper } = require('../out/bspHelper');
const {
  classifyCompletionError,
  recordCompletionMetrics,
  getCompletionMetrics,
  resetCompletionMetrics,
  summarizeCompletionMetrics,
  formatMetricsLine,
  percentile,
  MAX_ACTIVE_COMPLETION_REQUESTS,
} = require('../out/inlineCompletionMetrics');
const { clearInlineCompletionContextCache } = require('../out/inlineCompletionContext');
Module._load = load;

function makeDoc(lines, opts = {}) {
  const full = lines.join('\n');
  return {
    fileName: 'Модуль.bsl',
    languageId: 'bsl',
    uri: { toString: () => opts.uri || 'file:///Модуль.bsl' },
    version: 1,
    lineCount: lines.length,
    lineAt: (n) => ({ text: lines[n] ?? '' }),
    getText: (range) => {
      if (!range) { return full; }
      const off = (line, ch) => lines.slice(0, line).join('\n').length + (line > 0 ? 1 : 0) + ch;
      return full.substring(off(range.start.line, range.start.character), off(range.end.line, range.end.character));
    },
  };
}
function liveToken() {
  return { isCancellationRequested: false, onCancellationRequested() { return { dispose() {} }; } };
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function run() {
  MetadataScanner.scanWorkspace = async () => ({ name: 'Test', version: '8.3', objects: [], isDemoFallback: false });
  MultiTabScanner.getOpenModulesContext = () => '';
  BSPHelper.getBSPPromptInjection = () => '// BSP';
  NormaHubClient.getApiKey = async () => 'nr_hub_test';

  let completeCalls = 0;
  let completeImpl = async () => 'Сообщить("ok");';
  NormaHubClient.complete = async (...a) => { completeCalls++; return completeImpl(...a); };
  const reset = () => {
    completeCalls = 0;
    channels.length = 0;
    settings.debounceMs = 0;
    settings.completionDebug = false;
    completeImpl = async () => 'Сообщить("ok");';
    resetCompletionMetrics();
    MetadataScanner.clearCache();
    clearInlineCompletionContextCache();
  };

  // 1. error classification matrix
  {
    assert.equal(classifyCompletionError(new CompletionCancelledError()), 'cancelled');
    assert.equal(classifyCompletionError(Object.assign(new Error('x'), { name: 'AbortError' })), 'cancelled');
    assert.equal(classifyCompletionError(new Error('Таймаут запроса к шлюзу NormaHub')), 'timeout');
    assert.equal(classifyCompletionError(new Error('Ошибка шлюза NormaHub (HTTP 401): bad')), 'unauthorized');
    assert.equal(classifyCompletionError(new Error('Ошибка шлюза NormaHub (HTTP 403): bad')), 'unauthorized');
    assert.equal(classifyCompletionError(new Error('Ошибка шлюза NormaHub (HTTP 429): slow')), 'rate-limited');
    assert.equal(classifyCompletionError(new Error('Ошибка шлюза NormaHub (HTTP 500): oops')), 'gateway');
    assert.equal(classifyCompletionError(new Error('Ошибка шлюза NormaHub (HTTP 402): empty')), 'gateway');
    assert.equal(classifyCompletionError(new Error('Ошибка парсинга ответа: broken')), 'parse');
    assert.equal(classifyCompletionError(new Error('Сеть недоступна')), 'unknown');
    assert.equal(classifyCompletionError(undefined), 'unknown');
  }
  console.log('  ✓ error classes: cancelled/timeout/401-403/429/5xx-402/parse/unknown');

  // 2. percentile helper is deterministic
  {
    assert.equal(percentile([], 95), 0);
    assert.equal(percentile([10, 20, 30, 40], 50), 30);
    assert.equal(percentile([5], 99), 5);
  }
  console.log('  ✓ percentile helper deterministic');

  // 3. metrics never contain user code, prompts or keys (canary test)
  reset();
  settings.completionDebug = true;
  {
    const CANARY = 'КАНАРЕЙКА_СЕКРЕТ_ЫЫЫ';
    const FAKE_KEY = 'nr_hub_CANARYKEY123';
    NormaHubClient.getApiKey = async () => FAKE_KEY;
    completeImpl = async () => `Сообщить("${CANARY}");`;
    const doc = makeDoc(['Процедура Т()', `    // ${CANARY} комментарий`, '    Сообщить(']);
    const r = await new BSLInlineCompletionProvider({}).provideInlineCompletionItems(
      doc, new api.Position(2, 13), {}, liveToken());
    assert.ok(r && r.length === 1, 'canary completion must surface (it is valid BSL)');
    const dump = JSON.stringify(getCompletionMetrics());
    assert.ok(!dump.includes(CANARY), 'metrics ring must not contain user code');
    assert.ok(!dump.includes(FAKE_KEY), 'metrics ring must not contain the API key');
    assert.ok(!dump.includes('КОД ДО КУРСОРА'), 'metrics ring must not contain prompt text');
    const debugText = channels.map((c) => c.lines.join('\n')).join('\n');
    assert.ok(channels.length === 1, 'debug channel created exactly once when enabled');
    assert.ok(!debugText.includes(CANARY) && !debugText.includes(FAKE_KEY), 'debug output sanitized');
    assert.match(debugText, /model=deepseek-v4\.1-flash/, 'debug line carries model/timings only');
    NormaHubClient.getApiKey = async () => 'nr_hub_test';
  }
  console.log('  ✓ diagnostics carry no code, prompts or keys (ring + debug output)');

  // 4. debug channel stays silent when disabled (default)
  reset();
  {
    const r = await new BSLInlineCompletionProvider({}).provideInlineCompletionItems(
      makeDoc(['Процедура Т()', '    Сообщить(']), new api.Position(1, 13), {}, liveToken());
    assert.ok(r && r.length === 1);
    assert.equal(channels.length, 0, 'no OutputChannel when completionDebug is off');
    assert.equal(getCompletionMetrics().length, 1, 'ring still records internally');
  }
  console.log('  ✓ debug logging off by default, ring always records');

  // 5. model separation: fast model for ghost text, reasoning elsewhere
  {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    const props = pkg.contributes.configuration.properties;
    assert.equal(props['normahub1c.autocompleteModel'].default, 'deepseek-v4.1-flash');
    assert.equal(props['normahub1c.reasoningModel'].default, 'gpt-6.1-sol');
    assert.notEqual(props['normahub1c.autocompleteModel'].default, props['normahub1c.reasoningModel'].default);
    const providerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'inlineCompletionProvider.ts'), 'utf-8');
    assert.ok(providerSrc.includes("get<string>('autocompleteModel'"), 'ghost text uses autocompleteModel');
    assert.ok(!providerSrc.includes('reasoningModel'), 'ghost text never touches reasoningModel');
    const extSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf-8');
    assert.ok(extSrc.includes("get<string>('reasoningModel'"), 'deep flows (query/explain) use reasoningModel');
  }
  console.log('  ✓ autocompleteModel (flash) vs reasoningModel (sol) never mixed');

  // 6. error classes are recorded per failure (no throw, no toast)
  reset();
  {
    const cases = [
      ['Ошибка шлюза NormaHub (HTTP 401): bad key', 'unauthorized'],
      ['Ошибка шлюза NormaHub (HTTP 429): slow down', 'rate-limited'],
      ['Ошибка шлюза NormaHub (HTTP 500): oops', 'gateway'],
      ['Таймаут запроса к шлюзу NormaHub', 'timeout'],
      ['Ошибка парсинга ответа: broken', 'parse'],
    ];
    for (const [msg, cls] of cases) {
      completeImpl = async () => { throw new Error(msg); };
      const r = await new BSLInlineCompletionProvider({}).provideInlineCompletionItems(
        makeDoc(['Процедура Т()', '    Сообщить(']), new api.Position(1, 13), {}, liveToken());
      assert.equal(r, null, `failure must be silent (${cls})`);
      void cls;
    }
    const summary = summarizeCompletionMetrics(getCompletionMetrics());
    assert.equal(summary.errors.unauthorized, 1);
    assert.equal(summary.errors['rate-limited'], 1);
    assert.equal(summary.errors.gateway, 1);
    assert.equal(summary.errors.timeout, 1);
    assert.equal(summary.errors.parse, 1);
    assert.equal(summary.total, 5);
  }
  console.log('  ✓ per-failure error classes recorded (401/429/500/timeout/parse)');

  // 7. context-phase failures are classified as context
  reset();
  {
    const bad = makeDoc(['Процедура Т()']);
    bad.getText = () => { throw new Error('document changed'); };
    const r = await new BSLInlineCompletionProvider({}).provideInlineCompletionItems(
      bad, new api.Position(0, 3), {}, liveToken());
    assert.equal(r, null);
    assert.equal(completeCalls, 0);
    const [m] = getCompletionMetrics();
    assert.equal(m.errorClass, 'context');
  }
  console.log('  ✓ context build failures classified as context, zero network');

  // 8. backpressure: 50-way burst collapses to one request, all settle
  reset();
  settings.debounceMs = 10;
  {
    assert.equal(MAX_ACTIVE_COMPLETION_REQUESTS, 1, 'single global slot is the backpressure policy');
    const p = new BSLInlineCompletionProvider({});
    const doc = makeDoc(['Процедура Т()', '    Сообщить(']);
    const calls = [];
    for (let i = 0; i < 50; i++) {
      calls.push(p.provideInlineCompletionItems(doc, new api.Position(1, 13), {}, liveToken()));
    }
    const results = await Promise.all(calls);
    assert.equal(completeCalls, 1, `50-way burst must collapse, got ${completeCalls}`);
    assert.equal(results.filter(Boolean).length, 1);
    const summary = summarizeCompletionMetrics(getCompletionMetrics());
    assert.equal(summary.total, 50);
    assert.equal(summary.cancelled, 49);
  }
  console.log('  ✓ backpressure: 50 concurrent calls → 1 network, 49 cancelled, no hang');

  // 9. summary shape carries p50/p95/p99 per phase
  reset();
  {
    await new BSLInlineCompletionProvider({}).provideInlineCompletionItems(
      makeDoc(['Процедура Т()', '    Сообщить(']), new api.Position(1, 13), {}, liveToken());
    const s = summarizeCompletionMetrics(getCompletionMetrics());
    for (const k of ['totalMs', 'contextBuildMs', 'networkMs']) {
      assert.ok(typeof s[k].p50 === 'number' && typeof s[k].p95 === 'number' && typeof s[k].p99 === 'number');
    }
    assert.equal(s.networkCalls, 1);
    assert.equal(s.surfaced, 1);
    const line = formatMetricsLine(getCompletionMetrics()[0]);
    assert.match(line, /^#\d+ model=\S+ total=\d+ms debounce=\d+ms ctx=\d+ms net=\d+ms/);
  }
  console.log('  ✓ summary exposes p50/p95/p99 per phase + sanitized line format');

  console.log('Metrics & policy: 9/9 passed (fake transport, deterministic).');
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
