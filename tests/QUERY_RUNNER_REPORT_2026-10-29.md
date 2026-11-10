# Локальный query runner: исполнение 1С, изоляция и подписанный receipt

Дата: 2026-10-29, Europe/Moscow. Source: `/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot`, `main`, HEAD `f98713a64c8c44a098497d222925ddd4d24215bb`, dirty. Реализован отдельный operator/developer CLI; коммит, публикация и новый VSIX не создавались.

## Реализовано

`dist/runner-cli.js` принимает request выбранного query fragment и отдельные operator-pinned profile/key. Строгие schemas связывают полное содержимое кандидата, UTF-16 selection, decoded query, contract, project, image/fixture/schema/binary, nonce/lease и policy. Нет входов shell/executable/URL/production database или host mount.

На host создаётся одноразовый ограниченный контейнер из точного local image ID с запретом pull. Контроллер проверяет Docker config и фактические cgroups/UID/seccomp/capabilities/mount/network перед выполнением. В контейнер передаются только nonce и query data; private signing key и окружающий BSL туда не попадают. После завершения и успешной очистки host подписывает receipt Ed25519. Verifier требует отдельно закреплённые key/profile/request/challenge; источник доверия не берётся из receipt.

Для результата различаются исполнение выбранного запроса, сравнение с proposed expectation, full BSL, approval и возможность apply. Даже при `equal` поля `executionVerified=false`, `approvalVerified=false`, `canApply=false` сохраняются; `queryExecutionVerified=true` относится только к выбранному запросу. Текущую свежесть editor snapshot обязан повторно проверить IDE adapter. Native signed-receipt import пока не подключён.

Архитектура/границы/запуск: [QUERY_RUNNER.md](../docs/QUERY_RUNNER.md). Core не импортирует vscode или test fixtures. Runtime использует operator-approved image; подготовка собственной учебной конфигурации вынесена в `tests/runner_fixture`.

## Реальная учебная 1С

Платформа 8.3.27.1508; фактический binary SHA-256 `0a53bd62447130c145d3caba50fe35b14f7b3f33ab04a5ce85ef75fe26753b39`. Финальный local image ID `sha256:50be42a5f7fe7db8d6bba590671183b4b6a41bf24c0905466be786983838d67a`. Это локальный собственный test profile, не распространяемый image и не квалифицированная компания/ERP.

Независимое ожидание задано до результатов: товар A / склад W1; остаток 10; две сохранённые строки по 6 → дефицит 2. Кандидаты — контролируемые test artifacts, без AI-вызова. BSL вокруг выбранного string literal специально содержит `ВызватьИсключение`: его исполнение не разрешено и не происходило, что соответствует narrow scope.

Каждый case получил отдельный container/tmpfs и новую копию собственной базы. Финальная квалификация после изменения policy hash:

| Case | Реальный выход 1С | Проверка / CLI exit | Результат |
|---|---|---|---|
| Correct aggregation | Одна строка A / 2 | `equal`, exit 0 | Выбранный query выполнен; expectation совпал |
| Controlled per-line defect | Пустая таблица | `different`, missingRows=1, exit 2 | Ошибка обнаружена независимым expectation; это test-only мутация |
| Unknown metadata object | Ошибка таблицы `Документ.НетОбъекта` | `failed`, queryExecutionVerified=false, exit 2 | Отказ не повышен до pass |
| Typed NULL | Одна строка typed null / 2 | `equal`, exit 0 | NULL сохранён отдельно от строки/Undefined |

Во всех четырёх контейнерах измерено: UID 10001, memory.max=2147483648, swap.max=0, pids.max=256, cpu.max=`100000 100000`, seccomp=2, NoNewPrivs=1, CapEff=0, read-only root, interfaces=`[lo]`. Все job containers удалены. Последующая подмена actual value в receipt отклонена настоящим CLI с `Invalid runner signature`, exit 1. Первоначальная functional training лаборатория не запускалась и её база не изменялась.

Дополнительно production policy ограничивает жизнь контейнера независимым timeout 180 с и AutoRemove. В отдельной проверке того же timeout/AutoRemove primitive длительность сокращена до 2 с: после выхода start-client контейнер сам завершился и удалился. Это не полный SIGKILL/restart/ledger recovery тест. [Watchdog evidence](evidence/query-runner-2026-10-29/watchdog-proof.json).

