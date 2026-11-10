# Начало реализации AI/B2B: contract, comparator и evidence Core

Дата: 2026-10-29, Europe/Moscow; timestamps артефактов UTC. Репозиторий `/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot`, `main`, HEAD `f98713a64c8c44a098497d222925ddd4d24215bb`, dirty. Коммит/публикация и новый VSIX не создавались.

## Реализованный срез

| Область | Реальный результат | Статус относительно плана |
|---|---|---|
| BusinessContract | Строгая schema v1; provenance/scope; query_rows_equal; immutable proposal и digest; фиктивный approved отклоняется | P1-13 in_progress: authenticated approval и весь R1 contract ещё не готовы |
| Typed comparison | Multiset/ordered, кратность, NULL/Undefined, decimal strings, dates/refs; ограниченный sample отличий | D1-05 in_progress: comparator provided-data, не полный runner workflow |
| Evidence | Шесть hashes + project binding, expiry, required checks и явные непройденные статусы; canApply=false | P2-12 in_progress: consistency/freshness, не доверенный execution receipt |
| Доступный entrypoint | `node dist/verification-cli.js`; четыре JSON operations и ограниченный stdin | Developer/CI entrypoint; IDE/MCP пользовательские workflows не добавлены |
| Engine smoke | Реальная учебная 1С исполнила корректный запрос и контролируемую ошибочную мутацию; comparator различил результаты | Один собственный fixture, не автоматический поиск/AI/корпоративная приёмка |

Описание API и границ: [VERIFICATION_CORE.md](../docs/VERIFICATION_CORE.md). Application dispatcher находится в `src/app/verification/`; features импортируют entities/shared, Core не импортирует vscode. Данные тестов не включены в runtime.

## Выполненные проверки

- `npm test` — pass, включая существующие suites inline/host/Core/transport/Sidecar и 11 новых групп verification. Финальный запуск после размещения dispatcher в app завершился с exit 0.
- `pnpm build`, `pnpm lint`, Ruff для `.codex/scripts/` — pass.
- Реальные subprocess CLI: malformed JSON/UTF-8, превышение 2 MiB, неподдерживаемая schema/operation и неверные поля отклоняются.
- Числа за пределами точности IEEE-754, дробные отличия, дубли, NULL/пустые ссылки, порядок, timestamps, stale binding и попытка подделки approval проверены отдельно.
- Полные G1/G2/D-G1 и независимый security/domain sign-off не закрыты этими тестами.

## Реальное исполнение 1С

Использован ранее установленный изолированный учебный Linux-стенд с платформой 8.3.27.1508; новая собственная файловая база в `/lab/verification-core-g1un226g/ib`. Старые базы и исходная fixture не перезаписывались. Container ID `09d262dc9cf702ecb5cd44677761306ce7386550d8c1e61527ac9868d7d8052d`; SHA-256 фактически запущенного бинарника: `0a53bd62447130c145d3caba50fe35b14f7b3f33ab04a5ce85ef75fe26753b39`. Это identity лабораторного процесса, не новый воспроизводимый production image.

Первый load завершился с exit 1 из-за отсутствия locale у процесса. После изучения лога выставлены `LANG=ru_RU.UTF-8`, `LC_ALL=ru_RU.UTF-8`; load/update, CheckConfig Server/Thin и Enterprise завершились с exit 0. Первый отказ сохранён в evidence и не засчитан как pass.

Независимое ожидаемое условие: товар A на складе W1; остаток 10; две текущие строки по 6 → одна строка дефицита 2. Правильный вариант получен настоящим общим генератором продукта. Ошибочный вариант — явная test-only мутация без агрегирования строк; это проверка отрицательного контроля, не якобы найденная AI ошибка.

Свежий результат движка:

```text
RUN|935c307f-14cb-4a98-8115-a1a184f1b0e2
correct.count|1
correct.row|A|2
broken.count|0
PASS|typed_comparison
```

Checker проверил nonce/freshness/source hashes, передал эти выходы финальному CLI и получил `equal` для верного результата, `different` / missingRows=1 для ошибочного. При этом CLI сохранил `executionVerified=false`, потому что не аутентифицирует присланный ему engine receipt. Сам лабораторный запуск наблюдался отдельно и ограничен описанным профилем. Контейнер остановлен после проверки.

Повторяемые команды и защита новой базы: [onec_engine/README.md](onec_engine/README.md). Старые 11 engine-сценариев не выдаются за повторно выполненные в этом отдельном срезе; здесь один сценарий с двумя вариантами запроса.

## Сохранность и артефакты

В исходных src/Sidecar и трёх прежних runtime bundles изменений не обнаружено по 68 ранее сохранённым файлам, включая VSIX. Добавлены отдельные модули и verification bundle; в существующем package.json изменены только build/test scripts и добавлены три команды. Все прежние script chains сохранены и дополнены. Settings/models/commands/key storage продукта не менялись.

VSIX 1.0.8 сохранён с SHA-256 `d8542c08a188f03e800f8dca4a7772d8eaad9d85694c2d17401d23d8c10a79db`; новый CLI в него не включён. Публикация не выполнялась.

Постоянная компактная evidence: [manifest.json](evidence/verification-foundation-2026-10-29/manifest.json), [сравнение](evidence/verification-foundation-2026-10-29/comparison-report.json), [engine output](evidence/verification-foundation-2026-10-29/engine-results.txt), [CheckConfig](evidence/verification-foundation-2026-10-29/engine-check.txt). Manifest содержит source/CLI hashes и ограничения. Backup/полные логи этой стадии: `/tmp/1c-core-foundation-2026-10-29-m_bbkleh/`; временный каталог не гарантирует постоянного хранения.

## Следующий срез и открытые gates

Доверенный editor snapshot и TaskSpec/ChangeSet → интеграция контракта с настоящей AI-задачей → ограниченный runner job и проверяемый receipt → интерфейс review/apply с revalidation. Корпоративные права и approval реализуются на доверенной стороне, не через новый JSON flag.

Пока отсутствуют автоматический поиск/уменьшение контрпримеров, полный semantic diff проведения, банк правил, серверная tenant/approval/budget защита нового workflow, Windows/RDP и новые live AI/IDE проверки. Production готовность всего плана и уникальность относительно рынка не установлены. Эти зависимости остаются в [backlog](../docs/AI_B2B_BACKLOG.csv) и [матрице](../docs/AI_B2B_ACCEPTANCE_MATRIX.csv).
