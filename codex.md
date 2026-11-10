# Codex: рабочая карта проекта

Дата настройки: 2026-10-29. Проверенная локальная версия CLI: `0.164.0`. Автоматическая точка входа — [AGENTS.md](AGENTS.md); этот файл читается по его ссылке, а не вследствие специального имени `codex.md`.

## Источники и текущие границы

- [План AI/B2B](docs/AI_B2B_PRODUCT_TECHNICAL_PLAN.md), [backlog](docs/AI_B2B_BACKLOG.csv), [приёмка](docs/AI_B2B_ACCEPTANCE_MATRIX.csv).
- [Предметная спецификация проверки изменений](docs/AI_BUSINESS_VERIFICATION_SPEC.md).
- [MCP: настройка, диагностика, ограничения](docs/CODEX_MCP.md).
- [Инциденты разработки и предварительные проверки](docs/DEVELOPMENT_INCIDENTS.md): прочитать перед повторным запуском IDE/1С/browser harness и дополнять при значимом отказе.
- Историческая исходная точка: `main`, HEAD `f98713a64c8c44a098497d222925ddd4d24215bb`, dirty; кандидат 1.0.8. Перед новой задачей заново проверь Git и package.json, не принимай эти значения за текущие навсегда.
- Текущие MCP tools, локальные шаблоны и отдельный лабораторный корпус не реализуют будущие counterexample search, semantic diff и банк правил.
- Контракт/comparator/evidence Core и отдельный developer CLI: [VERIFICATION_CORE.md](docs/VERIFICATION_CORE.md). CLI сравнивает переданные данные, не аутентифицирует исполнение 1С.
- Текущий локальный срез: [PACKAGED_INLINE_RELEASE_REPORT_2026-11-02.md](tests/PACKAGED_INLINE_RELEASE_REPORT_2026-11-02.md). Установленный VSIX 1.0.11 в VS Code и Cursor: физический Tab 4/4, Escape 1/1 на сохранённых реальных ответах 1017 через контролируемый HTTPS, без исходного provider и без live API. При штатном debounce 250 мс пакет 1.0.10 делал один дополнительный запрос после Tab; 1.0.11 не делает, до следующей печати или явного вызова. Установленный smoke 4/4 в каждой IDE, full `npm test`, `pnpm build`, `pnpm lint`, release QA прошли. Пакет локальный, dirty/не закоммичен и не опубликован. [Бриф ограниченной беты](docs/CEO_BETA_RELEASE_BRIEF_2026-11-02.md). NO GO массового B2B релиза: live gateway p95/p99 и полный корпус, full BSL, корпоративные capability/tenant/approval не подтверждены.
- Предыдущий локальный срез: [PARAMETERS_NATIVE_ACCEPTANCE_REPORT_2026-11-02.md](tests/PARAMETERS_NATIVE_ACCEPTANCE_REPORT_2026-11-02.md). Runner v2 с typed параметрами, 7/7 собственных реальных SELECT, 6/6 native parameter workflow в каждой IDE. Установленный VSIX 1.0.10 прошёл отдельный packaged smoke; SHA пакета в отчёте. Учебная 1С работала на дату проверки, бессрочность лицензии не установлена. Предыдущие VSIX/evidence сохранены.
- Предыдущий live срез: [LIVE_NORMAHUB_1017_REPORT_2026-10-31.md](tests/LIVE_NORMAHUB_1017_REPORT_2026-10-31.md), [opt-in runbook](tests/live_normahub/README.md). 25 actual inference calls, 17 unique cases из frozen 30; 13 query cases not_run. Строго requested 1017, gateway response base alias; нет provider attestation. 2 query typed matches; truncation/timeouts и прежний fixture parameter limit. Новая native Tab проверка выше воспроизвела сохранённые raw ответы, но нового live inference не делала. Не печатать/сохранять пользовательский key и не запускать платный harness автоматически.
- Предыдущий локальный UX-срез: [EXTENSION_WORKFLOWS_REPORT_2026-10-30.md](tests/EXTENSION_WORKFLOWS_REPORT_2026-10-30.md), [инструкция](docs/EXTENSION_WORKFLOWS.md). Native proposed-contract/range/typed CSV wizard, captured-source diff и once-only apply/Undo. Source-module native 9/9 в каждом VS Code/Cursor с actual own 1С; отдельно installed VSIX 1.0.9 activation/handlers/navigation/catalogues/languages 4/4 в каждом IDE. Inference/dialogs controlled в source suite; installed smoke не исполняет AI. Новый VSIX не опубликован; старые пакеты сохранены. Следующий этап требует отдельной приёмки, не объявлять весь extension/B2B backlog выполненным.
- Предыдущий signed-import срез: [SIGNED_RUNNER_IMPORT_REPORT_2026-10-30.md](tests/SIGNED_RUNNER_IMPORT_REPORT_2026-10-30.md), [native workflow](docs/SIGNED_RUNNER_IMPORT.md). Menu preview → host-issued job → внешний `run-prepared` → signed import по локальному operator pin → динамический virtual report. 8/8 native checks в VS Code 1.141.0 и Cursor 1.105.1, real own-training 1С, controlled inference/dialogs. Это source-module интеграция, не packaged VSIX или live AI; selected query не повышается до full BSL/approval/apply.
- Текущая собственная лаборатория: `/home/user/.local/share/normahub-copilot-lab/signed-import-20261030/worker-v2/profile.json`; новый image `sha256:d104cbc4d58a7e4fd979aaee0dc56ec37d232c082f5ade36a54067db79f1daec`. Ключи — в соседнем `key/`, mode 0700/0600, вне repo/image; не выводить private PEM и не копировать в evidence. Старые временные profile/key в `/tmp` исчезли; исторический key не восстанавливать и не заменять. Worker-only patch сохраняет exact base/config и пересчитывает fixture hash. Перед повтором проверить файл/image/permissions; не пересобирать базу/пакет автоматически.
- Предыдущий provided-data IDE-срез: [query comparison report](tests/QUERY_COMPARISON_REPORT_2026-10-29.md), [workflow](docs/QUERY_COMPARISON_WORKFLOW.md). Import supplied rows сохраняет false execution/approval/apply flags. Следующий этап — backend runner registration/revocation/tenant/capabilities/budget/approval и практичный редактор proposed contract/range с независимым domain review. Локальный pin/подпись не заменяют enterprise trust. P3-05/P3-07/P3-09 и P2-12 остаются in_progress; корпоративные gates не пройдены.
- Предыдущий snapshot-срез и его границы: [отчёт](tests/EDITOR_SNAPSHOT_REPORT_2026-10-29.md), [EditorSnapshot API](docs/EDITOR_SNAPSHOT.md). P1-01/P1-02/P1-03 и P1-13/P2-12/D1-05 остаются in_progress. Начальный operator runner уже есть, но не заменяет corporate identity/approval; provided-data receipt нельзя повышать до execution/approval. Не запускать AI BSL на host. Лаборатория 1С остановлена; старые evidence исторические. Не повторять установку 1С или пересборку старого VSIX.
- NormaHub — текущий публичный AI route продукта. Корпоративные IAM/policies и private inference требуют отдельной реализации/проверки; настройки самого Codex не изменяют runtime расширения.

