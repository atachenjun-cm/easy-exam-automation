import json
import tempfile
import unittest
from pathlib import Path

from task_state_db import TaskStore


class TaskStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = TaskStore(Path(self.temp_dir.name) / "tasks.sqlite3")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_lists_projects_and_sessions_across_accounts(self):
        first = self.store.create_task("项目甲", "account-a", {"source": "a.xlsx"})
        second = self.store.create_task("项目乙", "account-b", {"source": "b.xlsx"})
        self.store.upsert_session(first["taskId"], "formal", {
            "session_id": "10001", "name": "项目甲正式考试", "start": "2026-06-20 09:00", "end": "2026-06-20 10:00"
        })
        self.store.upsert_session(second["taskId"], "trial", {
            "session_id": "10002", "name": "项目乙-试考", "start": "2026-06-19 09:00", "end": "2026-06-19 10:00"
        })

        projects = self.store.list_tasks()
        sessions = self.store.list_sessions()

        self.assertEqual({item["sourceAccount"] for item in projects}, {"account-a", "account-b"})
        self.assertEqual({item["session_id"] for item in sessions}, {"10001", "10002"})

    def test_persists_task_owner_email_to_tasks_and_sessions(self):
        task = self.store.create_task("同事项目", "account-a", {}, owner_email="mate@example.com")
        self.store.upsert_session(task["taskId"], "formal", {
            "session_id": "20001", "name": "同事项目正式考试"
        })

        detail = self.store.get_task(task["taskId"])
        sessions = self.store.list_sessions()

        self.assertEqual(task["ownerEmail"], "mate@example.com")
        self.assertEqual(detail["ownerEmail"], "mate@example.com")
        self.assertEqual(sessions[0]["ownerEmail"], "mate@example.com")

    def test_steps_are_independent_and_persist_timestamps(self):
        task = self.store.create_task("项目甲", "account-a", {})
        task_id = task["taskId"]
        self.store.update_step(task_id, "trial_session_create", "success", {"message": "试考先完成"})
        detail = self.store.get_task(task_id)

        trial = next(step for step in detail["steps"] if step["stepKey"] == "trial_session_create")
        formal = next(step for step in detail["steps"] if step["stepKey"] == "formal_session_create")
        self.assertEqual(trial["status"], "success")
        self.assertIsNotNone(trial["startedAt"])
        self.assertIsNotNone(trial["completedAt"])
        self.assertEqual(formal["status"], "pending")
        self.assertGreater(detail["progress"], 0)

    def test_combined_step_requires_both_children(self):
        task = self.store.create_task("项目甲", "account-a", {})
        task_id = task["taskId"]
        self.store.update_step(task_id, "sessions_auto_rooms", "running", {
            "subStatus": {"formalExamStatus": "success", "trialExamStatus": "running"}
        })
        running = self.store.get_task(task_id)
        combined = next(step for step in running["steps"] if step["stepKey"] == "sessions_auto_rooms")
        self.assertEqual(combined["status"], "running")

        self.store.update_step(task_id, "sessions_auto_rooms", "success", {
            "subStatus": {"formalExamStatus": "success", "trialExamStatus": "success"}
        })
        finished = self.store.get_task(task_id)
        combined = next(step for step in finished["steps"] if step["stepKey"] == "sessions_auto_rooms")
        self.assertEqual(combined["status"], "success")


if __name__ == "__main__":
    unittest.main()
