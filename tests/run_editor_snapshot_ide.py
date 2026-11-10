"""Run source-module snapshot checks in new real IDE profiles; never reuse user profiles."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


def fixture_workspace(base):
    workspace = base / "workspace"
    for name in ("a", "b"):
        folder = workspace / name
        folder.mkdir(parents=True)
        (folder / "Module.bsl").write_text('Процедура Т()\n    Сообщить("own fixture ' + name + '");\nКонецПроцедуры', encoding="utf-8")
        (folder / "metadata.json").write_text(json.dumps({"name": "Fixture" + name.upper(),
            "objects": [{"kind": "Документ", "name": "Own" + name.upper(), "fields": [{"name": "Номер"}]}]}), encoding="utf-8")
    project = workspace / "Snapshot.code-workspace"
    project.write_text(json.dumps({"folders": [{"path": "a"}, {"path": "b"}], "settings": {
        "files.autoSave": "off", "files.hotExit": "off", "workbench.startupEditor": "none",
        "extensions.autoUpdate": False, "extensions.autoCheckUpdates": False,
        "normahub1c.enableInlineCompletion": False
    }}), encoding="utf-8")
    return project


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="New evidence directory; must not exist")
    parser.add_argument("--flavors", nargs="+", choices=["vscode", "cursor"], default=["vscode", "cursor"])
    parser.add_argument("--no-sandbox", action="store_true", help="Explicit Linux test-profile exception; never a production runner profile")
    parser.add_argument("--suite", choices=["snapshot", "comparison", "signed-import", "extension-ux", "parameter-ux", "packaged"], default="snapshot")
    parser.add_argument("--vsix", type=Path)
    parser.add_argument("--runner-profile", type=Path)
    parser.add_argument("--runner-key-directory", type=Path)
    args = parser.parse_args()
    if args.suite in ("signed-import", "extension-ux", "parameter-ux") and not (args.runner_profile and args.runner_key_directory):
        parser.error("signed-import requires an explicit own runner profile and external key directory")
    if args.suite in ("signed-import", "extension-ux", "parameter-ux"):
        for required in (args.runner_profile, args.runner_key_directory / "public.pem", args.runner_key_directory / "private.pem"):
            if not required.is_file():
                parser.error("required operator file does not exist: " + str(required))
    if args.suite == "packaged" and (not args.vsix or not args.vsix.is_file()):
        parser.error("packaged suite requires an existing explicit --vsix")
    output = Path(args.output).resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    keep = {"PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "TMPDIR"}
    environment = {key: value for key, value in os.environ.items() if key in keep}
    summaries = []
    for flavor in args.flavors:
        binary = shutil.which("code" if flavor == "vscode" else "cursor")
        if not binary:
            raise RuntimeError(f"{flavor} is not installed; provision it explicitly before qualification")
        folder = output / flavor
        folder.mkdir()
        project = fixture_workspace(folder)
        env = {**environment, "SNAPSHOT_REPOSITORY": str(ROOT), "SNAPSHOT_IDE_EVIDENCE": str(folder)}
        if args.suite in ("signed-import", "extension-ux", "parameter-ux", "packaged"):
            companion = folder / "extensions/copilot.test-boundary"
            companion.mkdir(parents=True)
            (companion / "package.json").write_text(json.dumps({"name": "test-boundary", "publisher": "copilot", "version": "0.0.1",
                "engines": {"vscode": "^1.100.0"}, "main": "./main.cjs", "activationEvents": ["*"]}))
            (companion / "main.cjs").write_text("exports.activate = context => context;")
        if args.suite in ("signed-import", "extension-ux", "parameter-ux"):
            env.update({"SNAPSHOT_RUNNER_PROFILE": str(args.runner_profile.resolve()),
                        "SNAPSHOT_RUNNER_KEYS": str(args.runner_key_directory.resolve()), "SNAPSHOT_RUNNER_NODE": shutil.which("node")})
        development_path = ROOT
        if args.suite == "packaged":
            import hashlib
            import zipfile
            with zipfile.ZipFile(args.vsix) as archive:
                env["SNAPSHOT_PACKAGE_BUNDLE_HASH"] = hashlib.sha256(archive.read("extension/dist/extension.js")).hexdigest()
                env["SNAPSHOT_PACKAGE_VERSION"] = json.loads(archive.read("extension/package.json"))["version"]
            installed = subprocess.run([binary, "--user-data-dir", str(folder / "profile"), "--extensions-dir", str(folder / "extensions"),
                "--install-extension", str(args.vsix.resolve())], env=env, capture_output=True, text=True, timeout=60)
            (folder / "install.log").write_text(installed.stdout + installed.stderr)
            if installed.returncode:
                raise RuntimeError("VSIX installation failed; inspect isolated install.log")
            development_path = companion
        suite_file = {"snapshot": "editor_snapshot_ide.cjs", "comparison": "query_comparison_ide.cjs", "signed-import": "signed_runner_import_ide.cjs", "extension-ux": "extension_workflows_ide.cjs", "parameter-ux": "parameter_workflows_ide.cjs", "packaged": "packaged_workflows_ide.cjs"}[args.suite]
        command = [binary, "--new-window", "--wait", "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust",
                   "--disable-updates", "--disable-telemetry", "--password-store=basic", "--disable-gpu",
                   "--user-data-dir", str(folder / "profile"), "--extensions-dir", str(folder / "extensions"),
                   "--extensionDevelopmentPath=" + str(development_path),
                   "--extensionTestsPath=" + str(ROOT / ("tests/" + suite_file)), str(project)]
        if args.no_sandbox:
            command.append("--no-sandbox")
        print(f"Starting isolated {flavor}; no inference calls", flush=True)
        with (folder / "launch.log").open("w") as log:
            process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            result_path = folder / "results.json"
            deadline = time.monotonic() + 180
            data = {"results": []}
            while time.monotonic() < deadline:
                if result_path.exists():
                    try:
                        data = json.loads(result_path.read_text())
                    except json.JSONDecodeError:
                        pass
                    if data.get("completed"):
                        break
                if process.poll() is not None:
                    raise RuntimeError(f"{flavor} exited before producing native results; inspect its isolated launch/profile logs")
                time.sleep(0.1)
            if not data.get("completed"):
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=10)
                raise RuntimeError(f"{flavor} produced no complete native result; inspect its isolated profile log")
            try:
                status = process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=10)
                raise RuntimeError(f"{flavor} qualification timed out; inspect the new profile log") from None
        results = data["results"]
        summary = {"flavor": flavor, "version": data.get("version"), "exit_code": status,
                   "passed": sum(result["pass"] for result in results), "total": len(results),
                   "source_development_profile": args.suite != "packaged", "transport_controlled": args.suite != "packaged", "suite": args.suite,
                   "sandbox_disabled": args.no_sandbox}
        summaries.append(summary)
        (output / "summary.json").write_text(json.dumps(summaries, indent=2), encoding="utf-8")
        print(json.dumps(summary), flush=True)
        if status or not results or any(not result["pass"] for result in results):
            raise RuntimeError(f"{flavor} failed; inspect results.json and launch.log before retry")


if __name__ == "__main__":
    main()
