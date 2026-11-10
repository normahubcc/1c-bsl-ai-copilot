"""Patch only our trusted worker in an exact own fixture image; preserve the prepared 1C base/config."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    from re import fullmatch
    profile = json.loads(args.profile.read_text())
    if profile.get("kind") != "query_text_fixture_v1" or not fullmatch(r"sha256:[a-f0-9]{64}", profile.get("imageId", "")):
        raise ValueError("Require an explicit own immutable fixture profile")
    out = args.output.resolve()
    out.mkdir(parents=True, mode=0o700, exist_ok=False)
    worker = Path(__file__).with_name("worker.py")
    container = subprocess.check_output(["docker", "create", "--pull=never", "--network=none", "--entrypoint=/usr/bin/true", profile["imageId"]], text=True, timeout=30).strip()
    try:
        subprocess.run(["docker", "cp", container + ":/runner/config", str(out / "config")], check=True, timeout=30, capture_output=True)
        subprocess.run(["docker", "cp", container + ":/runner/worker.py", str(out / "old-worker.py")], check=True, timeout=30, capture_output=True)
        files = sorted((str(p.relative_to(out / "config")), digest(p.read_bytes())) for p in (out / "config").rglob("*") if p.is_file())
        old_hash = digest(canonical({"files": files, "worker": digest((out / "old-worker.py").read_bytes())}))
        if old_hash != profile["fixtureHash"]:
            raise ValueError("Seed worker/config do not match the selected profile")
        shutil.copy2(worker, out / "worker.py")
        (out / "worker.py").chmod(0o644)
        subprocess.run(["docker", "cp", str(out / "worker.py"), container + ":/runner/worker.py"], check=True, timeout=30, capture_output=True)
        profile["imageId"] = subprocess.check_output(["docker", "commit", container], text=True, timeout=120).strip()
        profile["fixtureHash"] = digest(canonical({"files": files, "worker": digest(worker.read_bytes())}))
        (out / "profile.json").write_text(json.dumps(profile, indent=2))
        print(json.dumps({"profile": str(out / "profile.json"), "imageId": profile["imageId"]}))
    finally:
        subprocess.run(["docker", "rm", container], check=True, timeout=30, capture_output=True)


if __name__ == "__main__":
    main()
