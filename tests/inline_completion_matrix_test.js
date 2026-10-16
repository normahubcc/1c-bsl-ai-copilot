// Full test matrix for inline completion (Prompt 6).
// Covers what suites 1-5 left open: live registration via activate(),
// guard semantics, context boundaries, lifecycle remainders (402/parse/
// post-response cancel), UX shape, and seeded negative races.
// Deterministic: deferred gates, no sleep-based assertions.
// Failure messages carry request/doc/version/phase — never user code.
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
const registered = { inlineProviders: [], commands: {}, views: [] };
const api = {
  workspace: {
    workspaceFolders: [],
    textDocuments: [],
    getConfiguration: () => ({ get: (name, fallback) => (settings[name] !== undefined ? settings[name] : fallback) }),
    onDidOpenTextDocument: () => ({ dispose() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
  },
  languages: {
    registerInlineCompletionItemProvider: (selector, provider) => {
      registered.inlineProviders.push({ selector, provider });
      return { dispose() {} };
    },
    createDiagnosticCollection: () => ({ set() {}, delete() {}, clear() {}, dispose() {} }),
    registerCodeActionsProvider: () => ({ dispose() {} }),
  },
  window: {
    createStatusBarItem: () => ({ show() {}, dispose() {} }),
    registerWebviewViewProvider: (id, provider) => { registered.views.push(id); return { dispose() {} }; },
    showInformationMessage() {}, showWarningMessage() {}, showErrorMessage() {},
    createOutputChannel: () => ({ appendLine() {}, append() {}, show() {}, dispose() {} }),
  },
  commands: {
    registerCommand: (id, fn) => { registered.commands[id] = fn; return { dispose() {} }; },
  },
  env: { openExternal: async () => true },
  Uri: { parse: (s) => ({ toString: () => s }) },
  StatusBarAlignment: { Right: 1 },
  Position: class { constructor(line, character) { this.line = line; this.character = character; } },
  Range: class { constructor(a, b) { this.start = a; this.end = b; } },
  InlineCompletionItem: class { constructor(insertText, range) { this.insertText = insertText; this.range = range; } },
  Diagnostic: class { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } },
  DiagnosticRelatedInformation: class { constructor(location, message) { this.location = location; this.message = message; } },
  Location: class { constructor(uri, range) { this.uri = uri; this.range = range; } },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
  CodeAction: class { constructor(title, kind) { this.title = title; this.kind = kind; } },
  CodeActionKind: { QuickFix: 'quickfix' },
  ProgressLocation: { Notification: 1 },
};

const load = Module._load;
Module._load = function (name, ...args) {
  return name === 'vscode' ? api : load.call(this, name, ...args);
};
const { BSLInlineCompletionProvider } = require('../out/inlineCompletionProvider');
const extension = require('../out/extension');
const { NormaHubClient } = require('../out/normahubClient');
const { MetadataScanner } = require('../out/metadataScanner');
const { MultiTabScanner } = require('../out/multiTabScanner');
const { BSPHelper } = require('../out/bspHelper');
const {
  resetCompletionMetrics,
  getCompletionMetrics,
} = require('../out/inlineCompletionMetrics');
const {
  buildInlineCompletionContext,
  renderInlineSystemPrompt,
  renderInlineUserPrompt,
  clearInlineCompletionContextCache,
} = require('../out/inlineCompletionContext');
Module._load = load;

function makeDoc(lines, opts = {}) {
  const full = lines.join('\n');
  let edits = 0;
  const doc = {
    fileName: opts.fileName || 'Модуль.bsl',
    languageId: opts.languageId || 'bsl',
    uri: { toString: () => opts.uri || 'file:///Модуль.bsl' },
    version: opts.version !== undefined ? opts.version : 1,
    isClosed: false,
    lineCount: lines.length,
    lineAt: (n) => {
      if (n < 0 || n >= lines.length) { throw new Error('line out of range'); }
      return { text: lines[n] ?? '' };
    },
    getText: (range) => {
      if (!range) { return full; }
      const off = (line, ch) => lines.slice(0, line).join('\n').length + (line > 0 ? 1 : 0) + ch;
      return full.substring(off(range.start.line, range.start.character), off(range.end.line, range.end.character));
    },
    edit: async () => { edits++; return true; },
    _edits: () => edits,
  };
  return doc;
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
const nextTick = () => new Promise((r) => setImmediate(r));
// Failure context without user code: uri/version/position/phase only.
const where = (phase, doc, pos) => `${phase} :: ${doc.uri.toString()}#v${doc.version}@${pos.line}:${pos.character}`;

async function run() {
  // Keep pristine references: the suite stubs below replace these on the shared class.
  const realGetApiKey = NormaHubClient.getApiKey.bind(NormaHubClient);
  const realCheckBalance = NormaHubClient.checkBalance.bind(NormaHubClient);
  const realComplete = NormaHubClient.complete.bind(NormaHubClient);
  NormaHubClient.getApiKey = async () => 'nr_hub_matrix';
  NormaHubClient.checkBalance = async () => ({ status: 'active' });
  MetadataScanner.scanWorkspace = async () => ({ name: 'Test', version: '8.3', objects: [], isDemoFallback: false });
  MultiTabScanner.getOpenModulesContext = () => '';
  BSPHelper.getBSPPromptInjection = () => '// BSP-СТАБ (matrix)';

  let completeCalls = 0;
  let completeImpl = async () => 'Сообщить("ok");';
  NormaHubClient.complete = async (...a) => { completeCalls++; return completeImpl(...a); };
  const reset = () => {
    completeCalls = 0;
    settings.debounceMs = 0;
    completeImpl = async () => 'Сообщить("ok");';
    resetCompletionMetrics();
    MetadataScanner.clearCache();
    clearInlineCompletionContextCache();
  };

  // -- Registration (live activate boundary) --
  reset();
  {
    const context = { subscriptions: [], secrets: { get: async () => '', store: async () => {}, delete: async () => {} }, extensionUri: { fsPath: '/ext' } };
    extension.activate(context);
    await nextTick(); await nextTick(); // let updateStatusBar settle (stubbed, no network)
    assert.equal(registered.inlineProviders.length, 1, 'exactly one inline provider registered');
    const { selector, provider } = registered.inlineProviders[0];
    assert.deepEqual(selector, [
      { scheme: 'file', language: 'bsl' },
      { scheme: 'file', language: '1c' },
      { scheme: 'file', language: 'oscript' },
      { scheme: 'untitled', language: 'bsl' },
    ]);
    for (const lang of ['json', 'typescript', 'markdown']) {
      assert.ok(!selector.some((s) => s.language === lang), `${lang} must stay outside the selector`);
    }
    assert.ok(!selector.some((s) => s.scheme === 'untitled' && s.language !== 'bsl'),
      'untitled:1c/untitled:oscript gap documented (Prompt 7 candidate)');
    assert.ok(provider instanceof BSLInlineCompletionProvider, 'registered instance is the BSL provider');
    // End-to-end through the REGISTERED instance (not a fresh one).
    const doc = makeDoc(['Процедура Т()', '    Итог = 1;']);
    const r = await provider.provideInlineCompletionItems(doc, new api.Position(1, 14), {}, liveToken());
    assert.ok(r && r.length === 1, 'registered provider serves BSL');
    assert.ok(registered.commands['normahub1c.scanMetadata'], 'scanMetadata command registered');
    assert.ok(registered.views.includes('normahub1c.mainView'), 'sidebar view registered');
  }
  console.log('  ✓ Registration: bsl/1c/oscript + untitled:bsl live via activate(); json/ts/md excluded');

  // -- Input guards --
  reset();
  {
    const p = new BSLInlineCompletionProvider({});
    // whitespace-only line beyond line 0: request IS sent (pinned semantics — empty
    // mid-file lines may still carry scope context; Prompt 7 documents this).
    const ws = makeDoc(['Процедура Т()', '   ']);
    const rws = await p.provideInlineCompletionItems(ws, new api.Position(1, 3), {}, liveToken());
    assert.ok(rws && rws.length === 1, where('whitespace-line>0', ws, { line: 1, character: 3 }));
    assert.equal(completeCalls, 1);
  }
  console.log('  ✓ Guard semantics: whitespace line >0 still completes (pinned, documented)');

  reset();
  {
    const p = new BSLInlineCompletionProvider({});
    const empty = makeDoc(['']);
    const r = await p.provideInlineCompletionItems(empty, new api.Position(0, 0), {}, liveToken());
    assert.equal(r, null, where('cursor-at-doc-start', empty, { line: 0, character: 0 }));
    assert.equal(completeCalls, 0);
  }
  console.log('  ✓ Guard: cursor at document start → null, zero network');

  reset();
  {
    const p = new BSLInlineCompletionProvider({});
    const doc = makeDoc(['Процедура Т()', '    Итог = 1;']);
    const r = await p.provideInlineCompletionItems(doc, new api.Position(1, 14), {}, liveToken());
    assert.ok(r && r.length === 1);
    assert.equal(doc._edits(), 0, 'preview generation must never write to the document');
  }
  console.log('  ✓ Read-only safety: provider never edits the document');

  // -- Context boundaries --
  reset();
  {
    const lines = [];
    for (let i = 0; i < 100; i++) { lines.push(`Линия${i} = ${i};`); }
    const doc = makeDoc(lines);
    const snap = await buildInlineCompletionContext(doc, new api.Position(60, 5), { workspaceRoot: '' });
    assert.ok(snap.prefix.includes('Линия10 = 10;'), 'prefix window starts 50 lines back');
    assert.ok(!snap.prefix.includes('Линия9 = 9;'), 'prefix window excludes line 60-51');
    assert.ok(snap.suffix.includes('Линия75 = 75;'), 'suffix window ends 15 lines ahead');
    assert.ok(!snap.suffix.includes('Линия76 = 76;'), 'suffix window excludes line 60+16');
  }
  console.log('  ✓ Context window: 50 lines back / 15 ahead (boundaries pinned)');

  reset();
  {
    const doc = makeDoc(['Сообщить(', 'Итог = 1;']);
    const snap = await buildInlineCompletionContext(doc, new api.Position(0, 5), { workspaceRoot: '' });
    assert.equal(snap.prefix, 'Сообщ', 'first-line prefix is the bare fragment');
    const last = makeDoc(['Итог = 1;', 'Сообщить("x")']);
    const snapLast = await buildInlineCompletionContext(last, new api.Position(1, 13), { workspaceRoot: '' });
    assert.equal(snapLast.suffix, '', 'last line has no suffix');
    const user = renderInlineUserPrompt(snapLast.prefix, snapLast.suffix);
    assert.ok(!user.includes('ПОСЛЕ КУРСОРА') && user.includes('продолжения'), 'suffix-less prompt uses continuation variant');
  }
  console.log('  ✓ First/last line edges + continuation prompt variant');

  reset();
  {
    const longCyr = `Переменная${'Я'.repeat(5900)} = 1;`;
    const doc = makeDoc(['Процедура Т()', longCyr]);
    const snap = await buildInlineCompletionContext(doc, new api.Position(1, longCyr.length), { workspaceRoot: '' });
    assert.ok(Array.from(snap.prefix).length <= 4000, 'long line obeys prefix budget');
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(snap.prefix), 'no split surrogates');
    assert.ok(snap.prefix.endsWith('= 1;'), 'tail (cursor context) preserved');
  }
  console.log('  ✓ Long-line truncation: budget-safe, tail preserved');

  reset();
  {
    const doc = makeDoc(['&НаСервере', 'Процедура Рассчитать(Знач Коэффициент)', '    Перем Локальная;', '    Для Каждого Стр Из Таблица Цикл', '        Попытка', '            Сообщить(']);
    const snap = await buildInlineCompletionContext(doc, new api.Position(5, 13), { workspaceRoot: '' });
    assert.equal(snap.scope.compilationDirective, '&НаСервере');
    assert.equal(snap.scope.currentMethod.name, 'Рассчитать');
    assert.ok(snap.scope.localVariables.includes('Коэффициент'), 'parameters captured');
    assert.ok(snap.scope.localVariables.includes('Локальная'), 'Перем captured');
    assert.equal(snap.scope.insideLoop, true);
    assert.equal(snap.scope.insideTry, true);
    const prompt = renderInlineSystemPrompt(snap);
    assert.ok(prompt.includes('&НаСервере'), 'directive rendered');
    assert.ok(prompt.includes('Процедура Рассчитать(Знач Коэффициент)'), 'method+params rendered');
    assert.ok(prompt.includes('Внутри цикла: Да') && prompt.includes('Внутри попытки: Да'), 'flags rendered');
  }
  console.log('  ✓ Scope: directive/method/params/Перем/loop/try rendered into prompt');

  // -- Network lifecycle remainders --
  for (const [label, msg, cls] of [
    ['402 billing block', 'Ошибка шлюза NormaHub (HTTP 402): empty', 'gateway'],
  ]) {
    reset();
    completeImpl = async () => { throw new Error(msg); };
    const doc = makeDoc(['Процедура Т()', '    Сообщить(']);
    const r = await new BSLInlineCompletionProvider({}).provideInlineCompletionItems(
      doc, new api.Position(1, 13), {}, liveToken());
    assert.equal(r, null, where(label, doc, { line: 1, character: 13 }));
    assert.equal(getCompletionMetrics()[0].errorClass, cls, `${label} classified`);
  }
  console.log('  ✓ Lifecycle: 402 → gateway, silent null');

  reset();
  {
    completeImpl = async () => { throw new Error('Ошибка парсинга ответа: Unexpected token'); };
    const doc = makeDoc(['Процедура Т()', '    Сообщить(']);
    const r = await new BSLInlineCompletionProvider({}).provideInlineCompletionItems(
      doc, new api.Position(1, 13), {}, liveToken());
    assert.equal(r, null);
    assert.equal(getCompletionMetrics()[0].errorClass, 'parse');
  }
  console.log('  ✓ Lifecycle: malformed JSON → parse, silent null');

  reset();
  settings.debounceMs = 30;
  {
    // VS Code revokes the token MID-DEBOUNCE (listener path, not pre-cancelled).
    const tok = cancellableToken();
    const doc = makeDoc(['Процедура Т()', '    Сообщить(']);
    const pending = new BSLInlineCompletionProvider({}).provideInlineCompletionItems(
      doc, new api.Position(1, 13), {}, tok);
    await nextTick(); // inside the debounce window
    assert.equal(completeCalls, 0, where('mid-debounce', doc, { line: 1, character: 13 }));
    tok._fire();
    assert.equal(await pending, null);
    assert.equal(completeCalls, 0, 'revoked debounce never reaches the network');
    assert.equal(getCompletionMetrics()[0].cancelled, true);
  }
  console.log('  ✓ Lifecycle: token revoked mid-debounce → null, zero network');

  reset();
  {
    const tok = cancellableToken();
    completeImpl = async () => { tok._fire(); return 'Сообщить("поздно");'; };
    const doc = makeDoc(['Процедура Т()', '    Сообщить(']);
    const r = await new BSLInlineCompletionProvider({}).provideInlineCompletionItems(
      doc, new api.Position(1, 13), {}, tok);
    assert.equal(r, null, where('cancel-after-response', doc, { line: 1, character: 13 }));
  }
  console.log('  ✓ Lifecycle: cancel after response but before return → null');

  reset();
  {
    completeImpl = async () => 'Вот код:\nСообщить("ok");';
    const doc = makeDoc(['Процедура Т()', '    Сообщить(']);
    const r = await new BSLInlineCompletionProvider({}).provideInlineCompletionItems(
      doc, new api.Position(1, 13), {}, liveToken());
    assert.ok(r && r.length === 1);
    assert.equal(String(r[0].insertText), '"ok");', 'explanation stripped, echo deduped at provider level');
  }
  console.log('  ✓ Provider-level normalization: explanation + echo resolved to pure code');

  // -- Client transport (real complete/checkBalance/key-storage, stubbed sockets) --
  {
    const https = require('node:https');
    const { EventEmitter } = require('node:events');
    const realRequest = https.request;
    const realGet = https.get;
    const { CompletionCancelledError: RealCancelled } = require('../out/normahubClient');
    const RealClient = {
      getApiKey: realGetApiKey,
      setApiKey: NormaHubClient.setApiKey.bind(NormaHubClient),
      checkBalance: realCheckBalance,
      complete: realComplete,
      isCancelledError: NormaHubClient.isCancelledError.bind(NormaHubClient),
    };
    assert.ok(RealClient.isCancelledError(new RealCancelled()), 'isCancelledError recognizes cancellation');
    assert.ok(!RealClient.isCancelledError(new Error('HTTP 500: x')), 'isCancelledError rejects gateway errors');

    // key storage via fake SecretStorage + env fallback
    let stored = '';
    const fakeCtx = { secrets: {
      get: async () => stored,
      store: async (_k, v) => { stored = v; },
      delete: async () => { stored = ''; },
    } };
    await RealClient.setApiKey(fakeCtx, '  nr_hub_abc  ');
    assert.equal(await RealClient.getApiKey(fakeCtx), 'nr_hub_abc', 'key round-trips trimmed');
    await RealClient.setApiKey(fakeCtx, '   ');
    delete process.env.NORMAHUB_API_KEY; delete process.env.OPENAI_API_KEY;
    assert.equal(await RealClient.getApiKey(fakeCtx), '', 'empty storage + env → empty key');
    process.env.NORMAHUB_API_KEY = '  nr_hub_env  ';
    assert.equal(await RealClient.getApiKey(fakeCtx), 'nr_hub_env', 'env fallback trimmed');
    delete process.env.NORMAHUB_API_KEY;

    const fakeReq = () => {
      const handlers = {};
      const req = new EventEmitter();
      req.destroyed = 0;
      const origEmit = req.emit.bind(req);
      req.on = (ev, fn) => { handlers[ev] = fn; return req; };
      req.destroy = () => { req.destroyed++; };
      req.write = () => {}; req.end = () => {};
      req._handlers = handlers;
      req._emit = origEmit;
      return req;
    };
    const fakeRes = (status, body) => {
      const res = new EventEmitter();
      res.statusCode = status;
      process.nextTick(() => { res.emit('data', body); res.emit('end'); });
      return res;
    };
    try {
      // checkBalance: 200 / 401 / socket error / timeout
      let reqs = [];
      https.get = (url, opts, cb) => {
        const req = fakeReq(); reqs.push(req);
        process.nextTick(() => cb(fakeRes(req._status, req._body)));
        return req;
      };
      let pending = RealClient.checkBalance('k');
      reqs[reqs.length - 1]._status = 200; reqs[reqs.length - 1]._body = '{}';
      assert.equal((await pending).status, 'active');
      pending = RealClient.checkBalance('k');
      reqs[reqs.length - 1]._status = 401; reqs[reqs.length - 1]._body = 'no';
      assert.equal((await pending).status, 'unauthorized');
      pending = RealClient.checkBalance('');
      assert.equal((await pending).status, 'invalid_key', 'empty key short-circuits');
      pending = RealClient.checkBalance('k');
      reqs[reqs.length - 1]._handlers.error(new Error('boom'));
      assert.equal((await pending).status, 'invalid_key');
      pending = RealClient.checkBalance('k');
      const tReq = reqs[reqs.length - 1];
      tReq._handlers.timeout();
      const tRes = await pending;
      assert.equal(tRes.status, 'invalid_key');
      assert.equal(tReq.destroyed, 1, 'balance timeout destroys the socket');

      // complete: 200 valid / 200 malformed / 500 / socket error
      https.request = (url, opts, cb) => {
        const req = fakeReq(); reqs.push(req);
        process.nextTick(() => {
          // Read at fire time: the test arms _mode/_body after complete() returns.
          if (req._mode === 'error') { req._handlers.error(new Error('boom')); return; }
          cb(fakeRes(req._mode === 'ok' ? 200 : 500, req._body));
        });
        return req;
      };
      const lastReq = () => reqs[reqs.length - 1];
      let p = RealClient.complete('k', 'm', 's', 'u');
      lastReq()._mode = 'ok';
      lastReq()._body = JSON.stringify({ choices: [{ message: { content: 'Сообщить("x");' } }] });
      assert.equal(await p, 'Сообщить("x");');
      p = RealClient.complete('k', 'm', 's', 'u');
      lastReq()._mode = 'ok'; lastReq()._body = 'not-json{{{';
      await assert.rejects(() => p, /парсинга/);
      p = RealClient.complete('k', 'm', 's', 'u');
      lastReq()._mode = 'fail'; lastReq()._body = 'bad';
      await assert.rejects(() => p, /HTTP 500/);
      p = RealClient.complete('k', 'm', 's', 'u');
      lastReq()._mode = 'error';
      await assert.rejects(() => p, /boom/);
    } finally {
      https.request = realRequest;
      https.get = realGet;
    }
    // restore suite stubs clobbered above (https back to real; client fakes reinstalled below)
    NormaHubClient.getApiKey = async () => 'nr_hub_matrix';
    NormaHubClient.checkBalance = async () => ({ status: 'active' });
    NormaHubClient.complete = async (...a) => { completeCalls++; return completeImpl(...a); };
  }
  console.log('  ✓ Client transport: key storage, balance states, response/error paths (stubbed sockets)');

  // -- UX / acceptance --
  reset();
  {
    const p = new BSLInlineCompletionProvider({});
    const doc = makeDoc(['Процедура Т()', '    Итог = 1;']);
    const pos = new api.Position(1, 14);
    const r = await p.provideInlineCompletionItems(doc, pos, {}, liveToken());
    assert.ok(r && r.length === 1);
    const item = r[0];
    assert.ok(item instanceof api.InlineCompletionItem, 'native Tab flow consumes InlineCompletionItem');
    assert.equal(item.range.start.line, pos.line);
    assert.equal(item.range.start.character, pos.character);
    assert.equal(item.range.end.line, pos.line);
    assert.equal(item.range.end.character, pos.character, 'zero-length range at cursor = ghost text contract');
    assert.ok(!String(item.insertText).includes('```'), 'no fences reach the editor');
  }
  console.log('  ✓ UX: native item shape, cursor range, fence-free');

  reset();
  {
    // No provider call may ever reject into VS Code (burst of mixed outcomes).
    const p = new BSLInlineCompletionProvider({});
    const impls = [
      async () => 'Итог = 1;',
      async () => { throw new Error('Ошибка шлюза NormaHub (HTTP 500): x'); },
      async () => '   ',
      async () => '```bsl\nИтог = 2;\n```',
    ];
    const settled = [];
    for (let i = 0; i < 8; i++) {
      completeImpl = impls[i % impls.length];
      const doc = makeDoc(['Процедура Т()', '    Итог = 1;'], { uri: `file:///U${i}.bsl` });
      settled.push(await p.provideInlineCompletionItems(doc, new api.Position(1, 14), {}, liveToken())
        .then((v) => ({ ok: true, v }), (e) => ({ ok: false, e })));
    }
    assert.ok(settled.every((s) => s.ok), 'zero rejections across mixed outcomes');
  }
  console.log('  ✓ UX: errors never throw into VS Code (8 mixed outcomes, all settled)');

  // -- Seeded negative races: version bumps + doc switches + cancels mid-burst --
  //    (debounce window open so coalescing is actually exercised)
  reset();
  settings.debounceMs = 30;
  {
    const p = new BSLInlineCompletionProvider({});
    const docs = [makeDoc(['Процедура А()', '    Сообщить('], { uri: 'file:///N0.bsl' })];
    const gates = [];
    const mkGate = () => {
      let resolve;
      const promise = new Promise((res) => { resolve = res; });
      const gate = { promise, resolve };
      gates.push(gate);
      // Self-resolving: gates may be created after the burst forEach
      // (debounce delays network). Resolve is idempotent.
      setTimeout(() => gate.resolve(), 20);
      return promise;
    };
    let n = 0;
    completeImpl = () => mkGate().then(() => `Вариант${n++};`);
    const calls = [];
    let active = docs[0];
    for (let i = 0; i < 20; i++) {
      if (i % 5 === 4) { active.version++; } // external edit between keystrokes
      if (i % 7 === 6) { // editor switched to a new document
        active = makeDoc(['Процедура Б()', '    Сообщить('], { uri: `file:///N${i}.bsl` });
        docs.push(active);
      }
      const tok = i % 9 === 8 ? (() => { const t = cancellableToken(); t._fire(); return t; })() : liveToken();
      calls.push(p.provideInlineCompletionItems(active, new api.Position(1, 13), {}, tok));
      await nextTick(); // deterministic interleave: let each call reach its gate
    }
    gates.forEach((g) => g.resolve());
    const results = await Promise.all(calls);
    assert.equal(results.filter(Boolean).length, 1, 'exactly one survivor under hostile interleave');
    assert.equal(completeCalls, 1, `burst coalesces to a single request, got ${completeCalls}`);
    // 20 calls − 2 pre-cancelled (exit before identity, by design) = 18 records.
    assert.ok(getCompletionMetrics().length === 18, 'every post-identity race call recorded');
  }
  console.log('  ✓ Negative races: 20 hostile calls settle, 1 network, full metrics');

  console.log('Matrix: all groups passed (registration/guards/context/lifecycle/UX/races).');
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
