# Подписанный selected-query результат в IDE — 2026-10-30

Реализована цепочка: native preview → локальный публичный pin оператора → host-issued challenge → внешний `run-prepared` → signed result import → native virtual report с актуальностью source/context/profile/expiry. Это проверка выбранного query fragment, не полный BSL, утверждение бизнес-требования или корпоративное разрешение apply.

Источник: `/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot`, `main`, HEAD `f98713a64c8c44a098497d222925ddd4d24215bb`, dirty до и после. Изменения не закоммичены, не опубликованы и не включены в старый VSIX. Применены проектные skills `onec-behavior-verification` и `copilot-runtime-verification`. Независимый agent/domain/security review не проводился.

## Реализованное поведение

- Одна кнопка **Проверить результат / Validate result** вместо двух конкурирующих действий comparison. Native-меню сохраняет сравнение переданных строк с прежними false execution flags и добавляет отдельный signed workflow.
- Настройка профиля доступна до AI/API key через настройки и Command Palette. Экспорт actual project descriptor позволяет оператору создать корректный scope; публичный connection-файл требует подтверждения native-диалога с полным fingerprint. Private PEM и произвольные trust fields отвергаются.
- Pin — в extension-owned globalState по project scope, с новой revision при reconnect. Отзыв, смена, ошибочная запись storage, другой scope, новый host job и eviction отказывают в доверии. Это локальная политика пользователя, не корпоративный registry.
- IDE сама берёт sealed native candidate artifact, создаёт request/nonce/lease и сохраняет pending capability в памяти. Результат не выбирает свой expected request/challenge/key/profile. После reload/в другом окне нужен новый host job.
- Operator CLI `export-connection` и `run-prepared` сохраняют прежнюю изоляцию, проверяют host binding/deadline до запуска и экспортируют минимальный `result.json`. В расширении нет Docker execution, private signing key или запуска окружающего BSL.
- Импорт проверяет подпись, candidate/source/context/contract/profile/policy bindings и актуальность. Повтор того же receipt допустим; другой signed результат того же задания не заменяет уже принятый.
- Native read-only report обновляет статус при изменениях source/context, pin/revoke, supersede и expiry. Случайный programmatic edit восстанавливается из проверенного evidence; обычный ввод запрещён. Произвольное вредоносное расширение с доступом к host не изолируется этим provider.
- RU/EN сохранены. User-controlled значения выводятся внутри экранированного JSON; Markdown/command links из requirement не исполняются. Отчёт не изменяет исходник и не запускает apply.

## Фактически выполненные проверки

| Проверка | Результат | Граница |
|---|---|---|
| Полный `npm test` | exit 0 | Включая inline, host, Sidecar, verification, runner suites |
| `pnpm build` / `pnpm lint` | exit 0 / exit 0 | Source bundles; без упаковки VSIX |
| Signed import Core | 15 групп | Real crypto/operator CLI, controlled observation |
| Native adapter host | 7 групп | Controlled VS Code boundary; pin confirmation/cancel/stale, busy, import, dynamic report, revoke, restoration/no-loop |
| Webview | 182 layout cases + bridge/error/context checks | Browser fixture; новая кнопка/настройка и stale guard |
| RU/EN Webview | 364 layout cases и integrity | Browser fixture; исходный код/черновики не переводятся |
| VS Code 1.141.0 | 8/8 | Actual development extension host, native unsaved editor, file API, actual Memento companion test extension, virtual docs и реальная 1С |
| Cursor 1.105.1 | 8/8 | То же, отдельные чистые test profiles/workspaces |
| Engine controls после worker patch | 4/4 | Реальный Docker/учебная 1С; отдельная база/контейнер на case |

AI key/complete, выбор файлов и ответ на pin confirmation в native automation контролируемые. Реальных gateway/inference-вызовов не было. Actual Memento принадлежит companion test extension в отдельном профиле; production namespace не менялся. Native `type` проверяет read-only UX, API edit — восстановление из evidence. Source-module тесты и активация development bundle не равны проверке нового установленного VSIX. IDE test launcher использовал явное `--no-sandbox`; Docker runner сохранил свою отдельную фиксированную security policy.

