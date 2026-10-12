#!/usr/bin/env python3
import http.server
import socketserver
from pathlib import Path

PORT = 8088
HTML_FILE = Path(__file__).resolve().parent.parent / "tests" / "webview_test.html"

class WebviewHandler(http.server.SimpleHTTPRequestHandler):
    def do_HEAD(self):
        if self.path in ("/", "/index.html"):
            if not HTML_FILE.exists():
                self.send_error(404, "webview_test.html not found")
                return
            content = HTML_FILE.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Connection", "close")
            self.end_headers()
        else:
            self.send_response(302)
            self.send_header("Location", "/")
            self.send_header("Connection", "close")
            self.end_headers()

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            if not HTML_FILE.exists():
                self.send_error(404, "webview_test.html not found")
                return
            content = HTML_FILE.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(content)
        else:
            self.send_response(302)
            self.send_header("Location", "/")
            self.send_header("Connection", "close")
            self.end_headers()

    def log_message(self, format, *args):
        print(f"[UI Preview Server :8088] {self.address_string()} - {format % args}")

class ReusableThreadingServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

if __name__ == "__main__":
    with ReusableThreadingServer(("0.0.0.0", PORT), WebviewHandler) as httpd:
        print(f"=======================================================")
        print(f" 1C BSL AI COPILOT — ИНТЕРАКТИВНЫЙ UI ПРЕДПРОСМОТР")
        print(f" URL: http://localhost:{PORT}")
        print(f" Статус: Сервер запущен, готов к тестированию в браузере")
        print(f"=======================================================")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
