---
name: copilot-runtime-verification
description: Проверять изменения runtime этого расширения, inline lifecycle, host/Webview bridge, MCP transport и происхождение release evidence. Применять при таких изменениях или аудите кандидата; не запускать полный продуктовый benchmark для простой документации.
---

# Проверка runtime Copilot

Прочитай AGENTS.md, codex.md и только относящиеся к изменению существующие тесты/отчёты. Выбери минимальные проверки, разрешающие реальную неопределённость; обязательные `pnpm build` и `pnpm lint` остаются в силе.

## Границы проверок

| Уровень | Что доказывает | Что остаётся отдельно |
|---|---|---|
| Unit/controlled host | Контракты, lifecycle, error/cancel, выбранный editor target | Настоящий extension host и модель |
| Browser/Playwright fixture | DOM, RU/EN, keyboard/layout, управляемый Webview bridge | VS Code API, native insertion/Undo/Tab |
| Local MCP | initialize/list/call, DTO и локальная Core-логика | Реальный AI и исполнение 1С |
| Installed VSIX в IDE | Активация, команды и применение в конкретном editor profile | Модель, если transport подменён |
| Live AI | Настоящий разрешённый gateway route и outcomes | Бизнес-корректность без independent oracle/1С |

Не повышай уровень доказательства при переносе результата в README/план/отчёт.

## При изменении inline/apply

Проверь фактические cancellation/debounce/request identity и захваченный document target. Включи edit/close/reopen, закрытие последнего editor split, смену active editor, несохранённый buffer, stale response и once-only apply там, где изменение затрагивает эти пути. Показанное completion не равно принятому; принятие не равно полезному результату. Неизмеренное partial acceptance остаётся unknown.

Host suites и `tests/inline_completion_*` выбираются по реальному затронутому контракту. Для positive Tab, native Undo и live p95 нужны реальные IDE/модель; fake transport и browser fixture их не закрывают. Публикуй профиль, N, failures/cancellations и полное время, не один быстрый запрос.

## При изменении MCP/пакета

Собери bundle и проверь initialize, notifications/initialized, tools/list, положительный tools/call и отказ на неверные аргументы. Протокол и схема tools имеют отдельные версии. `copilot_local` использует код продукта, поэтому не служит независимым oracle его корректности.

Не перезаписывай текущий VSIX ради документации. При настоящем release сохрани прежний пакет, свяжи новый артефакт с reviewed source и проверь packaged entrypoints. В отчёте указывай точный SHA/digest и различай source change, build, publication и live behavior.

Проектные MCP/skills/agents могут потребовать новый сеанс с cwd репозитория. Конфигурация и initialize не доказывают, что tool уже доступен модели текущей беседы. Для диагностики см. `docs/CODEX_MCP.md`.
