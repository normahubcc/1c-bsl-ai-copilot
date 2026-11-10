# Локальные сценарии расширения и кандидат 1.0.9 — 2026-10-30

Реализованы native создание проверки запроса без ручного JSON и diff захваченного исходника. Собран отдельный VSIX 1.0.9 и проверена его настоящая установка в VS Code/Cursor. Это завершение конкретного локального UX/release этапа, не всего AI/B2B-плана и не подтверждение live AI.

Источник: `/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot`, `main`, HEAD `f98713a64c8c44a098497d222925ddd4d24215bb`, dirty до/после. Коммит и публикация не выполнялись. Предыдущие 202 evidence/package файла проверены по hashes и сохранены. Новый VSIX собран из текущего dirty source; независимого полного review унаследованного diff не было. Project skills `onec-behavior-verification` и `copilot-runtime-verification` применены; независимые subagents не использовались.

## Изменения

1. Native-мастер: выбор полного query literal с UTF-16 offsets, multiline/CRLF/doubled quotes; отказ от сборки динамической конкатенации. Независимые requirement/reference/preconditions/assumptions пользователя; ручные ожидаемые строки либо typed UTF-8 CSV, explicit empty result и comparison mode. Source/pin guards после каждого await и native подтверждения. Контракт всегда proposed; challenge появляется после завершения мастера.
2. CSV: точные decimal strings, NULL/undefined, boolean/date/reference/empty-reference, строки с `;`, кавычками и переносами. Дубликаты сохраняются; 64 колонки, 2000 строк, bounded local file ≤2 MiB. Никаких inferred expectations или JS Number для числовых значений.
3. Native diff: полный захваченный unsaved source → точная вставка/замена. Virtual read-only snapshots с защитой отображения от accidental programmatic edits, bounded memory; открытие ничего не применяет. Apply повторно проверяет source/context, остаётся once-only и поддерживает native Undo. Новый Command Palette entry, кнопки preview запроса/проведения/расширения/формы, RU/EN.
4. Release candidate: version/lock 1.0.9, локализация новых действий. Packager использует exclusive create и отказывается перезаписывать существующий VSIX. Старые версии не заменены.

Инструкция: [EXTENSION_WORKFLOWS.md](../docs/EXTENSION_WORKFLOWS.md). Прежний импорт готового плана и provided-data comparison сохранены, сохраняется разделение подписи/выполнения/совпадения ожиданий/approval.

## Фактические проверки

| Проверка | Результат | Что подтверждено |
|---|---|---|
| `npm test` | exit 0 | Полная регрессия Core/inline/host/Sidecar/runner + 9 новых workflow groups |
| `pnpm build`, `pnpm lint` | exit 0 / exit 0 | Source compile/bundles и lint |
| Browser Webview | 182 layout cases и bridge checks | Diff button/preview ID/stale guard, existing tools |
| RU/EN browser | 364 layout cases + integrity | Новые labels, сохранность code/draft |
| Native source modules VS Code 1.141.0 | 9/9 | Мастер → host job → real isolated 1С → signed import; diff/apply/once/Undo; stale/revoke/tamper |
| Native source modules Cursor 1.105.1 | 9/9 | Тот же scope, отдельный профиль/workspace |
| **Установленный VSIX** VS Code 1.141.0 | 4/4 | Actual installed path/version/bundle hash, activation, все contributed handlers, 10 навигационных/metadata действий без изменения кода, RU/EN command catalogues, bsl/1c/oscript registrations |
| **Установленный VSIX** Cursor 1.105.1 | 4/4 | Тот же installed smoke scope |
| `tests/release_qa.py` | exit 0 | VSIX/source payload parity, 9 packaged MCP calls, invalid args, NormaHub-only route policy |

Actual installed smoke не импортирует source modules продукта. Source workflow suite отдельно использует out modules и actual native API; AI response, inputs/file choices/confirmation контролируемые. Backend inference не вызывается. Подтверждение pin и proposed contract в production остаётся явным действием пользователя. IDE test profiles использовали явный `--no-sandbox`; security policy Docker runner не ослаблялась.

В реальной учебной 1С 8.3.27.1508 выполнено по одному полному selected-query сценарию на IDE: независимые ожидания A/2 для двух строк по 6 при остатке 10. Мастер построил proposed contract, оператор выполнил именно host job, receipt привязан к candidate/snapshot/profile/challenge, typed comparison equal. Подпись не повысила full BSL/approval/apply flags. Использован прежний exact approved image `sha256:d104cbc4d58a7e4fd979aaee0dc56ec37d232c082f5ade36a54067db79f1daec`, без переустановки 1С/подготовки новой конфигурации. Контейнеры собственных nonce очищены; private key не копировался в workspace/VSIX/evidence.

## Сохранённые отказы

Первый native workflow attempt остановился из-за test locator с побочным эффектом внутри `find`; diff/once/Undo уже прошли. Первый packaged attempt: 3/4, тест предположил несуществующий config key языка; реальное хранилище языка — extension preferences. Unit regression также сохранил совместимость прежнего non-regular JSON refusal после обобщения file reader. Первый query-range test выявил line-oriented boundaries legacy lexer, заменены отдельным complete-literal scanner. Production guards/ожидания не ослаблены. См. [I-17–I-19](../docs/DEVELOPMENT_INCIDENTS.md), raw attempts в evidence.

## Сохранность и ограничения

[Evidence](evidence/extension-workflows-2026-10-30/) содержит native/installed results, публичный key/profile, prepared jobs, signed receipts, current/stale/revoked reports, полные regression/build/lint/release логи, preservation и manifest. Сохранённые отчёты — исторические снимки, receipt audits выполняются на signed finishedAt, не заявляют текущую свежесть. Private PEM в evidence отсутствует.

План: 96 пакетов/30 acceptance rows; P1-03/P1-08/P2-12/P3-05/P3-07/P3-09 не объявлены завершёнными. AC-19/AC-30 дополнены доказательствами с точной границей. После этого этапа всё ещё требуются:

- live NormaHub/качество AI, acceptance и latency/cost на реальных задачах;
- полный packaged end-to-end workflow с настоящей моделью, поддерживаемые Windows/RDP/remote profiles и пилот команды;
- multi-file changes, crash recovery, полный parser/metadata/index/grounding scope будущего плана;
- предметная приёмка проведения, ERP/БСП/РЛС, форм/расширений, Vanessa и реальных инцидентов ТЖ: selected-query fixture не проверяет их;
- backend identity/tenant/capabilities/budget/runner registry/revocation/approval и независимая security/domain проверка.

Это не UI-обёртки вместо серверной защиты: tenant isolation или permission на выполнение нельзя обеспечить одним расширением. Новый пакет — проверяемый кандидат, не опубликованный и не объявленный 100% production.
