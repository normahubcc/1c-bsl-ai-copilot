# Live NormaHub / DeepSeek V4.1 Flash 1017 — 2026-10-31

**Verdict: NO GO для широкой платной рекламы текущего AI-workflow.** Реальный inference выполнен, обнаружены реальные несовместимости и границы испытательного стенда. Это не 30/30 PASS и не сравнительная оценка качества всех моделей.

## Источник и модель

Repository `/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot`, `main`, HEAD `f98713a64c8c44a098497d222925ddd4d24215bb`, dirty до/после. Первоначальный источник — кандидат 1.0.9; затем отдельный source patch профиля low и отдельный fix нормализатора. Старый VSIX 1.0.9 не менялся, фиксы в него не включены. Нет commit/publication.

**Каждый inference request отправлялся с `model: deepseek-v4.1-flash-1017`.** В клиенте не было переключения на GPT или базовый Flash. GET /v1/models подтвердил точный ID и карточку «DeepSeek V4.1 Flash 1017». Все полученные inference responses называли `model: deepseek-v4.1-flash`; один timeout не дал response body. Это может быть canonical ID/alias upstream, но внутреннюю версию/маршрутизацию клиент не аттестует. Нельзя переименовывать response field ради нужного результата. Для backend-сверки сохранены доступные X-Request-Id.

Ключ получен через stdin при выключенном echo и передан один раз через private Unix socket в память test extension host. Не сохранялся в source/env/argv/files/VS Code SecretStorage. В модель передавались только собственные synthetic fixtures. Private signing key runner оставался вне workspace/image/evidence.

## Методика и все попытки

До основной генерации зафиксирован corpus 30 cases: 20 query, 5 explain, 5 inline. SHA-256 JSON **`0dd1bb727a1fb3b7a3e2ff8f3df06e0a9ebde0410ae5b8713e0ebf3627f02932`** одинаков во всех четырёх run directories. Ожидания и рубрики заданы до результатов, не менялись под модель. Независимой внешней domain approval у corpus нет.

Source modules реально вызывали продуктовый NormaHubClient по HTTPS в VS Code 1.141.0. SecretStorage был заменён только in-memory credential port, completion responses не заменялись. Query literal передавался как data в прежний ограниченный own-training 1С runner; окружающий BSL не выполнялся. Полное время сценария и API latency записаны отдельно. Это source-module test, не полный packaged live UI workflow.

| Серия | Условия | Результат |
|---|---|---|
| Connectivity + 2 canaries | Строгий ID 1017, реальный API | Три HTTP 200; arithmetic nonce ответ корректный, простой BSL получен. Первый strict-word probe дал другой текст и не считается usefulness PASS |
| Run a | Product provider default, max_tokens 3000, 25s | q01–q03: все три обрезаны по length, дальше stopped; 27 cases not_run |
| 2 compatibility diagnostics | Тот же q01, отдельно thinking disabled / effort low | Disabled: снова length/3000 reasoning. Low: готовый ответ в 2745 tokens, 16.2s. Это разные контролируемые условия, не скрытый retry |
| Run b | Source profile low, прежние 3000/25s | Из 7 query attempts: 2 typed matches в настоящей 1С, 4 truncated, 1 failed из-за параметров fixture. После q05–q07 остановка; q08–q20 not_run |
| Run c | Только explain/inline, source low | Explain: 3 ответа, 1 truncated, 1 timeout. Первые 3 inline cases не дошли до API из-за configuration registration ошибки стенда |
| Run d | Только inline после установки primary VSIX в отдельный profile | 5 реальных API calls: 4 normalized suggestions, 1 valid quoted literal отвергнут старым нормализатором. Native commit в исходном адаптере не подтверждён |
| Offline acceptance replay a/b | Сохранённые реальные suggestions, **0 API calls** | Не установили надёжный полный acceptance path. Один exact insertion в смешанном Tab/commit replay; другие попытки дали no-change/unexpected edits. Это не clean positive Tab evidence |

Всего **25 inference calls**, из них 20 в основных сериях и 5 connectivity/compatibility. **17 уникальных cases получили реальный inference**. q08–q20 не запущены по stop rule. Три inline configuration failures не являются ни API failures, ни ошибками модели. Во всех сериях нет автоматических paid retries. Run a/b имели stop всего прогона после трёх подряд отказов; для run c stop локализован по семейству, чтобы отдельно проверить другой workflow. Conditions и исходные stop artifacts сохранены.

`completed: true` означает завершение конкретной серии, включая остановку, а не успешное прохождение corpus.

## Что фактически подтверждено

**Query:** q02 вернул COUNT=2; q03 вернул две типизированные строки A/6, A/6 с сохранёнными дублями. Проверены реальные receipt/assessment своего engine, только selected query. Это не доказательство выполнения полного сгенерированного BSL или произвольной ERP.

