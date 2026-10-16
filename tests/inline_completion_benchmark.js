// Benchmark harness for inline completion (Prompt 5).
// Deterministic fake transport (seeded PRNG — no flaky randomness),
// configurable delay / payload / error rate. Prints p50/p95/p99 per phase
// plus hard assertions on the release criteria that CAN be proven in CI.
// Live <250ms claims are NOT proven here — see the printed verdict section.
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const settings = {
  enableInlineCompletion: true,
  debounceMs: 0,
  autocompleteModel: 'deepseek-v4.1-flash',
  completionDebug: false,
};
const api = {
  workspace: {
    workspaceFolders: [],
    textDocuments: [],
    getConfiguration: () => ({ get: (name, fallback) => (settings[name] !== undefined ? settings[name] : fallback) }),
  },
  languages: {},
  window: {
    showInformationMessage() {}, showWarningMessage() {}, showErrorMessage() {},
    createOutputChannel: () => ({ appendLine() {}, append() {}, show() {}, dispose() {} }),
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
  resetCompletionMetrics,
  getCompletionMetrics,
  summarizeCompletionMetrics,
} = require('../out/inlineCompletionMetrics');
const { clearInlineCompletionContextCache } = require('../out/inlineCompletionContext');
Module._load = load;

// Seeded PRNG: identical sequence on every run.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeDoc(lines, opts = {}) {
  const full = lines.join('\n');
  return {
    fileName: 'Модуль.bsl',
    languageId: 'bsl',
    uri: { toString: () => opts.uri || 'file:///Модуль.bsl' },
    version: opts.version || 1,
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
function cancellableToken() {
  const listeners = [];
  return {
    isCancellationRequested: false,
    onCancellationRequested(fn) { listeners.push(fn); return { dispose() {} }; },
    _fire() { this.isCancellationRequested = true; listeners.splice(0).forEach((f) => f()); },
  };
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const nextTick = () => new Promise((r) => setImmediate(r));

const DOC_LINES = ['Процедура Рассчитать(Знач Коэффициент)', '    Перем Итог;', '    Итог = Коэффициент * 2;', '    Сообщить('];

async function run() {
  MultiTabScanner.getOpenModulesContext = () => '';
  BSPHelper.getBSPPromptInjection = () => '// BSP-СТАБ (benchmark)';
  NormaHubClient.getApiKey = async () => 'nr_hub_bench';

  const realScan = MetadataScanner.scanWorkspace.bind(MetadataScanner);
  let scans = 0;
  let scanDelayMs = 0;
  MetadataScanner.scanWorkspace = async (...a) => {
    scans++;
    if (scanDelayMs > 0) { await tick(scanDelayMs); }
    return realScan(...a);
  };

  let networkCalls = 0;
  let fakeDelayMs = 2;
  let payloadPad = '';
  let failPlan = null; // () => Error | null, consulted per call
  NormaHubClient.complete = async (...args) => {
    networkCalls++;
    const signal = args[6]?.signal;
    if (signal?.aborted) { throw new CompletionCancelledError(); }
    const failure = failPlan ? failPlan() : null;
    if (fakeDelayMs > 0) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, fakeDelayMs);
        signal?.addEventListener('abort', () => { clearTimeout(t); reject(new CompletionCancelledError()); }, { once: true });
      });
    }
    if (signal?.aborted) { throw new CompletionCancelledError(); }
    if (failure) { throw failure; }
    return `Итог = Итог + 1;${payloadPad}`;
  };

  const reset = () => {
    networkCalls = 0;
    fakeDelayMs = 2;
    payloadPad = '';
    failPlan = null;
    scanDelayMs = 0;
    settings.debounceMs = 0;
    resetCompletionMetrics();
    MetadataScanner.clearCache();
    clearInlineCompletionContextCache();
  };
  const report = (label, extra = {}) => {
    const s = summarizeCompletionMetrics(getCompletionMetrics());
    console.log(`  -- ${label}: n=${s.total} net=${s.networkCalls} cancelled=${s.cancelled} ` +
      `surfaced=${s.surfaced} total p50/p95/p99=${s.totalMs.p50}/${s.totalMs.p95}/${s.totalMs.p99}ms ` +
      `ctx ${s.contextBuildMs.p50}/${s.contextBuildMs.p95}/${s.contextBuildMs.p99}ms ` +
      `net ${s.networkMs.p50}/${s.networkMs.p95}/${s.networkMs.p99}ms` +
      (extra.note ? ` | ${extra.note}` : ''));
    return s;
  };

  console.log('Benchmark scenarios (fake transport, seeded):');

  // A. cold vs warm context (real fs fixture, artificial scan latency)
  reset();
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ilc-bench-'));
    try {
      const cfDir = path.join(root, 'src', 'cf', 'Catalogs');
      fs.mkdirSync(cfDir, { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'cf', 'Configuration.xml'),
        '<MetaDataObject><Properties><Name>БенчКонфа</Name></Properties></MetaDataObject>');
      fs.writeFileSync(path.join(cfDir, 'Товары.xml'), '<MetaDataObject/>');
      scanDelayMs = 10;
      const p = new BSLInlineCompletionProvider({});
      const doc = makeDoc(DOC_LINES);
      await p.provideInlineCompletionItems(doc, new api.Position(3, 13), {}, liveToken());
      const coldScans = scans;
      const coldCtx = getCompletionMetrics().map((m) => m.contextBuildMs);
      resetCompletionMetrics();
      await p.provideInlineCompletionItems(doc, new api.Position(3, 13), {}, liveToken());
      const warmScans = scans - coldScans;
      const warmCtx = getCompletionMetrics().map((m) => m.contextBuildMs);
      assert.equal(coldScans, 1, 'cold path scans once');
      assert.equal(warmScans, 0, 'warm path performs zero rescans');
      console.log(`  -- cold vs warm: coldScans=1 warmScans=0 coldCtx=${coldCtx[0]}ms warmCtx=${warmCtx[0]}ms`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  console.log('  ✓ warm cache eliminates metadata rescans');

  // B. 10 keystrokes in quick succession → one paid request
  reset();
  settings.debounceMs = 25;
  {
    const p = new BSLInlineCompletionProvider({});
    const doc = makeDoc(DOC_LINES);
    const calls = [];
    for (let i = 0; i < 10; i++) {
      calls.push(p.provideInlineCompletionItems(doc, new api.Position(3, 13), {}, liveToken()));
      await tick(5); // 10 keystrokes inside ~50ms
    }
    const results = await Promise.all(calls);
    assert.equal(networkCalls, 1, `burst must collapse, got ${networkCalls}`);
    assert.equal(results.filter(Boolean).length, 1);
    report('10 keystrokes / ~50ms');
  }
  console.log('  ✓ burst collapses: no request explosion');

  // C. 100 sequential completions (throughput + phase percentiles)
  reset();
  {
    const p = new BSLInlineCompletionProvider({});
    const doc = makeDoc(DOC_LINES);
    for (let i = 0; i < 100; i++) {
      const r = await p.provideInlineCompletionItems(doc, new api.Position(3, 13), {}, liveToken());
      assert.ok(r && r.length === 1, `sequential #${i} must surface`);
    }
    assert.equal(networkCalls, 100);
    const s = report('100 sequential');
    assert.equal(s.surfaced, 100);
    assert.equal(s.cancelled, 0);
  }
  console.log('  ✓ 100 sequential: stable, zero drops');

  // D. 10 parallel documents → single survivor, rest cancelled
  reset();
  settings.debounceMs = 10;
  {
    const p = new BSLInlineCompletionProvider({});
    const calls = [];
    for (let i = 0; i < 10; i++) {
      calls.push(p.provideInlineCompletionItems(
        makeDoc(DOC_LINES, { uri: `file:///Doc${i}.bsl` }), new api.Position(3, 13), {}, liveToken()));
    }
    const results = await Promise.all(calls);
    assert.ok(networkCalls <= 2, `parallel docs must not fan out, got ${networkCalls}`);
    assert.equal(results.filter(Boolean).length, 1, 'exactly one survivor');
    report('10 parallel documents');
  }
  console.log('  ✓ parallel documents: single active request (backpressure holds)');

  // E. 10% timeout rate over 50 calls (seeded) — all silent, classified
  reset();
  {
    const rnd = mulberry32(20261014);
    let timeouts = 0;
    failPlan = () => (rnd() < 0.10 ? (timeouts++, new Error('Таймаут запроса к шлюзу NormaHub')) : null);
    const p = new BSLInlineCompletionProvider({});
    const doc = makeDoc(DOC_LINES);
    for (let i = 0; i < 50; i++) {
      const r = await p.provideInlineCompletionItems(doc, new api.Position(3, 13), {}, liveToken());
      void r;
    }
    const s = report('10% timeout / 50 calls');
    assert.ok(timeouts >= 2 && timeouts <= 8, `seeded timeouts in plausible band, got ${timeouts}`);
    assert.equal(s.errors.timeout, timeouts, 'every timeout classified');
    assert.equal(s.surfaced, 50 - timeouts);
  }
  console.log('  ✓ timeouts degrade silently with correct classification');

  // F. gateway error mapping 401/429/500
  reset();
  {
    const codes = [401, 429, 500, 401, 429, 500];
    let i = 0;
    failPlan = () => new Error(`Ошибка шлюза NormaHub (HTTP ${codes[i++ % codes.length]}): x`);
    const p = new BSLInlineCompletionProvider({});
    const doc = makeDoc(DOC_LINES);
    for (let k = 0; k < 6; k++) {
      const r = await p.provideInlineCompletionItems(doc, new api.Position(3, 13), {}, liveToken());
      assert.equal(r, null);
    }
    const s = report('401/429/500 mapping');
    assert.deepEqual(s.errors, { unauthorized: 2, 'rate-limited': 2, gateway: 2 });
  }
  console.log('  ✓ gateway errors mapped: 2×unauthorized 2×rate-limited 2×gateway');

  // G. cancellation timing vs a 200ms response
  reset();
  fakeDelayMs = 200;
  {
    const p = new BSLInlineCompletionProvider({});
    const doc = makeDoc(DOC_LINES);
    const early = cancellableToken();
    const mid = cancellableToken();
    const late = cancellableToken();
    const c1 = p.provideInlineCompletionItems(doc, new api.Position(3, 13), {}, early);
    const c2 = p.provideInlineCompletionItems(doc, new api.Position(3, 13), {}, mid);
    const c3 = p.provideInlineCompletionItems(doc, new api.Position(3, 13), {}, late);
    await nextTick();
    // c1/c2 are already superseded by the single-slot policy; c3 is the survivor.
    const [r1, r2] = await Promise.all([c1, c2]);
    assert.equal(r1, null);
    assert.equal(r2, null);
    await tick(50);
    // Only the newest (c3) is alive; the older two were already superseded.
    // Cancel the survivor mid-flight, then verify a post-response cancel is a no-op.
    const survivor = cancellableToken();
    const c4 = p.provideInlineCompletionItems(doc, new api.Position(3, 13), {}, survivor);
    assert.equal(await c3, null, 'superseded survivor surfaces nothing');
    await tick(50);
    survivor._fire();
    const r4 = await c4;
    assert.equal(r4, null, 'mid-flight cancel surfaces nothing');
    const done = cancellableToken();
    const c5 = p.provideInlineCompletionItems(doc, new api.Position(3, 13), {}, done);
    await tick(300); // response (200ms) completes first
    done._fire(); // too late — already surfaced
    const r5 = await c5;
    assert.ok(r5 && r5.length === 1, 'post-response cancel cannot unsurface');
    const s = report('cancel timing vs 200ms response');
    assert.ok(s.cancelled >= 3, 'supersede + mid-flight cancels counted');
  }
  console.log('  ✓ cancellation wins mid-flight, never unsurfaces a result');

  // H. large payload stays within normalizer budget
  reset();
  fakeDelayMs = 0;
  {
    payloadPad = `\n${'Запрос = Новый Запрос; '.repeat(50)}`; // ~1150 chars over the 1000 budget
    const p = new BSLInlineCompletionProvider({});
    const r = await p.provideInlineCompletionItems(makeDoc(DOC_LINES), new api.Position(3, 13), {}, liveToken());
    assert.equal(r, null, 'oversized model output must be dropped, not truncated mid-statement');
    payloadPad = '';
  }
  console.log('  ✓ oversized payload dropped by normalizer limits');

  MetadataScanner.scanWorkspace = realScan;

  console.log('Benchmark: all scenarios passed.');
  console.log('Verdict vs Prompt-5 criteria:');
  console.log('  - no request explosion: PROVEN (B, D)');
  console.log('  - cancellation cuts paid stale requests: PROVEN (D, G + lifecycle suite)');
  console.log('  - warm path eliminates rescans: PROVEN (A)');
  console.log('  - README <250ms claim: NOT PROVEN here — fake delays are synthetic;');
  console.log('    a live p50/p95 benchmark with a real key is still required (Prompt 7 gate).');
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
