# MCP для разработки проекта

Дата: 2026-10-29. Конфигурация: [.codex/config.toml](../.codex/config.toml). Она относится к Codex разработчика, не включает MCP/AI автоматически у пользователей расширения.

## Подключения и границы

| Сервер | Зачем | Данные/доступ | Ограничения |
|---|---|---|---|
| `openai_docs` | Актуальные Codex config, agents, skills, OpenAI API | Официальный read-only `https://developers.openai.com/mcp`; поисковый запрос уходит наружу | Не передавать закрытый код, ключи и данные клиента; не исполняет inference и не знает контракт NormaHub |
| `copilot_local` | Проверка реальных tools/DTO общего toolbox | Собственный `bin/mcp-server-1c.js` из собранного `dist`; stdio, без API key | 9 локальных tools, protocol 2024-11-05; это код продукта и эвристики, не независимый oracle/1С/AI |
| `playwright_local` | Интерактивное воспроизведение Webview/layout/keyboard | Microsoft `@playwright/mcp` **0.0.83**, локальный Chromium, stdio, отдельный профиль в памяти | Проверяет browser fixture; не native VS Code/Tab/Undo, не Windows Конфигуратор и не 1С |

Перед использованием просмотреть реальные `tools/list`. Не предполагать наличие инструмента по документации иной версии. Инструменты продукта могут возвращать красивый, но непроверенный BSL: `syntaxChecked=false`, `executionVerified=false`, unknown/fallback источники сохраняются в отчёте.

Особенности проверенной Playwright версии: `browser_click` принимает `target` из свежего snapshot, не старый `ref` argument; для screenshot явно задаётся `scale="css"`. Snapshot может возвращаться ссылкой на локальный YAML вместо текста. Читать такой файл можно только из разрешённого каталога артефактов, с проверкой пути/размера; обновлять refs после изменений DOM. Факт наличия инструмента не означает совместимость аргументов из старого примера.

`copilot_local` имеет доступ локального процесса. `1c_scan_metadata.workspacePath` агент задаёт только внутри разрешённого проекта/fixture; нынешний сервер не заявляется как tenant-изолированный файловый sandbox. После правки исходников сначала `pnpm build`; старый dist не подтверждает новый код. Фиксированный wire protocol требует отдельного negotiation/совместимого client smoke; регистрация не модернизирует протокол автоматически.

Новый `dist/verification-cli.js` — отдельный one-request JSON CLI. Он не поддерживает MCP initialize/JSON-RPC и не должен регистрироваться как MCP server. Его contract/comparison/evidence API пока используется напрямую и из tests; девять текущих tools не получили скрытых новых полномочий.

Playwright allowlist оставляет обычные browser actions, snapshots, screenshots, console/network и исключает произвольный browser code/evaluate, установку браузера и доступ к личному профилю. Launcher не включает `--allow-unrestricted-file-access`, `--extension`, CDP или WebMCP со страницы. Никаких пользовательских cookies/логинов.

Разрешённая цель — локальный тестовый origin `http://127.0.0.1:<port>` / `http://localhost:<port>`. Playwright `allowed-origins` не является OS/security boundary и не покрывает все redirect cases; правила агента и sandbox действуют дополнительно. Не использовать сервер для входа в чужие кабинеты, публикации или чтения иных проектов. Артефакты попадают в игнорируемый `.codex/artifacts/playwright/`; screenshots/DOM могут содержать код, их нельзя автоматически публиковать.

## Установка и воспроизводимость

Python launcher [.codex/scripts/start_mcp.py](../.codex/scripts/start_mcp.py) находит корень независимо от рабочей подпапки и передаёт дочернему процессу минимальное окружение без API keys. Ничего автоматически не скачивает и не собирает. Текущий browser profile настроен для Linux; Windows/WSL/remote требуют собственного проверенного размещения.

Два `cwd` в текущем MCP config закреплены абсолютным путём этого checkout, чтобы запуск из подпапки не выбирал соседний проект. При переносе/клонировании обновить их на проверенный корень нового checkout и повторить диагностику. Скрипт затем дополнительно определяет свой root по собственному пути; имя ветки или случайный cwd не подменяют source identity.

Playwright MCP установлен отдельно от package.json приложения:

```bash
npm install --prefix "$HOME/.cache/1c-copilot-codex/playwright-mcp" \
  --ignore-scripts --no-audit --no-fund --save-exact @playwright/mcp@0.0.83
```