## Роли агентов

Codex загружает project-scoped роли из `.codex/agents/*.toml`. Модель и reasoning наследуются от родителя; этот проект не фиксирует платную модель или provider. Роли не переопределяют sandbox, approvals и серверы родителя.

| Роль | Когда нужна | Обязательный результат |
|---|---|---|
| `project_mapper` | Неясны entrypoint, handler и реальные зависимости | Карта вызовов с файлами; локальная/AI часть; дубли; неизвестное; без редактирования |
| `bsl_oracle` | Меняется смысл запросов/проведения/бизнес-тестов | Независимый контракт ожидаемого поведения, граничные случаи и профиль; без подгонки под кандидат |
| `extension_engineer` | Изменение Core/adapters/IDE lifecycle | Малый diff в назначенных файлах; сохранённые свойства; предметные проверки |
| `validation_engineer` | Требуются воспроизведение и проверка | Версии, команды, свежие артефакты, all outcomes; правки только назначенных tests |
| `security_reviewer` | Tenant, runner, IPC, export, credentials, budget | Конкретные пути обхода/отказа и проверки; review без редактирования |
| `product_evaluator` | Новый workflow или решение о выпуске | Пользователь, принятие результата, полное время/стоимость, onboarding и условия go/no-go |

Встроенные `explorer`/`worker` остаются применимы; не создавай отдельную роль ради каждого файла. В окружении без custom roles можно дать обычному доступному агенту те же инструкции явно. Если делегирование недоступно/не разрешено — выполни этапы последовательно и укажи отсутствие независимого agent review.

## Протокол делегирования

1. Главный агент фиксирует цель, ограничения, source identity и существующий dirty scope. Делегирование должно быть разрешено активными инструкциями; описание ролей не является универсальным разрешением их запускать.
2. Самостоятельная подзадача получает входы, точный scope, разрешённые файлы, запреты на внешние эффекты, критерии результата и доступные evidence. Не передавай лишние секреты/данные соседних проектов.
3. Одному файлу назначается один писатель. Исследование, domain oracle и review можно выполнять параллельно с реализацией; зависимые изменения и сборки общего output идут последовательно.
4. Не отправляй агенту, создающему независимый oracle, готовый ответ кандидата как норму. Передай требование, схему и утверждённые ограничения; результаты кандидата выдаются на этапе сравнения.
5. Агент возвращает findings с файлами/строками, фактические изменения, проверки и ограничения. Утверждение «готово» без артефактов не принимается.
6. Главный агент изучает diff и результаты, разрешает конфликты, запускает необходимые интеграционные проверки и составляет единый отчёт. Все агенты не должны независимо запускать полный benchmark или платные live-вызовы.

