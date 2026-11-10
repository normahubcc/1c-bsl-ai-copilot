# Публикация 1C BSL AI Copilot

Актуальный порядок, gates, каналы и медиа: [релизный runbook](docs/RELEASE_AND_GROWTH_2026-11-10.md). Публикуется **один проверенный VSIX из reviewed tag**. Старые файлы `*.vsix` в каталоге проекта не выбираются автоматически.

## Кандидат

1. Просмотрите весь `git status` и diff. Сохраните незакоммиченную работу; не связывайте её с прежним HEAD.
2. Зафиксируйте точную версию в `package.json`. Если после сборки меняется упаковываемый файл, повышайте версию и создавайте новый VSIX; существующий пакет не перезаписывайте.
3. Выполните `npm ci`, `npm test`, `pnpm build`, `pnpm lint`, `python3 build_vsix.py`, `python3 tests/release_qa.py`. Изолированный installed IDE и live/1С gates идут отдельно.
4. После review создайте commit и точный tag `v<package.version>`. Пуш тега запускает `.github/workflows/release.yml`: CI проверяет пакет и создаёт **черновик prerelease** на GitHub. Тег сам по себе не публикует расширение в Marketplace/Open VSX.
5. Проверьте draft VSIX, его SHA-256, release notes, установку в чистый профиль и соответствие источнику. Локально `./publish.sh --check` проверяет exact artifact/tag и не меняет реестры.

## Продвижение draft в каталоги

После прохождения gates запустите workflow `Release & Publish` на **том же теге** с `promote=true`: `gh workflow run release.yml --ref v1.0.12 -f promote=true` (после входа в GitHub CLI под владельцем репозитория). GitHub UI в меню Run workflow выбирает ветку, поэтому для tag ref используйте [GitHub CLI или REST API](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch). Workflow скачивает VSIX из GitHub draft, повторяет QA, публикует в Open VSX и VS Code Marketplace, затем открывает GitHub prerelease. Запуск на `main` будет отклонён проверкой тега.

Для CI нужен ротированный секрет `OVSX_PAT`. Для Marketplace создайте Trusted Publishing policy у издателя: owner `normahubcc`, repository `1c-bsl-ai-copilot`, workflow `release.yml`, environment пустой. Workflow получает короткоживущий токен через GitHub OIDC (`id-token: write`) и публикует тот же VSIX без `VSCE_PAT`. Если policy не настроена, продвижение завершится ошибкой на Marketplace; до её настройки не запускайте `promote=true`. Значение Open VSX токена не вставляйте в команду, README или чат.

Локальный `./publish.sh --check` остаётся read-only проверкой exact artifact/tag. Ветка локальной публикации через PAT — устаревающий запасной путь; для этого релиза используйте CI OIDC. [Документация VS Code Marketplace](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) описывает настройку Trusted Publishing и вывод global Azure DevOps PAT из обращения с 2026-12-01.

После upload откройте [Marketplace](https://marketplace.visualstudio.com/items?itemName=Normahub.1c-bsl-ai-copilot) и [Open VSX](https://open-vsx.org/extension/normahub/1c-bsl-ai-copilot), сверьте версию/README/скриншоты и установите опубликованный пакет в чистый VS Code/Cursor. [Официальная инструкция Open VSX](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions) описывает Eclipse account, Publisher Agreement, namespace и registry scanning.

Другие площадки требуют отдельных материалов и критериев: [Инфостарт](https://infostart.ru/about/rules/publishing_rules/) имеет специальные ограничения на коммерческие публикации и внешние ссылки; [Official MCP Registry](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/official-registry-requirements.md) и [Glama](https://glama.ai/mcp/faq) относятся к самостоятельно устанавливаемому MCP-серверу, а не к одному VSIX; [Product Hunt](https://help.producthunt.com/en/articles/17834537-4-build-your-product-page) нужен после английского onboarding и реального demo. Подробная последовательность — в runbook выше.
