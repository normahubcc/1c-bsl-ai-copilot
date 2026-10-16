# Inline Autocomplete Baseline — BSL (Промпт 1)

Дата: 2026-10-14
Source identity:
- path: `/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot`
- ref: `main...origin/main`
- HEAD SHA: `f8b4eda190204c6cec2a115f6dce02bfa444f275`
- status: dirty (22 modified + 6 untracked до этапа; см. `git status --short --branch`)
- Проверено по реальному коду, а не по README/screenshot. Runtime-рефактор на этом этапе НЕ делался.

## 1. Current architecture

Фактическая цепочка (подтверждена кодом):

```text
src/extension.ts:activate()
→ vscode.languages.registerInlineCompletionItemProvider(bslSelector, inlineProvider)
→ BSLInlineCompletionProvider.provideInlineCompletionItems(document, position, _context, token)
→ workspace.getConfiguration('normahub1c').get('enableInlineCompletion')
→ NormaHubClient.getApiKey(context) [SecretStorage → env NORMAHUB_API_KEY]
→ document.lineAt(position.line) → textBeforeCursor guard (только line 0 + whitespace)
→ lastRequestTime throttle-check (config debounceMs, default 250)
→ prefix: 50 строк до курсора; suffix: 15 строк после курсора
→ MetadataScanner.scanWorkspace(workspaceFolders[0]) — КАЖДЫЙ вызов, sync fs + cache per root
→ MetadataScanner.formatForPrompt(metadata)
→ BSPHelper.getBSPPromptInjection() — полный dump всех STANDARD_MODULES
→ MultiTabScanner.getOpenModulesContext(document) — до 6 открытых .bsl/.os, regex Экспорт
→ BSLTokenizer.tokenize(fullDocText) + BSLScopeAnalyzer.analyzeScopeAtPosition(...)
→ NormaHubClient.complete(apiKey, model, systemPrompt, userPrompt, 0.1, 800)
   → https.request POST {baseUrl}/chat/completions, timeout 25000, без AbortSignal
→ strip /^```(bsl|1c)?\n?/ + /```$/ → InlineCompletionItem(cleanText, Range(position, position))
→ catch (_) → null (ошибка проглатывается)
```

Регистрация (`src/extension.ts:25-35`):

```text
bslSelector = [
  { scheme: 'file', language: 'bsl' },
  { scheme: 'file', language: '1c' },
  { scheme: 'file', language: 'oscript' },
  { scheme: 'untitled', language: 'bsl' },
]
```

Что это значит:
- `untitled:1c`, `untitled:oscript`, `untitled:bsl` с scheme=file — НЕ покрыты (только `untitled:bsl`).
- Внутреннего `languageId`-guard в самом provider НЕТ — вся фильтрация только на уровне регистрации.
- `oscript` покрыт только для `file`, хотя MultiTabScanner учитывает `.os` файлы.

Transport (`src/normahubClient.ts:151-211`):
- `https.request`, `timeout: 25000`, `req.destroy()` только по socket-timeout.
- Нет параметра `AbortSignal`/token — отменить внешний HTTPS-запрос из provider невозможно.
- `getBaseUrl()` ограничен trusted hosts (normahub.cc, localhost) — API key наружу не утекает, fallback на DEFAULT при чужом host. Проверено кодом.

## 2. Request lifecycle