Если определён `XDG_CACHE_HOME`, используй его вместо `$HOME/.cache` и в команде установки. Сохраняй созданный package-lock при обновлении инструмента. На новой машине установку/смену версии выполняют явно; launcher отказывается запускать несовпадающую версию. Не добавлять `latest` в постоянную конфигурацию.

Launcher выбирает самый новый существующий Linux Chromium из `${XDG_CACHE_HOME:-$HOME/.cache}/ms-playwright/chromium-*/`. Существование бинарника не гарантирует совместимость: после смены браузера повторить navigate/click/screenshot smoke и записать выбранную версию. При отсутствии браузера требуется явное provision по официальной инструкции Playwright; не выполнять загрузку из model-controlled command. Включён Chromium sandbox; при ограничениях host сначала проверить разрешения/профиль, не отключать его молча.

## Загрузка в Codex

1. Открыть/запустить Codex с cwd данного Git-репозитория, например `codex -C /absolute/path/to/1c-bsl-ai-copilot`.
2. Убедиться, что этот проект доверенный по правилам Codex. Project `.codex/` в недоверенном проекте игнорируется. Не помечать весь home как trusted ради этих серверов.
3. Перезапустить соответствующий клиент/MCP; посмотреть `/mcp` и реальные подключённые tools. Набор tools уже открытой беседы может не обновиться автоматически.
4. `codex mcp list` — диагностическая команда; отдельно сверять project scope через `config/read` app-server: отключённый по trust слой не попадает в effective list. Не делать вывод о соединении только по TOML или этой команде. `mcpServerStatus/list` без project thread может показывать лишь глобальные/внедрённые Apps; для project connections нужен соответствующий project context.

User config моделей, providers и approvals не требуется заменять. Standalone custom agents наследуют permissions и MCP родителя; дополнительные `mcp_servers`/`sandbox_mode` внутри role-файла не дают отдельной защиты. Облачная поверхность без локального executor не получает локальный Python/Node/Chromium автоматически.

## Проверки

Структура/ссылки/зависимости:

```bash
python3 .codex/scripts/check_setup.py
```

App-server effective project config и обнаружение skills, без LLM-запроса:

```bash
python3 .codex/scripts/check_setup.py --codex
```

Initialize/tools/list/положительный и отрицательный call локального toolbox:

```bash
python3 .codex/scripts/check_setup.py --local-mcp
```

Browser smoke проводится на своей локальной fixture: initialize → tools/list → navigate → snapshot → click → screenshot → close. OpenAI Docs: initialize → tools/list → официальный поисковый запрос без private content. Для сети/запуска браузера могут действовать разрешения sandbox, их не обходить. Свежие результаты и ограничения — [CODEX_SETUP_AUDIT.md](CODEX_SETUP_AUDIT.md).

Повторяемая проверка на синтетической локальной странице и официальном документационном запросе:

```bash
python3 .codex/scripts/smoke_mcp.py --browser --docs
```

Этот smoke не отправляет запрос к модели и не является приёмкой интерфейса продукта. Для самого Webview остаются настоящие provider fixtures и существующие browser/host suites. Запуск headless Chromium и loopback HTTP может требовать разрешённого host-профиля.

## Что намеренно не подключено

- Универсальные filesystem/shell/Git MCP: shell и Git уже доступны, дополнительный сервер не закрывает конкретный пробел.
- GitHub write/admin, production DB и внешние 1С execution MCP: нет необходимости выдавать такие полномочия для планирования; реальные среды/права требуют отдельной проверки.
- Context7/другие документационные каталоги: сначала прямые первичные источники; добавить при конкретном воспроизводимом пробеле, без отправки закрытого контекста.
- Чужие коммерческие 1С серверы с неопределённой лицензией/доступами: не устанавливаются вместо отсутствующего licensed runner или независимого oracle.

Доступные в текущей беседе Apps/плагины могут быть внедрены средой отдельно и не перечисляться в пользовательском config.toml. Их наличие не подтверждает активность проектных MCP. Специальные skills нужны для корректной работы, но не устанавливают 1С, Java/BSL LS, Windows-стенд, корпоративный backend или доступ к NormaHub.

Первичные источники: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [project config](https://learn.chatgpt.com/docs/config-file/config-advanced), [custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [skills discovery](https://learn.chatgpt.com/docs/build-skills), [OpenAI Docs MCP](https://developers.openai.com/learn/docs-mcp), [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp).
