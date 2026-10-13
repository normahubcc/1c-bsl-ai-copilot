"""Core logic engine for 1C:Enterprise code analysis, query generation, and ITS auditing."""

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional


class SidecarCore:
    @staticmethod
    def audit_bsl_code(code: str) -> List[Dict[str, Any]]:
        """Audits BSL code against 1C ITS development standards and BSP best practices."""
        issues = []
        lines = code.split("\n")

        in_loop = False
        in_posting = False
        has_datalock = False

        for idx, line in enumerate(lines, 1):
            trimmed = line.strip()

            # Posting handler check
            if "Процедура ОбработкаПроведения" in trimmed:
                in_posting = True
                has_datalock = False
            if in_posting and "Новый БлокировкаДанных" in trimmed:
                has_datalock = True
            if in_posting and "КонецПроцедуры" in trimmed:
                if not has_datalock:
                    issues.append({
                        "line": idx,
                        "rule": "ITS-LOCK-001",
                        "severity": "error",
                        "message": "В процедуре ОбработкаПроведения отсутствует объект БлокировкаДанных.",
                        "suggestion": "Установите управляемую блокировку данных перед чтением остатков."
                    })
                in_posting = False

            # Loop check
            if re.match(r"^\s*(Для\s+Каждого|Для\s+\w+\s*=|Пока\s+)", trimmed, re.IGNORECASE):
                in_loop = True
            if re.match(r"^\s*КонецЦикла;", trimmed, re.IGNORECASE):
                in_loop = False

            # 1. Query inside loop
            if in_loop and re.search(r"\.Выполнить\s*\(\s*\)", trimmed, re.IGNORECASE):
                issues.append({
                    "line": idx,
                    "rule": "ITS-PERF-001",
                    "severity": "error",
                    "message": "Выполнение запроса внутри цикла (Запрос.Выполнить()).",
                    "suggestion": "Вынесите выборку в пакетный запрос до цикла с помещением во временную таблицу."
                })

            # 2. Virtual tables without parameters
            if re.search(r"\.(Остатки|СрезПоследних|СрезПервых|Обороты)\s*\(\s*\)", trimmed, re.IGNORECASE):
                issues.append({
                    "line": idx,
                    "rule": "ITS-PERF-002",
                    "severity": "warning",
                    "message": "Обращение к виртуальной таблице без параметров среза/условия.",
                    "suggestion": "Передавайте параметры периода и отборов в круглых скобках виртуальной таблицы."
                })

            # 3. Synchronous modals
            if re.search(r"(Предупреждение|Вопрос|ВвестиСтроку|ВвестиЧисло)\s*\(", trimmed, re.IGNORECASE) and not re.search(r"Оповещение", trimmed, re.IGNORECASE):
                issues.append({
                    "line": idx,
                    "rule": "ITS-UI-003",
                    "severity": "warning",
                    "message": "Использование модальных окон (Предупреждение/Вопрос).",
                    "suggestion": "Используйте асинхронные методы ПоказатьПредупреждение/ПоказатьВопрос с ОписаниеОповещения."
                })

            # 4. Anti-pattern: Ссылка.ПолучитьОбъект().Реквизит
            if re.search(r"\.ПолучитьОбъект\s*\(\s*\)\.[\w\u0400-\u04FF]+", trimmed, re.IGNORECASE):
                issues.append({
                    "line": idx,
                    "rule": "ITS-BSP-001",
                    "severity": "info",
                    "message": "Чтение реквизита через ПолучитьОбъект() блокирует сущность в памяти.",
                    "suggestion": "Используйте легковесный метод БСП: ОбщегоНазначения.ЗначениеРеквизитаОбъекта(Ссылка, \"ИмяРеквизита\")."
                })

        return issues

    @staticmethod
    def build_batch_query(entity: str, tabular: str, register: str, register_type: str = "Остатки") -> str:
        """Generates a professional 1C Batch Query with Temp Tables and indexing."""
        clean_entity = entity.strip()
        full_entity = clean_entity if "." in clean_entity else f"Документ.{clean_entity}"

        clean_reg = re.sub(r"^(РегистрНакопления|РегистрСведений|РегистрБухгалтерии)\.", "", register.strip())
        reg_type = register_type.strip() or "Остатки"

        if register.startswith("РегистрСведений.") or reg_type in ("СрезПоследних", "СрезПервых"):
            reg_kind = "РегистрСведений"
            vt_res_name = "Цена"
        elif register.startswith("РегистрБухгалтерии."):
            reg_kind = "РегистрБухгалтерии"
            vt_res_name = "СуммаОстаток"
        else:
            reg_kind = "РегистрНакопления"
            vt_res_name = "КоличествоОстаток" if reg_type == "Остатки" else "КоличествоОборот"

        vt_source = f"ВТ_{tabular}"
        vt_balances = f"ВТ_Остатки{clean_reg}"

        query = f"""ВЫБРАТЬ
    ДокументТаблица.Номенклатура КАК Номенклатура,
    СУММА(ДокументТаблица.Количество) КАК Количество
ПОМЕСТИТЬ {vt_source}
ИЗ
    {full_entity}.{tabular} КАК ДокументТаблица
ГДЕ
    ДокументТаблица.Ссылка = &Ссылка
СГРУППИРОВАТЬ ПО
    ДокументТаблица.Номенклатура
ИНДЕКСИРОВАТЬ ПО
    Номенклатура
;

////////////////////////////////////////////////////////////////////////////////
ВЫБРАТЬ
    Остатки.Номенклатура КАК Номенклатура,
    Остатки.{vt_res_name} КАК {vt_res_name}
ПОМЕСТИТЬ {vt_balances}
ИЗ
    {reg_kind}.{clean_reg}.{reg_type}(
        &ПериодКонтроля,
        Номенклатура В (ВЫБРАТЬ {vt_source}.Номенклатура ИЗ {vt_source})
    ) КАК Остатки
ИНДЕКСИРОВАТЬ ПО
    Номенклатура
;

////////////////////////////////////////////////////////////////////////////////
ВЫБРАТЬ
    Исходные.Номенклатура КАК Номенклатура,
    Исходные.Количество КАК Требуется,
    ЕСТЬNULL(Остатки.{vt_res_name}, 0) КАК Доступно,
    Исходные.Количество - ЕСТЬNULL(Остатки.{vt_res_name}, 0) КАК Дефицит
ИЗ
    {vt_source} КАК Исходные
    ЛЕВОЕ СОЕДИНЕНИЕ {vt_balances} КАК Остатки
        ПО Исходные.Номенклатура = Остатки.Номенклатура
ГДЕ
    Исходные.Количество > ЕСТЬNULL(Остатки.{vt_res_name}, 0)
;

////////////////////////////////////////////////////////////////////////////////
УНИЧТОЖИТЬ {vt_source}
;

////////////////////////////////////////////////////////////////////////////////
УНИЧТОЖИТЬ {vt_balances}"""

        scaffolding = f"""// Инициализация запроса 1С по стандартам ИТС с Менеджером Временных Таблиц
Запрос = Новый Запрос;
Запрос.МенеджерВременныхТаблиц = Новый МенеджерВременныхТаблиц;
Запрос.Текст = 
    "{query.replace(chr(10), '"' + chr(10) + '    + "')}";

Запрос.УстановитьПараметр("Ссылка", Ссылка);
Запрос.УстановитьПараметр("ПериодКонтроля", ?(ЗначениеЗаполнено(Дата), Дата, ТекущаяДатаСеанса()));

Результаты = Запрос.ВыполнитьПакет();
ВыборкаДефицит = Результаты[2].Выбрать();

Пока ВыборкаДефицит.Следующий() Цикл
    // Обработка нехватки товаров на складе
    ОбщегоНазначенияКлиентСервер.СообщитьПользователю(
        СтроковыеФункцииКлиентСервер.ВставитьПараметрыВСтроку(
            НСтр("ru = 'Недостаточно товара \"%1\": требуется %2, в наличии %3'"),
            ВыборкаДефицит.Номенклатура,
            ВыборкаДефицит.Требуется,
            ВыборкаДефицит.Доступно
        )
    );
КонецЦикла;"""
        return scaffolding

    @staticmethod
    def refactor_query(raw_query: str) -> Dict[str, Any]:
        """Intelligently refactors arbitrary 1C query isolating virtual tables."""
        applied_optimizations = []
        modified = raw_query.strip()

        vt_pattern = re.compile(
            r"(ЛЕВОЕ|ПРАВОЕ|ВНУТРЕННЕЕ|ПОЛНОЕ)?\s*СОЕДИНЕНИЕ\s+(Регистр(?:Накопления|Сведений|Бухгалтерии)\.([а-яА-ЯёЁa-zA-Z0-9_]+)\.(Остатки|Обороты|СрезПоследних|СрезПервых)\s*\(([^)]*)\))\s+КАК\s+([а-яА-ЯёЁa-zA-Z0-9_]+)\s+ПО\s+([^\n;]+)",
            re.IGNORECASE,
        )
        match = vt_pattern.search(modified)
        if match:
            join_type = match.group(1) or "ЛЕВОЕ"
            full_vt_expr = match.group(2)
            reg_name = match.group(3)
            vt_type = match.group(4)
            alias = match.group(6)
            on_cond = match.group(7).strip()

            field_match = re.search(rf"{alias}\.([а-яА-ЯёЁa-zA-Z0-9_]+)", on_cond, re.IGNORECASE)
            join_field = field_match.group(1) if field_match else "Номенклатура"
            vt_name = f"ВТ_{alias}"

            temp_table_part = (
                f"ВЫБРАТЬ\n"
                f"    {alias}.{join_field} КАК {join_field},\n"
                f"    {alias}.Количество{'Остаток' if vt_type == 'Остатки' else ''} КАК Количество\n"
                f"ПОМЕСТИТЬ {vt_name}\n"
                f"ИЗ\n"
                f"    {full_vt_expr} КАК {alias}\n"
                f"ИНДЕКСИРОВАТЬ ПО\n"
                f"    {join_field}\n"
                f";\n\n"
                f"////////////////////////////////////////////////////////////////////////////////\n"
            )
            applied_optimizations.append(
                f"Вынесение виртуальной таблицы {reg_name}.{vt_type} в индексированную временную таблицу {vt_name}"
            )
            applied_optimizations.append(f"Добавлена явная инструкция ИНДЕКСИРОВАТЬ ПО {join_field}")

            replacement_join = f"{join_type} СОЕДИНЕНИЕ {vt_name} КАК {alias} ПО {on_cond}"
            modified = modified[: match.start()] + replacement_join + modified[match.end() :]
            modified = f"{temp_table_part}{modified}\n\n////////////////////////////////////////////////////////////////////////////////\nУНИЧТОЖИТЬ {vt_name};"
            applied_optimizations.append(f"Добавлена инструкция УНИЧТОЖИТЬ {vt_name} для освобождения памяти СУБД")

        if re.search(r"ЛЕВОЕ\s+СОЕДИНЕНИЕ", modified, re.IGNORECASE) and not re.search(
            r"ЕСТЬNULL", modified, re.IGNORECASE
        ):
            null_target = re.compile(
                r"([а-яА-ЯёЁa-zA-Z0-9_]+\.(?:Количество|Сумма|Остаток)[а-яА-ЯёЁa-zA-Z0-9_]*)", re.IGNORECASE
            )
            if null_target.search(modified):
                modified = null_target.sub(r"ЕСТЬNULL(\1, 0)", modified)
                applied_optimizations.append("Обертывание числовых полей соединения в функцию ЕСТЬNULL(..., 0)")

        return {
            "refactoredQuery": modified,
            "appliedOptimizations": applied_optimizations,
        }

    @staticmethod
    def generate_extension_method(
        method_name: str,
        directive: str,
        params: Optional[List[str]] = None,
        is_function: bool = False
    ) -> str:
        """Generates 1C configuration extension (cfe) method interceptor."""
        params_str = ", ".join(params or ["Отказ"])
        keyword = "Функция" if is_function else "Процедура"
        end_keyword = "КонецФункции" if is_function else "КонецПроцедуры"

        if directive == "Вместо":
            body = f"""    // [NormaHub Extension] Перехват &Вместо
    // Вызов оригинального метода поставщика
    {"Результат = " if is_function else ""}ПродолжитьВызов({params_str});
    {"Возврат Результат;" if is_function else ""}"""
        elif directive == "Перед":
            body = """    // [NormaHub Extension] Проверки перед вызовом типовой процедуры
    // Отказ = Истина; // при необходимости прерывания"""
        elif directive == "После":
            body = """    // [NormaHub Extension] Постобработка после завершения типового метода"""
        elif directive == "ИзменениеИКонтроль":
            body = """    // Оригинальный код поставщика...
#Вставка
    // [NormaHub Extension] Вставка нового кода без снятия с поддержки
    Сообщить("Выполнен модифицированный участок кода расширения");
#КонецВставки
    // Продолжение оригинального кода..."""
        else:
            body = "    // Логика расширения"

        return f"""&{directive}("{method_name}")
{keyword} Расш_{method_name}({params_str})
{body}
{end_keyword}"""

    @staticmethod
    def call_normahub_llm(
        api_key: str,
        base_url: str,
        model: str,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 1500
    ) -> str:
        """Calls NormaHub LLM gateway directly via HTTPS."""
        if not api_key:
            raise ValueError("NORMAHUB_API_KEY не задан")

        parsed = urllib.parse.urlparse(base_url)
        hostname = (parsed.hostname or "").lower()
        trusted_hosts = ("api.normahub.cc", "normahub.cc", "localhost", "127.0.0.1", "::1")
        is_trusted = (
            hostname in trusted_hosts
            or hostname.endswith(".normahub.cc")
        )
        if not is_trusted:
            raise ValueError(
                f"Untrusted baseUrl host: '{hostname}'. NormaHub API key will not be sent to untrusted domains."
            )

        url = f"{base_url.rstrip('/')}/chat/completions"
        payload = json.dumps({
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.1,
            "max_tokens": max_tokens
        }).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            },
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=25) as response:
                body = response.read().decode("utf-8")
                data = json.loads(body)
                return data["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            raise RuntimeError(f"NormaHub API Error (HTTP {e.code}): {err_body}")
        except Exception as e:
            raise RuntimeError(f"Ошибка запроса к NormaHub: {str(e)}")

    @staticmethod
    def generate_bdd_feature(
        doc_name: str = "РеализацияТоваровУслуг",
        tabular_section: str = "Товары",
        register_name: str = "ТоварыНаСкладах",
        user_role: str = "Администратор"
    ) -> str:
        """Generates Russian Gherkin .feature file for Vanessa-Automation."""
        clean_doc = doc_name.strip() or "РеализацияТоваровУслуг"
        clean_tab = tabular_section.strip() or "Товары"
        clean_reg = register_name.strip() or "ТоварыНаСкладах"

        return f"""# language: ru

Функционал: Проведение и валидация документа "{clean_doc}"
  Как Менеджер по продажам / Кладовщик
  Я хочу быстро создавать и проводить документ "{clean_doc}" с проверкой остатков
  Чтобы исключить отрицательные остатки на складах и гарантировать целостность данных

Контекст:
  Дано Я открыл сеанс пользователя "{user_role}"
  И Я открыл навигационную панель

  Сценарий: Успешное создание и проведение документа "{clean_doc}"
    Когда в командном интерфейсе я выбираю "Основное" -> "{clean_doc}"
    Тогда открылось окно "{clean_doc}"
    И я нажимаю кнопку "Создать"
    Тогда открылось окно "{clean_doc} (создание)"
    И я заполняю реквизит "Организация" значением "Основная организация"
    И я заполняю реквизит "Склад" значением "Основной склад"
    И в табличной части "{clean_tab}" я нажимаю кнопку "Добавить"
    И в табличной части "{clean_tab}" я заполняю текущую строку:
      | 'Номенклатура' | 'Количество' | 'Цена' |
      | 'Тестовый товар А' | 5 | 1200 |
    И я нажимаю кнопку "Провести и закрыть"
    Тогда открылось окно "{clean_doc}"
    И я проверяю движения документа по регистру "{clean_reg}"

  Сценарий: Контроль превышения остатка при проведении "{clean_doc}"
    Когда в командном интерфейсе я выбираю "Основное" -> "{clean_doc}"
    И я нажимаю кнопку "Создать"
    И в табличной части "{clean_tab}" я заполняю текущую строку:
      | 'Номенклатура' | 'Количество' |
      | 'Тестовый товар Недостача' | 999999 |
    И я нажимаю кнопку "Провести"
    Тогда я жду появления сообщения об ошибке "Недостаточно товара на складе"
"""

    @staticmethod
    def analyze_tech_log(raw_log: str) -> Dict[str, Any]:
        """Parses and diagnoses 1C Technological Log (ТЖ) events."""
        events = []
        diagnoses = []

        lines = raw_log.split("\n")
        current_event_text = ""

        for line in lines:
            trimmed = line.strip()
            if re.match(r"^\d{2}:\d{2}\.\d{4,6}-\d+,\w+,\d+", trimmed):
                if current_event_text:
                    ev = SidecarCore._parse_single_techlog_event(current_event_text)
                    if ev:
                        events.append(ev)
                current_event_text = trimmed
            elif current_event_text:
                current_event_text += "\n" + line

        if current_event_text:
            ev = SidecarCore._parse_single_techlog_event(current_event_text)
            if ev:
                events.append(ev)

        for ev in events:
            event_name = ev.get("event", "OTHER")
            duration_sec = ev.get("duration_sec", 0.0)
            props = ev.get("properties", {})
            context = props.get("Context", props.get("context", ""))

            if event_name == "TLOCK":
                regions = props.get("Regions", props.get("regions", "Не указаны"))
                wait_conns = props.get("WaitConnections", props.get("waitConnections", ""))
                is_crit = duration_sec >= 5.0
                diagnoses.append({
                    "severity": "critical" if is_crit else "warning",
                    "category": "Транзакционные блокировки (TLOCK)",
                    "title": f"Ожидание на управляемой блокировке: {duration_sec:.2f} сек.",
                    "description": f"Сеанс ожидал освобождения блокировки по регистру/таблице '{regions}'. Конфликт: {wait_conns or 'не определен'}.",
                    "context": context,
                    "recommendations": [
                        "Уменьшите время активной транзакции (вынесите чтение за пределы).",
                        "Используйте объект БлокировкаДанных с детализацией по измерениям.",
                        "Включите разделение итогов регистра накопления."
                    ]
                })
            elif event_name == "TDEADLOCK":
                conns = props.get("DeadlockConnectionList", "")
                diagnoses.append({
                    "severity": "critical",
                    "category": "Взаимные блокировки (TDEADLOCK)",
                    "title": "Обнаружен DEADLOCK (Взаимная блокировка сеансов)",
                    "description": f"Взаимная блокировка между сеансами 1С/СУБД: {conns}.",
                    "context": context,
                    "recommendations": [
                        "Соблюдайте единый глобальный порядок захвата таблиц во всех документах конфигурации.",
                        "Захватывайте строки в упорядоченном виде (по Номенклатура.Ссылка).",
                        "Проверьте наличие индексов на СУБД для предотвращения эскалации блокировок."
                    ]
                })
            elif event_name == "EXCP":
                descr = props.get("Descr", props.get("descr", "Системное исключение"))
                diagnoses.append({
                    "severity": "critical",
                    "category": "Исключение / Ошибка (EXCP)",
                    "title": "Необработанное исключение платформы 1С",
                    "description": descr,
                    "context": context,
                    "recommendations": [
                        "Локализуйте строку ошибки по Context стеку вызовов.",
                        "Оберните критический участок в Попытка ... Исключение.",
                        "Проверьте передачу мутабельных типов между клиентом и сервером."
                    ]
                })
            elif event_name in ("SDBL", "DBPOSTGR", "DBMSSQL"):
                sql = props.get("Sql", props.get("sql", ""))
                diagnoses.append({
                    "severity": "critical" if duration_sec >= 3.0 else "warning",
                    "category": "Медленный запрос к СУБД",
                    "title": f"Медленный запрос ({event_name}): {duration_sec:.2f} сек.",
                    "description": f"Выполнение запроса на уровне СУБД заняло {duration_sec:.2f} с.",
                    "context": context,
                    "sql_preview": sql[:120] + "..." if len(sql) > 120 else sql,
                    "recommendations": [
                        "Проверьте план запроса (EXPLAIN / Showplan).",
                        "Исключите соединения с виртуальными таблицами без временных таблиц.",
                        "Убедитесь в саргабельности условий фильтрации."
                    ]
                })

        report_lines = [f"## 📊 Отчет диагностики Технологического Журнала 1С\nОбнаружено событий: {len(events)}, Инцидентов: {len(diagnoses)}\n"]
        for idx, d in enumerate(diagnoses, 1):
            badge = "🔴 [КРИТИЧНО]" if d["severity"] == "critical" else "🟡 [ВНИМАНИЕ]"
            report_lines.append(f"### {idx}. {badge} {d['title']}")
            report_lines.append(f"- **Категория:** {d['category']}")
            if d.get("context"):
                report_lines.append(f"- **Контекст 1С:** `{d['context']}`")
            report_lines.append(f"- **Описание:** {d['description']}")
            report_lines.append("**💡 Рекомендации:**")
            for rec in d["recommendations"]:
                report_lines.append(f"  - {rec}")
            report_lines.append("")

        return {
            "events_count": len(events),
            "diagnoses_count": len(diagnoses),
            "diagnoses": diagnoses,
            "report": "\n".join(report_lines)
        }

    @staticmethod
    def _parse_single_techlog_event(event_text: str) -> Optional[Dict[str, Any]]:
        header = re.match(r"^(\d{2}:\d{2}\.\d{4,6})-(\d+),(\w+),(\d+),(.*)", event_text, re.DOTALL)
        if not header:
            return None

        duration_microsec = int(header.group(2))
        event_name = header.group(3).upper()
        payload = header.group(5)

        properties = {}
        for m in re.finditer(r"([a-zA-Z0-9_:]+)=(?:'([^']*)'|([^,]*))(?:,|$)", payload):
            k = m.group(1)
            v = m.group(2) if m.group(2) is not None else m.group(3)
            if k:
                properties[k] = v.strip() if v else ""

        return {
            "timestamp": header.group(1),
            "duration_microsec": duration_microsec,
            "duration_sec": duration_microsec / 1000000.0,
            "event": event_name,
            "level": int(header.group(4)),
            "properties": properties,
            "raw_text": event_text
        }
