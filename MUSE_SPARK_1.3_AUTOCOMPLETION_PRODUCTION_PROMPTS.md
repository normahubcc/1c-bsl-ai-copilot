# Production-промпты для Muse Spark 1.3

## Bootstrap protocol для нового чата

Ты начинаешь работу без истории предыдущего чата. Сначала восстанови фактический контекст проекта, затем переходи к реализации.

### Source identity

Рабочий проект:

```text
/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot
```

Перед любым изменением выполни из корня проекта:

```bash
git status --short --branch
git rev-parse HEAD
git diff --stat
git log --oneline -10
```

Зафиксируй в отчёте:

- абсолютный путь проекта;
- repository/ref;
- текущий HEAD SHA;
- clean/dirty status;
- список уже изменённых файлов;
- какие изменения были до начала текущего этапа.

Правила source control:

- Текущий source code, текущий Git diff и фактические результаты тестов важнее README, старых handoff-документов, screenshots и исторических отчётов.
- Не удаляй, не перезаписывай и не форматируй незакоммиченные изменения пользователя.
- Не выполняй `git checkout`, `git switch`, `git reset`, `git clean`, `git pull`, force-операции или commit без явной команды пользователя.
- Не копируй код из других worktree или архивов.
- Перед изменением каждого файла проверь, не является ли его diff пользовательской работой.

### Mandatory discovery

До первого изменения прочитай актуальные версии:

```text
src/inlineCompletionProvider.ts
src/normahubClient.ts
src/metadataScanner.ts
src/multiTabScanner.ts
src/bslTokenizer.ts
src/standardsChecker.ts
src/types.ts
src/extension.ts
package.json
README.md
tests/
```

Отдельно проверь:

- реальную регистрацию `InlineCompletionItemProvider`;
- текущие `postMessage`-контракты и Webview handlers;
- реальный transport NormaHub;
- текущие тестовые scripts и их зависимости;
- наличие live credentials и возможность их использовать;
- наличие VS Code/Cursor CLI и возможность установить VSIX для smoke test.

Не считай наличие элемента в HTML, старый screenshot или текст README доказательством фактического поведения.

### Execution protocol

- Начни с короткого аудита и плана конкретного этапа.
- Не перепрыгивай через этапы 1–7.
- Следующий этап начинай только после завершения текущего, анализа diff и запуска соответствующих проверок.
- Если проверка невозможна, явно обозначь `BLOCKED`, причину и то, какая проверка нужна.
- Не подменяй реальный extension-host smoke test браузерным mock или generated Webview fixture.
- Не объявляй функцию production-ready только потому, что `npm test` завершился успешно.

### Evidence model

Всегда различай следующие состояния:

```text
локальные незакоммиченные изменения
→ committed source SHA
→ reviewed/merged SHA
→ built bundle
→ packaged VSIX
→ installed extension
→ live-verified behavior
```

Не смешивай эти состояния и не выводи одно из другого. В частности:

- успешный TypeScript compile не доказывает работу в VS Code;
- успешный browser mock не доказывает работу extension host;
- собранный `dist/extension.js` не означает, что VSIX установлен;
- существующий VSIX не содержит текущие незакоммиченные изменения;
- live benchmark с одним ответом не доказывает p95 production latency.

### Required report after every stage

После каждого из 7 этапов верни:

1. Что было проверено.
2. Что изменено.
3. Список изменённых файлов.
4. Точные команды проверки и результаты.
5. Новые или оставшиеся риски.
6. Что подтверждено фактически.
7. Что пока не подтверждено.
8. Следующий этап.

Не создавай commit автоматически и не публикуй VSIX автоматически.

## Назначение

Этот документ содержит 7 последовательных production-промптов для Muse Spark 1.3. Они предназначены для доведения автодополнения BSL в расширении `1c-bsl-ai-copilot` до уровня, приемлемого для ежедневного использования сотнями разработчиков.

Промпты нужно выполнять по порядку. Каждый следующий этап должен начинаться только после завершения предыдущего, запуска проверок и анализа diff.

Целевой проект:

```text
/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot
```

Ключевые исходники:

```text
src/inlineCompletionProvider.ts
src/normahubClient.ts
src/metadataScanner.ts
src/multiTabScanner.ts
src/bslTokenizer.ts
src/types.ts
src/extension.ts
package.json
tests/
```

Текущая архитектура автодополнения:

