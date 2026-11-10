"""Build a new, local-only approved fixture from an explicitly selected installed training seed."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", required=True, help="Immutable sha256 image ID")
    parser.add_argument("--output", required=True, help="New directory")
    parser.add_argument("--key-id", required=True)
    args = parser.parse_args()
    import re
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", args.seed) or not re.fullmatch(r"[a-f0-9]{64}", args.key_id):
        raise ValueError("Require immutable seed and public-key fingerprint")
    out = Path(args.output).resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    shutil.copytree(ROOT / "tests/onec_engine/fixture", out / "config")
    module = out / "config/CommonModules/Проверки/Ext/Module.bsl"
    module.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(Path(__file__).with_name("Module.bsl"), module)
    (out / "config/Ext/ManagedApplicationModule.bsl").write_text('''Процедура ПриНачалеРаботыСистемы()
Попытка
 Проверки.ЗапуститьRunner();
Исключение
 Журнал = Новый ЗаписьТекста("/work/client-error.txt", КодировкаТекста.UTF8);
 Журнал.ЗаписатьСтроку(ОписаниеОшибки()); Журнал.Закрыть();
КонецПопытки;
ЗавершитьРаботуСистемы(Ложь);
КонецПроцедуры
''', encoding="utf-8")
    shutil.copy2(Path(__file__).with_name("worker.py"), out / "worker.py")
    stage = out / "stage"
    stage.mkdir()
    shutil.move(out / "config", stage / "config")
    shutil.move(out / "worker.py", stage / "worker.py")
    # These are our synthetic fixture copies; cap-drop root must not need DAC_OVERRIDE to read them.
    for item in [stage, *stage.rglob("*")]:
        item.chmod(0o755 if item.is_dir() else 0o644)
    with (out / "build.log").open("w") as log:
        container = subprocess.check_output(["docker", "create", "--pull=never", "--network=none", "--memory=2g", "--cpus=1", "--pids-limit=256",
            "--user", f"{stage.stat().st_uid}:{stage.stat().st_gid}",
            "--cap-drop=ALL", "--security-opt=no-new-privileges=true", "--entrypoint=/usr/bin/python3", args.seed,
            "/runner/worker.py", "--idle"], text=True, timeout=30).strip()
        try:
            subprocess.run(["docker", "cp", str(stage), container + ":/runner"], stdout=log, stderr=subprocess.STDOUT, check=True, timeout=30)
            subprocess.run(["docker", "start", container], stdout=log, stderr=subprocess.STDOUT, check=True, timeout=15)
            account = "import pwd; assert not any(p.pw_uid==10001 for p in pwd.getpwall()); open('/etc/passwd','a').write('copilot-runner:x:10001:10001:Copilot fixture runner:/work/home:/usr/sbin/nologin\\n'); open('/etc/group','a').write('copilot-runner:x:10001:\\n')"
            subprocess.run(["docker", "exec", "--user=0", container, "/usr/bin/python3", "-c", account], stdout=log, stderr=subprocess.STDOUT, check=True, timeout=15)
            subprocess.run(["docker", "exec", container, "/usr/bin/python3", "/runner/worker.py", "--prepare"], stdout=log, stderr=subprocess.STDOUT, check=True, timeout=180)
            image_id = subprocess.check_output(["docker", "commit", container], text=True, timeout=120).strip()
        except Exception:
            evidence = out / "failure-logs"
            evidence.mkdir()
            for name in ["create.log", "create-process.log", "load.log", "load-process.log", "check.log", "check-process.log", "xvfb.log", "diagnostic.png"]:
                subprocess.run(["docker", "cp", container + ":/runner/prepare-work/" + name, str(evidence / name)], stdout=log, stderr=subprocess.STDOUT, check=False, timeout=10)
            raise
        finally:
            subprocess.run(["docker", "rm", "--force", container], stdout=log, stderr=subprocess.STDOUT, check=True, timeout=30)
    def digest(data):
        return hashlib.sha256(data).hexdigest()
    files = sorted((str(p.relative_to(stage / "config")), digest(p.read_bytes())) for p in (stage / "config").rglob("*") if p.is_file())
    def canonical(value):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    metadata = [entry for entry in files if entry[0].endswith(".xml")]
    fixture_hash = digest(canonical({"files": files, "worker": digest((stage / "worker.py").read_bytes())}))
    profile = {"schemaVersion": 1, "kind": "query_text_fixture_v1", "runnerId": "own-local-training-runner", "keyId": args.key_id,
        "projectId": digest(b"own-query-runner-project"), "profileId": "own-query-fixture-v1", "imageId": image_id,
        "fixtureHash": fixture_hash, "metadataHash": digest(canonical(metadata)), "platformVersion": "8.3.27.1508",
        "binaryHash": "0a53bd62447130c145d3caba50fe35b14f7b3f33ab04a5ce85ef75fe26753b39"}
    (out / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({"profile": str(out / "profile.json"), "imageId": image_id}), flush=True)


if __name__ == "__main__":
    main()
