# Editor snapshot, AI task и безопасное применение черновика

Дата: 2026-10-29, Europe/Moscow. Репозиторий `/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot`, branch `main`, HEAD `f98713a64c8c44a098497d222925ddd4d24215bb`, dirty. Исходный dirty diff сохранён; коммита, публикации и нового VSIX нет.

## Практический результат

AI query/explain/BDD теперь получают захваченный host-контекст, initial LocalTaskSpec и идентификатор кандидата. Нельзя незаметно переключить источник/модель во время ожидания ключа или метаданных. Подготовительный stale/cancel останавливает запрос; поздний ответ остаётся доступен как непроверенный черновик. Применение связано с полным несохранённым исходным буфером, проектом и историей вкладок. Явно вставленный snippet не отправляет случайные метаданные активного проекта.

Однофайловый ChangeSet фиксирует base snapshot, UTF-16 диапазон, candidate hash и optional task ID. Native apply повторяет проверки на границах await и edit callback, сохраняет Undo и одноразовость. Устаревший query result сразу блокирует кнопку вставки с RU/EN предупреждением; copy/open остаются доступны. Позднейшие изменения также проверяются самим host при apply.

Domain-модели вынесены в entities/shared без `vscode`; native adapters находятся в entity API, orchestration — в features. Публичная поверхность по-прежнему выдаёт `executionVerified=false`. Форматы, hashes и ограничения: [EDITOR_SNAPSHOT.md](../docs/EDITOR_SNAPSHOT.md).

## Проверки

| Проверка | Фактический результат | Граница доказательства |
|---|---|---|
| `npm test` | Pass, включая новые 16 групп snapshot/task/apply, старые host/transport/inline/Sidecar и 11 verification групп | Контролируемые API/транспорт; не live inference |
| `pnpm build`, `pnpm lint` | Pass | Сборка extension/MCP/toolbox/verification и TS/Ruff |
| Ruff launcher и `.codex/scripts/` | Pass | Статическая проверка Python |
| Webview regression | Pass, 182 layout cases, keyboard/error/bridge/contrast и stale open/copy/apply | Настоящий rendered provider HTML в Chromium, контролируемый bridge |
| RU/EN Webview | Pass, 364 layout cases и английское stale предупреждение, copy integrity | Browser fixture, не native Webview end-to-end |
| Настоящий VS Code 1.141.0 | 9/9, exit 0 | Новый development profile, native API, source modules, controlled key/complete |
| Настоящий Cursor 1.105.1 | 9/9, exit 0 | Отдельный development profile/workspace, те же ограничения |

В двух IDE проверены activation development bundle, несохранённый UTF-16/CRLF replacement и Undo/once-only, edit после capture, изоляция двух корней при смене фокуса, поздний ответ, настоящее событие сохранения metadata watcher, закрытие последней вкладки и reopening, detached snippet и отказ serialized context до чтения ключа. `out/` модули сценария импортированы в реальный extension host; это отдельно от факта activation bundle и не packaged VSIX qualification. Chromium sandbox в обоих native запусках включён. Workspace Trust отключён только в этих новых тестовых профилях; trust отказы проверены controlled host suite.

Обе IDE сохранили живой тот же `TextDocument` после close/reopen последней вкладки. Поэтому проверка `isClosed`/version сама по себе недостаточна; новый монотонный lifecycle epoch отклоняет такой устаревший контекст.

Первые две native попытки не засчитаны: ожидание CLI было исправлено на completion sentinel/`--wait`, metadata fixture — на реальный объект; затем устранено загрязнение общего workspace между IDE. Финальная квалификация использует отдельные fixture workspace. Исходные outcomes сохранены в [native-attempts.json](evidence/editor-snapshot-2026-10-29/native-attempts.json). При добавлении browser сценария исправлены ошибка quoting в тесте и восстановление тестового editor context перед существующим BSP assertion; финальные suite завершились с exit 0.

## Сохранность и evidence

Backup исходных затронутых файлов: `/tmp/1c-editor-snapshot-2026-10-29-om3mixli/`. По pre-turn manifest из 83 файлов не удалён ни один; изменились только шесть ожидаемых существующих source-модулей и `dist/extension.js`. Добавлены отдельные новые модули; package.json дополнен test scripts, settings/models/commands не менялись. Существующие suites адаптированы к native trust/text geometry контракту и дополнены stale UI assertions. Backlog/матрица/точка продолжения обновлены.

Исторические foundation evidence, Sidecar, inline исходники и прежние MCP/toolbox/verification bundles не переписывались. Старый VSIX 1.0.8 сохранён: SHA-256 `d8542c08a188f03e800f8dca4a7772d8eaad9d85694c2d17401d23d8c10a79db`. Он не содержит этого нового среза.

Постоянные результаты: [manifest](evidence/editor-snapshot-2026-10-29/manifest.json), [native summary](evidence/editor-snapshot-2026-10-29/native-summary.json), [VS Code](evidence/editor-snapshot-2026-10-29/vscode-results.json), [Cursor](evidence/editor-snapshot-2026-10-29/cursor-results.json), [полный test log](evidence/editor-snapshot-2026-10-29/full-test.txt), [browser](evidence/editor-snapshot-2026-10-29/webview-test.txt), [RU/EN](evidence/editor-snapshot-2026-10-29/language-test.txt). Содержимое fixture синтетическое, реальные ключи не использованы и не сохранены.

## Открытые границы и продолжение

P1-01/P1-02/P1-03 начаты; P1-13/P2-12/D1-05 продолжаются. Полный G1 не закрыт. LocalTaskSpec ещё не имеет корпоративных policy/budget/state-transition контрактов, а однофайловый ChangeSet — native diff/multi-file recovery. Metadata epoch отражает наблюдённые события, не атомарную ревизию всей конфигурации; scope hash не является серверным разрешением. Не квалифицированы большие workspace и новый live p95.

Следующий срез: связать задачу/кандидат с BusinessContract и validation job, определить ограниченный runner profile и проверяемый execution receipt. Нельзя повышать caller-supplied report до доверенного результата или approval. Live NormaHub, финальный packaged VSIX, Windows/RDP/remote и независимый security/domain review остаются отдельными проверками. 1С в этом срезе не запускалась; предыдущий engine smoke остаётся историческим. Весь B2B-план и «100% production» не подтверждены.