```text
VS Code InlineCompletionItemProvider
→ BSLInlineCompletionProvider.provideInlineCompletionItems()
→ API key
→ debounce/throttle check
→ prefix/suffix context
→ metadata scanner
→ BSP context
→ multi-tab context
→ BSL tokenizer/scope analyzer
→ NormaHubClient.complete()
→ InlineCompletionItem
```

## Общие правила для всех 7 этапов

- Работай с текущим checkout проекта. Перед изменениями проверь `git status --short --branch` и `git rev-parse HEAD`.
- Не стирай существующие незакоммиченные изменения пользователя.
- Сначала читай код и тесты, затем формулируй краткий implementation plan, затем редактируй файлы.
- Реализуй изменения в коде, а не ограничивайся рекомендациями.
- Не переписывай весь проект и не заменяй VS Code Inline Completion API другим механизмом.
- Не добавляй React, Electron, новый backend или тяжёлый runtime без доказанной необходимости.
- Не отправляй в telemetry исходный BSL-код, выделенный текст, prompt, API-ключ или содержимое файлов.
- Не используй демонстрационные сущности конфигурации как реальные данные автодополнения.
- Любая новая асинхронная операция должна иметь понятный lifecycle: старт, успех, отмена, ошибка, timeout.
- Все внешние ошибки должны быть безопасными и диагностируемыми без утечки секретов.
- Не проглатывай ошибки без причины. Для пользовательского completion допускается `null`, но причина должна быть доступна в debug-диагностике или тестах.
- Не обещай latency, которую не измерил.
- После каждого этапа запускай минимум:

```bash
npm run compile
npm test
npm run build
```

- Если добавляются browser/UI-тесты, запускай также актуальные Webview regression tests.
- В конце каждого этапа покажи:
  - изменённые файлы;
  - поведение до/после;
  - тесты и их результат;
  - известные ограничения;
  - следующий шаг.

---

# Промпт 1. Senior-аудит и baseline автодополнения

```text
Ты — Senior Staff Engineer, Senior QA и Product Performance Engineer. Работай над проектом:
/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot

Твоя задача на этом этапе — провести глубокий технический аудит текущего BSL inline autocomplete и подготовить безопасный baseline для последующей реализации. Не ограничивайся обзором README: источником истины являются реальные TypeScript-обработчики, VS Code API, HTTP-клиент и тесты.

Изучи минимум:
- src/inlineCompletionProvider.ts;
- src/normahubClient.ts;
- src/metadataScanner.ts;
- src/multiTabScanner.ts;
- src/bslTokenizer.ts;
- src/types.ts;
- src/extension.ts;
- package.json;
- tests/suite.ts;
- tests/sidebar_host_test.js;
- tests/webview_regression.py;
- существующие live benchmark scripts.

Зафиксируй:
1. Как и когда регистрируется InlineCompletionItemProvider.
2. Какие languageId и URI scheme поддерживаются.
3. Как извлекаются prefix и suffix.
4. Как работает текущий debounce/throttle.
5. Какие операции выполняются до сетевого запроса.
6. Какие операции кэшируются, а какие выполняются заново на каждый вызов.
7. Что происходит при быстром наборе текста.
8. Что происходит при CancellationToken.
9. Отменяется ли фактический HTTPS-запрос.
10. Может ли один старый ответ повлиять на новый completion.
11. Может ли fallback metadata попасть в prompt.
12. Есть ли защита от duplicate requests и лишних платных вызовов.
13. Какие ошибки видит пользователь и какие ошибки теряются.
14. Как очищается ответ модели.
15. Проверяется ли синтаксис или безопасность возвращаемого текста.
16. Есть ли тесты именно на inline completion, а не только на отдельные tokenizer/core helpers.

Создай документ:
tests/INLINE_AUTOCOMPLETE_BASELINE.md

В документе должны быть разделы:
- Current architecture;
- Request lifecycle;
- Known risks;
- Claims that are currently unproven;
- Test coverage matrix;
- Latency measurement plan;
- Implementation priorities P0/P1/P2.

Особенно проверь правдивость claim «отклик < 250 мс». Не принимай это значение без p50/p95 измерений. Укажи, какие части pipeline делают его невозможным или маловероятным.

На этом этапе не делай крупный refactor runtime-кода. Разрешены только минимальные изменения, необходимые для baseline-тестов и безопасного документирования.

Добавь минимальный unit-test harness для BSLInlineCompletionProvider, если его нет. Тесты должны покрыть:
- disabled setting;
- missing API key;
- first-line empty input;
- valid BSL context;
- cancellation before request;
- empty API response;
- markdown fence cleanup;
- API error;
- unsupported document guard.

Критерии готовности:
- baseline document создан;
- все текущие риски подтверждены кодом;
- тесты воспроизводят текущие сценарии;
- npm run compile проходит;
- npm test проходит;
- npm run build проходит;
- ты не утверждаешь, что автодополнение production-ready только потому, что сборка зелёная.
```

