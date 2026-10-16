// Context tests for inline completion (Prompt 3): trust model, cache +
// invalidation, budgets, unicode safety. Asserts PROMPT CONTENTS, not just
// call counts. Uses the REAL MetadataScanner/BSPHelper against temp dirs.
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
}
class Range {
  constructor(a, b) { this.start = a; this.end = b; }
}

const openDocs = [];
const api = {
  workspace: {
    workspaceFolders: [],
    textDocuments: openDocs,
    getConfiguration: () => ({ get: (_n, fallback) => fallback }),
  },
  languages: {},
  window: {},
  Position,
  Range,
};

const load = Module._load;
Module._load = function (name, ...args) {
  return name === 'vscode' ? api : load.call(this, name, ...args);
};
const {
  buildInlineCompletionContext,
  renderInlineSystemPrompt,
  renderInlineUserPrompt,
  getInlineContextKey,
  clearInlineCompletionContextCache,
  truncateCodePoints,
} = require('../out/inlineCompletionContext');
const { MetadataScanner } = require('../out/metadataScanner');
const { BSPHelper } = require('../out/bspHelper');
Module._load = load;

function makeDoc(lines, opts = {}) {
  const full = lines.join('\n');
  return {
    fileName: opts.fileName || 'Модуль.bsl',
    languageId: 'bsl',
    uri: { toString: () => opts.uri || 'file:///Модуль.bsl' },
    version: opts.version !== undefined ? opts.version : 1,
    isClosed: false,
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
}

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ilc-ctx-'));
}
function writeRealFixture(root) {
  const cfDir = path.join(root, 'src', 'cf');
  const catDir = path.join(cfDir, 'Catalogs');
  fs.mkdirSync(catDir, { recursive: true });
  const configPath = path.join(cfDir, 'Configuration.xml');
  fs.writeFileSync(
    configPath,
    '<?xml version="1.0" encoding="utf-8"?><MetaDataObject><Properties><Name>МояКонфа</Name></Properties></MetaDataObject>',
    'utf-8');
  fs.writeFileSync(path.join(catDir, 'Товары.xml'), '<MetaDataObject><Properties><Name>Товары</Name></Properties></MetaDataObject>', 'utf-8');
  return configPath;
}
function bumpMtime(file) {
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(file, t, t);
}
const codePoints = (s) => Array.from(s).length;
const hasLoneSurrogate = (s) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

