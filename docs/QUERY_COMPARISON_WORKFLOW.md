# Сравнение данных для конкретного AI-запроса

Начальный IDE workflow P1-13/P2-12/D1-05. Пользователь сопоставляет независимо заданное ожидание с импортированными фактическими строками. Продукт проверяет привязку пакета к AI-кандидату и текущему исходному буферу. Запуск 1С, подлинность внешнего результата и утверждение требования этим workflow не устанавливаются.

## Действия в расширении

1. Сгенерировать AI-запрос из открытого BSL-модуля. В preview откройте **«Проверить результат»**. В native-меню доступны **«Экспортировать задание сравнения данных»** и **«Сравнить предоставленные данные»**. Локальный шаблон, объяснение, Gherkin и query без исходного BSL-модуля не получают этих действий.
2. **«Экспортировать задание сравнения данных»** открывает JSON descriptor в native editor. Его можно сохранить и передать своему тестовому процессу. Он содержит `candidate`, `responseOperation` и `contractProjectId`, без исходного кода, ключа и выдуманных ожиданий.
3. Подготовить JSON-пакет по схеме ниже. Ожидаемый результат задаётся независимо от проверяемого кандидата. `contract.projectId` должен точно совпасть с `contractProjectId` descriptor. Это локальный scope hash, не организация или серверное разрешение.
4. **«Сравнить предоставленные данные»** открывает native file chooser. Выбрать один локальный UTF-8 JSON-файл до 2 MiB. Он читается порциями с повторной проверкой свежести/cancellation; сеть, shell и код из пакета не вызываются.
5. Отчёт откроется отдельным Markdown-документом. Он различает совпадение строк, расхождения и несовпадение колонок, показывает counts, bounded sample, requirement/scope и hashes. Его можно сохранить штатным Save As. Пользовательские значения находятся в экранированных JSON-блоках.

После изменения source/context, close/reopen последней вкладки, потери Workspace Trust, применения или eviction preview нужно получить новый кандидат/descriptor. Смена фокуса на другой файл сама по себе исходный контекст не меняет. Повторное сравнение актуального кандидата создаёт новый локальный job; конкурентные нажатия для одного preview отклоняются.

Отмена file chooser не создаёт отчёт. Сравнение не изменяет код и не повышает статус preview до проверенного. Существующее явное ручное применение черновика сохраняет свои source guards; сравнение предоставленных данных не является approval gate или новым разрешением на apply.

## Формат пакета v1

Точные validators: [queryComparison.ts](../src/entities/validation/model/queryComparison.ts), [BusinessContract](../src/entities/business-contract/model/contract.ts), [typed results](VERIFICATION_CORE.md). Неизвестные поля/версии/операции, `approved` и заявления `executionVerified` из JSON отклоняются.

```text
{
  schemaVersion: 1,
  operation: "compare_provided_query_result",
  candidate: <точная копия candidate из descriptor>,
  contract: <BusinessContract v1, approvalState "proposed">,
  actual: <типизированный QueryResultSet>
}
```

Это описание структуры, не готовый JSON для импорта. В `candidate` обязательны `schemaVersion`, `taskId`, `scopeHash`, `snapshotHash`, `contextHash`, `candidateHash`, `textHashEncoding: "utf16le"`. Сверяются **все** поля с host-owned preview. Одинаковый текст другой задачи не позволяет подменить `taskId`.

BusinessContract v1 содержит `schemaVersion`, `id`, `version`, `projectId`, `intent`, `requirement: {reference, sha256}`, `scope: {metadataHash, profileId, platformVersion}`, `preconditions`, `assumptions`, `assertion: {kind: "query_rows_equal", mode: "multiset" | "ordered", expected}`, `approvalState: "proposed"`. Поля scope являются декларацией автора пакета: metadata/profile настоящего исполнения не проверены. Не подставляйте hash prompt вместо hash схемы и не выдавайте unknown profile за подтверждённый.

Пример typed expected/actual для самостоятельно выбранной тестовой задачи «6 + 6 при остатке 10 → дефицит 2»:

```json
{
  "columns": ["Товар", "Дефицит"],
  "rows": [[{"type":"string","value":"A"},{"type":"number","value":"2"}]]
}
```

Эти данные иллюстрируют формат; они не добавлены в runtime и не доказывают результат произвольного запроса. `actual` нужно получить своим тестовым процессом. Поддерживаемые типы, точные decimal strings, NULL/Undefined/reference, ordering и limits описаны в [VERIFICATION_CORE.md](VERIFICATION_CORE.md).

## Job и receipt

`QueryComparisonJob` исполняет только allowlisted provided-data comparison. Состояния: `created → comparing → completed | failed | cancelled | stale`. `completed` означает завершённое сравнение; его `comparison.status` отдельно равен `equal`, `different` или `schema_mismatch`. Terminal job повторно не запускается. I/O/отмена native orchestration происходят до выполнения синхронного ограниченного сравнения.

Receipt содержит локальный job ID, candidate identity, contract/input/result hashes, timestamps и `receiptHash` canonical JSON. Последний обеспечивает идентичность структуры, не подпись/подлинность автора. Native Markdown — представление и summary; полный immutable receipt возвращается Core API. Он не импортируется как доверенное подтверждение исполнения.

Всегда сохранены:

```json
{
  "scope": "provided_data_only",
  "engineStatus": "not_run",
  "metadataScopeStatus": "not_verified",
  "profileStatus": "not_verified",
  "executionVerified": false,
  "approvalVerified": false,
  "canApply": false
}
```

Это не authenticated runner receipt, corporate project mapping, approved oracle, validation-policy enforcement или полный task state machine. Старый standalone verification CLI сохраняет свои четыре операции; новый workflow вызывается из preview расширения.

## Проверки и продолжение

```bash
npm run test:comparison
pnpm compile
pnpm build
python3 tests/run_editor_snapshot_ide.py --suite comparison --output /tmp/new-comparison-evidence
```

Native probe использует реальные source modules в extension host, filesystem и report editors. Key/complete и выбор файла контролируемые; activation development bundle проверяется отдельно. Это не packaged VSIX, ручной platform dialog smoke или live NormaHub. Изменяемые workspace каждого IDE раздельные; output directory должен быть новым.

В следующем срезе добавлены локальный operator pin, signed receipt import и ограниченный selected-query runner. По-прежнему требуются серверная авторизация, корпоративный registry и независимая квалификация профилей. Произвольный BSL нельзя запускать на host под видом проверки; существующая учебная лаборатория не становится hardened runner автоматически. Текущий срез не закрывает G1/G2/D-G1. Результаты: [отчёт](../tests/QUERY_COMPARISON_REPORT_2026-10-29.md). Повторяющиеся затраты: [инциденты](DEVELOPMENT_INCIDENTS.md).

## Подписанное исполнение

Следующий source-срез добавляет [signed runner import](SIGNED_RUNNER_IMPORT.md). Он доступен из общего меню **Проверить результат** рядом с provided-data comparison. Предоставленные строки сохраняют прежние false execution/approval/apply flags. Подписанный runner receipt проверяется отдельным host challenge/pin и подтверждает только selected query, с динамической актуальностью native отчёта.
