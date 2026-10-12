"""Core logic engine for 1C:Enterprise code analysis, query generation, and ITS auditing."""

import json
import re
import urllib.error
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
        vt_source = f"ВТ_{tabular}"
        vt_balances = f"ВТ_Остатки{register}"

        query = f"""ВЫБРАТЬ
    ДокументТаблица.Номенклатура КАК Номенклатура,
    СУММА(ДокументТаблица.Количество) КАК Количество
ПОМЕСТИТЬ {vt_source}
ИЗ
    Документ.{entity}.{tabular} КАК ДокументТаблица
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
    Остатки.КоличествоОстаток КАК КоличествоОстаток
ПОМЕСТИТЬ {vt_balances}
ИЗ
    РегистрНакопления.{register}.{register_type}(
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
    ЕСТЬNULL(Остатки.КоличествоОстаток, 0) КАК Доступно,
    Исходные.Количество - ЕСТЬNULL(Остатки.КоличествоОстаток, 0) КАК Дефицит
ИЗ
    {vt_source} КАК Исходные
    ЛЕВОЕ СОЕДИНЕНИЕ {vt_balances} КАК Остатки
        ПО Исходные.Номенклатура = Остатки.Номенклатура
ГДЕ
    Исходные.Количество > ЕСТЬNULL(Остатки.КоличествоОстаток, 0)
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