q04 нельзя считать доказанным дефектом AI: модель создала `&Склад` и присвоила ему W1 в окружающем BSL. Текущий trusted harness задаёт только Дата/Ссылка и исполняет только query text. Он закономерно вернул missing Склад. Нужны явный параметрический контракт/профиль и ранний unsupported state; нельзя выполнять весь AI BSL на host ради зелёного теста или назначать произвольные значения параметров.

**Explain, assistant self-review (не independent expert approval):** e01 полезно выделил повторный query/неиспользование строки и оговорил отсутствие замеров; e05 обнаружил 6+6 > 10 и перечислил предположения. e03 правильно объяснил NULL ≠ 0, но чрезмерно обобщил WHERE по правой таблице и предложил перенос условия в ON без доказательства сохранения нужной семантики; требует пересмотра. Полученный текст не равен verified recommendation.

**Inline:** i01 `А + Б;`, i03 `Стр.Вес;`, i04 exception message — правдоподобные continuations в собственном контексте, не полная проверка BSL. i02 `"Привет!"` — корректный argument literal, который ошибочно отфильтровал клиент. i05 предложил `КонецДня(Дата)` вместо передачи Дата; это не запрошенное изменение смысла. Ни наличие item, ни его acceptance не доказывают семантическую пригодность.

## Задержки и расход

Run b query API: N=7, median **17.916s**, nearest-rank p95 **19.991s**. Explain: N=5, median **20.164s**, max/timeout **25.062s**. Inline: N=5, median **6.183s**, nearest-rank p95/max **6.758s**, min **4.624s**. Это малая выборка одной среды; p95 не является production SLO. Для interactive autocomplete задержка остаётся серьёзным ограничением. Полный сценарий query включает ещё native context и engine execution.

Из 25 calls для 24 известен reported usage: **51 462 tokens**, один timeout без usage. Оценка по uncached rates карточки запрошенного 1017 для известных ответов около **$0.00549**, не invoice и не полная итоговая сумма: cache, оценка usage шлюзом, неизвестный timeout и фактический billing route могут менять списание. См. cost-estimate.json.

## Исправления в source и их границы

1. Только для `deepseek-v4.1-flash-1017` добавлен `reasoning_effort: low`; другие модели не получают этот параметр, model ID/бюджет/timeout не подменяются. Это **частичная mitigation**, повторный прогон всё ещё дал truncation. Увеличение лимита само по себе не доказано решением. Официальная [документация DeepSeek](https://api-docs.deepseek.com/guides/thinking_mode/) описывает high thinking default и low effort; passthrough/учёт на конкретном gateway требуют собственной проверки.
2. Нормализатор принимает целый quoted literal только в уже открытой argument position, продолжая отклонять standalone quoted prose, comments, malformed strings и смешанный текст. Unit regression и replay сохранённого реального i02 подтвердили `"Привет!"` после fix. Нового платного inference/чистой native acceptance после этого fix не было.
3. Добавлен явный opt-in paid harness и offline acceptance tools; они не входят в npm test. Все ошибки стенда отделены от product/model outcomes.

После последних runtime fixes: **npm test, pnpm build, pnpm lint — exit 0**. Секрет не встроен в source/bundle. VSIX 1.0.9 имеет прежний SHA-256 `8f0550609700694464bc3e1a5b0d47d136990fe594b57c79cd54ee833af737c4`; новый пакет не создавался. Ошибки reasoning/profile/Tab не замаскированы изменёнными ожиданиями, ручной вставкой или общим verified=true.

## Следующий обязательный шаг

- Сверить доступные request IDs и actual model/controls mapping в NormaHub; публичный exact ID не подтверждает provider weights. Проверить, почему disabled thinking не дал ожидаемого поведения; клиенту не приписывать доказанное отключение.
- Утвердить рабочие task-specific controls/budgets с измерением задержки; сохранить bounded cancellation и не вводить silent fallback на другую модель.
- Реализовать явный supported parameter contract для runner и preflight unsupported вместо отнесения missing binding к ошибке AI.
- Повторить native acceptance на выделенном display/чистом UI без конкурирующих completion/ввода; текущий mixed replay не закрывает Tab/полный lifecycle.
- После этих изменений выполнить новый frozen run всех 30 cases; затем пользовательский пилот. Массовую рекламу до этого не считать обоснованной.

Данные и журнал: [evidence](evidence/live-normahub-2026-10-31/), [runbook](live_normahub/README.md). Подробности gateway semantics — [NormaHub API docs](https://normahub.cc/docs); они указывают, что usage может быть точным или оценённым. Внешняя security/domain review и реальный клиентский пилот не проводились.
