import json
import tempfile
import unittest
from pathlib import Path

from openpyxl import load_workbook

from not_started_candidate_exporter import export_not_started_candidates


class NotStartedCandidateExporterTest(unittest.TestCase):
    def test_exports_only_the_requested_not_started_rows(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp = Path(temp_dir)
            payload = temp / "payload.json"
            output = temp / "not-started.xlsx"
            payload.write_text(
                json.dumps(
                    {
                        "session": {"session_id": "trial-123", "name": "试考"},
                        "rows": [
                            {
                                "name": "张三",
                                "identity_id": "510101199001010011",
                                "mobile": "13800000000",
                                "permit": "A001",
                                "course": "试考",
                                "exam_status": "未开考",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                "utf-8",
            )

            result = export_not_started_candidates(payload, output)

            self.assertTrue(result["ok"])
            self.assertEqual(result["rows"], 1)
            sheet = load_workbook(output).active
            self.assertEqual(
                [cell.value for cell in sheet[1]],
                ["姓名", "性别", "证件号码", "手机号码", "邮箱", "科目", "准考证号", "考试状态"],
            )
            self.assertEqual(sheet["A2"].value, "张三")
            self.assertEqual(sheet["G2"].value, "A001")
            self.assertEqual(sheet["H2"].value, "未开考")
            self.assertEqual(sheet.freeze_panes, "A2")

    def test_rejects_empty_not_started_rows(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp = Path(temp_dir)
            payload = temp / "payload.json"
            output = temp / "not-started.xlsx"
            payload.write_text(
                json.dumps({"session": {"session_id": "trial-123"}, "rows": []}),
                "utf-8",
            )

            result = export_not_started_candidates(payload, output)

            self.assertFalse(result["ok"])
            self.assertIn("没有未开考考生", result["errors"][0])


if __name__ == "__main__":
    unittest.main()
