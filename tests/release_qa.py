#!/usr/bin/env python3
"""Release QA for the VSIX, MCP stdio server and NormaHub-only policy."""

import json
import os
import re
import subprocess
import sys
import tempfile
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
        credential_patterns = {
            "NormaHub key": re.compile(rb"nr_hub_[A-Za-z0-9-]{24,}"),
            "Open VSX token": re.compile(rb"ovsxat_[A-Za-z0-9]{20,}"),
            "private PEM": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
        }
        for member in names:
            body = archive.read(member)
            for label, pattern in credential_patterns.items():
                if pattern.search(body):
                    fail(f"VSIX contains {label} in {member}; value intentionally not printed")
        required = {
            "extension/package.json",
            "extension/package.nls.json",
            "extension/package.nls.ru.json",
            "extension/dist/extension.js",
            "extension/dist/mcp-server.js",
            "extension/dist/toolbox-cli.js",
            "extension/bin/mcp-server-1c.js",
            "extension/README.md",
            "extension/LICENSE",
            "extension/icon.png",
            "extension/media/1c-icon.svg",
            "extension/language-configuration.json",
            "extension/syntaxes/bsl.tmLanguage.json",
        }
        missing = sorted(required - names)
        if missing:
            fail(f"VSIX missing runtime files: {missing}")
        for name in required:
            source = ROOT / name.removeprefix("extension/")
            if source.read_bytes() != archive.read(name):
                fail(f"Packaged file differs from the current worktree: {name}")
        packaged = json.loads(archive.read("extension/package.json"))
        localization_keys = set(re.findall(r'%([a-zA-Z0-9_.-]+)%', json.dumps(packaged)))
        for locale_file in ("package.nls.json", "package.nls.ru.json"):
            catalogue = json.loads(archive.read("extension/"+locale_file))
            if any(not isinstance(catalogue.get(key), str) or not catalogue[key].strip() for key in localization_keys):
                fail(f"Incomplete extension localization: {locale_file}")
        if packaged["version"] != version:
            fail("VSIX package version differs from repository version")
        if packaged["main"] != "./dist/extension.js":
            fail("VSIX main entrypoint is invalid")
        lang_ids = {lang.get("id") for lang in packaged.get("contributes", {}).get("languages", [])}
        if not {"bsl", "1c", "oscript"}.issubset(lang_ids):
            fail(f"VSIX package must contribute bsl/1c/oscript languages, got: {sorted(lang_ids)}")
        grammar_langs = {g.get("language") for g in packaged.get("contributes", {}).get("grammars", [])}
        if not {"bsl", "1c", "oscript"}.issubset(grammar_langs):
            fail("VSIX package must contribute TextMate grammars for bsl/1c/oscript")
        if packaged["contributes"]["configuration"]["properties"]["normahub1c.contextBudgetChars"]["default"] != 200000:
            fail("VSIX contextBudgetChars default must be 200000")
        model_settings = packaged["contributes"]["configuration"]["properties"]
        for name in ("autocompleteModel", "reasoningModel"):
            choices = model_settings["normahub1c."+name]["enum"]
            if "deepseek-v4.1-flash-1017" not in choices or "deepseek-v4.1-flash" in choices:
                fail("The release must offer DeepSeek 1017 instead of the legacy model")
        if model_settings["normahub1c.autocompleteModel"]["default"] != "deepseek-v4.1-flash-1017":
            fail("Autocomplete must default to DeepSeek 1017")
        extension_bundle = archive.read("extension/dist/extension.js").decode("utf-8")
        if "OPENAI_API_KEY" in extension_bundle or "normahub1c.baseUrl" in extension_bundle:
            fail("VSIX bundle contains a forbidden non-NormaHub cloud transport fallback")
        if "https://api.normahub.cc/v1" not in extension_bundle:
            fail("VSIX bundle does not contain the fixed NormaHub API endpoint")

    env = os.environ.copy()
    env.pop("NORMAHUB_API_KEY", None)
    env.pop("OPENAI_API_KEY", None)
    query = "ВЫБРАТЬ Цены.Цена ИЗ Справочник.Номенклатура КАК Н ЛЕВОЕ СОЕДИНЕНИЕ РегистрСведений.Цены.СрезПоследних(&Дата,) КАК Цены ПО Н.Ссылка = Цены.Номенклатура"
    calls = {
        "1c_audit_standards": {"code": 'Предупреждение("x");'},
        "1c_build_batch_query": {"entityName":"ЗаказКлиента", "tabularSection":"Товары", "registerName":"Остатки", "fields":["Номенклатура","Количество"]},
        "1c_inspect_query": {"queryText":query},
        "1c_refactor_query": {"rawQuery":query},
        "1c_generate_extension": {"targetMethod":"ПриОткрытии", "moduleType":"МодульФормы", "directive":"Вместо"},
        "1c_bsp_search": {"query":"ЗначениеРеквизитаОбъекта"},
        "1c_scan_metadata": {"workspacePath":str(ROOT)},
        "1c_generate_bdd_feature": {"entityName":"ЗаказКлиента", "prompt":"Скидка 17%"},
        "1c_analyze_tech_log": {"rawLog":"00:01.000000-1,DBPOSTGR,1,Sql=SELECT 1"},
    }
    request_lines = [
        {"jsonrpc":"2.0", "id":1, "method":"initialize", "params":{}},
        {"jsonrpc":"2.0", "method":"notifications/initialized"},
        {"jsonrpc":"2.0", "id":2, "method":"tools/list", "params":{}},
    ] + [{"jsonrpc":"2.0", "id":i+3, "method":"tools/call", "params":{"name":name,"arguments":args}} for i, (name,args) in enumerate(calls.items())]
    request_lines.append({"jsonrpc":"2.0", "id":99, "method":"tools/call", "params":{"name":"1c_build_batch_query","arguments":{}}})
    request_lines.extend([
        {"jsonrpc":"2.0", "id":100, "method":"tools/call", "params":{"name":"1c_generate_extension","arguments":{"targetMethod":"Test","directive":"Вместо","isFunction":"true"}}},
        {"jsonrpc":"2.0", "id":101, "method":"tools/call", "params":{"name":"1c_generate_extension","arguments":False}},
        {"jsonrpc":"2.0", "id":102, "method":"tools/call", "params":False},
        {"jsonrpc":"2.0", "method":"tools/list"},
        None,
    ])
    # Execute the actual package contents without the repository's node_modules or out/.
    with tempfile.TemporaryDirectory(prefix="bsl-vsix-qa-") as temporary:
        with zipfile.ZipFile(vsix_path) as archive:
            archive.extractall(temporary)
        process = subprocess.run(
            ["node", "bin/mcp-server-1c.js"], cwd=Path(temporary)/"extension", env=env,
            input="\n".join(json.dumps(item,ensure_ascii=False) for item in request_lines)+"\n",
            capture_output=True, text=True, timeout=15, check=False,
        )
    if process.returncode:
        fail(f"Packaged MCP server failed: {process.returncode}; stderr={process.stderr}")
    responses = [json.loads(line) for line in process.stdout.splitlines() if line.strip()]
    by_id = {response.get("id"):response for response in responses}
    if by_id.get(1,{}).get("result",{}).get("serverInfo",{}).get("name") != "1c-bsl-ai-copilot-mcp":
        fail("Packaged MCP initialize failed")
    tools = by_id.get(2,{}).get("result",{}).get("tools",[])
    if {tool["name"] for tool in tools} != set(calls):
        fail("MCP inventory differs from the tested tools")
    results = {}
    for i, name in enumerate(calls):
        response = by_id.get(i+3,{})
        result = response.get("result",{})
        if response.get("error") or result.get("isError") or not result.get("content"):
            fail(f"Packaged tool failed: {name}")
        results[name] = json.loads(result["content"][0]["text"])
    if not by_id.get(99,{}).get("result",{}).get("isError"):
        fail("Invalid tool arguments must return a tool error")
    for invalid_id in (100, 101):
        if not by_id.get(invalid_id, {}).get("result", {}).get("isError"):
            fail(f"Invalid argument type silently accepted: {invalid_id}")
    if by_id.get(102, {}).get("error", {}).get("code") != -32602:
        fail("Invalid params must produce -32602")
    if by_id.get(None, {}).get("error", {}).get("code") != -32600:
        fail("Invalid request must produce -32600")
    if len(responses) != len(calls) + 7:
        fail("Notifications must not produce responses or suppress valid requests")
    if '&НаКлиенте' not in results["1c_generate_extension"]["code"]:
        fail("Explicit form module must infer the form event directive")
    if results["1c_analyze_tech_log"]["diagnosesCount"]:
        fail("Fast SQL must not be called an incident")
    if "Скидка 17%" not in results["1c_generate_bdd_feature"]["feature"]:
        fail("BDD must retain the complete requirement")
    rewritten = results["1c_refactor_query"]["refactoredQuery"]
    if "Цены.Количество" in rewritten or "КАК СрезПоследних" in rewritten:
        fail("Query rewrite invented a field")


    print(f"Release QA passed: {vsix_path.name}, {len(tools)} packaged MCP calls, invalid-input handling, artifact parity, credential pattern scan and NormaHub-only policy")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        print(f"Release QA failed: {error}", file=sys.stderr)
        sys.exit(1)
