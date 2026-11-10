"""Trusted fixture worker baked into the operator-approved local image; not shipped as runtime data."""
import hashlib
import json
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import re
from datetime import datetime

BINARY = "/opt/1cv8t/x86_64/8.3.27.1508/1cv8t"
VERSION = "8.3.27.1508"
WORK = Path("/work")


def stage(arguments, log, timeout=45):
    environment = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                   "HOME": str(WORK / "home"), "LANG": "ru_RU.UTF-8", "LC_ALL": "ru_RU.UTF-8", "DISPLAY": ":88"}
    with log.open("wb") as output:
        process = subprocess.Popen(arguments, env=environment, stdout=output, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + timeout
        try:
            process.wait(timeout=min(5, timeout))
        except subprocess.TimeoutExpired:
            if shutil.which("import"):
                subprocess.run(["/usr/bin/import", "-display", ":88", "-window", "root", str(WORK / "diagnostic.png")],
                               stdout=output, stderr=subprocess.STDOUT, check=False, timeout=5)
            try:
                process.wait(timeout=max(1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
                raise
    if process.returncode:
        raise RuntimeError(f"Platform stage failed: exit {process.returncode}; {log.name}")


def stop_process(process):
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def display():
    WORK.mkdir(exist_ok=True)
    (WORK / "home").mkdir(exist_ok=True)
    output = (WORK / "xvfb.log").open("wb")
    process = subprocess.Popen(["/usr/bin/Xvfb", ":88", "-screen", "0", "1280x800x24", "-nolisten", "tcp", "-ac"],
                               stdout=output, stderr=subprocess.STDOUT)
    for _ in range(80):
        if process.poll() is not None:
            output.close()
            raise RuntimeError("Private Xvfb exited")
        if Path("/tmp/.X11-unix/X88").exists():
            return process, output
        time.sleep(0.05)
    stop_process(process)
    output.close()
    raise RuntimeError("Private Xvfb startup timed out")


def validate_parameters(parameters, expected_hash):
    if not isinstance(parameters, list) or len(parameters) > 32:
        raise ValueError("Invalid parameters array")
    encoded = json.dumps(parameters, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    if len(encoded) > 131072:
        raise ValueError("Parameters exceed 128 KiB")
    actual = hashlib.sha256(encoded).hexdigest()
    if actual != expected_hash:
        raise ValueError("Parameter digest mismatch")
    seen = set()
    for parameter in parameters:
        if not isinstance(parameter, dict) or set(parameter) != {"name", "value"}:
            raise ValueError("Invalid parameter object")
        name = parameter["name"]
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]{0,63}", name):
            raise ValueError("Invalid parameter name")
        lower = name.lower()
        if lower in seen or lower in {"дата", "ссылка"}:
            raise ValueError("Duplicate/reserved parameter")
        seen.add(lower)
        cell = parameter["value"]
        if not isinstance(cell, dict):
            raise ValueError("Invalid parameter value")
        kind = cell.get("type")
        if kind not in {"string", "number", "boolean", "date", "null"} or set(cell) != ({"type"} if kind == "null" else {"type", "value"}):
            raise ValueError("Unsupported parameter value")
        value = cell.get("value")
        if kind == "boolean" and type(value) is not bool:
            raise ValueError("Invalid boolean parameter")
        if kind in {"string", "number", "date"} and not isinstance(value, str):
            raise ValueError("Invalid text parameter")
        if kind == "string":
            value.encode("utf-8", errors="strict")
            if "\0" in value or len(value.encode("utf-16le")) // 2 > 16384:
                raise ValueError("Invalid string parameter")
        if kind == "number" and (not re.fullmatch(r"-?\d+(?:\.\d+)?", value) or len(re.sub(r"[-.]", "", value)) > 38):
            raise ValueError("Invalid number parameter")
        if kind == "date":
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", value):
                raise ValueError("Invalid date parameter")
            datetime.fromisoformat(value)


def main():
    global WORK
    if sys.argv[1:] == ["--idle"]:
        while True:
            signal.pause()
    update = sys.argv[1:] == ["--prepare-update"]
    prepare = update or sys.argv[1:] == ["--prepare"]
    if prepare:
        WORK = Path("/runner/prepare-work")
    process, output = display()
    try:
        if prepare:
            base = "/runner/base"
            if not update:
                stage([BINARY, "CREATEINFOBASE", f'File="{base}";Locale=ru_RU;', "/DisableStartupDialogs", "/Out", str(WORK / "create.log")], WORK / "create-process.log")
            if not (Path(base) / "1Cv8.1CD").is_file() or (not update and not (WORK / "create.log").is_file()):
                raise RuntimeError("CREATEINFOBASE produced no database/log; exit 0 alone is insufficient")
            stage([BINARY, "DESIGNER", "/F", base, "/LoadConfigFromFiles", "/runner/config", "/UpdateDBCfg", "/DisableStartupDialogs", "/Out", str(WORK / "load.log")], WORK / "load-process.log")
            load_log = (WORK / "load.log").read_text(encoding="utf-8-sig")
            if "Ошибка" in load_log:
                raise RuntimeError("Configuration load reported errors; inspect load.log")
            stage([BINARY, "DESIGNER", "/F", base, "/CheckConfig", "-Server", "-ThinClient", "/DisableStartupDialogs", "/Out", str(WORK / "check.log")], WORK / "check-process.log")
            check = (WORK / "check.log").read_text(encoding="utf-8-sig", errors="strict")
            if "Ошибка" in check or "error" in check.lower():
                raise RuntimeError("CheckConfig reported errors; inspect the image build log")
            for item in [Path(base), *Path(base).rglob("*")]:
                item.chmod(0o755 if item.is_dir() else 0o644)
            print(json.dumps({"prepared": True, "binaryHash": hashlib.sha256(Path(BINARY).read_bytes()).hexdigest()}), flush=True)
            return
        raw = sys.stdin.buffer.read(1048577)
        if len(raw) > 1048576:
            raise ValueError("Worker input exceeds 1 MiB")
        request = json.loads(raw)
        version = request.get("schemaVersion")
        expected = {"schemaVersion", "nonce", "query"} | ({"parameters", "parametersHash"} if version == 2 else set())
        if type(version) is not int or version not in (1, 2) or set(request) != expected:
            raise RuntimeError("Invalid worker envelope")
        if version == 2:
            validate_parameters(request["parameters"], request["parametersHash"])
            (WORK / "parameters.json").write_text(json.dumps(request["parameters"], ensure_ascii=True), encoding="utf-8")
        query = request["query"]
        if not isinstance(query, str) or not 1 <= len(query) <= 24000 or "\0" in query:
            raise RuntimeError("Invalid query data")
        shutil.copytree("/runner/base", WORK / "base")
        (WORK / "query.txt").write_text(query, encoding="utf-8")
        result = {"status": "failed", "actual": None, "reason": "Platform stage did not finish"}
        try:
            stage([BINARY, "ENTERPRISE", "/F", "/work/base", "/DisableStartupDialogs", "/DisableStartupMessages", "/Out", "/work/enterprise.log"], WORK / "enterprise-process.log", 60)
            result_file = WORK / "engine-result.json"
            if (WORK / "client-error.txt").is_file():
                raise RuntimeError((WORK / "client-error.txt").read_text(encoding="utf-8-sig")[:3500])
            if not result_file.is_file() or result_file.stat().st_size > 2 * 1024 * 1024:
                raise RuntimeError("Missing or oversized engine result")
            result = json.loads(result_file.read_text(encoding="utf-8-sig"))
        except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError, UnicodeError, OSError) as error:
            diagnostics = "\n".join(p.name + ": " + p.read_bytes()[-1200:].decode("utf-8-sig", errors="replace")
                                    for p in sorted(WORK.glob("*.log")))
            result["reason"] = (str(error) + "\n" + diagnostics)[:4000]
        log_data = b"".join(p.read_bytes()[:131072] for p in sorted(WORK.glob("*.log")))
        print(json.dumps({"schemaVersion": version, **({"parametersHash": request["parametersHash"]} if version == 2 else {}), "nonce": request["nonce"], "platformVersion": VERSION,
            "binaryHash": hashlib.sha256(Path(BINARY).read_bytes()).hexdigest(), **result,
            "logHash": hashlib.sha256(log_data).hexdigest()}, ensure_ascii=True), flush=True)
    finally:
        stop_process(process)
        output.close()


if __name__ == "__main__":
    main()
