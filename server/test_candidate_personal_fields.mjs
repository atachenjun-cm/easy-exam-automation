import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalImportFieldName,
  generateCustomFieldCode,
  mergeCustomPersonalFields,
  normalizeCustomPersonalFieldNames,
  normalizeImportPersonalFieldRequests,
  syncImportPersonalFields,
  syncCustomPersonalFields,
} from "./candidate_personal_fields.mjs";

test("merges selected custom fields into visible personal information config", () => {
  const personal = mergeCustomPersonalFields(
    { full_name: { label: "姓名", visible: true, order: 0 } },
    ["专业", "岗位名称"],
  );
  const majorCode = generateCustomFieldCode("专业");
  const positionCode = generateCustomFieldCode("岗位名称");

  assert.equal(personal[majorCode].visible, true);
  assert.equal(personal[majorCode].editable, false);
  assert.equal(personal[majorCode].required, false);
  assert.equal(personal[majorCode].label, "专业");
  assert.equal(personal[positionCode].visible, true);
});

test("filters disallowed import-only fields and duplicate custom personal field names", () => {
  assert.deepEqual(normalizeCustomPersonalFieldNames(["专业", "专业", "手机号", "手机", "准考证号", "", "岗位名称"]), ["专业", "手机号码", "岗位名称"]);
});

test("canonicalizes phone and email aliases to EasyExam field names", () => {
  assert.equal(canonicalImportFieldName("手机"), "手机号码");
  assert.equal(canonicalImportFieldName("手机号"), "手机号码");
  assert.equal(canonicalImportFieldName("联系电话"), "手机号码");
  assert.equal(canonicalImportFieldName("电子邮箱"), "邮箱");
});

test("syncs custom personal fields with stable ascii field code mappings", () => {
  const result = syncCustomPersonalFields(
    { full_name: { label: "姓名", visible: true, order: 0 } },
    [
      { source_column: "专业", target_name: "专业", enabled: true },
      { source_column: "岗位", target_name: "岗位名称", enabled: true },
    ],
  );

  assert.equal(result.mappings.length, 2);
  assert.match(result.mappings[0].field_code, /^cf_[a-f0-9]{12}$/);
  assert.equal(result.personal[result.mappings[0].field_code].label, "专业");
  assert.equal(result.personal[result.mappings[1].field_code].label, "岗位名称");
  assert.equal(result.personal[result.mappings[0].field_code].editable, false);
});

test("reuses existing personal field by label", () => {
  const result = syncCustomPersonalFields(
    { cf_existing: { label: "专业", visible: true, order: 8, field_id: 123 } },
    [{ source_column: "专业", target_name: "专业", enabled: true }],
  );

  assert.equal(result.mappings[0].field_code, "cf_existing");
  assert.equal(result.mappings[0].yikao_field_id, "123");
  assert.equal(result.mappings[0].status, "existing");
  assert.equal(result.personal.cf_existing.editable, false);
  assert.equal(result.personal.cf_existing.required, false);
  assert.equal(result.personal.cf_existing.visible, true);
});

test("normalizes selected import fields including mapped base fields only", () => {
  const selected = normalizeImportPersonalFieldRequests([
    { field_name: "姓名", field_code: "full_name", source_column: "姓名", field_kind: "base", enabled: true },
    { field_name: "准考证号", field_code: "permit", source_column: "准考证号", field_kind: "base", enabled: true },
    { field_name: "身份证号", field_code: "identity_id", source_column: "身份证号", field_kind: "base", enabled: false },
    { field_name: "专业", source_column: "专业", field_kind: "custom", enabled: true },
  ]);

  assert.deepEqual(selected.map((field) => field.field_name), ["姓名", "准考证号", "专业"]);
  assert.deepEqual(selected.map((field) => field.field_code), ["full_name", "permit", generateCustomFieldCode("专业")]);
});

test("syncs mapped name and identity plus checked custom fields while excluding permit and course code", () => {
  const result = syncImportPersonalFields({}, [
    { field_name: "姓名", field_code: "full_name", source_column: "姓名", field_kind: "base", enabled: true },
    { field_name: "身份证号", field_code: "identity_id", source_column: "身份证号", field_kind: "base", enabled: true },
    { field_name: "性别", source_column: "性别", field_kind: "custom", enabled: true },
    { field_name: "专业", source_column: "专业", field_kind: "custom", enabled: true },
    { field_name: "岗位名称", source_column: "岗位名称", field_kind: "custom", enabled: true },
  ]);

  assert.deepEqual(result.names, ["姓名", "身份证号", "性别", "专业", "岗位名称"]);
  assert.equal(Boolean(result.personal.permit), false);
  assert.equal(Boolean(result.personal.course_code), false);
});

test("syncs only selected import fields without adding default identity field", () => {
  const result = syncImportPersonalFields({}, [
    { field_name: "姓名", field_code: "full_name", source_column: "姓名", field_kind: "base", enabled: true },
    { field_name: "专业", source_column: "专业", field_kind: "custom", enabled: true },
  ]);

  assert.deepEqual(result.names, ["姓名", "专业"]);
  assert.equal(Boolean(result.personal.identity_id), false);
  assert.equal(result.personal.full_name.label, "姓名");
  assert.equal(result.personal.full_name.editable, false);
  assert.equal(result.personal.full_name.visible, true);
  assert.equal(result.personal.full_name.required, false);
});

test("allows the same source column to feed permit and phone personal field", () => {
  const selected = normalizeImportPersonalFieldRequests([
    { field_name: "准考证号", field_code: "permit", source_column: "联系电话", field_kind: "base", enabled: true },
    { field_name: "手机号", source_column: "联系电话", field_kind: "custom", enabled: true },
  ]);
  const result = syncImportPersonalFields({}, selected);

  assert.deepEqual(selected.map((field) => [field.field_name, field.field_code, field.source_column]), [
    ["准考证号", "permit", "联系电话"],
    ["手机号码", "phone", "联系电话"],
  ]);
  assert.deepEqual(result.names, ["准考证号", "手机号码"]);
  assert.equal(result.personal.phone.label, "手机号码");
  assert.equal(result.personal.phone.visible, true);
  assert.equal(result.mappings.find((field) => field.field_name === "手机号码").source_column, "联系电话");
});
