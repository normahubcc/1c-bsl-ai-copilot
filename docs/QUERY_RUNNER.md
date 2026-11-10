# Локальный runner выбранного запроса

Начальный operator/developer компонент P3-05/P3-07/P3-09 и P2-12. Он исполняет выбранный текст запроса в закреплённой собственной fixture и проверяет подписанное свидетельство. В текущей версии это отдельный CLI из source tree. Расширение, MCP, Sidecar и NormaHub не получают автоматического доступа к Docker или этому entrypoint.

## Граница исполнения

| Компонент | Ответственность |
|---|---|
| Доверенный оператор | Выбирает локальный image ID, проект/profile, fixture/schema/binary hashes и ключ вне workspace |
| Host controller | Проверяет request, выдаёт свежие job ID/nonce/lease, создаёт ограниченный контейнер, проверяет effective policy, подписывает итог после cleanup |
| Контейнер | Получает только nonce и декодированный текст запроса; исполняет встроенный trusted harness и создаёт новую копию своей базы |
| Verifier | Использует отдельно закреплённые public key, profile, request и challenge; сверяет подпись, все bindings и время |
| IDE adapter | Создаёт challenge, проверяет operator-pinned receipt и actual editor snapshot/context, показывает selected-query отчёт; approval/apply остаются false |

Передаваемый `candidateCode` хешируется целиком, но контейнер его не получает. В `selection` выбирается весь plain query или полный BSL string literal. Декодер поддерживает doubled quotes, CRLF и `|` continuation; никаких `Выполнить`/`Вычислить` BSL для входа нет. Источник может содержать другой BSL вокруг литерала: его поведение этим профилем не проверяется.

Принимается один SELECT, до 24000 символов; query batches отклоняются. Full candidate ограничен 64000 символами; unpaired surrogate/NUL и неверный content hash отклоняются. Нет полей shell/executable/URL/production DB/host path/произвольных параметров. Версии и неизвестные JSON-поля отклоняются.

Это **selected-query execution**, не запуск всего AI-модуля, проведения, формы, `.cfe`, Vanessa или независимое утверждение бизнес-требования. Query compile происходит внутри `Запрос.Выполнить`; BSL harness предварительно скомпилирован в утверждённом image. Лабораторный contract остаётся `proposed`.

## Контейнерный профиль v1

Linux Docker с cgroups v2, доступными CPU/memory/swap/PID limits и встроенным seccomp. Runtime требует local `sha256:<image-id>` и `--pull=never`; image tags из задания не принимаются. Контейнер работает с UID/GID 10001, read-only root, `cap-drop=ALL`, no-new-privileges, private IPC/cgroup namespace и `network=none`. Нет host bind mounts, устройств, ports или Docker socket. Приватный signing key находится вне контейнера.

Лимиты: 1 CPU, 2 GiB RAM, без дополнительного swap, 256 PID, 768 MiB tmpfs `/work`, 256 MiB tmpfs `/tmp`, nofile 1024. Deadline задания — 120 с; cleanup имеет отдельные ограниченные вызовы. Независимый от controller `/usr/bin/timeout` ограничивает жизнь контейнера 180 с, `AutoRemove=true` удаляет его после выхода PID 1. Это страховка от потери controller, не durable job recovery. Новая база копируется из immutable image в собственный tmpfs; namespace и данные удаляются вместе с контейнером.

Перед запуском проверяются Docker inspect и фактические `memory.max`, `memory.swap.max`, `pids.max`, `cpu.max`, UID, seccomp, NoNewPrivs, CapEff, root mount и interfaces внутри контейнера. Недоступные ограничения дают отказ. Ошибка/отмена не переводят выполнение на host и не ослабляют профиль. Cleanup проверяет owner nonce и удаляет конкретный container ID; при сбое cleanup успешный receipt не выдаётся.

