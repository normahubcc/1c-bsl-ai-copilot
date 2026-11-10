# Привязка BusinessContract к AI-кандидату и сравнение предоставленных данных

Дата: 2026-10-29, Europe/Moscow. Source: `/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot`, branch `main`, HEAD `f98713a64c8c44a098497d222925ddd4d24215bb`, dirty. Новый коммит/VSIX/публикация не создавались.

## Что теперь доступно

Preview AI-запроса с исходным BSL-модулем имеет действия **«Задание сравнения» / «Сравнить данные»**, также на английском. Host выдаёт descriptor task/scope/snapshot/context/candidate; импортирует один локальный пакет с proposed BusinessContract и typed actual rows; сверяет идентичность и текущий source guard; сравнивает значения и открывает native RU/EN Markdown-отчёт.

Core различает `equal`, `different`, `schema_mismatch`; сохраняет typed NULL/decimal/multiplicity/order semantics существующего comparator. Локальный job имеет terminal states, не запускается повторно; конкурентный import одного preview отклоняется. Изменение source/context, потеря trust и eviction preview отзывают его host lease. Во время file I/O свежесть/отмена проверяются повторно. Чтение порционное, не более 2 MiB; nonregular files, invalid UTF-8/JSON, неизвестные поля/версии и чужая identity отклоняются.

Local receipt связывает candidate, contract/input/results hashes и timestamps. Он имеет `scope=provided_data_only`, `engineStatus=not_run`, metadata/profile `not_verified`, execution/approval/apply flags `false`. Hash не является подписью. Code apply и AI gateway не вызываются этим workflow. Ожидание импортируется из proposed-контракта и не формируется из ответа кандидата самим comparator.

Использование/формат/границы: [QUERY_COMPARISON_WORKFLOW.md](../docs/QUERY_COMPARISON_WORKFLOW.md). Подробные инциденты и профилактика повторных затрат: [DEVELOPMENT_INCIDENTS.md](../docs/DEVELOPMENT_INCIDENTS.md).

## Фактически выполненные проверки

| Проверка | Результат | Ограничение |
|---|---|---|
| `npm test` | Exit 0; новые 13 meaningful groups, прежние 16 snapshot groups, 11 verification groups, host/transport/inline/Sidecar | Контролируемые native/AI boundaries |
| `pnpm build` | Exit 0, все четыре runtime bundles | Новый extension bundle, без VSIX packaging |
| `pnpm lint` | Exit 0 | TypeScript и Sidecar Ruff |
| Ruff launcher / Codex scripts | Pass | Статическая Python проверка |
| Rendered Webview | Pass, 182 layout cases, новый export/import bridge, visibility/stale blocking | Browser fixture; native chooser не вызывается браузером |
| RU/EN | Pass, 364 layout cases, новые EN labels и сохранность кода | Browser fixture |
| VS Code 1.141.0 | 7/7, exit 0 | Native API/files/report editor; source modules; chooser и inference контролируемые |
| Cursor 1.105.1 | 7/7, exit 0 | То же, отдельный новый workspace/profile |

Native checks: activation выбранного development bundle; реальный export descriptor; чтение настоящего локального пакета и отчёт с missingRows=1; равные данные с сохранёнными false flags; отказ чужому task ID; отмена выбора без отчёта; настоящее изменение исходника во время chooser callback с отказом до сравнения. Во всех сценариях source modules импортированы в actual extension host; это отдельно от activation bundle. Продуктовый Webview→native chooser end-to-end и installed VSIX не квалифицированы. Chromium sandbox включён; Workspace Trust отключён только в новых тестовых профилях. Реальные credentials не использовались.

Первая компиляция дала TS2367 в state guard; причина и исправление записаны в I-08 incident log. После исправления compile, 13 групп и полная регрессия прошли. Native и browser suites в этом срезе завершились с первой попытки, без изменения ожидаемых outcomes.

Постоянные результаты: [manifest](evidence/query-comparison-2026-10-29/manifest.json), [полный test log](evidence/query-comparison-2026-10-29/full.txt), [build](evidence/query-comparison-2026-10-29/build.txt), [lint](evidence/query-comparison-2026-10-29/lint.txt), [native summary](evidence/query-comparison-2026-10-29/native-summary.json), [VS Code checks](evidence/query-comparison-2026-10-29/vscode-results.json), [Cursor checks](evidence/query-comparison-2026-10-29/cursor-results.json), [пример native EN отчёта](evidence/query-comparison-2026-10-29/vscode-difference-report.md), [browser](evidence/query-comparison-2026-10-29/webview.txt), [RU/EN](evidence/query-comparison-2026-10-29/language.txt).

## Сохранность

Backup начала среза: `/tmp/1c-validation-job-2026-10-29-mvx_tifp/`. Существующие runtime source изменены только в `previewStore.ts`, `sidebarProvider.ts`, `feedback.en.ts`; пересобран `dist/extension.js`. Остальные проверенные существующие source/Sidecar и прежние bundles/evidence сохранены. Новая логика идёт в entities/features/shared/app adapter; в provider добавлена только маршрутизация и UI действий.

В package.json дополнены test scripts; settings/model routes/commands не менялись. Launcher получил выбор suite; browser suites дополнены assertions. Планы, acceptance evidence, `codex.md` и incident log обновлены. Статусы work packages не повышены до complete. VSIX 1.0.8 сохранён с SHA-256 `d8542c08a188f03e800f8dca4a7772d8eaad9d85694c2d17401d23d8c10a79db`; он не содержит новую функцию.

## Следующий шаг

Определить и реализовать доверенную runner identity/profile/receipt и ограниченную execution-среду для кандидата, затем связать её с job/policy/apply. Текущий receipt нельзя принимать как подтверждённое исполнение или корпоративный approval. Нет нового запуска 1С, live NormaHub, hardened runner, полного task state machine, серверной tenant/policy/budget защиты, Windows/RDP/remote qualification или независимого agent/security/domain review. G1/G2/D-G1 и весь B2B-план остаются открытыми.
