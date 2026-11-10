#!/usr/bin/env python3
"""Validate project setup; optional real read-only Codex/MCP protocol checks."""
import argparse
import csv
import json
import os
from pathlib import Path
import re
import select
import subprocess
import sys
import time
import tomllib

ROOT = Path(__file__).resolve().parents[2]


class RpcProcess:
    def __init__(self, command):
        self.process = subprocess.Popen(command, cwd=ROOT, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.buffer = b""
        self.identifier = 0

    def send(self, message):
        self.process.stdin.write((json.dumps(message) + "\n").encode())
        self.process.stdin.flush()

    def call(self, method, params, timeout=20):
        self.identifier += 1
        identifier = self.identifier
        self.send({"jsonrpc": "2.0", "id": identifier, "method": method, "params": params})
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            while b"\n" in self.buffer:
                line, self.buffer = self.buffer.split(b"\n", 1)
                if not line.strip():
                    continue
                message = json.loads(line)
                if message.get("id") == identifier:
                    return message
            ready = select.select([self.process.stdout], [], [], max(0, end - time.monotonic()))[0]
            if not ready:
                break
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                detail = self.process.stderr.read(2000).decode(errors="replace")
                raise RuntimeError(f"RPC process exited during {method}: {detail}")
            self.buffer += chunk
        raise RuntimeError(f"RPC response timed out: {method}")

    def close(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            stream.close()


def structural_checks():
    config = tomllib.loads((ROOT / ".codex/config.toml").read_text())
    assert "model" not in config and "approval_policy" not in config and "sandbox_mode" not in config
    assert config["agents"]["max_concurrent_threads_per_session"] <= 3
    for server in config["mcp_servers"].values():
        if "command" in server:
            assert Path(server["cwd"]).resolve() == ROOT, "MCP cwd must identify this checkout"
            assert (ROOT / server["args"][0]).is_file(), "MCP launcher missing"
    role_names = []
    for path in sorted((ROOT / ".codex/agents").glob("*.toml")):
        role = tomllib.loads(path.read_text())
        assert all(isinstance(role[key], str) and role[key].strip() for key in ("name", "description", "developer_instructions"))
        assert not ({"sandbox_mode", "mcp_servers", "model", "model_provider", "approval_policy"} & role.keys())
        assert path.stem == role["name"]
        role_names.append(role["name"])
    assert len(role_names) == len(set(role_names))
    skills = []
    for path in sorted((ROOT / ".agents/skills").glob("*/SKILL.md")):
        content = path.read_text()
        assert content.startswith("---\n") and "TODO" not in content
        assert f"name: {path.parent.name}\n" in content and "description:" in content
        skills.append(path.parent.name)
    with (ROOT / "docs/AI_B2B_BACKLOG.csv").open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        rows = list(reader)
        assert all(set(row) == set(reader.fieldnames) and None not in row.values() for row in rows)
    tasks = {row["id"]: row for row in rows}
    assert len(tasks) == len(rows)
    done, active = set(), set()

    def visit(identifier):
        assert identifier in tasks, f"Unknown dependency {identifier}"
        assert identifier not in active, f"Cyclic dependency {identifier}"
        if identifier in done:
            return
        active.add(identifier)
        row = tasks[identifier]
        assert 0 < int(row["person_days_min"]) <= int(row["person_days_max"])
        for dependency in filter(None, row["depends_on"].split(";")):
            visit(dependency)
        active.remove(identifier)
        done.add(identifier)

    for identifier in tasks:
        visit(identifier)
    with (ROOT / "docs/AI_B2B_ACCEPTANCE_MATRIX.csv").open(encoding="utf-8-sig", newline="") as stream:
        matrix = list(csv.DictReader(stream))
    assert len({row["id"] for row in matrix}) == len(matrix)
    for row in matrix:
        assert all(identifier in tasks for identifier in row["backlog_ids"].split(";"))
    documents = [ROOT / name for name in ("AGENTS.md", "codex.md", "docs/AI_B2B_PRODUCT_TECHNICAL_PLAN.md",
                 "docs/AI_BUSINESS_VERIFICATION_SPEC.md", "docs/CODEX_MCP.md", "docs/CODEX_SETUP_AUDIT.md")]
    for path in documents:
        content = path.read_text()
        assert content.count("```") % 2 == 0, str(path)
        for target in re.findall(r"\]\(([^)]+)\)", content):
            if not re.match(r"https?://|#", target):
                assert (path.parent / target.split("#")[0]).exists(), f"Broken link {path}: {target}"
    return {"roles": role_names, "skills": skills, "servers": list(config["mcp_servers"]),
            "backlog_packages": len(rows), "acceptance_areas": len(matrix), "dag_and_links": "pass"}


def local_mcp_check():
    rpc = RpcProcess([sys.executable, str(ROOT / ".codex/scripts/start_mcp.py"), "copilot"])
    try:
        initialize = rpc.call("initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                                              "clientInfo": {"name": "copilot-setup-smoke", "version": "1.0.0"}})
        assert "error" not in initialize, initialize
        rpc.send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        listing = rpc.call("tools/list", {})
        names = [tool["name"] for tool in listing["result"]["tools"]]
        assert "1c_inspect_query" in names
        positive = rpc.call("tools/call", {"name": "1c_inspect_query", "arguments": {"queryText": "ВЫБРАТЬ 1 КАК Число"}})
        assert "result" in positive and not positive["result"].get("isError"), positive
        negative = rpc.call("tools/call", {"name": "unknown_setup_tool", "arguments": {}})
        assert "error" in negative or negative.get("result", {}).get("isError"), negative
        return {"protocol": initialize["result"]["protocolVersion"], "tools": names,
                "initialize_list_positive_negative": "pass", "independent_oracle": False, "engine_execution": False}
    finally:
        rpc.close()


def codex_check():
    rpc = RpcProcess(["codex", "app-server", "--stdio"])
    try:
        initialized = rpc.call("initialize", {"clientInfo": {"name": "project_setup_audit", "version": "1.0.0"},
                                               "capabilities": {"experimentalApi": True}})
        assert "error" not in initialized, initialized
        rpc.send({"method": "initialized"})
        response = rpc.call("config/read", {"includeLayers": True, "cwd": str(ROOT)})
        assert "result" in response, response
        result = response["result"]
        effective = result.get("config", {})
        servers = effective.get("mcp_servers", {})
        skills_response = rpc.call("skills/list", {"cwds": [str(ROOT)], "forceReload": True})
        assert "result" in skills_response, skills_response
        discovered = []
        errors = []
        for entry in skills_response["result"].get("data", []):
            errors.extend(entry.get("errors", []))
            discovered.extend(skill["name"] for skill in entry.get("skills", []) if str(ROOT) in str(skill.get("path", "")))
        expected_servers = {"copilot_local", "playwright_local", "openai_docs"}
        assert expected_servers <= set(servers), "Project MCP config is not effective; inspect exact project trust and cwd"
        assert {"copilot-runtime-verification", "onec-behavior-verification"} <= set(discovered), "Project skills not discovered"
        assert not errors, errors
        return {"effective_servers": list(servers), "server_cwds": {key: value.get("cwd") for key, value in servers.items()},
                "agents": effective.get("agents"), "project_skills": discovered, "skill_errors": errors,
                "layers": [{"name": layer.get("name"), "disabledReason": layer.get("disabledReason")} for layer in result.get("layers", [])]}
    finally:
        rpc.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-mcp", action="store_true")
    parser.add_argument("--codex", action="store_true")
    args = parser.parse_args()
    report = {"structure": structural_checks()}
    if args.local_mcp:
        report["local_mcp"] = local_mcp_check()
    if args.codex:
        report["codex"] = codex_check()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
