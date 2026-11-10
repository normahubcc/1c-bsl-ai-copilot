"""Sidecar adapters. All local tools use the same bundled TypeScript core as MCP/IDE."""

import json
import os
import shutil
import subprocess
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

_slots = threading.BoundedSemaphore(4)


class SidecarCore:
    @staticmethod
    def run_local_tool(name: str, arguments: Dict[str, Any]) -> Any:
        bundle = Path(__file__).resolve().parent.parent / "dist" / "toolbox-cli.js"
        node = os.getenv("NORMAHUB_NODE") or shutil.which("node")
        if not node or not bundle.is_file():
            raise RuntimeError("Для локальных инструментов установите Node.js и соберите npm run build:core (в VSIX ядро уже включено).")
        if not _slots.acquire(timeout=1):
            raise RuntimeError("Локальные инструменты заняты. Повторите запрос.")
        try:
            process = subprocess.run(
                [node, str(bundle)], input=json.dumps({"name": name, "arguments": arguments}),
                capture_output=True, text=True, encoding="utf-8", timeout=15, check=False,
            )
            try:
                response = json.loads(process.stdout)
            except (json.JSONDecodeError, TypeError):
                raise RuntimeError("Не удалось прочитать ответ локального ядра.") from None
            if response.get("error"):
                raise ValueError(response["error"])
            if process.returncode:
                raise RuntimeError("Локальное ядро завершилось с ошибкой.")
            return response["result"]
        except subprocess.TimeoutExpired:
            raise RuntimeError("Таймаут локального инструмента.") from None
        finally:
            _slots.release()

    @staticmethod
    def audit_bsl_code(code: str, disabled_rules: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        return SidecarCore.run_local_tool("1c_audit_standards", {"code": code, "disabledRules": disabled_rules or []})["issues"]

    @staticmethod
    def build_batch_query(entity: str, tabular: str, register: str, register_type: str = "Остатки", fields: Optional[List[str]] = None, source_mode: str = "document", workspace_path: str = "") -> str:
        return SidecarCore.run_local_tool("1c_build_batch_query", {
            "entityName": entity, "tabularSection": tabular, "registerName": register,
            "registerType": register_type, "fields": fields, "sourceMode": source_mode, "workspacePath": workspace_path,
        })["queryCode"]

    @staticmethod
    def refactor_query(raw_query: str) -> Dict[str, Any]:
        return SidecarCore.run_local_tool("1c_refactor_query", {"rawQuery": raw_query})

    @staticmethod
    def generate_extension_method(method_name: str, directive: str, params: Optional[List[str]] = None, is_function: bool = False) -> str:
        return SidecarCore.run_local_tool("1c_generate_extension", {
            "targetMethod": method_name, "directive": directive, "parameters": params or [], "isFunction": is_function,
        })["code"]

    @staticmethod
    def generate_bdd_feature(doc_name: str, tabular_section: str = "", register_name: str = "", prompt: str = "", steps_text: str = "") -> str:
        return SidecarCore.run_local_tool("1c_generate_bdd_feature", {
            "entityName": doc_name, "tabularSection": tabular_section, "registerName": register_name, "prompt": prompt, "stepsText": steps_text,
        })["feature"]

    @staticmethod
    def analyze_tech_log(raw_log: str) -> Dict[str, Any]:
        result = SidecarCore.run_local_tool("1c_analyze_tech_log", {"rawLog": raw_log})
        return {"events_count": result["eventsFound"], "diagnoses_count": result["diagnosesCount"], "diagnoses": result["diagnoses"], "report": result["report"]}

    @staticmethod
    def call_normahub_llm(
        api_key: str,
        base_url: str,
        model: str,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 1500
    ) -> str:
        """Calls NormaHub LLM gateway directly via HTTPS."""
        if not api_key:
            raise ValueError("NORMAHUB_API_KEY не задан")

        parsed = urllib.parse.urlparse(base_url)
        if parsed.scheme != "https" or parsed.netloc.lower() != "api.normahub.cc" or parsed.path.rstrip("/") != "/v1":
            raise ValueError(
                "baseUrl must be the fixed NormaHub endpoint: 'https://api.normahub.cc/v1'"
            )

        url = f"{base_url.rstrip('/')}/chat/completions"
        payload = json.dumps({
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.1,
            "max_tokens": max_tokens
        }).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            },
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=25) as response:
                body = response.read().decode("utf-8")
                data = json.loads(body)
                choice = data["choices"][0]
                if choice.get("finish_reason") == "length":
                    raise ValueError("Ответ модели обрезан. Сократите задачу.")
                result = choice["message"]["content"]
                if not isinstance(result, str) or not result.strip():
                    raise ValueError("Модель вернула пустой ответ.")
                return result
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"NormaHub API Error (HTTP {e.code})") from None
        except Exception:
            raise RuntimeError("Ошибка запроса к NormaHub. Проверьте подключение и API-ключ.") from None
