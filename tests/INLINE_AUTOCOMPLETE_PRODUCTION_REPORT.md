# Inline Autocomplete Production Report (Промпт 7)

Дата: 2026-10-14
Проект: `/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot`

## 1. Source identity

- ref: `main...origin/main`
- HEAD SHA (committed): `f8b4eda190204c6cec2a115f6dce02bfa444f275`
- status на момент отчёта: dirty — все изменения этапов 1–7 незакоммичены (см. §8).
- Проверено из корня проекта: `git status --short --branch`, `git rev-parse HEAD`, `git diff --stat`.

## 2. Exact commands

```bash
npm run compile   # tsc -p ./  → out/
npm test          # core suite + compile + sidebar host + 6 inline suites + benchmark + coverage + sidecar (18 tests)
npm run build     # esbuild → dist/extension.js + dist/mcp-server.js
python3 build_vsix.py  # OPC-упаковка → 1c-bsl-ai-copilot-1.0.2.vsix
node ./tests/inline_completion_benchmark.js
node ./tests/inline_completion_coverage.js
```

## 3. Test totals (все зелёные, `npm test` EXIT=0)

| Suite | Результат |
|---|---|
| core `tests/suite.ts` (8 групп: стандарты/БСП/запросы/cfe/метаданные/BDD/ТЖ/токенизатор) | pass |
| `tests/sidebar_host_test.js` | pass |
| `inline_completion_baseline_test.js` | 9/9 |
| `inline_completion_lifecycle_test.js` | 11/11 |
| `inline_completion_context_test.js` | 9/9 (prompt contents) |
| `inline_completion_normalizer_test.js` | 23/23 (pure) |
| `inline_completion_metrics_test.js` | 9/9 |
| `inline_completion_matrix_test.js` | 16 групп |
| benchmark (8 сценариев, seeded fake transport) | pass |
| coverage (4 модуля, порог 90%) | 100/100/100/100% функций |
| sidecar `unittest` | 18/18 OK |

## 4. Coverage (V8 function coverage, без зависимостей)

- `src/inlineCompletionProvider.ts`: 18/18 (100%)
- `src/normahubClient.ts`: 28/28 (100%)
- `src/inlineCompletionNormalizer.ts`: 11/11 (100%)
- `src/inlineCompletionContext.ts`: 27/27 (100%)
- TS-emit boilerplate исключён content-детектом; непокрытых продуктовых функций нет.

## 5. Benchmark p50/p95/p99 (fake transport, seeded — НЕ live-доказательство)

| Сценарий | total p50/p95/p99, мс | сеть | итог |
|---|---|---|---|
| cold vs warm context | ctx 12 → 0 | rescans 1 → 0 | warm устраняет rescan |
| 10 keystrokes / ~50ms | 5/29/29 | 1 запрос, 9 cancelled, 1 surfaced | нет explosion |
| 100 sequential | 2/3/4 | 100/100 surfaced, 0 cancelled | стабильно |
| 10 parallel documents | 1/13/13 | 1 запрос, 9 cancelled, 1 survivor | backpressure держит |
| 10% timeout / 50 | 2/3/4 | 48 surfaced, 2 classified timeout | silent degrade |
| 401/429/500 | 2/3/3 | 2×unauthorized, 2×rate-limited, 2×gateway | mapping верен |
| cancel vs 200ms response | 51/200/200 | 3 сети, 4 cancelled, 1 surfaced | отмена побеждает mid-flight |

- Cancellation rate при burst: 90% (9/10) — устаревшие запросы не оплачиваются.
- Empty rate: пустые ответы → `null` (baseline 6, UX-матрица).
- Stale-response тесты: поздний ответ после нового запроса отбрасывается (lifecycle 10, benchmark G).
- Честная оговорка: задержки синтетические; live p50/p95/p99 с реальным ключом НЕ замерены, клеймы `<250 мс` из README сняты.

## 6. Consistency-аудит (10 пунктов Промпта 7)