---

# Промпт 2. Настоящий debounce, cancellation и request identity

```text
Ты — Senior TypeScript/VS Code Platform Engineer. Продолжай работу в проекте:
/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot

Реализуй production-grade lifecycle для inline completion. Главная цель — не отправлять и не оплачивать устаревшие запросы, когда разработчик продолжает печатать или меняет документ.

Текущие проблемы, которые необходимо устранить:
- текущая логика с lastRequestTime является throttle, а не debounce;
- debounce общий для всего provider;
- HTTP-запрос NormaHub не отменяется CancellationToken;
- старые requests могут жить до 25 секунд;
- cancellation проверяется только до и после complete();
- нет request identity по URI, document version и cursor position.

Проектируй lifecycle так:

```text
каждый вызов completion
→ создать request identity
→ отменить предыдущий запрос для того же документа/позиции или глобально по активному документу
→ дождаться debounce interval
→ проверить cancellation/version/position
→ собрать контекст
→ отправить cancellable request
→ проверить identity ещё раз
→ вернуть completion только если request всё ещё актуален
```

Требования:
1. Добавь явный тип CompletionRequestKey/CompletionRequestIdentity.
2. Identity минимум содержит:
   - document URI;
   - document version;
   - line;
   - character;
   - monotonically increasing request id.
3. Старый запрос не должен вернуть completion после нового запроса.
4. Используй CancellationToken из VS Code API.
5. Расширь NormaHubClient.complete так, чтобы он принимал optional AbortSignal или эквивалентный cancellation mechanism.
6. При отмене вызывай `req.destroy()`/AbortController корректно и не превращай отмену в пользовательскую ошибку.
7. Не логируй API key, prompt или код.
8. Таймер debounce должен корректно очищаться при отмене и завершении.
9. Не задерживай первый осмысленный запрос дольше необходимого.
10. Не создавай unhandled Promise rejection.
11. При смене document version старый request должен стать invalid.
12. При смене active editor completion от старого документа не должен попасть в новый.
13. Не меняй публичный UX VS Code Tab-принятия.

Добавь тесты:
- rapid typing: 10 вызовов за короткий интервал → максимум один актуальный network request;
- second request cancels first;
- cancellation before debounce;
- cancellation during HTTPS request;
- document version changed while waiting;
- cursor moved while waiting;
- different documents cannot reuse each other's result;
- cancelled request does not produce error toast/log noise;
- timeout destroys the HTTP request;
- stale response is discarded even if server resolves it later.

Добавь controlled fake transport только в тесты. Runtime не должен импортировать mocks.

Критерии готовности:
- настоящий debounce, а не timestamp throttle;
- фактическая отмена network request;
- zero stale completions;
- tests cover race conditions;
- npm run compile, npm test и npm run build проходят.
```

---

# Промпт 3. Контекст, кэш и защита от ложных metadata