| Фаза | Код | Факт |
|---|---|---|
| enable guard | `inlineCompletionProvider.ts:29-32` | `enableInlineCompletion` default true |
| key lookup | `normahubClient.ts:8-15` | SecretStorage → env; пусто → `null`, без UI-сигнала |
| empty guard | `inlineCompletionProvider.ts:39-45` | только `!textBeforeCursor.trim() && line===0`; whitespace-строка на line>0 — проходит дальше |
| throttle | `inlineCompletionProvider.ts:48-53` | `if (now - lastRequestTime < debounceMs) return null`; это throttle, НЕ debounce; общий на весь provider (все документы/позиции); первый вызов после паузы идёт сразу в сеть |
| prefix/suffix | `56-62` | `Range(50 строк до, position)` / `Range(position, +15 строк)`; boundaries не нормализуются под unicode — обрезка по `Position`, не по code points (риск разреза суррогата — не проверен) |
| metadata | `66-67` | `await scanWorkspace(rootPath)` каждый вызов; cache hit только если root тот же; `''` root тоже кэшируется |
| bsp | `68` | полный injection каждый вызов, без кэша, без бюджета символов |
| multitab | `69` | сканирует `workspace.textDocuments` каждый вызов, до 6 документов, regex на каждый |
| tokenizer | `72-74` | токенизация ВСЕГО документа каждый вызов, O(n) на каждое нажатие |
| pre-flight cancel | `116-118` | `token.isCancellationRequested` только ДО `complete()` |
| network | `120-127` | `complete()` без token/signal; висит до 25s |
| post-flight cancel | `129-131` | `token.isCancellationRequested \|\| !completion.trim()` → null |
| cleanup | `134` | только `^```(bsl\|1c)?` + trailing ` ``` `; пояснения/повтор prefix/suffix/JSON/oversize — НЕ фильтруются |
| error | `145-147` | `catch (_) { return null; }` — класс ошибки, requestId, фаза теряются |

Отсутствующие переходы (подтверждены отсутствием в коде):
- нет `requestId / URI / version / line / character` identity;
- нет отмены предыдущего HTTPS при новом вызове;
- нет проверки `document.version` после `await`;
- нет проверки смены `activeDocument`;
- нет лимита параллельных запросов;
- нет разделения `contextBuildMs / networkMs`.

## 3. Known risks (подтверждены кодом)

1. **Throttle ≠ debounce.** `lastRequestTime` — глобальный timestamp. Быстрый набор: часть вызовов молча дропается (`null`), а ушедший в сеть запрос — устаревший, но оплачиваемый.
2. **Нет отмены HTTPS.** `complete()` не принимает `AbortSignal`. Токен проверяется до/после, `req.destroy()` только по 25s timeout. Старый request живёт до 25s.
3. **Stale completion возможен.** Нет identity → поздний ответ старого запроса может быть возвращён, если VS Code вызовет provider повторно в той же позиции (VS Code сам отбрасывает по токену, но within-provider гонки не закрыты; два документа делят один `lastRequestTime`).
4. **Duplicate paid requests.** Нет dedup по (uri, version, position, prefix-hash). 10 keystrokes → до N сетевых вызовов минус throttle-дропы, без гарантии 1.
5. **Fallback metadata попадает в prompt.** `MetadataScanner.scanWorkspace('')` или пустой workspace → `isDemoFallback=true` с 7 синтетическими сущностями (Номенклатура, Контрагенты, …), а `formatForPrompt` всё равно вставляет их в system prompt с пометкой `// Метаданные (Демо-схема...)`. Модель видит выдуманные `ЗаказКлиента/ТоварыНаСкладах` как контекст. Для query-генератора это терпимо, для autocomplete — источник ложных подсказок.
6. **Нет бюджета контекста.** prefix (50 строк) + suffix (15) + full BSP dump + multitab (6 файлов × 8 методов) + metadata (до 100 объектов) — без truncation. Большой открытый проект = большой prompt = latency + cost на каждый символ.
7. **Tokenizer на каждый keystroke.** `tokenize(fullDocText)` + `scanWorkspace` + `getOpenModulesContext` выполняются ДО сети на каждый вызов — cold path всегда.
8. **Нормализация минимальна.** Только fence-strip. Пояснительный текст, повтор prefix/suffix, JSON/markdown, oversize multiline, незакрытые скобки/кавычки — проходят в ghost text. Пустой/whitespace-only ответ отбрасывается, остальное — нет.
9. **Ошибки немы.** `catch (_) → null`. 401/402/429/500/parse/timeout неразличимы для диагностики; пользователь не видит ничего; debug-счётчиков нет.
10. **Нет метрик.** Нет `requestId`, `contextBuildMs/networkMs/totalMs`, `cancelled/empty/errorClass`. Замерить p50/p95 нечем.
11. **Модельная путаница возможна.** `autocompleteModel` default `deepseek-v4.1-flash`, `reasoningModel` default `gpt-6.1-sol`; в provider используется `autocompleteModel`, но enum обоих включает reasoning-модели — ничто не мешает выбрать тяжёлую reasoning-модель для ghost text (latency ×10).
12. **Untitled/file пробел.** `untitled:1c`, `untitled:oscript` не зарегистрированы; `file:oscript` есть. Поведение для новых несохранённых OneScript-файлов — нет provider.
13. **Whitespaces за пределами line 0.** Guard только для line 0; пустая строка в середине файла уходит в сеть.
14. **Тестов на provider не было.** `tests/suite.ts` покрывает StandardsChecker/BSP/Query/Extension/Metadata/BDD/TechLog/Tokenizer — inline provider не покрыт вообще (см. матрицу ниже).
15. **Bundle ≠ runtime.** `dist/extension.js` в diff модифицирован, но собран из неизвестного состояния; VSIX `1.0.0-1.0.2` в корне не содержат текущих незакоммиченных изменений. Зелёный `npm test` ≠ работа в extension host.
16. **Секреты в логах — чисто, но fragile.** Сейчас prompt/код не логируются (логов вообще нет). Риск — будущий debug-log без маскировки; требование П2 уже сейчас.