Ограничения Docker по умолчанию требуют явной настройки ресурсов; данный профиль задаёт и проверяет их. См. [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/). При `none` остаётся loopback; это дополнительно проверяется в kernel evidence. См. [Docker none network](https://docs.docker.com/engine/network/drivers/none/).

Контейнер разделяет kernel с host и доверяет Docker daemon. Это не VM isolation или независимый hostile-BSL security sign-off. Arbitrary BSL profile здесь отсутствует. Не публикуйте Docker-backed CLI как доступный всем MCP/HTTP tool: server-side capabilities, runner registration, leases/heartbeat/revocation и tenant isolation ещё требуют реализации.

## Подпись и область доверия

Ed25519 key ID — SHA-256 публичного SPKI DER. Payload подписывается по canonical JSON UTF-8; ключи поддерживаются встроенным [Node crypto](https://nodejs.org/api/crypto.html#cryptosignalgorithm-data-key-callback). Содержание текста использует SHA-256 UTF-16LE, совместимый с EditorSnapshot; file hashes считаются по байтам.

Receipt связывает job ID/nonce, request/profile/policy hashes, полный candidate identity, выбор/query hash, contract/expected hashes, engine output, measured isolation и timestamps. Profile hash включает runner/key/project, immutable image, fixture/schema, platform и binary hashes. Публичный ключ из самого receipt не принимается. Подмена результата, чужой project/profile/challenge и неизвестные claims отклоняются.

Подпись устанавливает авторство/целостность утверждения закреплённого runner. Она предполагает доверие к оператору, daemon, выбранному image и защите private key; это не аппаратная attestation и не доказательство честности владельца ключа. Caller должен передавать свой trusted current challenge/profile/key, а не брать их из непроверенного пакета. Серверный реестр отзыва и авторизованный approval пока отсутствуют.

TTL результата — 5 минут. При истечении signature может оставаться математически верной, но оценка становится `stale`, `queryExecutionVerified=false`. Future timestamps и выполнение вне lease отклоняются. Исторический evidence нужно оценивать как исторический; для актуального применения необходимы новый запуск и host revalidation.

Даже при совпадении ожидаемых строк:

```json
{
  "queryExecutionVerified": true,
  "scope": "selected_query_only",
  "sourceFreshness": "must_be_revalidated_by_host",
  "fullBslExecution": "not_run",
  "executionVerified": false,
  "approvalVerified": false,
  "canApply": false
}
```

Успешное исполнение запроса отдельно от `comparison.status`: запрос с неправильной бизнес-логикой может выполниться и дать `different`. Существующий provided-data importer расширения сохраняет прежние false flags; signed receipt import доступен отдельным [native workflow](SIGNED_RUNNER_IMPORT.md) с host challenge и локальным pin.

## Operator CLI

```bash
npm run build:runner
node dist/runner-cli.js init-key --directory /absolute/private/new-runner-key-directory
```

Каталог должен быть новым. Private key записывается с mode 0600, каталог — 0700. Храните ключ вне workspace, Git, image и облачных artifacts. Runtime читает только небольшой regular key file текущего владельца с закрытыми правами. В stdout выводятся только public key ID и пути, не PEM private key.

Оператор отдельно подготавливает profile JSON. Точные поля — [queryJob.ts](../src/entities/runner/model/queryJob.ts). Profile и ключ не выбираются из model/Webview request. Поля request:

```text
schemaVersion: 1
operation: "run_query_fragment"
candidate: QueryCandidateIdentity v1
candidateCode: исходный текст, соответствующий candidateHash
selection: {start, end, format: "query_text" | "bsl_string_literal"}
contract: proposed BusinessContract v1
profileId: идентификатор закреплённого профиля
```

`candidate.scopeHash`, `contract.projectId` и operator profile project должны совпасть. Также сверяются contract metadata/profile/platform. Profile source — отдельная доверенная конфигурация оператора. В CLI source identity предоставлена caller: текущий editor state он самостоятельно не читает.

```bash
node dist/runner-cli.js run \
  --request /absolute/request.json \
  --profile /absolute/operator-profile.json \
  --private-key /absolute/private/private.pem \
  --output /absolute/new-result-directory

node dist/runner-cli.js verify \
  --request /absolute/request.json \
  --profile /absolute/operator-profile.json \
  --challenge /absolute/result/challenge.json \
  --receipt /absolute/result/receipt.json \
  --public-key /absolute/pinned/public.pem
```

`run` создаёт новый directory, challenge/receipt/assessment с закрытыми правами. Повторная запись прежнего output запрещена. Operator/request/cleanup failure даёт `failure.json`, если output уже создан. Отмена SIGINT/SIGTERM вызывает cleanup. Реальное platform failure сохраняет signed failed observation; оно не превращается в successful query check.

Exit codes: `0` — актуальный подписанный query result совпал с proposed expectation; `2` — выполненное сравнение дало расхождение, engine failed/unsupported или evidence stale; `1` — неверные входы/подпись, сбой Docker/cleanup/оператора. `ok=true` означает завершённую обработку CLI, а outcome находится в status/flags/comparison и exit code.

## Собственная учебная квалификация

Test-only образ готовится из явно выбранной установленной учебной платформы. Код fixture/подготовки находится в `tests/runner_fixture`; runtime `src/` не импортирует эти данные и не создаёт конфигурацию 1С из примеров автоматически. Binary 1С не включён в VSIX/npm/source artifacts и image не публиковался. Лицензированная эксплуатация на данных компаний — отдельный профиль и решение.

```bash
python3 tests/runner_fixture/prepare_image.py \
  --seed sha256:YOUR_APPROVED_LOCAL_IMAGE_ID \
  --key-id YOUR_PUBLIC_KEY_ID \
  --output /absolute/new-own-fixture-build

node tests/runner_fixture/run_smoke.js \
  /absolute/build/profile.json \
  /absolute/private/key-directory \
  /absolute/new-smoke-directory
```

Это подготовка исключительно новой собственной fixture: без пути к пользовательской базе. В исходном image должны быть официальная учебная 8.3.27.1508, locale ru_RU.UTF-8, Python, Xvfb и нужные зависимости. Build/preparation и runtime — отдельные среды. Специфичные paths/binary hash ограничивают этот лабораторный profile; они не являются универсальной поддержкой 1С.

Текущая fixture: товар A / склад W1, остаток 10, две сохранённые строки по 6; параметры `Ссылка` и `Дата` фиксирует trusted harness. Поддержаны scalar string/number/boolean/NULL/Undefined результаты, до 2000 строк / 64 колонок. Reference/date и другие сложные значения требуют отдельного engine adapter; они не выдаются как пройденные.

Контролируемая регрессия:

```bash
npm run test:runner
```

Отдельный `tests/runner_fixture/watchdog_smoke.js <profile.json> <new-output.json>` проверяет timeout/AutoRemove primitive с сокращённым до 2 с сроком; production lifetime 180 с также сверяется inspect в обычных engine runs.

11 групп используют controlled Docker transport и настоящий crypto/CLI. Engine integration запускается отдельно; она проверяет correct / controlled defect / schema error / typed NULL, fresh DB/container per case, подписи и cleanup. После UI-timeout сохраняйте диагностику перед удалением среды; см. [инциденты I-10–I-12](DEVELOPMENT_INCIDENTS.md).

Фактическая квалификация и исходные отказы: [QUERY_RUNNER_REPORT_2026-10-29.md](../tests/QUERY_RUNNER_REPORT_2026-10-29.md).

## Импорт в IDE

Реализован отдельный [signed import workflow](SIGNED_RUNNER_IMPORT.md): `export-connection`, host-issued `prepared_query_job`, `run-prepared` и минимальный `result.json`. Native-меню preview проверяет результат по отдельно закреплённому public profile/key. Это не автоматический запуск из расширения и не корпоративное разрешение apply.