```text
Ты — Senior Search/Context Systems Engineer для IDE AI tools. Продолжай работу над:
/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot

Сделай контекст автодополнения быстрым, детерминированным и достоверным. Сейчас каждый запрос может повторно выполнять metadata scan, BSP injection, multi-tab scan и tokenizer. При отсутствии реальной конфигурации scanner способен вернуть synthetic fallback entities. Для inline completion это может привести к ложным подсказкам.

Цели:
- не сканировать неизменившиеся данные повторно;
- не отправлять synthetic fallback как реальную структуру проекта;
- отделить fast autocomplete context от deep query-generation context;
- ограничить размер prompt и время подготовки контекста;
- правильно инвалидировать cache.

Реализуй:
1. Отдельный typed context builder для inline completion.
2. Чёткую модель доверия metadata:
   - real;
   - fallback/demo;
   - unavailable.
3. Для inline completion synthetic fallback по умолчанию не отправляется в prompt.
4. Если fallback всё же необходим для совместимости, он должен быть явно помечен как synthetic и не должен выглядеть реальным.
5. Cache по workspace root с invalidation:
   - смена workspace;
   - изменение Configuration.xml/EDT источника;
   - ручной scan metadata;
   - явный clear cache.
6. Cache для BSP prompt injection.
7. Cache/cheap snapshot для multi-tab signatures.
8. Не кэшируй полный исходный код без необходимости.
9. Ограничь каждый context section по размеру:
   - prefix;
   - suffix;
   - metadata;
   - BSP;
   - multi-tab.
10. Добавь deterministic truncation с приоритетом текущего метода, параметров и экспортируемых сигнатур.
11. Не обрезай середину unicode-строки некорректно.
12. Учитывай document version в context cache.
13. Не отправляй active document дважды через multi-tab context.
14. Раздели context preparation time и network time в internal debug metrics.

Рекомендуемая модель:

```ts
interface InlineCompletionContextSnapshot {
  documentUri: string;
  documentVersion: number;
  position: { line: number; character: number };
  prefix: string;
  suffix: string;
  scope: ScopeSnapshot;
  metadata: TrustedMetadataContext;
  bsp: string;
  neighboringModules: ModuleSignature[];
  generatedAt: number;
}
```

Добавь тесты:
- same workspace reuses metadata cache;
- changed Configuration.xml invalidates cache;
- fallback metadata is not included in autocomplete prompt;
- real metadata is included;
- active module excluded from neighboring modules;
- context size stays below configured budget;
- long Cyrillic identifiers remain intact;
- no duplicate BSP injection;
- document version changes snapshot identity.

Критерии готовности:
- cold context path measurable;
- warm context path measurable;
- fallback is explicitly controlled;
- tests assert prompt contents, not just function calls;
- no regression in query generator, which may use richer metadata context.
```

---

# Промпт 4. Нормализация, безопасность и качество ответа модели

```text
Ты — Senior Compiler/Language Tooling Engineer. Работай в проекте:
/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot

Улучши обработку ответа inline completion. Сейчас результат проверяется только на пустоту и очищается от простых markdown fences. Для production IDE этого недостаточно: модель может вернуть пояснение, повторить уже введённый текст, вернуть несколько блоков, сломать границу строки или предложить слишком большой фрагмент.

Создай чистый модуль нормализации, например:

```ts
normalizeInlineCompletion(raw, input, context): NormalizedCompletion | null
```

Модуль должен:
1. Удалять markdown fences безопасно.
2. Удалять вводные пояснения, если модель их вернула.
3. Не принимать пустой результат.
4. Убирать повтор prefix/current line там, где это очевидно.
5. Не дублировать suffix.
6. Ограничивать количество строк и символов конфигурацией.
7. Отбрасывать ответ, который выглядит как JSON, Markdown-объяснение или обычный текст вместо BSL.
8. Сохранять русский BSL-код и unicode identifiers.
9. Не ломать строковые литералы и комментарии простыми агрессивными regex.
10. Не вставлять completion, если результат состоит только из whitespace/comments.
11. Очищать только допустимые внешние обёртки; не переписывать код произвольно.
12. Учитывать compilation directive текущего scope.
13. Проверять базовые structural invariants:
    - количество незакрытых скобок;
    - незакрытые кавычки только если проверка не даёт false positive;
    - очевидно незакрытые блоки в сгенерированном фрагменте;
    - отсутствие ` ``` `.
14. Если уверенность низкая — вернуть `null`, а не плохой ghost text.

Не пытайся написать полный BSL compiler. Нужен консервативный фильтр с тестами на false positives.

Создай тип:

```ts
interface NormalizedCompletion {
  text: string;
  lineCount: number;
  charCount: number;
  confidence: 'high' | 'medium';
  removedWrapper: boolean;
}
```

Добавь тесты:
- plain BSL continuation;
- fenced BSL;
- fenced code without language;
- answer with Russian explanation;
- answer containing prefix twice;
- answer containing suffix twice;
- multiline procedure;
- Cyrillic strings;
- comments and quoted strings with parentheses;
- empty response;
- JSON response;
- oversized response;
- malformed response;
- valid `Если`, `Для Каждого`, `Попытка` continuations;
- no accidental removal of meaningful code.

Критерии готовности:
- provider returns only normalized safe text;
- normalization is pure and unit-testable;
- invalid responses are dropped silently for the user but observable in debug counters;
- no user code is logged;
- npm test passes.
```

---

# Промпт 5. Latency, cost, concurrency и диагностируемость

```text
Ты — Senior Production Performance Engineer и FinOps Engineer. Продолжай работу над BSL autocomplete в:
/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot

