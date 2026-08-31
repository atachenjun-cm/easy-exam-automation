import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts.refresh_test_runtime import refresh


def create_database(path, value):
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE sample (value TEXT NOT NULL)")
        connection.execute("INSERT INTO sample (value) VALUES (?)", (value,))


def read_value(path):
    with sqlite3.connect(path) as connection:
        return connection.execute("SELECT value FROM sample").fetchone()[0]


class RefreshTestRuntimeTests(unittest.TestCase):
    def test_refresh_copies_only_databases_by_default_and_preserves_previous_test_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            production = root / "production"
            test = root / "test" / "runtime"
            production.mkdir()
            test.mkdir(parents=True)
            for database in ("task_state.sqlite3", "requirement_requests.sqlite3"):
                create_database(production / database, "production")
                create_database(test / database, "test-before-refresh")
            (production / "auth_sessions.json").write_text('[{"token":"secret"}]', encoding="utf-8")
            (production / "uploads").mkdir()
            (production / "uploads" / "candidate.xlsx").write_bytes(b"fixture")

            metadata = refresh(production, test, require_test_stopped=False)

            self.assertEqual(read_value(test / "task_state.sqlite3"), "production")
            self.assertEqual(read_value(test / "requirement_requests.sqlite3"), "production")
            self.assertFalse((test / "auth_sessions.json").exists())
            self.assertFalse((test / "uploads").exists())
            snapshot = test.parent / "snapshots" / f"before-refresh-{metadata['snapshotId']}"
            self.assertEqual(read_value(snapshot / "task_state.sqlite3"), "test-before-refresh")

    def test_include_uploads_replaces_test_uploads_with_recoverable_backup(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            production = root / "production"
            test = root / "test" / "runtime"
            production.mkdir()
            test.mkdir(parents=True)
            for database in ("task_state.sqlite3", "requirement_requests.sqlite3"):
                create_database(production / database, "production")
            (production / "uploads").mkdir()
            (production / "uploads" / "new.txt").write_text("new", encoding="utf-8")
            (test / "uploads").mkdir()
            (test / "uploads" / "old.txt").write_text("old", encoding="utf-8")

            metadata = refresh(production, test, include_uploads=True, require_test_stopped=False)

            self.assertEqual((test / "uploads" / "new.txt").read_text(encoding="utf-8"), "new")
            snapshot = test.parent / "snapshots" / f"before-refresh-{metadata['snapshotId']}"
            self.assertEqual((snapshot / "uploads" / "old.txt").read_text(encoding="utf-8"), "old")


if __name__ == "__main__":
    unittest.main()
