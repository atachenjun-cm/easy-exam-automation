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

    def test_identity_id_is_optional(self):
        mapping = {"permit": "准考证号", "full_name": "姓名", "identity_id": "", "course_code": ""}
        candidates = [
            {
                "__row": 2,
                "permit": "P001",
                "full_name": "张三",
                "identity_id": "",
                "course_code": "",
            }
        ]

        self.assertEqual(parser.validate_candidates(candidates, mapping), ([], []))

    def test_detects_mobile_email_and_custom_field_candidates(self):
        columns = ["准考证号", "姓名", "身份证号", "手机号", "邮箱地址", "报考岗位", "学校"]
        mapping = parser.detect_mapping(columns)
        custom = parser.custom_field_candidates(columns, mapping)

        self.assertEqual(mapping["mobile"], "手机号")
        self.assertEqual(mapping["email"], "邮箱地址")
        self.assertEqual(custom, ["报考岗位", "学校"])

    def test_phone_aliases_are_fixed_mapping_fields_not_custom_candidates(self):
        columns = ["姓名", "联系电话", "身份证号", "专业", "岗位名称"]
        mapping = {
            "full_name": "姓名",
            "permit": "联系电话",
            "identity_id": "身份证号",
            "course_code": "",
            "mobile": "联系电话",
            "email": "",
        }

        custom = parser.custom_field_candidates(columns, mapping)

        self.assertNotIn("联系电话", custom)
        self.assertIn("专业", custom)

    def test_normalizes_mobile_and_email_custom_field_names_for_yikao(self):
        mapping = {
            "permit": "手机",
            "full_name": "姓名",
            "identity_id": "",
            "course_code": "",
            "mobile": "手机",
            "email": "电子邮件",
        }
        candidates = parser.build_candidates(
            [
                {
                    "__row": 2,
                    "手机": "15316833344",
                    "姓名": "张三",
                    "电子邮件": "a@example.com",
                }
            ],
            mapping,
            [
                {"source_column": "手机", "target_name": "手机", "enabled": True},
                {"source_column": "电子邮件", "target_name": "电子邮件", "enabled": True},
            ],
        )

        self.assertEqual(candidates[0]["permit"], "15316833344")
        self.assertEqual(candidates[0]["mobile"], "15316833344")
        self.assertEqual(candidates[0]["email"], "a@example.com")
        self.assertEqual(candidates[0]["custom_fields"], {"手机号码": "15316833344", "邮箱": "a@example.com"})

    def test_build_candidates_includes_enabled_custom_fields(self):
        mapping = {
            "permit": "准考证号",
            "full_name": "姓名",
            "identity_id": "身份证号",
            "course_code": "科目编号",
            "mobile": "手机号",
            "email": "邮箱",
        }
        candidates = parser.build_candidates(
            [
                {
                    "__row": 2,
                    "准考证号": "P001",
                    "姓名": "张三",
                    "身份证号": "",
                    "科目编号": "20260629-01-01",
                    "手机号": "13800000000",
                    "邮箱": "a@example.com",
                    "报考岗位": "综合岗",
                    "学校": "四川大学",
                }
            ],
            mapping,
            [
                {"source_column": "报考岗位", "target_name": "报考岗位", "enabled": True},
                {"source_column": "学校", "target_name": "毕业学校", "enabled": True},
                {"source_column": "备注", "target_name": "备注", "enabled": False},
            ],
        )

        self.assertEqual(candidates[0]["mobile"], "13800000000")
        self.assertEqual(candidates[0]["email"], "a@example.com")
        self.assertEqual(candidates[0]["custom_fields"], {"报考岗位": "综合岗", "毕业学校": "四川大学"})

    def test_template_includes_optional_course_code_column(self):
        self.assertEqual(parser.TEMPLATE_HEADERS, ("准考证号", "姓名", "身份证号", "科目编号", "手机号码", "邮箱"))


if __name__ == "__main__":
    unittest.main()
