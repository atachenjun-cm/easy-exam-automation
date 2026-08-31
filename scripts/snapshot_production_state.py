#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
from pathlib import Path


DATABASES = ("task_state.sqlite3", "requirement_requests.sqlite3")
ROOT_CONFIGS = (".env",)
RUNTIME_CONFIGS = (
    "auth.json",
    "auth_users.json",
    "auth_sessions.json",
    "settings.json",
    "user_settings.json",
    "email_settings.json",
)


def sha256(file_path):
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sqlite_snapshot(source, destination):
    source_uri = f"file:{source.as_posix()}?mode=ro"
    with sqlite3.connect(source_uri, uri=True) as source_db:
        with sqlite3.connect(destination) as destination_db:
            source_db.backup(destination_db)
            check = destination_db.execute("PRAGMA quick_check").fetchone()
    if not check or check[0] != "ok":
        raise RuntimeError(f"SQLite quick_check failed: {source.name}")
    os.chmod(destination, 0o600)
    return {"file": source.name, "sha256": sha256(destination), "quickCheck": "ok"}


def copy_private(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    os.chmod(destination, 0o600)
    return {"file": source.name, "sha256": sha256(destination)}


def snapshot(app_root, destination):
    app_root = app_root.resolve(strict=True)
    runtime_dir = app_root / ".easy_exam_runtime"
    if not runtime_dir.is_dir():
        raise RuntimeError(f"runtime directory is missing: {runtime_dir}")
    if destination.exists():
        raise RuntimeError(f"snapshot destination already exists: {destination}")
    destination.mkdir(parents=True, mode=0o700)
    os.chmod(destination, 0o700)

    result = {"databases": [], "configs": []}
    database_dir = destination / "databases"
    config_dir = destination / "config"
    try:
        for file_name in DATABASES:
            source = runtime_dir / file_name
            if not source.is_file():
                continue
            database_dir.mkdir(parents=True, exist_ok=True)
            result["databases"].append(sqlite_snapshot(source, database_dir / file_name))

        for file_name in ROOT_CONFIGS:
            source = app_root / file_name
            if source.is_file():
                result["configs"].append(copy_private(source, config_dir / "root" / file_name))
        for file_name in RUNTIME_CONFIGS:
            source = runtime_dir / file_name
            if source.is_file():
                result["configs"].append(copy_private(source, config_dir / "runtime" / file_name))

        metadata_path = destination / "metadata.json"
        metadata_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.chmod(metadata_path, 0o600)
        return result
    except Exception:
        shutil.rmtree(destination, ignore_errors=True)
        raise


def main():
    parser = argparse.ArgumentParser(description="Create a consistent production state snapshot before code deployment")
    parser.add_argument("--app-root", required=True)
    parser.add_argument("--destination", required=True)
    args = parser.parse_args()
    result = snapshot(Path(args.app_root), Path(args.destination))
    print(json.dumps({
        "ok": True,
        "databaseCount": len(result["databases"]),
        "configCount": len(result["configs"]),
    }))


if __name__ == "__main__":
    main()
