# Changelog — 1C BSL AI Copilot (NormaHub)

## 1.0.12 — кандидат открытой беты, 2026-11-10

- Уточнены поддерживаемые редакторы, передача контекста в NormaHub, статус AI-черновиков и порядок обезличенной обратной связи в README, который входит в VSIX.
- Поставка релиза разделена на CI draft с точным VSIX/SHA256SUMS и ручное продвижение того же пакета в Open VSX и Marketplace; исходный код расширения в этом изменении не менялся.
- До публикации обязательны проверка финального установленного пакета и новый живой NormaHub canary. Этот раздел не означает, что версия уже опубликована.

## 1.0.11 — локальный кандидат, 2026-11-02

- After a native inline acceptance, suppress repeated automatic inference until the document changes again. An explicit manual request remains available. This reduces an observed extra paid request after Tab under the default 250 ms debounce.
- Correct the README's outdated VSIX filename and live latency claim. Packaged native Tab checks and release qualification are recorded separately from real gateway latency.

## 1.0.10 — локальный кандидат, 2026-11-02

- Signed selected-query runner protocol v2 binds explicitly typed string, decimal, boolean, date and NULL parameters; v1 receipts stay verifiable.
- Native validation wizard requests each extra parameter and shows the bound values before preparing an operator job. Training 1C engine controls and VS Code/Cursor native workflows passed on an isolated display.
- Source inline provider replay accepted four saved live 1017 suggestions by physical Tab in both IDEs; a semantically changed fifth suggestion was rejected by Escape. These are offline replay results, not new live gateway calls.
- Truncation diagnostics report sanitized token counts and distinguish response budget spent predominantly on reasoning. Mass production and full BSL execution remain unverified.

## 1.0.9 — кандидат, 2026-10-30

- Native diff captured unsaved source → proposed insertion/replacement; source guards and once-only apply/Undo preserved.
- Native proposed-contract wizard: query literal selection, independent requirement/preconditions, typed expected rows or UTF-8 CSV, explicit empty-result confirmation.
- Operator-pinned signed selected-query import and dynamic reports from the preceding source stage are included in this candidate; no full-BSL/approval claim.
- Packager refuses overwriting an existing VSIX. Publication and live NormaHub qualification are separate.


## [1.0.8] — Practical defect fixes

- Invalidate previews when the final source tab closes, even if VS Code retains the TextDocument; retain split-editor support and recheck after async editor operations.
- Narrow query-in-loop and injection checks, remove unsupported BSP property inference, inspect embedded query literals, and support rule settings and inline suppression.
- Query inspection reports unvalidated syntax explicitly and rejects obvious malformed input; NULL hints require arithmetic on a nullable joined field.
- Deficit templates support current rows, header attributes, renamed fields/resources and schema checks using real project metadata.
- Format supplied Vanessa steps and tables with explicit step count and unverified-execution status.
- Preserve interceptor default parameters and quoted commas; reject invalid event kinds and parameter injection.

## [1.0.7] — Russian and English interface

- Add a persistent RU / EN selector in the panel header; switch without reloading or losing drafts and code previews.
- Translate navigation, tools, settings, onboarding, status messages and BSP descriptions; keep BSL identifiers, code and user content intact.
- Localize VS Code command titles and configuration descriptions using package NLS resources.
- Add host and Webview language regressions, including storage failure recovery and exact clipboard preservation.

## [1.0.6] — DeepSeek Flash 1017

- Replace DeepSeek with the gateway ID `deepseek-v4.1-flash-1017` in defaults, selectors and runtime requests.
- Existing settings using `deepseek-v4.1-flash` resolve to 1017 without rewriting user/workspace settings. Explicit GPT model choices remain independent.
- Update model regressions and keep the 1.0.5 product audit as historical evidence; its outstanding findings remain open.

## [1.0.5] — independent lifecycle and context recheck

- Reject completion responses after edits/close; cancel superseded requests before asynchronous key reads and dispose active requests on deactivation.
- Block preview application to reopened documents even when URI and version match.
- Invalidate metadata on JSON and saved XML/EDT changes. Cache neighbor signatures by document identity and limits; ignore declarations inside comments/strings and retain real common-module names.
- Respect workspace model overrides and synchronize effective settings back to the panel.
- Refuse query extraction with lock/permission modifiers; avoid temporary-table and result-field collisions. Scope event signature inference to the selected module.
- Validate MCP envelopes and boolean argument types. A malformed HTTP 200 model list no longer means a connected gateway; interrupted health responses settle with an error.
- Add independent negative scenarios, packaged protocol regressions and effective-model Webview checks. Live IDE/API/1C gates remain open.

