import assert from "node:assert/strict";
import test from "node:test";

import { buildCandidateChangeEditorFields } from "./candidate_change.mjs";

test("renders the course code as a session-scoped select field", () => {
  const fields = buildCandidateChangeEditorFields({
    personal: { full_name: { label: "姓名", visible: true, required: true } },
    courses: [
      { name: "综合能力", code: "20260902-01-01" },
      { course_name: "专业能力", course_code: "20260902-01-02" },
    ],
  });
  const courseField = fields.find((field) => field.field_code === "course_code");

  assert.equal(courseField.type, "select");
  assert.equal(courseField.required, true);
  assert.deepEqual(courseField.options, [
    { value: "20260902-01-01", label: "综合能力（20260902-01-01）" },
    { value: "20260902-01-02", label: "专业能力（20260902-01-02）" },
  ]);
});
