#!/usr/bin/env python3
"""Start reviewed project MCPs without downloading packages or inheriting API keys."""
import json
import os
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[2]
PLAYWRIGHT_MCP_VERSION = "0.0.83"


def command_for(server):
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is unavailable; install the project's supported Node version.")
    if server == "copilot":
        bundle = ROOT / "dist/mcp-server.js"
        if not bundle.is_file():
            raise RuntimeError("Missing dist/mcp-server.js. Run pnpm build in this repository first.")
        return [node, str(ROOT / "bin/mcp-server-1c.js")]
    if server != "playwright":
        raise RuntimeError("Supported server names: copilot, playwright")
    cache = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache")))
    package = cache / "1c-copilot-codex/playwright-mcp/node_modules/@playwright/mcp"
    manifest = package / "package.json"
    if not manifest.is_file() or json.loads(manifest.read_text())["version"] != PLAYWRIGHT_MCP_VERSION:
        raise RuntimeError("Pinned Playwright MCP is missing or mismatched; follow docs/CODEX_MCP.md. No automatic download.")
    browsers = cache / "ms-playwright"
    candidates = []
    for directory in browsers.glob("chromium-*"):
        suffix = directory.name.removeprefix("chromium-")
        if suffix.isdigit():
            candidates.extend((int(suffix), p) for p in directory.glob("*/chrome") if p.is_file())
    if not candidates:
        raise RuntimeError("No installed Linux Chromium found; provision a browser explicitly per docs/CODEX_MCP.md.")
    executable = max(candidates, key=lambda item: item[0])[1]
    output = ROOT / ".codex/artifacts/playwright"
    output.mkdir(parents=True, exist_ok=True)
    return [node, str(package / "cli.js"), "--headless", "--isolated", "--browser", "chrome",
            "--executable-path", str(executable), "--sandbox", "--no-webmcp", "--block-service-workers",
            "--allowed-hosts", "localhost,127.0.0.1", "--allowed-origins", "http://127.0.0.1:*;http://localhost:*",
            "--output-dir", str(output)]


def main():
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: python3 .codex/scripts/start_mcp.py copilot|playwright")
    command = command_for(sys.argv[1])
    keep = {"PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR"}
    environment = {key: value for key, value in os.environ.items() if key in keep}
    os.chdir(ROOT)
    os.execve(command[0], command, environment)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        print(f"Project MCP startup failed: {error}", file=sys.stderr)
        sys.exit(1)
