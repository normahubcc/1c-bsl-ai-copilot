import argparse
import sys
import threading
from pathlib import Path

# Ensure project root is in sys.path when invoked directly as python3 sidecar/main.py
_root = str(Path(__file__).resolve().parent.parent)
if _root not in sys.path:
    sys.path.insert(0, _root)

from sidecar.config import load_config
from sidecar.core import SidecarCore
from sidecar.server import run_server
from sidecar.clipboard_watcher import ClipboardWatcher


def main():
    parser = argparse.ArgumentParser(description="NormaHub 1C Configurator Global Sidecar")
    subparsers = parser.add_subparsers(dest="command")

    # daemon
    daemon_parser = subparsers.add_parser("daemon", help="Start background HTTP server and clipboard daemon")
    daemon_parser.add_argument("--with-clipboard", action="store_true", help="Also start background clipboard watcher")

    # audit
    audit_parser = subparsers.add_parser("audit", help="Audit BSL file or code snippet")
    audit_parser.add_argument("path", help="Path to .bsl file or raw code")

    # query
    query_parser = subparsers.add_parser("query", help="Generate compliant 1C batch query")
    query_parser.add_argument("--entity", default="РеализацияТоваровУслуг", help="Document or Catalog name")
    query_parser.add_argument("--tabular", default="Товары", help="Tabular section name")
    query_parser.add_argument("--register", default="ТоварыНаСкладах", help="Accumulation register name")

    # extension
    ext_parser = subparsers.add_parser("extension", help="Generate 1C extension interceptor")
    ext_parser.add_argument("method", help="Target method name")
    ext_parser.add_argument("--directive", default="Вместо", choices=["Вместо", "Перед", "После", "ИзменениеИКонтроль"])

    # bdd
    bdd_parser = subparsers.add_parser("bdd", help="Generate Vanessa-Automation .feature scenario")
    bdd_parser.add_argument("--entity", default="РеализацияТоваровУслуг", help="Document name")
    bdd_parser.add_argument("--tabular", default="Товары", help="Tabular section name")
    bdd_parser.add_argument("--register", default="ТоварыНаСкладах", help="Accumulation register name")

    # techlog
    techlog_parser = subparsers.add_parser("techlog", help="Analyze 1C Technological Log (ТЖ) events")
    techlog_parser.add_argument("path", help="Path to tech log file or raw log snippet")

    # clip-process
    subparsers.add_parser("process-clip", help="Transform current clipboard content once")

    # status
    subparsers.add_parser("status", help="Print sidecar configuration status")

    args = parser.parse_args()
    config = load_config()

    if args.command == "daemon" or not args.command:
        print("=" * 60)
        print("Starting 1C Configurator Global Sidecar (NormaHub)")
        print(f"API Base: {config.base_url}")
        print(f"Model:    {config.autocomplete_model}")
        print(f"Port:     {config.port}")
        print("=" * 60)

        if getattr(args, "with_clipboard", False):
            watcher = ClipboardWatcher(config)
            t = threading.Thread(target=watcher.watch_loop, daemon=True)
            t.start()

        run_server(config)

    elif args.command == "audit":
        try:
            with open(args.path, "r", encoding="utf-8") as f:
                code = f.read()
        except Exception:
            code = args.path

        issues = SidecarCore.audit_bsl_code(code)
        if not issues:
            print("✓ Замечаний по стандартам ИТС не обнаружено.")
        else:
            print(f"Найдено замечаний: {len(issues)}")
            for iss in issues:
                print(f"[{iss['rule']}] (стр. {iss['line']}): {iss['message']}")
                print(f"  Решение: {iss['suggestion']}\n")

    elif args.command == "query":
        query_code = SidecarCore.build_batch_query(args.entity, args.tabular, args.register)
        print(query_code)

    elif args.command == "extension":
        ext_code = SidecarCore.generate_extension_method(args.method, args.directive)
        print(ext_code)

    elif args.command == "bdd":
        feature = SidecarCore.generate_bdd_feature(args.entity, args.tabular, args.register)
        print(feature)

    elif args.command == "techlog":
        try:
            with open(args.path, "r", encoding="utf-8") as f:
                log_data = f.read()
        except Exception:
            log_data = args.path

        diag = SidecarCore.analyze_tech_log(log_data)
        print(diag.get("report", ""))

    elif args.command == "process-clip":
        watcher = ClipboardWatcher(config)
        watcher.run_once()

    elif args.command == "status":
        print(f"Sidecar Host:  {config.host}:{config.port}")
        print(f"NormaHub Key:  {'Configured' if config.api_key else 'Missing'}")
        print(f"Model:         {config.autocomplete_model}")


if __name__ == "__main__":
    main()