## 4. Claims that are currently unproven

- `README:16` — «задержка отклика < 250 мс» для ghost text.
- `README:26` — `deepseek-v4.1-flash`: «Быстрый отклик (< 250 мс)».
- `package.json:271-275` — `debounceMs default 250` подаётся как «задержка перед отправкой в сеть», что читается как debounce, хотя код — throttle.
- Неявный claim «контекст = реальная конфигурация»: при отсутствии `Configuration.xml` в prompt уходит демо-схема без явного отделения от реальной.

Почему `<250ms` невозможен/маловероятен в текущем виде:
1. `debounceMs=250` — это уже нижняя граница для части вызовов (throttle-drop), а не верхняя.
2. Cold path на каждый вызов: `scanWorkspace` (fs `readdirSync/statSync`, до 4 candidate dirs) + `tokenize(fullDoc)` + BSP dump + multitab regex — всё до сети.
3. Сеть: `timeout 25000`, reasoning-модель не запрещена, prompt без бюджета (сотни строк) → TTFB одного чат-запроса через шлюз физически >250ms в медиане.
4. Нет измерений: ни одного benchmark-скрипта для inline path (`run_full_live_benchmark.py` / `live_1c_qa_cases.py` — про query/sidebar, не про ghost text p50/p95).
5. Один live-ответ ≠ p95. Доказательством были бы p50/p95/p99 по фазам на fake-transport + live spot-check.

Статус claim: **UNPROVEN. README требует правки в Промпте 7, если benchmark не подтвердит.**

## 5. Test coverage matrix

| Область | Покрытие до этапа | Чем |
|---|---|---|
| StandardsChecker (8 правил) | ✅ | `tests/suite.ts [1/5]`, `test_runner.js` |
| BSPHelper (35+ модулей) | ✅ | `tests/suite.ts [2/5]` |
| QueryBuilder (batch/inspect/refactor) | ✅ | `tests/suite.ts [3/5]` |
| ExtensionGenerator (cfe) | ✅ | `tests/suite.ts [4/5]` |
| MetadataScanner.format | ⚠️ частично | только `formatForPrompt` на synthetic input; `scanWorkspace` fs/cache/fallback — не покрыт |
| BDD / TechLog | ✅ | `tests/suite.ts [6-7/7]` |
| BSLTokenizer / Scope | ✅ | `tests/suite.ts [8/8]` (pipes, quotes, directives, Перем) |
| Sidebar host boundary | ✅ | `tests/sidebar_host_test.js` (mock vscode, duplicate-guard, HTML-escape) |
| **Inline provider registration** | ❌ → ✅ (этот этап, guard-тест) | новый `tests/inline_completion_baseline_test.js` проверяет селектор из `extension.ts` статически + отсутствие внутреннего guard |
| **Inline provider guards (disabled/key/empty)** | ❌ → ✅ | новый harness, кейсы 1-3 |
| **Inline provider lifecycle (cancel/empty/fence/error)** | ❌ → ✅ | новый harness, кейсы 5-8 |
| Race/stale/cross-doc, context budgets, normalization-matrix, benchmark | ❌ | Промпты 2-6 |

