# Первый срез Core: контракт, сравнение значений и актуальность evidence

Дата: 2026-10-29. Реализация начата по [плану](AI_B2B_PRODUCT_TECHNICAL_PLAN.md) и [предметной спецификации](AI_BUSINESS_VERIFICATION_SPEC.md). Это локальный фундамент P1-13/P2-12 и часть будущего comparator D1-05, а не завершённые gates G1/G2/D-G1.

## Что исполняется сейчас

- `parseBusinessContract`: строгий versioned JSON contract, requirement provenance, scope, preconditions/assumptions, единственный allowlisted assertion `query_rows_equal`. Принимается только `approvalState: proposed`; авторизованное утверждение ещё не подключено.
- `parseResultSet` / `compareQueryResults`: типизированные строки, сравнение в режиме multiset или ordered, точные десятичные строки, NULL/Undefined/пустая ссылка, UUID и локальная дата. Дубли учитываются по количеству; несовпадение колонок — `schema_mismatch`, без выдуманной статистики строк.
- `assessValidationEvidence`: сравнение binding проекта/snapshot/candidate/contract/fixture/profile/policy, срока и обязательных check IDs. Статусы `scope_mismatch`, `stale`, `invalid_time`, `failed`, `cancelled`, `incomplete`, `reported_pass` различаются.
- Canonical SHA-256 после строгой нормализации. Порядок ключей JSON не меняет digest, порядок массивов меняет. Hash обеспечивает идентичность содержимого, не подпись или доверие к автору.
- Самостоятельный JSON CLI без `vscode`, сети, модели, shell, чтения базы/редактора и выполнения кода из входа.

Сравнение даёт `equal` только для переданных значений. Поля `executionVerified=false`, `approvalVerified=false` сохраняются даже при равенстве. Оценка согласованного внешнего отчёта даёт `reported_pass` с `canApply=false`: этот CLI не проверяет существование артефактов и не аутентифицирует runner или корпоративные права.

## Запуск

```bash
npm run build:verification
node dist/verification-cli.js < /absolute/path/to/request.json
```

Один request/response на процесс, UTF-8, максимум 2 MiB. Некорректный request даёт JSON error и exit 1. Для программного вызова использовать `node` напрямую; npm/pnpm добавляют свои строки вывода. Это отдельный developer/CI CLI, пока не команда палитры и не распространяемая функция VSIX.

Пример сравнения предоставленных результатов, не обращения к 1С:

```json
{
  "schemaVersion": 1,
  "operation": "compare_results",
  "mode": "multiset",
  "expected": {
    "columns": ["Товар", "Дефицит"],
    "rows": [[{"type":"string","value":"A"},{"type":"number","value":"2"}]]
  },
  "actual": {"columns":["Товар","Дефицит"],"rows":[]}
}
```

Результат: `different`, `missingRows=1`, уменьшенный sample отличий. Бизнес-ожидание здесь задано человеком; CLI не выводит его из кода и не доказывает его правильность.

## Операции и формат

| operation | Дополнительные поля |
|---|---|
| `validate_contract` | `contract` |
| `compare_contract_result` | `contract`, `actual` |
| `compare_results` | `expected`, `actual`, `mode: multiset / ordered` |
| `assess_evidence` | `report`, `currentBinding`, `requiredChecks` |

Неизвестные поля и версии отклоняются. Формальная начальная схема и валидаторы находятся в [contract.ts](../src/entities/business-contract/model/contract.ts), [resultSet.ts](../src/entities/business-contract/model/resultSet.ts) и [evidence.ts](../src/entities/validation/model/evidence.ts). Существующая короткая иллюстрация BusinessContract в предметной спецификации — не сериализованный input этого CLI.

ResultSet: `columns: string[]`, `rows: QueryValue[][]`, одинаковая длина каждой строки. Колонки непустые, уникальные без учёта регистра; для сравнения порядок и имена колонок должны точно совпадать. Автоматическое переименование/перестановка колонок не выполняется.

QueryValue поддерживает `null`, `undefined`, `boolean`, `string`, `number`, `date`, `reference`, `empty_reference`. Для number требуется десятичная строка без exponent; ведущие/конечные нули нормализуются без округления, IEEE-754 не используется. Date — существующая календарная дата `YYYY-MM-DDTHH:mm:ss` без timezone; преобразование часовых поясов не выполняется. Reference требует квалифицированный metadata name и ненулевой UUID; empty_reference передаётся явно. Неизвестные сложные типы отклоняются.

Начальные resource limits: 64 колонки, 2000 строк на result set, 16384 символа в строковом значении, глубина JSON 24, до 200000 узлов, samples не более 20 отличий. Статистика учитывает все отличия даже при усечённом sample. Это лимиты локального протокола, не заявленные ограничения платформы 1С.

ValidationReport содержит `schemaVersion`, `binding`, UTC timestamps `startedAt/finishedAt/expiresAt` с миллисекундами и checks. Binding включает `projectId` и шесть lowercase SHA-256 из таблицы выше. Check имеет `id`, `level`, `status`, `evidence`; непройденному check нужен `reason`, завершённому `passed/failed` — artifact IDs/hashes. Требуемые checks задаются явно; failures не скрываются как «необязательные». Все это пока декларации caller, не авторизованные отчёты.

## Проверки и оставшаяся работа

`npm run test:verification`: 11 групп, включая реальные subprocess CLI cases, неверный UTF-8/размер/версии, попытку подделки approval, mutable inputs, getter/cycle/sparse-array hazards, дробную точность, NULL/дубли/ссылки, stale binding, expiry и непроведённые проверки.

EditorSnapshot и начальная привязка proposed-контракта к AI-кандидату теперь интегрированы в source-версию расширения: [QUERY_COMPARISON_WORKFLOW.md](QUERY_COMPARISON_WORKFLOW.md). Этот отдельный native workflow сравнивает импортированные строки и выдаёт локальный provided-data receipt; CLI по-прежнему не читает IDE. Следующие необходимые этапы: полноценный validation job/receipt от реального runner; server-side approval/tenant policy; test data factory/search/reduction и контролируемый apply. Шаблоны текущего toolbox и девять MCP tools не заменены и не расширены скрытой AI-логикой. Существующий VSIX не пересобран и не содержит этот CLI.

В учебной 1С 8.3.27.1508 дополнительно проверен один собственный сценарий: два входа по 6 и остаток 10. Истинный продуктовый генератор дал дефицит 2; контролируемая тестовая мутация без агрегирования ошибочно дала пустую таблицу. CLI распознал `equal` для верного результата и `different` для ошибочного. Это реальное engine-наблюдение узкого случая, не автоматический поиск и не качество AI. Артефакты и условия — в [отчёте](../tests/VERIFICATION_FOUNDATION_REPORT_2026-10-29.md).
