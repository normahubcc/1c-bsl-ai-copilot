#!/usr/bin/env python3
"""Explicit MCP smoke checks using only public documentation and a synthetic local page."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import sys
import threading
import urllib.request

from check_setup import ROOT, RpcProcess


def text_content(result):
    return "\n".join(block.get("text", "") for block in result.get("content", []) if block.get("type") == "text")


def result_of(response):
    assert "error" not in response, response.get("error")
    result = response["result"]
    assert not result.get("isError"), text_content(result)
    return result


def snapshot_content(result):
    content = text_content(result)
    match = re.search(r"\[Snapshot\]\(([^)]+)\)", content)
    if match:
        path = Path(match.group(1))
        path = path.resolve() if path.is_absolute() else (ROOT / path).resolve()
        assert path.is_relative_to(ROOT / ".codex/artifacts/playwright")
        assert path.stat().st_size < 2_000_000
        content += "\n" + path.read_text()
    return content


def browser_smoke():
    page = b"""<!doctype html><html lang="en"><title>Codex MCP setup probe</title>
<h1>Local synthetic probe</h1><button onclick="document.querySelector('output').textContent='Probe passed'">Run probe</button>
<output>Waiting</output></html>"""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(page)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    serving = threading.Thread(target=server.serve_forever, daemon=True)
    serving.start()
    rpc = RpcProcess([sys.executable, str(ROOT / ".codex/scripts/start_mcp.py"), "playwright"])
    try:
        initialized = rpc.call("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                               "clientInfo": {"name": "project-mcp-smoke", "version": "1.0.0"}})
        assert "result" in initialized, initialized
        rpc.send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        listed = rpc.call("tools/list", {})
        names = [tool["name"] for tool in listed["result"]["tools"]]
        assert all(name in names for name in ("browser_navigate", "browser_click", "browser_take_screenshot"))

        def call(name, arguments):
            return result_of(rpc.call("tools/call", {"name": name, "arguments": arguments}, timeout=45))

        opened = call("browser_navigate", {"url": f"http://127.0.0.1:{server.server_port}/"})
        snapshot = snapshot_content(opened)
        match = re.search(r'button "Run probe" \[ref=([^\]]+)\]', snapshot)
        assert match, snapshot
        clicked = call("browser_click", {"element": "Run probe button", "target": match.group(1)})
        assert "Probe passed" in snapshot_content(clicked), snapshot_content(clicked)
        shot = ROOT / ".codex/artifacts/playwright/setup-smoke.png"
        call("browser_take_screenshot", {"filename": str(shot), "type": "png", "scale": "css"})
        assert shot.is_file() and shot.stat().st_size > 0
        call("browser_close", {})
        return {"initialize_list_navigate_click_screenshot": "pass", "fixture": "synthetic local page only",
                "tools_discovered": len(names), "screenshot": str(shot.relative_to(ROOT)),
                "screenshot_sha256": hashlib.sha256(shot.read_bytes()).hexdigest(), "live_ide": False}
    finally:
        rpc.close()
        server.shutdown()
        server.server_close()
        serving.join(timeout=5)


def docs_smoke():
    url = "https://developers.openai.com/mcp"
    session = None
    protocol = "2025-06-18"
    identifier = 0

    def send(method, params, notification=False):
        nonlocal session, identifier
        identifier += 1
        message = {"jsonrpc": "2.0", "method": method, "params": params}
        if not notification:
            message["id"] = identifier
        headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
                   "MCP-Protocol-Version": protocol}
        if session:
            headers["Mcp-Session-Id"] = session
        request = urllib.request.Request(url, data=json.dumps(message).encode(), headers=headers, method="POST")
        with urllib.request.urlopen(request, timeout=35) as response:
            session = response.headers.get("Mcp-Session-Id", session)
            if notification or response.status == 202:
                return None
            if "text/event-stream" in response.headers.get("Content-Type", ""):
                for line in response:
                    if line.startswith(b"data:"):
                        result = json.loads(line[5:])
                        if result.get("id") == identifier:
                            return result
                raise RuntimeError("No response event in documentation MCP stream")
            return json.load(response)

    initialized = send("initialize", {"protocolVersion": protocol, "capabilities": {},
                                      "clientInfo": {"name": "project-docs-smoke", "version": "1.0.0"}})
    assert "result" in initialized, initialized
    protocol = initialized["result"]["protocolVersion"]
    send("notifications/initialized", {}, notification=True)
    listing = send("tools/list", {})
    tools = listing["result"]["tools"]
    search = next(tool for tool in tools if "search" in tool["name"].lower())
    assert "query" in search.get("inputSchema", {}).get("properties", {})
    arguments = {"query": "Codex project scoped MCP config.toml AGENTS.md"}
    if "limit" in search.get("inputSchema", {}).get("properties", {}):
        arguments["limit"] = 1
    found = result_of(send("tools/call", {"name": search["name"], "arguments": arguments}))
    assert found.get("content"), found
    return {"initialize_list_search": "pass", "protocol": protocol, "search_tool": search["name"],
            "tools": [tool["name"] for tool in tools], "private_content_sent": False, "inference_call": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", action="store_true")
    parser.add_argument("--docs", action="store_true")
    args = parser.parse_args()
    if not (args.browser or args.docs):
        parser.error("Choose --browser and/or --docs explicitly")
    report = {}
    if args.browser:
        report["browser"] = browser_smoke()
    if args.docs:
        report["docs"] = docs_smoke()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
