import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "snapshot_production_state",
    ROOT / "scripts" / "snapshot_production_state.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SnapshotProductionStateTest(unittest.TestCase):
    def test_snapshot_copies_consistent_databases_and_private_configs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "app"
            runtime = root / ".easy_exam_runtime"
            runtime.mkdir(parents=True)
            database = runtime / "task_state.sqlite3"
            with sqlite3.connect(database) as connection:
                connection.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY, name TEXT)")
                connection.execute("INSERT INTO tasks(name) VALUES ('test')")
            (root / ".env").write_text("SECRET=value\n", encoding="utf-8")
            (runtime / "auth_users.json").write_text('{"users":[]}\n', encoding="utf-8")

            destination = Path(temporary) / "snapshot"
            result = MODULE.snapshot(root, destination)

            self.assertEqual(len(result["databases"]), 1)
            self.assertEqual(len(result["configs"]), 2)
            with sqlite3.connect(destination / "databases" / "task_state.sqlite3") as connection:
                self.assertEqual(connection.execute("PRAGMA quick_check").fetchone()[0], "ok")
                self.assertEqual(connection.execute("SELECT name FROM tasks").fetchone()[0], "test")
            self.assertEqual((destination / "config" / "root" / ".env").read_text(), "SECRET=value\n")
            metadata = json.loads((destination / "metadata.json").read_text())
            self.assertEqual(metadata["databases"][0]["quickCheck"], "ok")

    def test_snapshot_refuses_to_overwrite_an_existing_destination(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "app"
            (root / ".easy_exam_runtime").mkdir(parents=True)
            destination = Path(temporary) / "snapshot"
            destination.mkdir()
            with self.assertRaisesRegex(RuntimeError, "already exists"):
                MODULE.snapshot(root, destination)


if __name__ == "__main__":
    unittest.main()