Измеренные whole-case времена 1526–1635 ms относятся к четырём тёплым локальным fixture jobs, включая CLI/verify/cleanup checks. Это N=4 без конкурентности, не p95, не время подготовки image и не live NormaHub latency.

## Регрессия и сохранность

- Финальные `npm test`, `pnpm build`, `pnpm lint` — exit 0. Новые 11 meaningful groups проверяют декодирование/подмену source, signing/pinning/replay/expiry, kernel/config refusals, active/preflight cancellation, foreign-owner cleanup refusal и реальные subprocess CLI/key permissions. Docker transport в этих 11 группах controlled; четыре engine cases проверены отдельно настоящим Docker/1С.
- Ruff и `py_compile` для новых Python fixture scripts — pass. Setup DAG/links и Git whitespace проверены отдельно.
- Повторного live IDE/Webview smoke здесь нет: existing extension runtime не менялся. Прежние native IDE результаты относятся к своим предыдущим этапам; этот срез не выдаётся за installed VSIX или live AI qualification.
- По backup начала этапа все 119 существующих source/Sidecar/bundle/evidence/VSIX файлов сохранены без изменения. Добавлены отдельные Core/CLI/tests; package.json дополнен build/test scripts, остальные поля не менялись.
- VSIX 1.0.8 сохранён: SHA-256 `d8542c08a188f03e800f8dca4a7772d8eaad9d85694c2d17401d23d8c10a79db`. Новый runner CLI и его image в этот пакет не входят. Private key находится вне workspace/контейнера; в evidence только public key.

Backup: `/tmp/1c-query-runner-2026-10-29-he6ch62v/`. Итоговый approved test profile: `/tmp/1c-query-runner-image-20261029-final/profile.json`; все source и output hashes находятся в постоянном manifest. Временные каталоги могут исчезнуть; повторный запуск требует сохранённого локального image или новой квалифицированной подготовки.

## Неуспешные попытки

Они не засчитаны в финальные 4 cases. Подробности и профилактика внесены в [инциденты I-10–I-12](../docs/DEVELOPMENT_INCIDENTS.md).

1. Dockerfile `FROM sha256:<id>` попытался получить registry image; подготовка переведена на exact local image ID, runtime запрещает pull.
2. Cap-drop root не смог читать/писать некоторые fixture paths. Исправлены permissions собственных copies, uid подготовки, единый WORK для `/Out`; добавлены проверки реальных logs/base и сохранение диагностики до cleanup.
3. Начальные реальные запуски показали generic client error. Попытка добавить POSIX account для UID 10001 не устранила причину. Startup catch и изъятие собственного partial JSON установили точную ошибку: platform serializer не принял `reason=Null`. Правильная строка A/2 уже была вычислена, но успешный receipt не выдавался.
4. Исправление `Неопределено` для JSON null и проверка client error/JSON завершили protocol path. Отдельный typed-NULL control сохраняет query Null как `{type: "null"}`.
5. После первых четырёх успешных cases policy hash дополнен всеми фиксированными ограничениями и автономным watchdog/AutoRemove; полный набор и четыре engine controls повторены на финальном Core. Это осмысленная повторная квалификация изменённого binding.

Сводка попыток, первичные отказы, публичный profile/key и финальные artifacts: [manifest](evidence/query-runner-2026-10-29/manifest.json), [attempts](evidence/query-runner-2026-10-29/attempts.json), [engine summary](evidence/query-runner-2026-10-29/engine-summary.json), [correct assessment](evidence/query-runner-2026-10-29/correct/assessment.json), [failed schema receipt](evidence/query-runner-2026-10-29/schema-error/receipt.json), [tamper refusal](evidence/query-runner-2026-10-29/tamper-refusal.json), [полный test log](evidence/query-runner-2026-10-29/full-test.txt).

## Открытая работа

P3-05/P3-07/P3-09 начаты; корпоративные G2/G3 не закрыты. Требуются native import с operator-pinned trust root и current source/context revalidation; server runner registration/revocation/capabilities, durable leases/heartbeat/cancellation ledger, tenant/budget/approval и независимый security/domain review. Самостоятельный оператор CLI не заменяет эти права.

Нет live NormaHub, выполнения полного AI BSL, произвольных конфигураций/СУБД, RLS/проведения/GUI/Vanessa/.cfe, Windows/RDP, hostile-BSL или VM isolation qualification. Подпись доверенного runner — авторство/целостность его утверждения; она не доказывает честность владельца private key. Следующий срез — безопасная native привязка signed receipt, сохраняя точную область проверки и запрет auto-apply.
