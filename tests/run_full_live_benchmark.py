import json
import os
import ssl
import time
import urllib.request

api_key = os.environ.get('NORMAHUB_API_KEY', '')
if not api_key:
    raise SystemExit('NORMAHUB_API_KEY is required; no API key is stored in source code')
base_url = 'https://api.normahub.cc/v1'
ctx = ssl.create_default_context()

def call_api(model, messages, max_tokens=1000):
    payload = {
        'model': model,
        'messages': messages,
        'max_tokens': max_tokens,
        'temperature': 0.1
    }
    t0 = time.time()
    req = urllib.request.Request(
        f'{base_url}/chat/completions',
        data=json.dumps(payload).encode('utf-8'),
        headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, context=ctx, timeout=60) as r:
        d = json.loads(r.read().decode('utf-8'))
        elapsed = time.time() - t0
        content = d['choices'][0]['message'].get('content', '')
        usage = d.get('usage', {})
        return elapsed, content, usage

test_cases = [
    {
        "name": "Тест 1: Быстрый FIM-автокомплит BSL",
        "model": "deepseek-v4.1-flash",
        "sys": "Ты 1C BSL автокомплит. Заверши логику цикла движения без лишних слов.",
        "prompt": "Для Каждого Стр Из ТаблицаТоваров Цикл\n    Движение = Движения.ТоварыНаСкладах.ДобавитьРасход();\n    Движение.Период = Дата;\n    Движение.Номенклатура = Стр.Номенклатура;\n    // допиши реквизиты и заверши цикл",
        "max_tokens": 400
    },
    {
        "name": "Тест 2: Пакетный запрос 1С по стандартам ИТС",
        "model": "deepseek-v4.1-flash",
        "sys": "Ты Senior 1C Developer. Сгенерируй строго BSL код запроса с временной таблицей ВТ_Товары, индексом по Номенклатуре и проверкой остатков без прямого соединения с регистром.",
        "prompt": "Напиши процедуру проведения документа 'РеализацияТоваровУслуг' по регистру 'ТоварыНаСкладах' с блокировкой Движения.ТоварыНаСкладах.БлокироватьДляИзменения = Истина и контролем отрицательных остатков.",
        "max_tokens": 1200
    },
    {
        "name": "Тест 3: Рефакторинг антипаттерна (Запрос в цикле + ПолучитьОбъект)",
        "model": "deepseek-v4.1-flash",
        "sys": "Ты архитектор 1С. Проведи рефакторинг BSL-кода, устрани антипаттерны: запрос в цикле и Ссылка.ПолучитьОбъект(). Замени на БСП ОбщегоНазначенияКлиентСервер.СвойстваОбъекта() или единую выборку.",
        "prompt": "Код с антипаттерном:\nДля Каждого Стр Из ТЧ Цикл\n    ОбъектНом = Стр.Номенклатура.ПолучитьОбъект();\n    Запрос = Новый Запрос(\"ВЫБРАТЬ Цена ИЗ РегистрСведений.ЦеныНоменклатуры.СрезПоследних(, Номенклатура = &Ном)\");\n    Запрос.УстановитьПараметр(\"Ном\", Стр.Номенклатура);\n    Стр.Цена = Запрос.Выполнить().Выгрузить()[0].Цена;\nКонецЦикла;",
        "max_tokens": 1200
    },
    {
        "name": "Тест 4: Генерация Vanessa Automation (BDD feature)",
        "model": "deepseek-v4.1-flash",
        "sys": "Ты специалист по автоматизированному тестированию 1С (Vanessa Automation). Сгенерируй Gherkin-сценарий .feature на русском языке.",
        "prompt": "Сценарий: Проведение документа Реализация товаров и услуг. Если количество товара на складе меньше требуемого, система должна выдать ошибку 'Недостаточно остатка на складе Основной'.",
        "max_tokens": 600
    },
    {
        "name": "Тест 5: Анализ инцидента Технологического Журнала (TLOCK Deadlock)",
        "model": "gpt-6-sol",
        "sys": "Ты эксперт по HighLoad 1С и анализу ТЖ. Разбери инцидент TLOCK, определи тип блокировки, ресурс и дай конкретное решение для 1С разработчика.",
        "prompt": "Лог ТЖ:\n42:15.890001-2500000,TLOCK,3,process=rphost,Regions=AccumRegister.ТоварыНаСкладах,WaitConnections=18,Context=Документ.РеализацияТоваровУслуг.МодульОбъекта : 142\nLocks=AccumRegister.ТоварыНаСкладах(Exclusive, Sklad='Основной', Nomenklatura='00001')",
        "max_tokens": 800
    }
]

print("=== НАЧАЛО РЕАЛЬНОГО QA ТЕСТИРОВАНИЯ НА ПЛАТНОМ API NORMAHUB ===")
results = []
for i, tc in enumerate(test_cases, 1):
    print(f"\n[{i}/5] Запуск {tc['name']} (Модель: {tc['model']})...")
    try:
        msgs = [{"role": "system", "content": tc["sys"]}, {"role": "user", "content": tc["prompt"]}]
        elapsed, content, usage = call_api(tc["model"], msgs, tc["max_tokens"])
        print(f"-> УСПЕШНО! Время: {elapsed:.2f} сек. Токены: {usage.get('total_tokens', 'N/A')} (Prompt: {usage.get('prompt_tokens', 0)}, Completion: {usage.get('completion_tokens', 0)})")
        print("Фрагмент ответа:")
        preview = content[:250].replace('\n', ' ')
        print(f"'{preview}...'")
        results.append({
            "name": tc["name"],
            "model": tc["model"],
            "status": "PASS",
            "time_sec": elapsed,
            "tokens": usage.get("total_tokens", 0),
            "content": content
        })
    except Exception as e:
        print(f"-> ОШИБКА: {e}")
        results.append({
            "name": tc["name"],
            "model": tc["model"],
            "status": "FAIL",
            "error": str(e)
        })

print("\n=== ИТОГОВЫЙ ОТЧЕТ ТЕСТИРОВАНИЯ ===")
all_pass = all(r["status"] == "PASS" for r in results)
print(f"Общий статус: {'ВСЕ ТЕСТЫ ПРОЙДЕНЫ (5/5)' if all_pass else 'ЧАСТИЧНЫЙ ПРОХОД'}")
