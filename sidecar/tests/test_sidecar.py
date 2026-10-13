"""Unit tests for 1C Configurator Global Sidecar."""

import json
import socket
import threading
import time
import urllib.request
import unittest

from sidecar.config import SidecarConfig
from sidecar.core import SidecarCore
from sidecar.server import ThreadingHTTPServer, SidecarHandler
from sidecar.clipboard_watcher import ClipboardWatcher


class TestSidecarCore(unittest.TestCase):
    def test_audit_bsl_code_flags_violations(self):
        code = """
        Для Каждого Стр Из ТЧ Цикл
            Запрос = Новый Запрос;
            Запрос.Выполнить();
        КонецЦикла;
        """
        issues = SidecarCore.audit_bsl_code(code)
        rules = [i["rule"] for i in issues]
        self.assertIn("ITS-PERF-001", rules)

    def test_audit_bsl_code_clean_code(self):
        code = """
        Процедура ОбработкаПроведения(Отказ, РежимПроведения)
            Блокировка = Новый БлокировкаДанных;
            Блокировка.Заблокировать();
        КонецПроцедуры
        """
        issues = SidecarCore.audit_bsl_code(code)
        self.assertEqual(len(issues), 0)

    def test_build_batch_query(self):
        query = SidecarCore.build_batch_query("ЗаказКлиента", "Товары", "ТоварыНаСкладах")
        self.assertIn("ПОМЕСТИТЬ ВТ_Товары", query)
        self.assertIn("ИНДЕКСИРОВАТЬ ПО", query)
        self.assertIn("УНИЧТОЖИТЬ ВТ_Товары", query)
        self.assertIn("МенеджерВременныхТаблиц", query)

    def test_build_batch_query_srez_poslednih(self):
        query = SidecarCore.build_batch_query("УстановкаЦен", "Товары", "ЦеныНоменклатуры", register_type="СрезПоследних")
        self.assertIn("РегистрСведений.ЦеныНоменклатуры.СрезПоследних", query)
        self.assertNotIn("РегистрНакопления.ЦеныНоменклатуры", query)

    def test_call_normahub_llm_rejects_untrusted_host(self):
        with self.assertRaises(ValueError) as ctx:
            SidecarCore.call_normahub_llm(
                api_key="secret",
                base_url="https://evil-untrusted-server.com/v1",
                model="deepseek-v4.1-flash",
                system_prompt="test",
                user_prompt="test"
            )
        self.assertIn("Untrusted baseUrl host", str(ctx.exception))

    def test_refactor_query(self):
        query = """
        ВЫБРАТЬ Док.Номенклатура, Остатки.КоличествоОстаток
        ИЗ Документ.РеализацияТоваровУслуг.Товары КАК Док
        ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.ТоварыНаСкладах.Остатки(&Период, ) КАК Остатки
            ПО Док.Номенклатура = Остатки.Номенклатура
        """
        res = SidecarCore.refactor_query(query)
        self.assertIn("ПОМЕСТИТЬ ВТ_Остатки", res["refactoredQuery"])
        self.assertIn("ИНДЕКСИРОВАТЬ ПО", res["refactoredQuery"])
        self.assertIn("УНИЧТОЖИТЬ ВТ_Остатки", res["refactoredQuery"])
        self.assertIn("ЕСТЬNULL", res["refactoredQuery"])
        self.assertGreaterEqual(len(res["appliedOptimizations"]), 3)

    def test_generate_extension_method(self):
        ext_vmesto = SidecarCore.generate_extension_method("ОбработкаПроведения", "Вместо")
        self.assertIn('&Вместо("ОбработкаПроведения")', ext_vmesto)
        self.assertIn("ПродолжитьВызов(", ext_vmesto)

        ext_control = SidecarCore.generate_extension_method("ПроверитьЗаполнение", "ИзменениеИКонтроль")
        self.assertIn('&ИзменениеИКонтроль("ПроверитьЗаполнение")', ext_control)
        self.assertIn("#Вставка", ext_control)

    def test_clipboard_processor_intents(self):
        config = SidecarConfig()
        watcher = ClipboardWatcher(config)

        # 1. Extension intent
        res_ext = watcher.process_text("// перехват ОбработкаПроведения")
        self.assertIsNotNone(res_ext)
        self.assertIn('&Вместо("ОбработкаПроведения")', res_ext)

        # 2. Query intent
        res_query = watcher.process_text("// запрос остатки")
        self.assertIsNotNone(res_query)
        self.assertIn("ПОМЕСТИТЬ ВТ_Товары", res_query)

        # 3. Audit intent
        res_audit = watcher.process_text("Предупреждение(\"Ошибка!\");")
        self.assertIsNotNone(res_audit)
        self.assertIn("ITS-UI-003", res_audit)

        # 4. Vanessa BDD intent
        res_bdd = watcher.process_text("// ванесса ЗаказКлиента")
        self.assertIsNotNone(res_bdd)
        self.assertIn("Функционал: Проведение и валидация документа \"ЗаказКлиента\"", res_bdd)

        # 5. Tech Log intent
        tlog_snippet = "14:20.123000-8000000,TLOCK,2,process=rphost,Context=Док : 10 : Заблокировать(),Regions=Товары,WaitConnections=10"
        res_tlog = watcher.process_text(f"// тж\n{tlog_snippet}")
        self.assertIsNotNone(res_tlog)
        self.assertIn("Транзакционные блокировки (TLOCK)", res_tlog)

    def test_generate_bdd_feature(self):
        feat = SidecarCore.generate_bdd_feature("РеализацияТоваровУслуг", "Товары", "ТоварыНаСкладах")
        self.assertIn("# language: ru", feat)
        self.assertIn("Функционал: Проведение и валидация документа \"РеализацияТоваровУслуг\"", feat)
        self.assertIn("Сценарий: Успешное создание и проведение документа", feat)
        self.assertIn("Сценарий: Контроль превышения остатка", feat)

    def test_analyze_tech_log(self):
        log_sample = """
14:20.123000-8000000,TLOCK,2,process=rphost,Context=Документ.Реализация.Модуль : 142 : Заблокировать(),Regions=Товары,WaitConnections=100
15:02.450000-0,TDEADLOCK,3,process=rphost,Context=Документ.Заказ.Модуль : 88 : Записать(),DeadlockConnectionList=100 102
"""
        diag = SidecarCore.analyze_tech_log(log_sample)
        self.assertEqual(diag["events_count"], 2)
        self.assertEqual(diag["diagnoses_count"], 2)
        cats = [d["category"] for d in diag["diagnoses"]]
        self.assertIn("Транзакционные блокировки (TLOCK)", cats)
        self.assertIn("Взаимные блокировки (TDEADLOCK)", cats)
        self.assertIn("Рекомендации", diag["report"])


class TestSidecarHTTPServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Find free port
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            cls.port = s.getsockname()[1]

        cls.config = SidecarConfig(port=cls.port, host="127.0.0.1")
        SidecarHandler.config = cls.config
        cls.server = ThreadingHTTPServer((cls.config.host, cls.config.port), SidecarHandler)
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_health_endpoint(self):
        url = f"http://127.0.0.1:{self.port}/health"
        with urllib.request.urlopen(url) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data["status"], "ok")
            self.assertEqual(data["service"], "1c-configurator-sidecar")

    def test_audit_endpoint(self):
        url = f"http://127.0.0.1:{self.port}/v1/audit"
        payload = json.dumps({"code": "Предупреждение(\"Тест\");"}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data["issuesCount"], 1)
            self.assertEqual(data["issues"][0]["rule"], "ITS-UI-003")

    def test_query_endpoint(self):
        url = f"http://127.0.0.1:{self.port}/v1/query"
        payload = json.dumps({"entity": "ЗаказКлиента", "tabular": "Товары", "register": "ТоварыНаСкладах"}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertIn("ПОМЕСТИТЬ ВТ_Товары", data["code"])

    def test_query_refactor_endpoint(self):
        url = f"http://127.0.0.1:{self.port}/v1/query/refactor"
        raw_query = """
        ВЫБРАТЬ Док.Номенклатура ИЗ Документ.Реализация.Товары КАК Док
        ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.ТоварыНаСкладах.Остатки(&Период, ) КАК Остатки ПО Док.Номенклатура = Остатки.Номенклатура
        """
        payload = json.dumps({"query": raw_query}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertIn("ПОМЕСТИТЬ ВТ_Остатки", data["refactoredQuery"])
            self.assertIn("ИНДЕКСИРОВАТЬ ПО", data["refactoredQuery"])

    def test_extension_endpoint(self):
        url = f"http://127.0.0.1:{self.port}/v1/extension"
        payload = json.dumps({"method": "РассчитатьСкидки", "directive": "Вместо"}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertIn('&Вместо("РассчитатьСкидки")', data["code"])

    def test_bdd_endpoint(self):
        url = f"http://127.0.0.1:{self.port}/v1/bdd"
        payload = json.dumps({"entity": "ЗаказКлиента", "tabular": "Товары", "register": "ТоварыНаСкладах"}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertIn("Функционал: Проведение и валидация документа \"ЗаказКлиента\"", data["feature"])

    def test_techlog_endpoint(self):
        url = f"http://127.0.0.1:{self.port}/v1/techlog"
        snippet = "14:20.123000-8000000,TLOCK,2,process=rphost,Context=Док : 10 : Блокировать(),Regions=Товары,WaitConnections=1"
        payload = json.dumps({"rawLog": snippet}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data["events_count"], 1)
            self.assertEqual(data["diagnoses_count"], 1)
            self.assertIn("Транзакционные блокировки (TLOCK)", data["report"])

    def test_auth_token_enforcement(self):
        SidecarHandler._auth_token = "test-token-xyz"
        url = f"http://127.0.0.1:{self.port}/health"

        # 1. Unauthenticated request must return 401
        try:
            with urllib.request.urlopen(url) as resp:
                self.fail("Expected HTTP 401 without auth token")
        except urllib.error.HTTPError as err:
            self.assertEqual(err.code, 401)

        # 2. Authenticated request with Bearer token must succeed
        req = urllib.request.Request(url, headers={"Authorization": "Bearer test-token-xyz"})
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)

        # Reset
        SidecarHandler._auth_token = ""


if __name__ == "__main__":
    unittest.main()
