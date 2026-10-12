"""Clipboard listener and automatic 1C code processor."""

import subprocess
import time
from typing import Optional
from sidecar.config import SidecarConfig
from sidecar.core import SidecarCore


class ClipboardWatcher:
    def __init__(self, config: SidecarConfig):
        self.config = config

    @staticmethod
    def get_clipboard() -> str:
        """Reads text from system clipboard (supports Linux xclip/xsel and Windows)."""
        # Try Linux xclip / xsel
        for cmd in [["xclip", "-selection", "clipboard", "-o"], ["xsel", "--clipboard", "--output"], ["wl-paste"]]:
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=1)
                if result.returncode == 0:
                    return result.stdout
            except Exception:
                continue

        # Try Python tkinter fallback
        try:
            import tkinter as tk
            root = tk.Tk()
            root.withdraw()
            text = root.clipboard_get()
            root.destroy()
            return text
        except Exception:
            pass

        return ""

    @staticmethod
    def set_clipboard(text: str) -> bool:
        """Writes text to system clipboard."""
        for cmd in [["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"], ["wl-copy"]]:
            try:
                p = subprocess.Popen(cmd, stdin=subprocess.PIPE, text=True)
                p.communicate(input=text, timeout=1)
                if p.returncode == 0:
                    return True
            except Exception:
                continue

        try:
            import tkinter as tk
            root = tk.Tk()
            root.withdraw()
            root.clipboard_clear()
            root.clipboard_append(text)
            root.update()
            root.destroy()
            return True
        except Exception:
            pass

        return False

    def process_text(self, text: str) -> Optional[str]:
        """Automatically transforms clipboard 1C snippet based on intent."""
        trimmed = text.strip()
        if not trimmed:
            return None

        # 1. Intent: Extension generation request (e.g. "// перехват ОбработкаПроведения")
        if trimmed.startswith("// перехват ") or trimmed.startswith("// расширение "):
            method_name = trimmed.split(maxsplit=2)[-1]
            return SidecarCore.generate_extension_method(method_name, "Вместо")

        # 2. Intent: Natural language query intent (e.g. "// запрос остатки номенклатуры")
        if trimmed.startswith("// запрос ") or trimmed.startswith("// создать запрос "):
            return SidecarCore.build_batch_query("РеализацияТоваровУслуг", "Товары", "ТоварыНаСкладах")

        # 3. Intent: Existing BSL code snippet -> Audit and report
        issues = SidecarCore.audit_bsl_code(trimmed)
        if issues:
            report_lines = [f"// [NormaHub 1C Audit] Найдено замечаний ИТС: {len(issues)}"]
            for iss in issues:
                report_lines.append(f"// • {iss['rule']} (стр. {iss['line']}): {iss['message']}")
                report_lines.append(f"//   💡 {iss['suggestion']}")
            return "\n".join(report_lines) + "\n\n" + text

        return None

    def run_once(self) -> bool:
        """Processes current clipboard once and updates clipboard with result."""
        content = self.get_clipboard()
        if not content:
            print("Clipboard is empty.")
            return False

        transformed = self.process_text(content)
        if transformed and transformed != content:
            self.set_clipboard(transformed)
            print("✓ Clipboard successfully transformed with 1C Copilot result.")
            return True

        print("No transformation applied.")
        return False

    def watch_loop(self, poll_interval: float = 0.5):
        """Continuously watches clipboard for changes."""
        print("✓ Clipboard watcher started. Monitoring 1C snippets...")
        last_clip = self.get_clipboard()

        while True:
            time.sleep(poll_interval)
            current = self.get_clipboard()
            if current and current != last_clip:
                last_clip = current
                transformed = self.process_text(current)
                if transformed and transformed != current:
                    self.set_clipboard(transformed)
                    last_clip = transformed
                    print("✓ Detected 1C snippet. Transformed in clipboard.")
