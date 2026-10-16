# Changelog — 1C BSL AI Copilot (NormaHub)

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