1. README ↔ поведение: клеймы `<250 мс` сняты (2 места), добавлен честный раздел (работа/не-запросы/отмена/задержки/отправка/настройки/тесты). Остальные фичи-описания соответствуют коду.
2. `package.json` ↔ runtime defaults: `debounceMs` 250, `requestTimeoutMs` 25000, `maxCompletionLines` 20, `maxCompletionChars` 1000, `contextBudgetChars` 12000, `completionDebug` false — совпадают с fallback в коде.
3. Модели: ghost — только `autocompleteModel` (default flash), reasoning (`reasoningModel`, default sol) — только query/explain; зафиксировано тестом, смешения нет.
4. `debounceMs` ↔ debounce: настоящий trailing, ровно `debounceMs`, рестарт каждым нажатием.
5. `requestTimeoutMs` ↔ HTTP: передаётся в `https.request timeout` + `req.destroy()`; default 25000 (лимит шлюза; для ghost долговато — P1 follow-up).
6. Cancellation: в README не было — теперь документирована и соответствует коду (abort + destroy + silent + stale-discard).
7. Fallback: демо-схема исключена из промпта по умолчанию (тест на содержимое); `includeSyntheticFallback` — только с явным баннером.
8. Селекторы: `file:bsl/1c/oscript` + `untitled:bsl` (тест через `activate()`); гэп `untitled:1c/oscript` зафиксирован как кандидат.
9. Ключ/статус: inline и Action Pilot используют один `NormaHubClient.getApiKey` (SecretStorage → env); UX различается осознанно (панель показывает статус, ghost молчит).
10. `<250 мс`: ни одного числового обещания в UI/docs не осталось без пометки «не замерено».

## 7. Release gate

```text
[x] npm run compile
[x] npm run build
[x] npm test
[x] inline provider test matrix (16 групп)
[x] deterministic fake transport tests (lifecycle/benchmark/coverage)
[x] no live secrets in repo (canary-тест метрик; ключи только в SecretStorage/env)
[x] no API key in logs (debug — только числа/enums; canary-тест)
[x] no fallback metadata presented as real (default exclude + banner-режим)
[x] no stale completions (identity + post-flight checks + тесты)
[x] cancellation works during HTTP request (AbortSignal + req.destroy + тесты)
[x] no duplicate paid requests during rapid typing (10→1, 50→1)
[x] README claims match measurements (клеймы сняты, раздел добавлен)
[x] VSIX package builds (пересобран 1.0.2 из текущего кода)
[ ] VSIX installs in a clean VS Code/Cursor smoke environment — BLOCKED (установка мутирует IDE; сознательно не выполнялась)
[ ] manual acceptance of Tab completion in BSL file — BLOCKED (нужны GUI + live key)
[ ] manual check of cancellation while typing — BLOCKED (то же)
[ ] manual check of offline/401/429 behavior — ЧАСТИЧНО: 401/429/500/timeout покрыты fake-транспортом; живой офлайн — BLOCKED
```

CLI наличествуют (`code` 1.141, `cursor` 3.9.16 — только `--version`, read-only).

## 8. Known limitations (остаточные риски)

- P0: нет живого IDE smoke-теста и live p95/p99 с реальным ключом — главный блокер массового релиза.
- P0: `untitled:1c` / `untitled:oscript` не зарегистрированы.
- P1: `requestTimeoutMs` default 25000 — долго для ghost text; рассмотреть 8–12 с для autocomplete-пути после live-замеров.
- P1: whitespace-строка вне line 0 уходит в сеть (pinned-семантика; задокументировать/пересмотреть).
- P2: `accepted` (принятие Tab) ненаблюдаемо через VS Code API — acceptance-метрика недоступна.
- Baseline-документ этапа 1 описывает ДО-рефактор и остаётся историческим снимком (не переписывался намеренно).

## 9. Release recommendation: CONDITIONAL (условно готов)

- Production readiness: **7/10**.
- Доказательства закрытия P0 baseline-рисков: throttle→debounce (lifecycle 1–2 + benchmark B/D); отмена сети (lifecycle 4,9 + client transport); stale (lifecycle 10 + benchmark G); fallback-в-промпте (context 3–4); нормализация (normalizer 23 + provider-тест); метрики без секретов (metrics 3–4, canary).
- Условия: внутренний/beta-релиз с live-ключом + ручной smoke (Tab/печать/401-429-офлайн) + live p95; массовый релиз и возврат числовых клеймов — только после них.
- Закрывать каждый остаточный P0 отдельным замером; не объявлять ready по зелёным unit-тестам.

## 10. Состояния (не смешивать)

- Локальные изменения (этапы 1–7, незакоммичены): `src/inlineCompletion{Provider,Context,Normalizer,Metrics}.ts`, `src/normahubClient.ts`, `src/bslTokenizer.ts` (+`Знач`), `src/extension.ts` (+2 строки), `package.json`, `README.md`, new `CHANGELOG.md`, new тесты (7 файлов), `tests/INLINE_AUTOCOMPLETE_{BASELINE.md,PRODUCTION_REPORT.md}`.
- Committed SHA: `f8b4eda` (без этапных изменений).
- Built bundle: `dist/extension.js` + `dist/mcp-server.js` (пересобраны из текущего дерева).
- Packaged VSIX: `1c-bsl-ai-copilot-1.0.2.vsix` (пересобран из текущего дерева).
- Installed extension / live behavior: НЕ проверялись (BLOCKED выше).
- Предсуществующие грязные файлы пользователя (screenshots, sidebar, webview-тесты) не трогались.
