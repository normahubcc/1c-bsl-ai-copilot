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

    def test_extension_endpoint(self):
        url = f"http://127.0.0.1:{self.port}/v1/extension"
        payload = json.dumps({"method": "РассчитатьСкидки", "directive": "Вместо"}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertIn('&Вместо("РассчитатьСкидки")', data["code"])


if __name__ == "__main__":
    unittest.main()
