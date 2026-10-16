// Lifecycle tests for BSLInlineCompletionProvider (Prompt 2):
// real debounce, AbortSignal cancellation, request identity, stale-discard.
// Fake transport only — no live key, no network. Deferred promises are used
// instead of sleep-based assertions wherever possible.
const assert = require('node:assert/strict');
const Module = require('node:module');
const https = require('node:https');

const settings = { enableInlineCompletion: true, debounceMs: 25, autocompleteModel: 'deepseek-v4.1-flash' };
const uiNoise = { info: 0, warn: 0, error: 0 };

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
}
class Range {
  constructor(a, b) { this.start = a; this.end = b; }
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
  window: {
    showInformationMessage() { uiNoise.info++; },
    showWarningMessage() { uiNoise.warn++; },
    showErrorMessage() { uiNoise.error++; },
  },
  Position,
  Range,
  InlineCompletionItem,
};

const load = Module._load;
Module._load = function (name, ...args) {
  return name === 'vscode' ? api : load.call(this, name, ...args);
};
const { BSLInlineCompletionProvider, getCompletionRequestKey } = require('../out/inlineCompletionProvider');
const { NormaHubClient, CompletionCancelledError } = require('../out/normahubClient');
const { MetadataScanner } = require('../out/metadataScanner');
const { MultiTabScanner } = require('../out/multiTabScanner');
const { BSPHelper } = require('../out/bspHelper');
Module._load = load;

function makeDoc(lines, opts = {}) {
  const full = lines.join('\n');
  const doc = {
    fileName: opts.fileName || 'Модуль.bsl',
    languageId: 'bsl',
    uri: { toString: () => opts.uri || 'file:///Модуль.bsl' },
    version: opts.version || 1,
    lineCount: lines.length,
    lineAt: (n) => ({ text: lines[n] ?? '' }),
    getText: (range) => {
      if (!range) { return full; }
      const off = (line, ch) => lines.slice(0, line).join('\n').length + (line > 0 ? 1 : 0) + ch;
      try {
        return full.substring(off(range.start.line, range.start.character), off(range.end.line, range.end.character));
      } catch { return full; }
    },
  };
  return doc;
}

