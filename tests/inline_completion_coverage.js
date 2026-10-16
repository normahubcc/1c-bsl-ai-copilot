// Coverage report for the inline-completion modules (Prompt 6).
// Dependency-free: runs the suites under NODE_V8_COVERAGE and aggregates
// V8 block coverage. Suites run against out/*.js (1:1 with src/*.ts).
// Thresholds assert FUNCTION coverage; uncovered functions are listed so the
// next stage knows exactly what is untested. No live key, no GUI.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SUITES = [
  'tests/inline_completion_baseline_test.js',
  'tests/inline_completion_lifecycle_test.js',
  'tests/inline_completion_context_test.js',
  'tests/inline_completion_normalizer_test.js',
  'tests/inline_completion_metrics_test.js',
  'tests/inline_completion_matrix_test.js',
  'tests/inline_completion_benchmark.js',
];
// out/*.js under test, mapped to their src/*.ts counterparts.
const TARGETS = {
  'out/inlineCompletionProvider.js': { src: 'src/inlineCompletionProvider.ts', minFunctions: 90 },
  'out/normahubClient.js': { src: 'src/normahubClient.ts', minFunctions: 90 },
  'out/inlineCompletionNormalizer.js': { src: 'src/inlineCompletionNormalizer.ts', minFunctions: 90 },
  'out/inlineCompletionContext.js': { src: 'src/inlineCompletionContext.ts', minFunctions: 90 },
};

function run() {
  const covDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilc-cov-'));
  try {
    for (const suite of SUITES) {
      const r = spawnSync(process.execPath, [path.join(ROOT, suite)], {
        cwd: ROOT,
        env: { ...process.env, NODE_V8_COVERAGE: covDir },
        encoding: 'utf-8',
        timeout: 180000,
      });
      if (r.status !== 0) {
        console.error(`SUITE FAILED: ${suite}\n${r.stdout}\n${r.stderr}`);
        process.exitCode = 1;
        return;
      }
    }

    // TS/CJS emit boilerplate carries no product logic — exclude from the count.
    const BOILERPLATE = /^(?:__createBinding|__setModuleDefault|__importStar|__exportStar|__rest|__awaiter|__generator|ownKeys)$/;
    // Compiled sources, cached once for content-based boilerplate detection.
    const sources = {};
    const isEmitBoilerplate = (rel, fn) => {
      if ((fn.functionName || '') !== '') {
        return false;
      }
      if (!sources[rel]) {
        sources[rel] = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
      }
      const start = fn.ranges[0]?.startOffset ?? 0;
      const end = fn.ranges[0]?.endOffset ?? start;
      return sources[rel].slice(start, end).includes('k2 === undefined');
    };
    // Aggregate per-file function ranges across all coverage files.
    const byFile = new Map(); // url -> Map<functionName#start, {covered, total, name, ranges}>
    for (const f of fs.readdirSync(covDir)) {
      if (!f.endsWith('.json')) { continue; }
      const payload = JSON.parse(fs.readFileSync(path.join(covDir, f), 'utf-8'));
      const results = payload.result || [];
      for (const entry of results) {
        if (!entry.url || !entry.url.startsWith('file://')) { continue; }
        const rel = path.relative(ROOT, entry.url.replace('file://', ''));
        if (!TARGETS[rel]) { continue; }
        if (!byFile.has(rel)) { byFile.set(rel, new Map()); }
        const fns = byFile.get(rel);
        for (const fn of entry.functions || []) {
          if (BOILERPLATE.test(fn.functionName || '') || isEmitBoilerplate(rel, fn)) {
            continue;
          }
          const key = `${fn.functionName}#${fn.ranges[0]?.startOffset}`;
          if (!fns.has(key)) {
            fns.set(key, { name: fn.functionName || '(anonymous)', covered: false, bytes: 0, hit: 0 });
          }
          const acc = fns.get(key);
          for (const range of fn.ranges || []) {
            acc.bytes += range.endOffset - range.startOffset;
            if (range.count > 0) {
              acc.hit += (range.endOffset - range.startOffset) * 0; // fn-level: any hit counts
              acc.covered = true;
            }
          }
          void acc.hit;
        }
      }
    }

    console.log('Inline completion coverage (V8 function coverage over inline suites):');
    let failed = false;
    for (const [rel, cfg] of Object.entries(TARGETS)) {
      const fns = byFile.get(rel);
      if (!fns || fns.size === 0) {
        console.log(`  ${cfg.src}: NO COVERAGE DATA`);
        failed = true;
        continue;
      }
      const list = [...fns.values()];
      const covered = list.filter((f) => f.covered).length;
      const pct = (100 * covered) / list.length;
      const uncovered = list.filter((f) => !f.covered).map((f) => f.name);
      const status = pct >= cfg.minFunctions ? 'OK  ' : 'FAIL';
      if (pct < cfg.minFunctions) { failed = true; }
      console.log(`  [${status}] ${cfg.src}: ${covered}/${list.length} functions (${pct.toFixed(1)}%, min ${cfg.minFunctions}%)`);
      if (uncovered.length > 0) {
        console.log(`         uncovered: ${uncovered.slice(0, 12).join(', ')}${uncovered.length > 12 ? ` (+${uncovered.length - 12} more)` : ''}`);
      }
    }
    if (failed) {
      console.error('Coverage thresholds not met.');
      process.exitCode = 1;
      return;
    }
    console.log('Coverage thresholds met for all four inline modules.');
  } finally {
    fs.rmSync(covDir, { recursive: true, force: true });
  }
}

run();
