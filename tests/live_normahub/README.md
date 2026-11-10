# Явный live-прогон NormaHub / DeepSeek V4.1 Flash 1017

Оплачиваемый developer test, **не входит в `npm test`**. Отправляет только собственный corpus, использует реальный HTTPS transport продукта и source modules в отдельном настоящем VS Code profile. Это не новый packaged VSIX qualification и не production ERP test.

## Предварительные условия

- Проверить Git source identity, project AGENTS/codex и DEVELOPMENT_INCIDENTS; сохранить dirty scope.
- `pnpm compile`, `pnpm build`, `pnpm lint` закончены до запуска IDE. Не менять `out/` или bundles во время suite.
- Установлены VS Code и Docker/cgroups v2; approved own fixture image и external signing profile/key доступны по пути текущего codex.md. Runner не принимает пользовательскую/production базу.
- Пользователь разрешил real inference данным ключом. Единственная модель — `deepseek-v4.1-flash-1017`; родительский процесс не передаёт API key в env/argv/files/SecretStorage.

## Запуск

```bash
trap 'stty echo' EXIT
stty -echo
node tests/live_normahub/run.cjs /absolute/new-evidence-directory
stty echo
```

После сообщения `Waiting for credential` ввести ключ и Enter с выключенным echo. Не добавлять ключ в команду, shell history, файл corpus или stdout. Запуск создаёт отдельный private Unix socket; ключ передаётся один раз в память extension-host test. Socket directory — mode 0700, socket — 0600. Не использовать опубликованный/shared output path.

Для автоматизированного запуска допустим только отдельный ротированный тестовый ключ в `.private/normahub-live-key` с правами 0600 (сам каталог — 0700). При создании через терминал вводите значение без echo и не вставляйте его в командную строку. После проверки прав передайте файл на stdin через перенаправление: `node tests/live_normahub/run.cjs .private/new-live-run '' 'q04,e03,i01' < .private/normahub-live-key`. Значение не попадает в argv, env, shell history и evidence; harness не записывает его в собственные файлы. Каталог результата каждый раз должен быть новым.

`run.cjs` фиксирует corpus/hash до запроса ключа. 20 query tasks, 5 explanation tasks, 5 inline tasks. Scope query: собственные A/W1 строки 6+6 и остаток 10, typed/null/duplicate/date/order controls. Все expectations заданы заранее в corpus, не генерируются моделью и не копируются из actual результата. Независимой внешней domain approval у corpus нет.

`runAiTask` и inline provider читают ключ через in-memory secret port; completion transport не подменяется. HTTPS observer сохраняет только request body собственных fixtures, response content/usage/ID/model/finish reason; Authorization не записывается. Не сохраняет reasoning_content. Код модели не выполняется как BSL на host: выбирается ровно один полный SELECT literal и передаётся внешнему ограниченному operator runner. Full BSL/approval/apply остаются false/not_run.

Inline: реальный provider получает реальный ответ gateway и нормализует его. Полученный item показывается через one-shot native presentation adapter и принимается native `inlineSuggest.commit`, без ручного editor insertion. Physical Tab binding и полный shipping-provider registration timing этой методикой не подтверждаются. Успешное принятие ещё не доказывает полезность или синтаксис всего BSL.

## Результаты

- `results.json`: все завершённые попытки, отдельные statuses/usage/latencies. `completed` означает завершение выбранного прогона, не успешность всех задач. Сверять `plannedCases`, `unrunCaseIds` и число HTTP calls.
- После трёх последовательных неудачных/отсутствующих запросов останавливается соответствующее семейство; `stop-reason.json` и незапущенные cases не считать PASS. Автоматических paid retries нет.
- `qNN-engine`: свежие signed observation/assessment либо failure. Query success и expected rows equal — разные состояния.
- Explanation/inline требуют явной semantic review. Автоматический success по HTTP 200 запрещён.
- `node tests/live_normahub/summarize.cjs /absolute/run`: descriptive latency/usage, nearest-rank p95 для малого N, catalogue-rate estimate без обещания соответствия invoice.

Записывать отдельно `requestedModel` и фактический `responseModel`. Каталог подтверждает доступность запрошенного ID, но не внутреннюю идентичность provider weights/route. Не переименовывать canonical response ID ради нужного marketing результата. Исторический receipt проверять на signed finishedAt; не выдавать его за текущую свежесть.

Изолированный IDE launcher использует явное `--no-sandbox`; Docker policy runner сохраняется отдельно. При отказе сначала сохранить evidence, определить продукт/шлюз/harness layer и только затем менять условия новым прогоном. Ключ/кастомные данные не нужны в bug report — достаточно public model ID, controls, request ID и собственного воспроизводимого prompt.

Для ограниченной серии передайте третьим аргументом `query`, `explain`, `inline` либо список через запятую. Четвёртым аргументом можно передать точные case ID через запятую, например `q04,e03,i01` (для всех семейств третий аргумент — пустая строка). Harness отклоняет неизвестные и повторные ID, а HTTPS observer ограничивает число вызовов числом выбранных случаев. Для canary из трёх случаев и оставшихся 27 нужны разные новые output directories. Corpus остаётся тем же frozen JSON; selected/unrun cases записываются отдельно. Перед вводом ключа launcher устанавливает VSIX версии из текущего `package.json` и записывает его SHA-256; установленный пакет даёт регистрацию языка и настроек. Live вызовы source modules не выдаются за packaged live qualification.

`acceptance.py` — offline replay saved suggestions с отдельным profile, CDP и Tab/commit. Запускать только на выделенном display: tool меняет focus собственного IDE window. Unexpected edits/no-change не являются положительным acceptance evidence.
