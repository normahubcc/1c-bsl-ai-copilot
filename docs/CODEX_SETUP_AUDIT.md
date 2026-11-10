# Проверка окружения Codex для проекта

Дата: 2026-10-29. Исходная точка: `main`, HEAD `f98713a64c8c44a098497d222925ddd4d24215bb`, dirty. План/настройки не являются реализацией будущего AI/B2B scope.

Этап настройки завершён. Созданы шесть standalone ролей, два project skills, три MCP-подключения, инструкции и повторяемые диагностики. Это подготовка разработки; будущие продуктовые workflows этим не реализованы.

| Проверка | Результат | Ограничение |
|---|---|---|
| Codex CLI | 0.164.0; effective config/read загружает project layer | Открытая беседа с cwd `/home/user` требует нового project context для новых tools |
| Skills discovery | Оба project skills обнаружены, ошибок нет; skill validator pass | Skill не является программой исполнения или независимым domain oracle |
| Роли | 6 TOML валидны; модели/permissions/MCP наследуются | Спавн/качество работы каждой роли отдельно не проверялись |
| Codex MCP connections | `copilot_local`, `openai_docs`, `playwright_local`: connected; toolsError отсутствует | Проверка выполнена во временном project session без model turn |
| Local toolbox | initialize/list; положительный inspect_query и отрицательный unknown-tool call — pass; 9 исходных tools | Локальные эвристики, не компиляция/поведение 1С |
| OpenAI Docs | initialize/list/search — pass; protocol 2025-06-18, 5 tools | Передан только публичный запрос по документации, inference отсутствует |
| Playwright | initialize/list/navigate/click/screenshot/close — pass | Только синтетическая loopback-страница; не Webview/IDE приёмка продукта |
| Playwright surface в Codex | 14 allowlisted tools из 25 обнаруживаемых сервером | Нет arbitrary evaluate/run-code; профиль не является OS isolation |
| Plan/backlog | 96 пакетов, 30 областей; DAG/refs/relative links — pass | Даты и оценки являются инженерными гипотезами |

В `~/.codex/config.toml` добавлен только exact project trust для `/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot`: без него Codex игнорировал project config. Модели, approvals и остальные parsed настройки сохранены. Это доверие к конфигурации данного checkout, не разрешение на публикацию или production access. Предыдущий конфиг сохранён вне Git с правами 0600.

Playwright MCP 0.0.83 установлен с `--ignore-scripts` в отдельный пользовательский кэш, без изменения package.json/lock приложения. Используется существующий Linux Chromium с включённым sandbox. Launcher не скачивает зависимости и отбрасывает API keys из дочернего окружения.

На момент завершения настройки hashes всех 166 сохранённых runtime/source/package файлов совпадали с исходными; VSIX 1.0.8 не пересобирался. Последующая реализация плана учитывается отдельно. Source identity остаётся dirty worktree, а не reviewed release SHA.

Доказательства этапа: `/tmp/1c-codex-setup-2026-10-29-kgnrks6t/` (backup, исходные hashes, Git status, Codex connections). Временный каталог не входит в репозиторий и не является постоянным хранилищем доказательств. Screenshot smoke: `.codex/artifacts/playwright/setup-smoke.png`, SHA-256 `36f28b4183d6658923fa45638aa8384e96cba07a842e95aa9053ff85f22fa0c9`; последний запуск может изменить hash при смене браузера/viewport.

## Оставшиеся реальные зависимости

- Нет доказательства готового корпоративного Team API/IAM/budget/retention NormaHub. Документационный MCP этого не даёт.
- Полноценный runner isolation, реальная интеграция BSL LS/парсера, Windows Конфигуратор/RDP и client-server профиль требуют собственной реализации/квалификации.
- Учебный Linux-стенд и узкие 11 engine cases уже существуют; это не выполнение будущего D1/D2/D3 или универсальной ERP.
- Независимые expected business outcomes, лицензии/права на справку и design partner acceptance не заменяются агентами.

Следовательно, необходимый базовый Codex tooling настроен и проверен, но «все условия полноценной реализации уже есть» не подтверждено. Независимые работы Core/contracts/evidence можно начинать сейчас; внешние зависимости остаются gates основного плана.

Инструкции: [AGENTS.md](../AGENTS.md), [codex.md](../codex.md), [MCP runbook](CODEX_MCP.md), [предметная спецификация](AI_BUSINESS_VERIFICATION_SPEC.md).
