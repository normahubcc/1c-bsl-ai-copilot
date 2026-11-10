# Editor snapshot и применение локального черновика

Начальный срез P1-01/P1-02/P1-03; не полный корпоративный TaskSpec/ChangeSet. Фактические проверки и source identity: [отчёт](../tests/EDITOR_SNAPSHOT_REPORT_2026-10-29.md).

## Поток

1. Native host захватывает `CapturedTaskContext` и цель вставки синхронно, до чтения ключа/метаданных/ответа модели. Источник — текущий несохранённый буфер; выбранный текст ограничен 16000 символами, соседние сигнатуры — 8000, фактически отправленный metadata prompt — 24000.
2. Snapshot содержит URI проекта/документа, язык, version, lifecycle epoch, длину и hash **всего** буфера. Сам код в DTO snapshot не хранится. Контекст хранит отправляемые фрагменты локально в памяти. `WeakMap` связывает исходный объект с host-only проверкой; копия/JSON не получает эту возможность.
3. `runAiTask` проверяет отмену, Workspace Trust и актуальность до secrets и после каждого подготовительного await. Модель фиксируется при запуске. `LocalTaskSpec` связывает hashes intent, snapshot и реальных частей prompt с запрошенной моделью; это не receipt фактически использованной gateway моделью.
4. Ответ становится immutable `GeneratedTaskResult`: `completed_unverified`, `executionVerified=false`, candidate ID и hash. Изменившийся во время HTTP контекст даёт читаемый устаревший черновик. Применять его нельзя. Подготовительный stale/cancel останавливает вызов до inference.
5. `PreviewStore` связывает результат с `SingleFileChange`: base snapshot, диапазон UTF-16 offsets, candidate hash, optional task ID. Код и host-only guard остаются в store; Webview получает только preview identity и поля для показа. Присланный Webview текст не используется как кандидат для apply.
6. Apply проверяет исходный объект документа, URI, язык, project binding, version, полный hash, lifecycle и контекст до/после `openTextDocument`, после `showTextDocument` и в edit callback. Применение одноразовое, через native editor edit с обычным Undo. Последний закрытый tab инвалидирует snapshot даже при живом `TextDocument`.

AI query, explanation и AI BDD используют этот контекст. Gherkin и explanation не становятся BSL-вставками. Локальные генераторы сохраняют native target guards, но не получают фиктивный AI task. Snippet, явно вставленный в поле объяснения, не заимствует метаданные активного проекта. Standalone-файл не использует другой workspace; untitled привязывается только при однозначном единственном workspace. При нескольких корнях без однозначного источника metadata context отсутствует.

## Hash и актуальность

- Текст snapshot/prompt/candidate/change хешируется SHA-256 по UTF-16LE с явным `textHashEncoding`. Это сохраняет различия произвольных JS code units, включая unpaired surrogate; offsets соответствуют API VS Code. Длина и диапазоны тоже в UTF-16 units.
- Hash DTO — SHA-256 canonical JSON UTF-8 из `jsonContract`. Hash файла в evidence — SHA-256 его байтов. Это разные контракты; нельзя заменять один другим. Прежний verification Core не меняет свою кодировку.
- Metadata epoch отражает **наблюдённые** сохранения/создания/удаления XML/MDO/metadata.json и ручной refresh. Neighbor guard сравнивает фактически переданную сводку. Это не атомарный snapshot файловой системы/конфигурации БД. Неотслеживаемые зависимости ещё требуют полноценного Context Worker.
- Изменение context после показа результата может стать известно UI только при попытке apply: native host всё равно повторно проверяет его. После обнаружения stale при завершении query UI сразу блокирует вставку, оставляет open/copy и показывает RU/EN предупреждение.
- Scope hash — локальная namespace identity. Workspace Trust, WeakMap и hashes не заменяют серверную авторизацию, tenant isolation, approval или доказательство исполнения 1С.

## Воспроизведение

Контролируемые host-проверки:

```bash
npm run test:editor-snapshot
```

Нативные source-module проверки в **новых** профилях установленных VS Code/Cursor:

```bash
pnpm compile
pnpm build
python3 tests/run_editor_snapshot_ide.py --output /tmp/choose-a-new-snapshot-evidence-directory
```

Каталог `--output` не должен существовать. Launcher создаёт собственные разные workspace для каждого IDE, отключает inline/updates/telemetry и не использует пользовательские профили. GUI/display должны быть доступны. По умолчанию Chromium sandbox включён. Workspace Trust отключается только в тестовом профиле: restricted-mode отказы покрывает controlled host suite, а не этот native запуск.

Активация проверяется у development extension bundle; snapshot/task/preview сценарии импортируют реальные скомпилированные `out/` модули в extension host и используют настоящий `vscode` API. Только key/complete заменяются в памяти. Это не packaged VSIX, пользовательский Webview end-to-end или проверка live gateway. Не пересобирай модули параллельно native запуску.

## Ещё требуется

Полная task state machine, contract/validation integration, авторизованный runner receipt, native diff, multi-file transaction/recovery, полный индекс зависимостей, квалификация OS/remote/Windows/RDP и live AI. Новые DTO не дают статуса business-verified и не закрывают G1/G2.