## [1.0.4] — preview workflows and practical tools

- Commands and panel share one workflow; previews capture source URI/version/position and apply once. Changed source blocks application; generated output opens separately without an editor.
- Batch templates preserve BSL string newlines and use explicit dimensions/resource. Virtual-JOIN extraction preserves projected fields and NULL semantics, refuses unsupported queries, and explains package result indexing.
- Independent generation/completion models; AI cancellation, plain-code extraction, empty/truncated response checks. Untitled 1c/oscript registered.
- No runtime demo metadata or browser mock transport. Validated metadata.json import and explicit refresh; configuration context follows the active workspace.
- BDD retains complete requirements; optional AI draft. Diagnostics describe their limited scope; log parsing distinguishes unsupported input and ignores fast SQL.
- MCP and Sidecar use one bundled local core. REST input validation, precise health/auth handling, fixed HTTP adapters and bundled documentation paths.
- New workflow/semantic regressions; existing inline suites retained. Live IDE/API/1C/Vanessa/TurboConf checks remain release gates.


## [1.0.3] — release QA and NormaHub-only transport
- Cloud AI transport is fixed to `https://api.normahub.cc/v1`.
- Removed `OPENAI_API_KEY` fallback and user-configurable cloud endpoint.
- Added BSL diagnostics and recommendation code actions in VS Code.
- Hardened Sidecar remote binding, request size limits and LLM endpoint policy.
- Added release artifact and MCP protocol QA checks.

## [Unreleased] — inline autocomplete production hardening (Промпты 1–6)

### Debounce / cancellation (Промпт 2)
- Заменён глобальный timestamp-throttle настоящим trailing debounce (`debounceMs`, default 250): burst схлопывается в один запрос.
- `CompletionRequestIdentity` (URI + версия + позиция + монотонный id); предыдущий слот отменяется всегда.
- `NormaHubClient.complete()` принимает `AbortSignal` (+ `timeoutMs`): отмена и таймаут уничтожают HTTPS-запрос (`req.destroy()`), отмена — silent `null`.
- Stale-ответы отбрасываются даже при позднем ответе сервера; смена версии/позиции/документа инвалидирует запрос.

### Context / cache / fallback (Промпт 3)
- Новый `src/inlineCompletionContext.ts`: снапшот контекста, trust-модель `real/fallback/unavailable`.
- Synthetic fallback по умолчанию исключён из autocomplete-промпта.
- Кэш метаданных с mtime-инвалидацией по `Configuration.xml`; ручной `scanMetadata` чистит оба слоя.
- Кэш BSP-инъекции; сигнатуры соседних вкладок по `(uri, version)` без хранения кода; активный документ исключён.
- Бюджеты секций + жёсткий `contextBudgetChars` (default 12000), юникод-безопасная обрезка, приоритет — метод и хвост курсора.
- Исправление по ходу: `Знач` добавлен в KEYWORDS токенизатора (парсился как имя параметра, ломал scope-описание).

### Normalization (Промпт 4)
- Новый pure-модуль `src/inlineCompletionNormalizer.ts`: fences, пояснения, echo-дедуп, JSON/markdown-гейты, лимиты (`maxCompletionLines` 20 / `maxCompletionChars` 1000), BSL-скан строк/комментариев, баланс скобок и блоков относительно префикса.
- Провайдер возвращает только нормализованный текст; сомнительное → silent `null`.

### Latency / diagnostics (Промпт 5)
- `CompletionMetrics` по фазам (debounce/context/network/total), классы ошибок, ring-буфер, санитизированный debug (`completionDebug`, default off).
- Backpressure: один глобальный слот (`MAX_ACTIVE_COMPLETION_REQUESTS = 1`).
- Разделение моделей зафиксировано тестом: ghost — только `autocompleteModel` (flash), reasoning — только глубокие flows.
- Benchmark-harness на fake-транспорте (seeded): cold ctx 12 мс → warm 0 мс; burst 10→1; 100 sequential без дропов.

### Test matrix (Промпт 6)
- Живая регистрация через `activate()`; guards; границы окон 50/15; полный lifecycle (402/parse/cancel-mid-debounce/post-response); UX-шейп под нативный Tab; seeded негативные races.
- V8 function coverage: 100% четырёх inline-модулей (`inlineCompletionProvider`, `normahubClient`, `inlineCompletionNormalizer`, `inlineCompletionContext`).

### Честность документации
- Сняты недоказанные клеймы `<250 мс` из README (заменены измеряемым описанием + разделом диагностики).
- Live p95 с реальным ключом и IDE smoke-тесты не выполнены — см. `tests/INLINE_AUTOCOMPLETE_PRODUCTION_REPORT.md`.
