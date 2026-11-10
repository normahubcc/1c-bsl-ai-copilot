# Подписанная проверка запроса из IDE

Это начальный операторский workflow для выбранного текста запроса. Он связывает результат собственного изолированного runner с конкретным AI-черновиком и снимком редактора. Доступен в исходной сборке; ранее собранный VSIX 1.0.8 этим этапом не обновляется.

В версии-кандидате 1.0.9 доступен [native мастер диапазона и ожидаемых строк](EXTENSION_WORKFLOWS.md); ручной JSON-план ниже остаётся альтернативным операторским путём.

В preview запроса кнопка **Проверить результат / Validate result** открывает native-меню. Сравнение предоставленных данных по-прежнему доступно и не подтверждает запуск 1С. Подписанная проверка требует отдельного оператора и заранее квалифицированного профиля. Расширение не запускает Docker/произвольный BSL и не получает приватный ключ.

## Подключение проекта

1. Откройте сохранённый BSL-модуль нужного проекта. Выполните `1С Copilot: Профиль проверки запросов` из Command Palette либо **Профиль проверки 1С** в настройках панели. AI/API key для подключения не нужны.
2. Выберите **Экспортировать описание проекта для оператора**. Сохраните открытый JSON и передайте оператору: `projectId` — локальная область проекта, `projectUri` может содержать путь пользователя. Экспорт требует явного сохранения/передачи пользователем; в сеть автоматически не отправляется.
3. Оператор создаёт профиль по [QUERY_RUNNER.md](QUERY_RUNNER.md), указывая этот `projectId`, свой точный образ, schema/fixture/binary hashes. Нельзя просто объявить произвольную ERP тем же лабораторным профилем.
4. Оператор экспортирует **только публичные** connection data:

```bash
node dist/runner-cli.js export-connection \
  --profile /operator/approved-profile.json \
  --public-key /operator/keys/public.pem \
  --output /operator/new-public-connection.json
```

5. Выберите **Подключить профиль проверки 1С**, откройте публичный JSON. Сверьте полный SHA-256 отпечаток с оператором по независимому каналу и подтвердите native-диалог. Импорт файла сам по себе профиль не закрепляет. Private PEM, иной проект, неизвестные поля или несовпадающий fingerprint отвергаются.

Pin хранится в extension-owned `globalState` отдельно для каждого scope. Репозиторий, workspace settings и файл результата не выбирают доверенный ключ. **Отключить профиль проверки** отзывает локальное доверие и инвалидирует ожидающие задания/отчёты. Повторное подключение даже того же ключа создаёт новую revision. Это локальная политика пользователя; серверный tenant registry, корпоративные роли, аппаратная аттестация и межмашинный отзыв ещё не реализованы.

## Подготовка задания

Получите preview запроса и сохраните независимый предложенный контракт. Контракт не утверждается AI или подписью runner автоматически. Подготовьте локальный JSON:

```json
{
  "schemaVersion": 1,
  "operation": "query_validation_plan",
  "selection": { "start": 0, "end": 42, "format": "query_text" },
  "contract": "REPLACE_WITH_BUSINESS_CONTRACT_OBJECT"
}
```

Пример выше показывает структуру, не является исполнимым контрактом. `contract` заменяется объектом [BusinessContract](VERIFICATION_CORE.md); готовая собственная тестовая структура находится в `tests/helpers/runnerData.js`. Смещения — UTF-16 offsets **в тексте preview**, не в исходном редакторе. `query_text` принимает выделенный SELECT; для строки BSL используйте `bsl_string_literal` и диапазон всей строковой константы с кавычками. Остальной BSL не выполняется. Parameters задаются trusted fixture, не произвольными данными импорта.

Выберите **Подготовить задание для 1С**, откройте план. IDE сама добавит фактические candidate code/hash, snapshot/context/scope, job ID, nonce, profile/policy bindings и короткий lease. План не может подменить эти поля. Сохраните открытый `prepared_query_job` и передайте оператору. При изменении исходника, контекста или профиля подготовьте новое задание. Ручная подготовка остаётся альтернативой native-мастеру версии-кандидата 1.0.9. Native-мастер выбирает найденный полный запрос и собирает proposed ожидания через поля/CSV.

## Исполнение и импорт

```bash
node dist/runner-cli.js run-prepared \
  --job /operator/from-ide/prepared-job.json \
  --profile /operator/approved-profile.json \
  --private-key /operator/keys/private.pem \
  --output /operator/new-result-directory
```

CLI проверяет неизменность и срок host challenge до запуска, использует те же ограничения контейнера и cleanup, что обычный `run`. Новый `result.json` содержит только schema/operation/jobId/receipt. Передайте этот файл пользователю. Оператор не должен переносить приватный ключ в IDE, workspace, image или evidence.

В том же окне IDE выберите **Импортировать подписанный результат 1С**. Проверяются сохранённое host-задание, отдельно закреплённый профиль/ключ, подпись, nonce, все хеши, время и актуальность источника. Результат из другого окна/после reload не восстанавливает pending challenge — нужен новый запуск. Изменённый packet и повторный отличный receipt для одного задания отвергаются; тот же receipt допускает повторное чтение.

## Что означает отчёт

Открывается native виртуальный Markdown только для чтения. Он показывает запрос, предложенное требование, типизированные расхождения, identity/time/profile/isolation и отдельные статусы:

- `signatureVerified`: подпись совпала с локальным pin и host challenge.
- `queryExecutionVerified`: выбранный query успешно выполнен, evidence актуален и соответствует текущему source/context/pin.
- `fullBslExecution: not_run`; `executionVerified`, `approvalVerified`, `canApply`: **false**. Сравнение с proposed expectation не утверждает бизнес-требование и не разрешает применение кода.

При редактировании исходника, смене metadata/context, закрытии исходной вкладки, смене/отключении pin, новом задании и expiry уже открытый отчёт показывает потерю актуальности. Исторический отчёт остаётся читаемым. Сохранённая на диск/экспортированная копия — статический снимок; вне расширения она сама не обновляется. Максимум 16 pending jobs и 16 открываемых report records; вытеснение не восстанавливает доверие.

Текущий профиль `query_text_fixture_v1` исполняет SELECT на собственной учебной конфигурации. Проведение, полные модули, внешние эффекты, ERP/БСП/РЛС, формы, Windows/RDP, approved oracle и corporate policy требуют отдельных профилей и evidence. Настоящий AI/gateway и качество его ответов проверяются отдельно.

## Проверки

```bash
npm run test:signed-import
python3 tests/run_editor_snapshot_ide.py --suite signed-import \
  --output /absolute/new-native-evidence \
  --runner-profile /operator/own-fixture-profile.json \
  --runner-key-directory /operator/keys
```

Native suite использует отдельные IDE profiles, собственную новую fixture workspace, real editor/files/virtual documents и actual Memento companion test extension. AI transport и выбор/подтверждение native dialogs управляемые. Внешний operator CLI действительно исполняет 1С в заранее подготовленном pinned image. Это source-module интеграция и активация development bundle; packaged VSIX и ручной диалоговый smoke остаются отдельными проверками.