Шаблон задания:

```text
Цель и критерий приёмки:
Repository / HEAD / dirty scope:
Входные файлы и утверждённые требования:
Разрешённые изменения (либо read-only):
Разрешённые среды, команды и внешние действия:
Лимит времени/вызовов и условие остановки:
Выход: findings, diff, evidence, not_run/unknown:
```

«Read-only» в инструкции роли — правило поведения, не отдельная техническая граница. Для действительно недоверенного исполнения требуется изолированная среда; custom role не создаёт её автоматически.

## Skills и выбор инструментов

| Skill / инструмент | Использовать для | Не считать подтверждением |
|---|---|---|
| `onec-behavior-verification` | Запросы, бизнес-oracle, минимальные fixtures, эквивалентность и исполнение 1С | Любой произвольной ERP/форм/прав без своего корпуса |
| `copilot-runtime-verification` | Extension host, Webview bridge, inline lifecycle и release evidence | Положительного live AI или IDE-проверки по одному браузеру |
| `openai-docs` при наличии | Codex config, MCP/agents/skills и официальные OpenAI API | Документации NormaHub или права менять model route продукта |
| `skill-creator` / `skill-installer` при наличии | Действительное изменение/подключение нужного workflow | Доступности любого внешнего сервиса |
| Shell + `rg`, Git, проектные тесты | Локальные исходники, diff, сборка и существующий automation | Корпоративного isolation и реальной модели при fake transport |

Project skills находятся в `.agents/skills/` и не требуют глобальной установки. Если skill не загружен в конкретной поверхности Codex, прочитай соответствующий `SKILL.md` явно и не заявляй автоматическое обнаружение. Существующие image/site/pet/marketing skills не нужны для обычной разработки данного расширения.

## Выбор проверок

| Область | Минимальное предметное направление |
|---|---|
| Локальный toolbox/query/BDD/interceptors | `tests/product_core_test.js`, `tests/production_defects_test.js`, `tests/deep_recheck_test.js`; бизнес-смысл — отдельная 1С |
| Transport | `tests/ai_transport_test.js`; затем разрешённый live smoke с учётом стоимости |
| Inline | `tests/inline_completion_*`; positive Tab и p95 требуют настоящей IDE/модели |
| Host/preview/RU-EN | `tests/sidebar_host_test.js`, `tests/editor_snapshot_test.js`, `tests/ui_language_host_test.js`; browser suites по изменённому UI; native source-module запуск по [EDITOR_SNAPSHOT.md](docs/EDITOR_SNAPSHOT.md) |
| Sidecar | `python3 -m unittest discover -s sidecar/tests/ -v`, `tests/sidecar_health_test.js` |
| MCP/schema/package | Собрать bundle, initialize/list/call/error contract; `tests/release_qa.py` для подготовленного кандидата |
| Codex tooling/docs | `.codex/scripts/check_setup.py`, skill validator, нужные MCP smoke; `pnpm build` и `pnpm lint` |
| BusinessContract / typed comparison / evidence | `npm run test:verification`, `npm run test:comparison`; native comparison — по workflow; engine-интеграция только в новой собственной базе по отдельному runbook |
| Native plan/diff / installed candidate | `npm run test:extension-workflows`; `tests/run_editor_snapshot_ide.py --suite extension-ux` с approved own runner/key; `--suite packaged --vsix /absolute/candidate.vsix` для отдельного installed smoke. Не менять out/dist во время native source suite; packager отказывается перезаписывать существующий VSIX |
| Signed import / native report | `npm run test:signed-import`; отдельный actual IDE/own-engine launcher по [workflow](docs/SIGNED_RUNNER_IMPORT.md). Нужны существующие exact profile/image и external key directory; private key только у operator CLI |
| Query runner / signing / isolation | `npm run test:runner`; actual engine только отдельный `tests/runner_fixture/run_smoke.js` с approved profile/new output. Не повторять image build без изменения harness/fixture |

JS suites обычно требуют предварительного `pnpm compile` / `pnpm build`; смотри imports конкретного теста. Не запускай упаковку текущего VSIX без необходимости. Реальные IDE/1С-сценарии, включая профиль/лицензию и ограничения, описаны в исторических отчётах и [tests/onec_engine/README.md](tests/onec_engine/README.md); пути старого стенда сначала проверь.

## Состояние подключения

MCP и роли конфигурируются только для этого проекта в `.codex/config.toml`. Пользовательские модели, approvals и глобальные MCP не заменяются. Для загрузки нужно открыть Codex с рабочим каталогом репозитория или его подпапки и перезапустить/переподключить MCP при необходимости. Открытая задача с cwd `/home/user` не обязана подхватить настройки дочернего репозитория. Различай configured, discovered, initialized и успешно выполненный tool call; результат проверки записывается в [CODEX_SETUP_AUDIT.md](docs/CODEX_SETUP_AUDIT.md).