После реализации cancellation, context cache и response normalization проведи performance hardening. Цель — сделать поведение предсказуемым для сотен активных пользователей, а не только успешным в одном локальном happy path.

Нужно измерять pipeline по этапам:

```text
provider invoked
→ key lookup
→ debounce wait
→ context build
→ request started
→ first response byte, если доступно
→ response complete
→ normalize
→ completion returned
```

Реализуй внутреннюю диагностическую модель без отправки кода или prompt:

```ts
interface CompletionMetrics {
  requestId: number;
  model: string;
  contextBuildMs: number;
  debounceWaitMs: number;
  networkMs?: number;
  totalMs: number;
  cancelled: boolean;
  empty: boolean;
  normalized: boolean;
  accepted?: boolean;
  errorClass?: string;
}
```

Требования:
1. Debug logging выключен по умолчанию.
2. Никогда не логировать API key, prompt, prefix, suffix или completion text.
3. Секреты должны быть замаскированы даже в error paths.
4. Ошибки классифицируются:
   - cancelled;
   - timeout;
   - unauthorized;
   - rate-limited;
   - gateway;
   - parse;
   - context;
   - unknown.
5. Не показывать пользователю раздражающие toast на каждый отменённый completion.
6. Обеспечить backpressure: при burst ввода не создавать бесконечную очередь.
7. Ограничить максимальное число активных completion requests.
8. При недоступном шлюзе быстро возвращать null после разумного timeout policy.
9. Не делать лишний metadata scan на каждый символ.
10. Не использовать reasoning model для autocomplete по умолчанию.
11. Проверить, что настройки autocompleteModel и reasoningModel не смешиваются.
12. Добавить конфигурируемые параметры:
    - debounceMs;
    - requestTimeoutMs;
    - maxCompletionLines;
    - maxCompletionChars;
    - contextBudgetChars.
13. Документировать разумные значения по умолчанию.

Создай benchmark harness без реального API:
- deterministic fake transport;
- configurable response delay;
- configurable cancellation timing;
- configurable payload size;
- configurable error rate.

Benchmark scenarios:
- cold start;
- warm cache;
- 10 keystrokes in 500 ms;
- 100 sequential completions;
- 10 parallel documents;
- 10% timeout rate;
- 401/429/500 responses;
- cancellation at 50/100/500 ms.

Отчёт должен содержать p50/p95/p99 для каждой фазы и общее количество фактических network requests.

Критерии готовности:
- нет необъяснимого request explosion;
- cancellation снижает число завершённых/оплачиваемых устаревших запросов;
- warm cache заметно быстрее cold path;
- метрики не содержат пользовательский код;
- README не заявляет `<250 мс`, если benchmark это не подтверждает.
```

---

# Промпт 6. Полное тестирование inline completion

```text
Ты — Senior QA Automation Engineer. Работай в том же проекте и создай отдельную полноценную test matrix для inline completion. Не считай существующие core tests достаточным покрытием: они не доказывают корректность VS Code InlineCompletionItemProvider.

Добавь изолированные тесты с контролируемой VS Code API boundary и fake HTTP transport. Runtime не должен импортировать mocks.

Обязательные группы тестов:

## Registration

- provider зарегистрирован для bsl;
- provider зарегистрирован для 1c;
- provider зарегистрирован для oscript;
- provider работает для untitled BSL;
- provider не активируется для JSON/TypeScript/Markdown.

## Input guards

- feature disabled;
- missing API key;
- empty first line;
- whitespace-only input;
- cursor at document start;
- read-only document does not affect preview generation;
- empty document.

## Context

- prefix/suffix boundaries;
- first line;
- last line;
- cursor in long line;
- selected compilation directive;
- inside procedure;
- inside function;
- inside loop;
- inside try block;
- local variables;
- neighboring modules;
- metadata real/fallback/unavailable;
- Unicode/Cyrillic identifiers.

## Network lifecycle

- valid response;
- empty response;
- HTTP 401;
- HTTP 402;
- HTTP 429;
- HTTP 500;
- malformed JSON;
- timeout;
- cancellation before request;
- cancellation during request;
- cancellation after response but before return;
- stale response after newer request;
- document version changed;
- cursor changed;
- active document changed.

## Normalization

- markdown fences;
- explanation before code;
- duplicate prefix;
- duplicate suffix;
- malformed BSL;
- oversized result;
- valid multiline block;
- strings/comments containing syntax characters.

