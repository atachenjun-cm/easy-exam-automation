import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import candidate_list_parser as parser


class CandidateListParserTest(unittest.TestCase):
    def test_detects_optional_course_code_from_chinese_header(self):
        columns = ["准考证号", "姓名", "身份证号", "科目编号"]
        mapping = parser.detect_mapping(columns)
        candidates = parser.build_candidates(
            [
                {
                    "__row": 2,
                    "准考证号": "P001",
                    "姓名": "张三",
                    "身份证号": "110101199001011234",
                    "科目编号": "COURSE-01",
                }
            ],
            mapping,
        )

        self.assertEqual(mapping["course_code"], "科目编号")
        self.assertEqual(candidates[0]["course_code"], "COURSE-01")
        self.assertEqual(parser.validate_candidates(candidates, mapping), ([], []))

    def test_course_code_is_optional(self):
        mapping = {"permit": "准考证号", "full_name": "姓名", "identity_id": "身份证号", "course_code": ""}
        candidates = [
            {
                "__row": 2,
                "permit": "P001",
                "full_name": "张三",
                "identity_id": "110101199001011234",
                "course_code": "",
            }
        ]

        self.assertEqual(parser.validate_candidates(candidates, mapping), ([], []))

    def test_template_includes_optional_course_code_column(self):
        self.assertEqual(parser.TEMPLATE_HEADERS, ("准考证号", "姓名", "身份证号", "科目编号"))


if __name__ == "__main__":
    unittest.main()