async function run() {
  const tempRoots = [];
  const realScan = MetadataScanner.scanWorkspace.bind(MetadataScanner);
  let scans = 0;
  MetadataScanner.scanWorkspace = async (...a) => { scans++; return realScan(...a); };
  const realBsp = BSPHelper.getBSPPromptInjection;
  let bspCalls = 0;
  BSPHelper.getBSPPromptInjection = (...a) => { bspCalls++; return realBsp(...a); };

  const reset = () => {
    scans = 0;
    bspCalls = 0;
    openDocs.length = 0;
    MetadataScanner.clearCache();
    clearInlineCompletionContextCache();
  };
  const track = (root) => { tempRoots.push(root); return root; };

  try {
    // 1. same workspace reuses metadata cache (warm path: zero rescans)
    reset();
    {
      const root = track(makeTempRoot());
      const configPath = writeRealFixture(root);
      void configPath;
      const doc = makeDoc(['Процедура Т()', '    Сообщить(']);
      const cold = await buildInlineCompletionContext(doc, new Position(1, 13), { workspaceRoot: root });
      assert.equal(scans, 1, 'cold build scans once');
      assert.equal(cold.metadata.trust, 'real');
      assert.equal(typeof cold.contextBuildMs, 'number');
      const warm = await buildInlineCompletionContext(doc, new Position(1, 13), { workspaceRoot: root });
      assert.equal(scans, 1, 'warm build must not rescan');
      assert.equal(warm.metadata.trust, 'real');
    }
    console.log('  ✓ same workspace reuses metadata cache (cold 1 scan, warm 0)');

    // 2. changed Configuration.xml invalidates the cache
    reset();
    {
      const root = track(makeTempRoot());
      const configPath = writeRealFixture(root);
      const doc = makeDoc(['Процедура Т()', '    Сообщить(']);
      await buildInlineCompletionContext(doc, new Position(1, 13), { workspaceRoot: root });
      assert.equal(scans, 1);
      bumpMtime(configPath);
      const after = await buildInlineCompletionContext(doc, new Position(1, 13), { workspaceRoot: root });
      assert.equal(scans, 2, 'config mtime change must trigger rescan');
      assert.equal(after.metadata.trust, 'real');
    }
    console.log('  ✓ changed Configuration.xml invalidates metadata cache');

    // 3. fallback metadata is NOT included in the autocomplete prompt
    reset();
    {
      const root = track(makeTempRoot()); // empty: no configuration files
      const doc = makeDoc(['Процедура Т()', '    Сообщить(']);
      const snap = await buildInlineCompletionContext(doc, new Position(1, 13), { workspaceRoot: root });
      assert.equal(snap.metadata.trust, 'fallback');
      assert.equal(snap.metadata.summary, '', 'fallback summary must be empty by default');
      const prompt = renderInlineSystemPrompt(snap);
      for (const leaked of ['Номенклатура', 'Контрагенты', 'ЗаказКлиента', 'Демо-схема', 'ТоварыНаСкладах']) {
        assert.ok(!prompt.includes(leaked), `prompt must not contain synthetic entity ${leaked}`);
      }
    }
    console.log('  ✓ fallback metadata excluded from autocomplete prompt');

    // 4. real metadata IS included (prompt contents asserted)
    reset();
    {
      const root = track(makeTempRoot());
      writeRealFixture(root);
      const doc = makeDoc(['Процедура Т()', '    Сообщить(']);
      const snap = await buildInlineCompletionContext(doc, new Position(1, 13), { workspaceRoot: root });
      assert.equal(snap.metadata.trust, 'real');
      assert.ok(snap.metadata.objectCount > 0);
      const prompt = renderInlineSystemPrompt(snap);
      assert.ok(prompt.includes('Товары'), 'prompt must contain the real catalog');
      assert.ok(prompt.includes('МояКонфа'), 'prompt must contain the real configuration name');
    }
    console.log('  ✓ real metadata included in prompt (contents asserted)');

    // 5. active module excluded from neighboring modules
    reset();
    {
      const root = track(makeTempRoot());
      const active = makeDoc(
        ['Процедура УникальныйАктивный() Экспорт', 'КонецПроцедуры'],
        { uri: 'file:///Active.bsl', fileName: '/ws/Active.bsl' });
      const neighbor = makeDoc(
        ['Процедура СоседнийМетод() Экспорт', 'КонецПроцедуры'],
        { uri: 'file:///Other.bsl', fileName: '/ws/Other.bsl' });
      openDocs.push(active, neighbor);
      const snap = await buildInlineCompletionContext(active, new Position(0, 5), { workspaceRoot: root });
      assert.equal(snap.neighboringModules.length, 1);
      assert.equal(snap.neighboringModules[0].moduleName, 'Other');
      assert.deepEqual(snap.neighboringModules[0].exportedMethods, ['СоседнийМетод()']);
      assert.ok(snap.multiTabSection.includes('СоседнийМетод'), 'neighbor signature must be present');
      assert.ok(!snap.multiTabSection.includes('УникальныйАктивный'),
        'active module must not leak via multi-tab section');
      // The current method name legitimately appears via AST scope, not via duplication:
      const prompt = renderInlineSystemPrompt(snap);
      assert.ok(prompt.includes('Процедура УникальныйАктивный()'), 'scope keeps the current method');
    }
    console.log('  ✓ active module excluded from neighboring modules');

    // 6. every section stays below budget; total cap trims deterministically
    //    (priority victim order: bsp → multitab → metadata → suffix → prefix).
    reset();
    {
      const root = track(makeTempRoot());
      writeRealFixture(root);
      const big = [];
      for (let i = 0; i < 200; i++) { big.push(`    Переменная${i} = Справочники.Товары.НайтиПоКоду("${i}"); // комментарий`); }
      big.push('    СерединаДокумента = 1;');
      for (let i = 0; i < 60; i++) { big.push(`    Хвост${i} = ${i};`); }
      const cursor = 200; // 'СерединаДокумента' line: both prefix and suffix are full
      const doc = makeDoc(big);
      openDocs.push(makeDoc(
        ['Процедура СоседнийМетод() Экспорт', 'КонецПроцедуры'],
        { uri: 'file:///Other.bsl', fileName: '/ws/Other.bsl' }));
      const budgets = {
        prefixChars: 60, suffixChars: 60, metadataChars: 40,
        bspChars: 40, multiTabChars: 40, totalChars: 40,
      };
      const snap = await buildInlineCompletionContext(doc, new Position(cursor, 10),
        { workspaceRoot: root, budgets });
      // Post-section sum ≈ 60+60+40+40+40=240 > 40 → trim 200 through every
      // section: bsp→0, multitab→0, metadata→0, suffix→0, prefix 60→40.
      assert.equal(snap.bsp, '', 'bsp is the first trim victim');
      assert.equal(snap.multiTabSection, '', 'multitab is trimmed before metadata');
      assert.equal(snap.metadata.summary, '', 'metadata is trimmed before suffix');
      assert.equal(snap.suffix, '', 'suffix is trimmed before prefix');
      assert.equal(codePoints(snap.prefix), 40, 'prefix survives to the hard cap');
      assert.ok(snap.prefix.endsWith('Середи'), 'prefix keeps the exact cursor tail');
      assert.ok(snap.neighboringModules.length === 1, 'structured signatures survive trimming');
      const total = codePoints(snap.prefix) + codePoints(snap.suffix)
        + codePoints(snap.metadata.summary) + codePoints(snap.bsp) + codePoints(snap.multiTabSection);
      assert.ok(total <= 40, `variable sections sum ${total} <= total budget 40`);
    }
    console.log('  ✓ per-section budgets and deterministic total-cap order');

    // 7. long Cyrillic identifiers + emoji survive truncation intact
    reset();
    {
      const root = track(makeTempRoot());
      const tail = 'ХВОСТ';
      const lines = [
        'Процедура ТестоваяПроцедура()',
        `    // комментарий с эмодзи 😀😀😀 ${'А'.repeat(200)}`,
        `    ${tail}`,
      ];
      const doc = makeDoc(lines);
      const snap = await buildInlineCompletionContext(doc, new Position(2, 4 + tail.length),
        { workspaceRoot: root, budgets: { prefixChars: 30 } });
      assert.ok(snap.prefix.endsWith(tail), 'tail (cursor context) has top priority');
      assert.ok(!hasLoneSurrogate(snap.prefix), 'no split surrogate pairs');
      assert.ok(codePoints(snap.prefix) <= 30);
      assert.equal(truncateCodePoints('😀😀', 1, 'head'), '😀', 'truncate helper is code-point safe');
      const user = renderInlineUserPrompt(snap.prefix, snap.suffix);
      assert.ok(user.includes(tail));
    }
    console.log('  ✓ Cyrillic/emoji truncation is code-point safe, tail preserved');

    // 8. BSP injected exactly once and cached across builds
    reset();
    {
      const root = track(makeTempRoot());
      const doc = makeDoc(['Процедура Т()', '    Сообщить(']);
      await buildInlineCompletionContext(doc, new Position(1, 13), { workspaceRoot: root });
      await buildInlineCompletionContext(doc, new Position(1, 13), { workspaceRoot: root });
      assert.equal(bspCalls, 1, `BSP must be computed once, got ${bspCalls}`);
      const snap = await buildInlineCompletionContext(doc, new Position(1, 13), { workspaceRoot: root });
      const prompt = renderInlineSystemPrompt(snap);
      const hits = prompt.split('Библиотеки Стандартных Подсистем').length - 1;
      assert.equal(hits, 1, 'BSP header must appear exactly once in the prompt');
    }
    console.log('  ✓ BSP cached, injected exactly once');

    // 9. document version changes the snapshot identity
    reset();
    {
      const root = track(makeTempRoot());
      const doc = makeDoc(['Процедура Т()', '    Сообщить('], { version: 1 });
      const v1 = await buildInlineCompletionContext(doc, new Position(1, 13), { workspaceRoot: root });
      doc.version = 2;
      const v2 = await buildInlineCompletionContext(doc, new Position(1, 13), { workspaceRoot: root });
      assert.equal(v1.documentVersion, 1);
      assert.equal(v2.documentVersion, 2);
      assert.notEqual(getInlineContextKey(v1), getInlineContextKey(v2));
    }
    console.log('  ✓ document version changes snapshot identity');
  } finally {
    MetadataScanner.scanWorkspace = realScan;
    BSPHelper.getBSPPromptInjection = realBsp;
    for (const root of tempRoots) {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
    }
  }

  console.log('Inline completion context: 9/9 passed (prompt contents asserted).');
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
