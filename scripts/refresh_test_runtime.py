#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import shutil
import socket
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path


DATABASES = ("task_state.sqlite3", "requirement_requests.sqlite3")
EXCLUDED_RUNTIME_STATE = (
    "auth.json",
    "auth_users.json",
    "auth_sessions.json",
    "email_settings.json",
    "user_settings.json",
    "browser profiles",
    "logs",
    "generated artifacts",
)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def port_is_open(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as client:
        client.settimeout(0.2)
        return client.connect_ex(("127.0.0.1", port)) == 0


def sqlite_backup(source, destination):
    source_uri = f"file:{source.as_posix()}?mode=ro"
    with sqlite3.connect(source_uri, uri=True) as source_db:
        with sqlite3.connect(destination) as destination_db:
            source_db.backup(destination_db)
            result = destination_db.execute("PRAGMA quick_check").fetchone()
            if not result or result[0] != "ok":
                raise RuntimeError(f"SQLite quick_check failed for {source.name}: {result}")


def replace_with_backup(target, staged, backup_dir):
    if target.exists():
        os.replace(target, backup_dir / target.name)
    os.replace(staged, target)


def refresh(production_runtime, test_runtime, include_uploads=False, require_test_stopped=True):
    production_runtime = production_runtime.resolve()
    test_runtime = test_runtime.resolve()
    if production_runtime == test_runtime:
        raise ValueError("Production and test runtime directories must differ")
    if require_test_stopped and port_is_open(8766):
        raise RuntimeError("Port 8766 is still running; stop the test service before refreshing")
    for database in DATABASES:
        if not (production_runtime / database).is_file():
            raise FileNotFoundError(production_runtime / database)

    test_root = test_runtime.parent
    snapshot_id = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = test_root / "snapshots" / f"before-refresh-{snapshot_id}"
    backup_dir.mkdir(parents=True, mode=0o700)
    test_runtime.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(test_root, 0o700)
    os.chmod(test_runtime, 0o700)

    copied = []
    with tempfile.TemporaryDirectory(prefix="refresh-", dir=test_root) as temporary:
        staging = Path(temporary)
        for database in DATABASES:
            staged_database = staging / database
            sqlite_backup(production_runtime / database, staged_database)
            os.chmod(staged_database, 0o600)
            replace_with_backup(test_runtime / database, staged_database, backup_dir)
            copied.append({
                "path": database,
                "sha256": sha256(test_runtime / database),
                "bytes": (test_runtime / database).stat().st_size,
            })

        if include_uploads:
            source_uploads = production_runtime / "uploads"
            staged_uploads = staging / "uploads"
            if source_uploads.is_dir():
                shutil.copytree(source_uploads, staged_uploads)
            else:
                staged_uploads.mkdir()
            replace_with_backup(test_runtime / "uploads", staged_uploads, backup_dir)
            copied.append({"path": "uploads", "files": sum(1 for item in (test_runtime / "uploads").rglob("*") if item.is_file())})

    metadata = {
        "snapshotId": snapshot_id,
        "createdAt": datetime.now(timezone.utc).astimezone().isoformat(),
        "productionRuntime": str(production_runtime),
        "testRuntime": str(test_runtime),
        "copied": copied,
        "excluded": EXCLUDED_RUNTIME_STATE,
        "testSchedulersEnabled": False,
    }
    metadata_path = test_runtime / "production-snapshot.json"
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(metadata_path, 0o600)
    return metadata


def parse_args():
    home = Path.home()
    parser = argparse.ArgumentParser(description="Refresh the isolated 8766 runtime from a safe 8765 data snapshot")
    parser.add_argument(
        "--production-runtime",
        type=Path,
        default=home / "Library" / "Application Support" / "yikao-auto-config-web" / ".easy_exam_runtime",
    )
    parser.add_argument(
        "--test-runtime",
        type=Path,
        default=home / "Library" / "Application Support" / "yikao-auto-config-test" / "YKAI001" / "runtime",
    )
    parser.add_argument("--include-uploads", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    print(json.dumps(refresh(args.production_runtime, args.test_runtime, args.include_uploads), ensure_ascii=False, indent=2))
