"""Lightweight Local HTTP REST Daemon for 1C:Enterprise Integration."""

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
import socketserver
from typing import Any, Dict
from sidecar.config import SidecarConfig
from sidecar.core import SidecarCore


class ThreadingHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True


class SidecarHandler(BaseHTTPRequestHandler):
    config: SidecarConfig = SidecarConfig()

    def _set_headers(self, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(204)

    def do_GET(self):
        if self.path in ("/health", "/status", "/"):
            resp = {
                "status": "ok",
                "service": "1c-configurator-sidecar",
                "version": "1.0.0",
                "model": self.config.autocomplete_model,
                "hasKey": bool(self.config.api_key)
            }
            self._set_headers(200)
            self.wfile.write(json.dumps(resp, ensure_ascii=False).encode("utf-8"))
        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": "Not Found"}).encode("utf-8"))

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_length)

        try:
            payload: Dict[str, Any] = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        except Exception:
            self._set_headers(400)
            self.wfile.write(json.dumps({"error": "Invalid JSON"}).encode("utf-8"))
            return

        if self.path == "/v1/audit":
            code = payload.get("code", "")
            issues = SidecarCore.audit_bsl_code(code)
            self._set_headers(200)
            self.wfile.write(json.dumps({
                "issuesCount": len(issues),
                "issues": issues
            }, ensure_ascii=False).encode("utf-8"))

        elif self.path == "/v1/query":
            entity = payload.get("entity", "РеализацияТоваровУслуг")
            tabular = payload.get("tabular", "Товары")
            register = payload.get("register", "ТоварыНаСкладах")
            query_code = SidecarCore.build_batch_query(entity, tabular, register)
            self._set_headers(200)
            self.wfile.write(json.dumps({"code": query_code}, ensure_ascii=False).encode("utf-8"))

        elif self.path == "/v1/query/refactor":
            raw_query = payload.get("query", "")
            refactor_result = SidecarCore.refactor_query(raw_query)
            self._set_headers(200)
            self.wfile.write(json.dumps(refactor_result, ensure_ascii=False).encode("utf-8"))

        elif self.path == "/v1/extension":
            method = payload.get("method", "ОбработкаПроведения")
            directive = payload.get("directive", "Вместо")
            params = payload.get("params", ["Отказ", "РежимПроведения"])
            is_func = payload.get("isFunction", False)
            ext_code = SidecarCore.generate_extension_method(method, directive, params, is_func)
            self._set_headers(200)
            self.wfile.write(json.dumps({"code": ext_code}, ensure_ascii=False).encode("utf-8"))

        elif self.path == "/v1/complete":
            prompt = payload.get("prompt", "")
            code_context = payload.get("code", "")
            system_prompt = "Ты — ведущий эксперт по языку 1С:Предприятие 8.3 (Стандарты фирмы «1С» и БСП). Допиши код без лишних пояснений."
            user_prompt = f"Контекст:\n{code_context}\n\nЗадача: {prompt}"

            try:
                result = SidecarCore.call_normahub_llm(
                    api_key=self.config.api_key,
                    base_url=self.config.base_url,
                    model=self.config.autocomplete_model,
                    system_prompt=system_prompt,
                    user_prompt=user_prompt
                )
                self._set_headers(200)
                self.wfile.write(json.dumps({"result": result}, ensure_ascii=False).encode("utf-8"))
            except Exception as e:
                self._set_headers(500)
                self.wfile.write(json.dumps({"error": str(e)}, ensure_ascii=False).encode("utf-8"))

        elif self.path == "/v1/bdd":
            entity = payload.get("entity", "РеализацияТоваровУслуг")
            tabular = payload.get("tabular", "Товары")
            register = payload.get("register", "ТоварыНаСкладах")
            feature = SidecarCore.generate_bdd_feature(entity, tabular, register)
            self._set_headers(200)
            self.wfile.write(json.dumps({"feature": feature}, ensure_ascii=False).encode("utf-8"))

        elif self.path == "/v1/techlog":
            raw_log = payload.get("rawLog", "")
            diagnosis = SidecarCore.analyze_tech_log(raw_log)
            self._set_headers(200)
            self.wfile.write(json.dumps(diagnosis, ensure_ascii=False).encode("utf-8"))

        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": "Route Not Found"}).encode("utf-8"))

    def log_message(self, format: str, *args: Any):
        # Suppress noisy standard request logging in daemon mode
        pass


def run_server(config: SidecarConfig):
    SidecarHandler.config = config
    server = ThreadingHTTPServer((config.host, config.port), SidecarHandler)
    print(f"✓ 1C Configurator Global Sidecar listening on http://{config.host}:{config.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down 1C Sidecar server...")
        server.server_close()
