import assert from "node:assert/strict";
import test from "node:test";

import { buildTenantCandidateEntry, buildTenantCandidateEntries } from "./candidate_tenant_payload.mjs";

test("flattens selected custom fields into EasyExam candidate entry payload", () => {
  const entry = buildTenantCandidateEntry(
    {
      permit: "ID001",
      full_name: "张三",
      identity_id: "ID001",
      course_code: "20260629-01-01",
      mobile: "13800000000",
      email: "a@example.com",
      custom_fields: {
        专业: "材料学",
        岗位名称: "炼化技术研发",
      },
    },
    [
      { field_name: "专业", field_code: "cf_major" },
      { field_name: "岗位名称", field_code: "cf_position_name" },
    ],
  );

  assert.deepEqual(entry, {
    permit: "ID001",
    full_name: "张三",
    identity_id: "ID001",
    course_code: "20260629-01-01",
    phone: "13800000000",
    email: "a@example.com",
    cf_major: "材料学",
    cf_position_name: "炼化技术研发",
  });
});

test("omits empty optional fields and falls back to legacy custom field keys without mappings", () => {
  const [entry] = buildTenantCandidateEntries([
    {
      permit: "13800000000",
      full_name: "李四",
      identity_id: "",
      course_code: "",
      custom_fields: { custom_fields: "bad", 专业: "化学工程" },
    },
  ]);

  assert.equal(entry.course_code, undefined);
  assert.equal(entry.custom_fields, undefined);
  assert.equal(entry.专业, "化学工程");
});

test("maps selected phone information item even when same source is used as permit", () => {
  const entry = buildTenantCandidateEntry(
    {
      permit: "15316833344",
      full_name: "张三",
      identity_id: "500240199412013811",
      custom_fields: {
        手机号码: "15316833344",
      },
    },
    [{ field_name: "手机号码", field_code: "phone" }],
  );

  assert.equal(entry.permit, "15316833344");
  assert.equal(entry.phone, "15316833344");
  assert.equal(entry.手机号码, undefined);
});

test("keeps explicit phone and email values when base information item mappings are present", () => {
  const entry = buildTenantCandidateEntry(
    {
      permit: "18516666447",
      full_name: "李四",
      identity_id: "230107198412150646",
      mobile: "18516666447",
      email: "lisi@example.com",
      custom_fields: {},
    },
    [
      { field_name: "手机号码", field_code: "phone" },
      { field_name: "邮箱", field_code: "email" },
    ],
  );

  assert.equal(entry.phone, "18516666447");
  assert.equal(entry.email, "lisi@example.com");
});