Harness этого этапа (9 кейсов, детерминированный, без live key, без sleep):
1. `disabled setting` → null, zero network calls;
2. `missing API key` (SecretStorage пусто + env очищен) → null;
3. `first-line empty input` → null;
4. `valid BSL context` → 1 item, `Range(position,position)`, без fences;
5. `cancellation before request` → null, zero network calls;
6. `empty API response` → null;
7. `markdown fence cleanup` → fences сняты;
8. `API error` → null, исключение не пробрасывается в VS Code;
9. `no internal languageId guard` → provider не фильтрует сам (guard только на регистрации; селектор покрывает file:bsl/1c/oscript + untitled:bsl).

## 6. Latency measurement plan

Без изменения runtime (инструментация — в Промпте 5):

1. Fake-transport harness (детерминированный): конфигурируемые `responseDelay`, `payloadSize`, `errorRate`, `cancelAtMs`. Сценарии: cold start / warm cache / 10 keystrokes за 500ms / 100 sequential / 10 parallel docs / 10% timeout / 401-429-500 / cancel at 50-100-500ms.
2. Фазы для замера (будущие `CompletionMetrics`): `keyLookup → debounceWait → contextBuild (metadata+bsp+multitab+tokenize раздельно) → network → normalize → total`. Сейчас в коде точек замера нет — фиксируем как gap.
3. Метрики отчёта: p50/p95/p99 каждой фазы + число фактических network requests + cancellation rate + empty/error rate.
4. Live spot-check (только с явным ключом, отдельно от CI): N≥50 completions в реальном BSL-файле, тёплый/холодный workspace, медиана и p95. Один ответ — не benchmark.
5. Порог честности: пока нет p95 < 250ms end-to-end — README-claim считается неподтверждённым.

## 7. Implementation priorities P0/P1/P2

**P0 (безопасность денег и корректности, Промпт 2):**
- Настоящий debounce per-document/position + `CompletionRequestIdentity {uri, version, line, character, requestId}`.
- `AbortSignal` в `NormaHubClient.complete()` + `req.destroy()` при cancel; отмена — не ошибка для UI.
- Stale-response discard (проверка identity после `await`).
- Zero duplicate paid requests при rapid typing.

**P1 (качество подсказок и cost, Промпты 3-4):**
- `InlineCompletionContextSnapshot` + cache (workspace root, Configuration.xml mtime, ручной scan, clear).
- `TrustedMetadataContext`: real/fallback/unavailable; fallback по умолчанию НЕ в autocomplete-prompt (или явно помечен synthetic).
- Бюджеты `prefix/suffix/metadata/bsp/multitab` + deterministic truncation (текущий метод/параметры/экспорты в приоритете), unicode-safe.
- `normalizeInlineCompletion()` как pure-модуль: fences, пояснения, дубли prefix/suffix, JSON/markdown-детект, лимиты строк/символов, structural invariants, `null` при низкой уверенности.

**P2 (наблюдаемость и релиз, Промпты 5-7):**
- `CompletionMetrics` без кода/prompt/key в логах; debug off by default; классификация ошибок (cancelled/timeout/unauthorized/rate-limited/gateway/parse/context/unknown).
- Конфиги `debounceMs/requestTimeoutMs/maxCompletionLines/maxCompletionChars/contextBudgetChars` + backpressure/лимит параллельных.
- Полная test matrix (Промпт 6) + benchmark p50/p95/p99 + честный README/CHANGELOG/QA-report и release gate (Промпт 7). VS Code/Cursor smoke (`code`/`cursor` CLI доступны, VSIX `1.0.0-1.0.2` в корне) — только с явного разрешения, не в этом этапе.

---

**Вывод этапа:** baseline зафиксирован кодом; P0-риски (throttle, отсутствие cancel/identity, fallback в prompt, отсутствие нормализации/метрик) подтверждены; claim `<250ms` — UNPROVEN; harness добавлен; production-ready НЕ заявляется.