function liveToken() {
  const listeners = [];
  return {
    isCancellationRequested: false,
    onCancellationRequested(fn) { listeners.push(fn); return { dispose() {} }; },
    _fire() { this.isCancellationRequested = true; listeners.splice(0).forEach((f) => f()); },
  };
}
function cancelledToken() {
  return {
    isCancellationRequested: true,
    onCancellationRequested(fn) { fn(); return { dispose() {} }; },
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const nextTick = () => new Promise((r) => setImmediate(r));

async function run() {
  MetadataScanner.scanWorkspace = async () => ({ name: 'Test', version: '8.3', objects: [], isDemoFallback: false });
  MultiTabScanner.getOpenModulesContext = () => '';
  BSPHelper.getBSPPromptInjection = () => '// BSP';
  NormaHubClient.getApiKey = async () => 'nr_hub_test';

  let completeCalls = 0;
  const seenSignals = [];
  let completeImpl = async () => 'Сообщить("ok");';
  const realComplete = NormaHubClient.complete.bind(NormaHubClient);
  const fakeComplete = async (...args) => {
    completeCalls++;
    const opts = args[6];
    if (opts?.signal) { seenSignals.push(opts.signal); }
    return completeImpl(...args);
  };
  NormaHubClient.complete = fakeComplete;
  const reset = () => {
    completeCalls = 0;
    seenSignals.length = 0;
    uiNoise.info = uiNoise.warn = uiNoise.error = 0;
    settings.enableInlineCompletion = true;
    settings.debounceMs = 25;
    completeImpl = async () => 'Сообщить("ok");';
  };
  const provider = () => new BSLInlineCompletionProvider({ secrets: {}, subscriptions: [] });
  const doc2lines = ['Процедура Т()', '    Сообщить('];

  // 0. identity key is deterministic and unique per request
  {
    const a = { requestId: 1, documentUri: 'file:///a.bsl', documentVersion: 3, line: 5, character: 9 };
    const b = { ...a, requestId: 2 };
    assert.equal(getCompletionRequestKey(a), 'file:///a.bsl#v3@5:9#1');
    assert.notEqual(getCompletionRequestKey(a), getCompletionRequestKey(b));
  }
  console.log('  ✓ request identity key is deterministic and unique');

  // 1. rapid typing: 10 calls in one tick → exactly one network request
  reset();
  {
    const p = provider();
    const doc = makeDoc(doc2lines);
    const calls = [];
    for (let i = 0; i < 10; i++) {
      calls.push(p.provideInlineCompletionItems(doc, new Position(1, 13), {}, liveToken()));
    }
    const results = await Promise.all(calls);
    const items = results.filter(Boolean);
    assert.equal(completeCalls, 1, `burst must collapse to 1 request, got ${completeCalls}`);
    assert.equal(items.length, 1, 'only the latest request surfaces');
    assert.equal(results[9] !== null, true);
    assert.ok(results.slice(0, 9).every((r) => r === null), 'superseded requests return null');
  }
  console.log('  ✓ rapid typing (10 calls) → 1 network request, 1 item');

  // 2. second request cancels first before its network call
  reset();
  {
    const p = provider();
    const doc = makeDoc(doc2lines);
    const gate = deferred();
    completeImpl = () => gate.promise;
    const first = p.provideInlineCompletionItems(doc, new Position(1, 13), {}, liveToken());
    await tick(5);
    const second = p.provideInlineCompletionItems(doc, new Position(1, 14), {}, liveToken());
    await tick(5);
    assert.equal(completeCalls, 0, 'first must be cancelled during debounce, before network');
    gate.resolve('НеИстина;');
    const [r1, r2] = await Promise.all([first, second]);
    assert.equal(r1, null);
    assert.ok(r2 && r2.length === 1);
    assert.equal(completeCalls, 1);
  }
  console.log('  ✓ second request cancels first (zero wasted network)');

  // 3. cancellation before debounce elapses
  reset();
  {
    const r = await provider().provideInlineCompletionItems(
      makeDoc(doc2lines), new Position(1, 13), {}, cancelledToken());
    assert.equal(r, null);
    assert.equal(completeCalls, 0);
  }
  console.log('  ✓ cancellation before debounce → null, zero network');

  // 4. cancellation during HTTPS request aborts the signal
  reset();
  {
    const tok = liveToken();
    const gate = deferred();
    completeImpl = (...args) => {
      const signal = args[6]?.signal;
      assert.ok(signal, 'provider must pass an AbortSignal');
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new CompletionCancelledError()));
        gate.promise.then(() => {}, () => {});
      });
    };
    settings.debounceMs = 0;
    const pending = provider().provideInlineCompletionItems(makeDoc(doc2lines), new Position(1, 13), {}, tok);
    await nextTick(); await nextTick();
    assert.equal(completeCalls, 1);
    tok._fire();
    const r = await pending;
    assert.equal(r, null, 'cancelled in-flight request surfaces nothing');
    assert.equal(seenSignals[0].aborted, true, 'AbortSignal must be aborted');
    gate.resolve('поздно;');
    await tick(5);
  }
  console.log('  ✓ cancellation during HTTPS aborts AbortSignal, returns null');

  // 5. document version changed while debouncing → stale, no network
  reset();
  {
    const doc = makeDoc(doc2lines, { version: 1 });
    const pending = provider().provideInlineCompletionItems(doc, new Position(1, 13), {}, liveToken());
    await nextTick(); // let the provider capture identity v1 and enter debounce wait
    assert.equal(completeCalls, 0, 'no network before debounce elapses');
    doc.version = 2; // external edit lands while debouncing
    const r = await pending;
    assert.equal(r, null);
    assert.equal(completeCalls, 0, 'version change must invalidate before network');
  }
  console.log('  ✓ document version change invalidates the request');

  // 6. cursor moved while waiting → first is stale
  reset();
  {
    const p = provider();
    const doc = makeDoc(doc2lines);
    const first = p.provideInlineCompletionItems(doc, new Position(1, 13), {}, liveToken());
    await tick(5);
    const second = p.provideInlineCompletionItems(doc, new Position(0, 5), {}, liveToken());
    const [r1, r2] = await Promise.all([first, second]);
    assert.equal(r1, null);
    assert.ok(r2 && r2.length === 1);
    assert.equal(completeCalls, 1);
  }
  console.log('  ✓ cursor move supersedes the previous request');

  // 7. different documents cannot reuse each other's result
  reset();
  {
    const p = provider();
    const docA = makeDoc(doc2lines, { uri: 'file:///A.bsl' });
    const docB = makeDoc(doc2lines, { uri: 'file:///B.bsl' });
    completeImpl = async (...args) => (args[3].includes('A') ? 'A;' : 'B;');
    // Distinguish prompts: prefix contains full doc text; docs identical here,
    // so assert on isolation instead: A is nulled, B surfaces.
    const first = p.provideInlineCompletionItems(docA, new Position(1, 13), {}, liveToken());
    await tick(5);
    const second = p.provideInlineCompletionItems(docB, new Position(1, 13), {}, liveToken());
    const [rA, rB] = await Promise.all([first, second]);
    assert.equal(rA, null, 'old-document result must never surface');
    assert.ok(rB && rB.length === 1);
  }
  console.log('  ✓ cross-document isolation holds');

  // 8. cancelled/error requests produce no UI noise and no throw
  reset();
  {
    const p = provider();
    settings.debounceMs = 0;
    completeImpl = async () => { throw new Error('HTTP 429'); };
    const rErr = await p.provideInlineCompletionItems(makeDoc(doc2lines), new Position(1, 13), {}, liveToken());
    assert.equal(rErr, null);
    const rCancel = await p.provideInlineCompletionItems(makeDoc(doc2lines), new Position(1, 13), {}, cancelledToken());
    assert.equal(rCancel, null);
    assert.deepEqual([uiNoise.info, uiNoise.warn, uiNoise.error], [0, 0, 0], 'no toasts on cancel/error');
  }
  console.log('  ✓ cancelled/error paths are silent (no toasts, no throw)');

  // 9. client: pre-aborted signal never touches the socket; timeout destroys the request
  {
    NormaHubClient.complete = realComplete; // exercise the REAL transport wiring
    const realRequest = https.request;
    try {
      let socketCalls = 0;
      https.request = () => { socketCalls++; throw new Error('must not be called'); };
      const aborted = new AbortController();
      aborted.abort();
      await assert.rejects(
        NormaHubClient.complete('k', 'm', 's', 'u', 0.1, 10, { signal: aborted.signal }),
        (e) => e instanceof CompletionCancelledError);
      assert.equal(socketCalls, 0, 'pre-aborted signal must skip socket creation');

      const handlers = {};
      let destroyed = 0;
      https.request = () => {
        const req = {
          on: (ev, fn) => { handlers[ev] = fn; return req; },
          destroy: () => { destroyed++; },
          write: () => {},
          end: () => {},
        };
        return req;
      };
      const pending = NormaHubClient.complete('k', 'm', 's', 'u', 0.1, 10, { timeoutMs: 50 });
      await nextTick();
      assert.ok(handlers.timeout, 'client must arm a timeout handler');
      handlers.timeout();
      await assert.rejects(() => pending, /Таймаут/);
      assert.equal(destroyed, 1, 'timeout must destroy the HTTP request');

      // mid-flight abort destroys the socket and rejects as cancelled
      const handlers2 = {};
      let destroyed2 = 0;
      https.request = () => {
        const req = {
          on: (ev, fn) => { handlers2[ev] = fn; return req; },
          destroy: () => { destroyed2++; },
          write: () => {},
          end: () => {},
        };
        return req;
      };
      const ctl = new AbortController();
      const pending2 = NormaHubClient.complete('k', 'm', 's', 'u', 0.1, 10, { signal: ctl.signal });
      await nextTick();
      ctl.abort();
      await assert.rejects(() => pending2, (e) => e instanceof CompletionCancelledError);
      assert.equal(destroyed2, 1, 'abort must destroy the HTTP request');
    } finally {
      https.request = realRequest;
      NormaHubClient.complete = fakeComplete;
    }
  }
  console.log('  ✓ client: pre-abort skips socket; timeout/abort destroy the request');

  // 10. stale response resolving late is discarded even if the server answers
  reset();
  {
    const p = provider();
    settings.debounceMs = 0;
    const late = deferred();
    let n = 0;
    completeImpl = (...args) => {
      n++;
      if (n === 1) { return late.promise; } // ignores abort, resolves late like a real server
      return Promise.resolve('Свежак;');
    };
    const doc = makeDoc(doc2lines);
    const first = p.provideInlineCompletionItems(doc, new Position(1, 13), {}, liveToken());
    await nextTick(); await nextTick();
    assert.equal(completeCalls, 1);
    const second = p.provideInlineCompletionItems(doc, new Position(1, 14), {}, liveToken());
    late.resolve('STALE-ОТВЕТ;');
    const [r1, r2] = await Promise.all([first, second]);
    assert.equal(r1, null, 'late stale response must be discarded');
    assert.ok(r2 && r2.length === 1);
    assert.ok(String(r2[0].insertText).includes('Свежак'));
    assert.ok(!String(r2[0].insertText).includes('STALE'));
  }
  console.log('  ✓ late stale response is discarded after a newer request');

  console.log('Inline completion lifecycle: 11/11 passed (fake transport, deterministic).');
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