Четыре engine controls: aggregate 6+6 при остатке 10 → A/2 (`equal`); контролируемый построчный дефект → `different`, хотя запрос выполнился; неизвестная схема → failed observation и `queryExecutionVerified: false`; typed NULL → `equal` с сохранённым типом null. Tampered receipt отвергнут. Подписанное исполнение и бизнес-совпадение имеют разные флаги. В обоих IDE дополнительно реально выполнен положительный запрос: всего шесть успешных сценариев обработки заданий на обновлённом image, включая отрицательные business/schema outcomes.

Профиль: учебная Linux 1С **8.3.27.1508**, binary SHA-256 `0a53bd62447130c145d3caba50fe35b14f7b3f33ab04a5ce85ef75fe26753b39`. Новый local image `sha256:d104cbc4d58a7e4fd979aaee0dc56ec37d232c082f5ade36a54067db79f1daec`. Фактически измерены UID 10001, RAM 2 GiB, swap 0, CPU 1, pids 256, seccomp 2, noNewPrivileges, нулевые capabilities, read-only root и network только `lo`. Все контейнеры соответствующих nonce удалены. Signing key остался вне repo/image/evidence.

## Сбои, которые не скрыты финальным PASS

- Attempt a: 2/8; controlled candidate не содержал `Новый Запрос`, поэтому существующий BSL validator корректно отказал. Исправлен вход native теста, validator не ослаблялся.
- Attempt b: 3/8; actual runner отказал из-за зависшего завершения Xvfb. Успешный receipt не принят. Исправлен bounded shutdown trusted fixture worker и сохранение failed-stage diagnostics.
- Attempt c: incomplete; IDE запущена раньше завершения отдельного image commit/записи profile. Добавлен file preflight; зависимая подготовка дождалась exit 0.
- Attempt d: 7/8; real query/import/source/revoke уже работали, но API edit не был безусловно запрещён. Исправлена достоверность отображения provider и уточнён native тест.
- Final e: 8/8 в каждом IDE. Повторены положительные и отрицательные engine controls на новом exact image.

Старый image/base/config и исторические evidence не переписывались. Worker-only update проверяет исходный fixture hash, меняет только trusted worker и пересчитывает новый hash. Подробности: [инциденты I-13–I-16](../docs/DEVELOPMENT_INCIDENTS.md).

## Сохранность и воспроизведение

[Evidence](evidence/signed-runner-import-2026-10-30/) содержит complete results, prepared jobs, публичные scoped profiles/key, signed receipts, current/stale/revoked snapshots, отрицательные controls, логи прошлых отказов и SHA-256 manifest. При проверке старых receipt verifier получает исторический `finishedAt`; это аудит подписи/привязки на тот момент, не заявление о текущей свежести. Экспортированные отчёты статичны и после expiry/изменений не становятся живыми отчётами.

Checkpoint после возобновления этой стадии подтвердил неизменность **99 прежних evidence/package файлов**. Начальный временный backup прошлой сессии исчез, поэтому этот checkpoint не подтверждает заново весь более ранний source diff. Точечные изменения продолжили существующую dirty работу; Git операции сброса/переключения/коммита не выполнялись. VSIX 1.0.8 сохранён с SHA-256 `d8542c08a188f03e800f8dca4a7772d8eaad9d85694c2d17401d23d8c10a79db`.

Повторение: [инструкция](../docs/SIGNED_RUNNER_IMPORT.md). Новый output обязателен. Current lab profile/key location указан в codex.md; сначала проверить existence/permissions/exact image. Наличие public key в evidence не позволяет восстановить private key. 1С не переустанавливалась, образы не публиковались, production базы и credentials не использовались.

## Практический verdict

**Ограниченный операторский workflow работоспособен.** Он закрывает разрыв между «передали строки» и «конкретный query выполнил закреплённый оператор», сохраняя связь с исходником. Для разработчика/оператора это применимый шаг; для массового B2C onboarding пока нужен удобный выбор диапазона и редактор контракта вместо ручного JSON.

P2-12/P3-05/P3-07/P3-09 остаются `in_progress`; G1/G2/G3 не объявляются пройденными. Не подтверждены live NormaHub/качество AI, packaged release, корпоративные tenant registry/revocation/capabilities/budgets/approval, независимое утверждение контрактов, полное dependency tracking, hostile-code isolation beyond selected-query, ERP/БСП/РЛС, проведение/формы/полный BSL, Windows/RDP/remote. Следующий технический шаг — backend control plane runner identity/job authorization с tenant isolation и отзывом; практический UI контрактов следует отдельной domain приёмке.