## UX/acceptance

- returned item has correct insertion range;
- returned item contains no markdown fences;
- no stale suggestion after cancellation;
- no duplicate paid request;
- errors do not throw into VS Code;
- empty result returns null;
- completion can be accepted by the native Tab flow.

Добавь negative tests, которые специально пытаются сломать provider race conditions.

Добавь coverage report именно для:
- src/inlineCompletionProvider.ts;
- src/normahubClient.ts cancellation paths;
- normalization module;
- context builder.

Критерии готовности:
- test suite запускается без live NormaHub key;
- tests deterministic and repeatable;
- no sleep-based flaky assertions where deferred promises are possible;
- failures показывают request id/document/version/phase, но не исходный код;
- npm test включает этот suite;
- CI сможет выполнить тесты без VS Code GUI.
```

---

# Промпт 7. Финальная интеграция, документация и release gate

```text
Ты — Principal Engineer, Release QA и Product Owner developer tooling. Это финальный этап для проекта:
/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot

Проведи release hardening после завершения предыдущих 6 этапов. Не добавляй новые возможности ради объёма: проверь, что реализованное поведение честно, измеримо и безопасно для ежедневного использования.

Проверь согласованность:
1. README и фактическое поведение autocomplete.
2. package.json settings и runtime defaults.
3. autocompleteModel и reasoningModel.
4. debounceMs и фактический debounce.
5. requestTimeoutMs и HTTP timeout.
6. cancellation docs и реальную отмену.
7. fallback metadata и prompt behavior.
8. BSL/1C/OneScript language selectors.
9. inline completion и Action Pilot не должны расходиться в правилах API key/status.
10. UI не должен обещать `<250 мс` без подтверждённого benchmark.

Обнови документацию:

## README

Добавь честный раздел:
- как работает автодополнение;
- какие языки поддерживаются;
- какой контекст используется;
- когда запрос не отправляется;
- как работает cancellation;
- какие настройки доступны;
- что влияет на latency;
- что отправляется в NormaHub;
- что не отправляется;
- как диагностировать проблемы;
- как запускать тесты.

## CHANGELOG или release notes

Опиши:
- debounce/cancellation;
- cache;
- normalization;
- fallback policy;
- test matrix;
- benchmark results.

## QA report

Создай или обнови:
tests/INLINE_AUTOCOMPLETE_PRODUCTION_REPORT.md

Включи:
- commit/source identity;
- exact commands;
- test totals;
- coverage;
- benchmark p50/p95/p99;
- cancellation rate;
- empty/error rates;
- stale response tests;
- known limitations;
- release recommendation: ready / conditional / not ready.

Release gate должен быть таким:

```text
[ ] npm run compile
[ ] npm run build
[ ] npm test
[ ] inline provider test matrix
[ ] deterministic fake transport tests
[ ] no live secrets in repo
[ ] no API key in logs
[ ] no fallback metadata presented as real
[ ] no stale completions
[ ] cancellation works during HTTP request
[ ] no duplicate paid requests during rapid typing
[ ] README claims match measurements
[ ] VSIX package builds
[ ] VSIX installs in a clean VS Code/Cursor smoke environment
[ ] manual acceptance of Tab completion in BSL file
[ ] manual check of cancellation while typing
[ ] manual check of offline/401/429 behavior
```

Если VS Code/Cursor smoke test невозможно выполнить в текущей среде, честно отметь его как BLOCKED. Не заменяй его unit test или browser fixture.

Финальный ответ Muse должен содержать:
- итоговую оценку production readiness от 1 до 10;
- список P0/P1 residual risks;
- доказательство каждого закрытого риска;
- точные команды проверки;
- список файлов изменений;
- отдельное различие между локально изменённым кодом, собранным bundle, VSIX и установленным runtime.

Не делай commit автоматически. Не публикуй VSIX автоматически. Не называй проект production-ready, если не пройдены реальные IDE smoke tests и latency benchmark.
```

---

## Рекомендуемый порядок запуска

```text
Промпт 1 → зафиксировать baseline
Промпт 2 → исправить lifecycle/cancellation
Промпт 3 → исправить context/cache/fallback
Промпт 4 → нормализовать ответ модели
Промпт 5 → измерить latency/cost/reliability
Промпт 6 → закрыть тестовую матрицу
Промпт 7 → синхронизировать docs и release gate
```

Не переходи к следующему промпту, если предыдущий этап не имеет зелёных тестов и понятного отчёта об ограничениях.
