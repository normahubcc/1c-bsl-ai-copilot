"""Qualify physical Tab/Escape in a new IDE profile on a private X11 display."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import zipfile

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--flavor", choices=("vscode", "cursor"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--vsix", type=Path, required=True)
    parser.add_argument("--mode", choices=("source", "packaged"), default="source")
    parser.add_argument("--debounce-ms", type=int, default=250)
    parser.add_argument("--require-no-post-action-call", action="store_true")
    parser.add_argument("--no-sandbox", action="store_true")
    args = parser.parse_args()
    if not args.vsix.is_file():
        parser.error("An existing exact primary VSIX is required for language registration")
    if not os.environ.get("DISPLAY"):
        parser.error("Use run_private.py to supply a dedicated DISPLAY")
    if not 0 <= args.debounce_ms <= 1000:
        parser.error("--debounce-ms must be in 0..1000")
    binary = shutil.which("code" if args.flavor == "vscode" else "cursor")
    if not binary:
        parser.error("Requested IDE is not installed")
    out = args.output.resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    workspace = out / "workspace"
    (workspace / ".vscode").mkdir(parents=True)
    settings = {"normahub1c.enableInlineCompletion": True, "normahub1c.debounceMs": args.debounce_ms,
                "normahub1c.autocompleteModel": "deepseek-v4.1-flash-1017", "editor.inlineSuggest.enabled": True,
                "editor.quickSuggestions": False, "editor.suggestOnTriggerCharacters": False,
                "editor.tabCompletion": "off", "editor.snippetSuggestions": "none", "workbench.startupEditor": "none",
                "files.autoSave": "off", "extensions.autoUpdate": False, "extensions.autoCheckUpdates": False}
    (workspace / ".vscode/settings.json").write_text(json.dumps(settings), encoding="utf-8")
    companion = out / "extensions/copilot.test-boundary"
    companion.mkdir(parents=True)
    (companion / "package.json").write_text(json.dumps({"name": "test-boundary", "publisher": "copilot",
        "version": "0.0.1", "engines": {"vscode": "^1.100.0"}, "main": "./main.cjs", "activationEvents": ["*"]}))
    (companion / "main.cjs").write_text("exports.activate=context=>context;")
    keep = {"PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "DISPLAY", "XDG_RUNTIME_DIR", "TMPDIR",
            "ELECTRON_OZONE_PLATFORM_HINT", "XDG_SESSION_TYPE"}
    env = {key: value for key, value in os.environ.items() if key in keep}
    env.update({"NATIVE_INLINE_ROOT": str(ROOT), "NATIVE_INLINE_OUTPUT": str(out),
                "NATIVE_INLINE_DEBOUNCE_MS": str(args.debounce_ms),
                "NATIVE_INLINE_REQUIRE_NO_POST_ACTION": "1" if args.require_no_post_action_call else "0"})
    with zipfile.ZipFile(args.vsix) as archive:
        package = json.loads(archive.read("extension/package.json"))
        env["NATIVE_INLINE_PACKAGE_VERSION"] = package["version"]
        env["NATIVE_INLINE_BUNDLE_HASH"] = hashlib.sha256(archive.read("extension/dist/extension.js")).hexdigest()
    profile = ["--user-data-dir", str(out / "profile"), "--extensions-dir", str(out / "extensions")]
    installed = subprocess.run([binary, *profile, "--install-extension", str(args.vsix.resolve())],
                               env=env, capture_output=True, text=True, timeout=90)
    (out / "install.log").write_text(installed.stdout + installed.stderr)
    installed.check_returncode()
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    command = [binary, *profile, "--new-window", "--wait", "--skip-welcome", "--skip-release-notes",
               "--disable-workspace-trust", "--disable-updates", "--disable-telemetry", "--disable-gpu",
               "--password-store=basic", "--remote-debugging-port=" + str(port),
               "--extensionDevelopmentPath=" + str(out / "extensions/copilot.test-boundary"),
               "--extensionTestsPath=" + str(ROOT / ("tests/native_display/packaged_inline_acceptance.cjs"
                   if args.mode == "packaged" else "tests/native_display/inline_acceptance.cjs")), str(workspace)]
    if args.no_sandbox:
        command.append("--no-sandbox")
    handled = set()
    with (out / "launch.log").open("w") as log:
        process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            with sync_playwright() as playwright:
                browser = None
                deadline = time.monotonic() + 150
                while time.monotonic() < deadline:
                    ready = out / "ready.json"
                    if ready.exists():
                        data = json.loads(ready.read_text())
                        case = data["id"]
                        if case not in handled:
                            action_file = out / ("action-" + case + ".json")
                            try:
                                if browser is None:
                                    browser = playwright.chromium.connect_over_cdp("http://127.0.0.1:" + str(port))
                                pages = [page for context in browser.contexts for page in context.pages if "workbench" in page.url]
                                if not pages:
                                    raise RuntimeError("No isolated workbench page in CDP")
                                page = pages[0]
                                page.bring_to_front()
                                ghost = []
                                rendered = []
                                ghost_deadline = time.monotonic() + 4
                                while time.monotonic() < ghost_deadline:
                                    ghost = [text for text in page.locator("[class*='ghost']").all_text_contents() if text.strip()]
                                    rendered = [text for text in page.locator(".monaco-editor.focused .view-lines").all_text_contents() if text.strip()]
                                    if any(data["expectedGhost"].strip() in text.replace("\u00a0", " ") for text in rendered):
                                        break
                                    page.wait_for_timeout(100)
                                active = page.evaluate("document.activeElement?.outerHTML?.slice(0,400) || ''")
                                screenshot = out / ("presentation-" + case + ".png")
                                page.screenshot(path=str(screenshot))
                                visible = any(data["expectedGhost"].strip() in text.replace("\u00a0", " ") for text in rendered)
                                sent = None
                                if visible:
                                    page.keyboard.press(data["action"])
                                    sent = data["action"]
                                action_file.write_text(json.dumps({"id": case, "sent": sent, "ghost": ghost,
                                    "renderedLines": rendered,
                                    "activeElement": active, "screenshot": screenshot.name}))
                            except Exception as error:
                                action_file.write_text(json.dumps({"id": case, "sent": None, "error": str(error)}))
                            handled.add(case)
                    result_file = out / "results.json"
                    if result_file.exists():
                        result = json.loads(result_file.read_text())
                        if result.get("completed"):
                            code = process.wait(timeout=30)
                            statuses = [(row["id"], row["status"]) for row in result["results"]]
                            print(json.dumps({"flavor": args.flavor, "mode": args.mode, "exitCode": code, "statuses": statuses}))
                            if code or any(status not in ("native_exact_tab_insertion", "native_escape_rejection") for _, status in statuses):
                                raise RuntimeError("Physical acceptance failed; inspect isolated results and screenshots")
                            return
                    if process.poll() is not None:
                        raise RuntimeError("IDE exited before completing physical acceptance")
                    time.sleep(0.1)
                raise RuntimeError("Physical acceptance timed out")
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)


if __name__ == "__main__":
    main()
