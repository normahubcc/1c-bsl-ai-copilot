#!/usr/bin/env python3
"""Release QA for the VSIX, MCP stdio server and NormaHub-only policy."""

import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def fail(message: str) -> None:
    raise AssertionError(message)


def main() -> None:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    version = package["version"]
    vsix_path = ROOT / f"{package['name']}-{version}.vsix"
    if not vsix_path.is_file():
        fail(f"release VSIX missing: {vsix_path.name}")

    with zipfile.ZipFile(vsix_path) as archive:
        names = set(archive.namelist())
        required = {
            "extension/package.json",
            "extension/dist/extension.js",
            "extension/dist/mcp-server.js",
            "extension/bin/mcp-server-1c.js",
            "extension/README.md",
            "extension/LICENSE",
            "extension/icon.png",
            "extension/media/1c-icon.svg",
        }
        missing = sorted(required - names)
        if missing:
            fail(f"VSIX missing runtime files: {missing}")
        packaged = json.loads(archive.read("extension/package.json"))
        if packaged["version"] != version:
            fail("VSIX package version differs from repository version")
        if packaged["main"] != "./dist/extension.js":
            fail("VSIX main entrypoint is invalid")
        extension_bundle = archive.read("extension/dist/extension.js").decode("utf-8")
        if "OPENAI_API_KEY" in extension_bundle or "normahub1c.baseUrl" in extension_bundle:
            fail("VSIX bundle contains a forbidden non-NormaHub cloud transport fallback")
        if "https://api.normahub.cc/v1" not in extension_bundle:
            fail("VSIX bundle does not contain the fixed NormaHub API endpoint")

    env = os.environ.copy()
    env.pop("NORMAHUB_API_KEY", None)
    env.pop("OPENAI_API_KEY", None)
    request_lines = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": "1c_audit_standards", "arguments": {"code": "Предупреждение(\"x\");"}},
        },
    ]
    process = subprocess.Popen(
        ["node", "bin/mcp-server-1c.js"],
        cwd=ROOT,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    stdout, stderr = process.communicate(
        "\n".join(json.dumps(item, ensure_ascii=False) for item in request_lines) + "\n",
        timeout=10,
    )
    if process.returncode not in (0, -15):
        fail(f"MCP server exited unexpectedly: {process.returncode}; stderr={stderr}")
    responses = [json.loads(line) for line in stdout.splitlines() if line.strip()]
    by_id = {response.get("id"): response for response in responses}
    if by_id.get(1, {}).get("result", {}).get("serverInfo", {}).get("name") != "1c-bsl-ai-copilot-mcp":
        fail("MCP initialize contract failed")
    tools = by_id.get(2, {}).get("result", {}).get("tools", [])
    tool_names = {tool.get("name") for tool in tools}
    required_tools = {"1c_audit_standards", "1c_build_batch_query", "1c_scan_metadata"}
    if not required_tools.issubset(tool_names):
        fail(f"MCP tool inventory incomplete: {sorted(required_tools - tool_names)}")
    if not by_id.get(3, {}).get("result", {}).get("content"):
        fail("MCP tool call returned no content")

    print(f"Release QA passed: {vsix_path.name}, {len(tools)} MCP tools, NormaHub-only bundle policy")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        print(f"Release QA failed: {error}", file=sys.stderr)
        sys.exit(1)
