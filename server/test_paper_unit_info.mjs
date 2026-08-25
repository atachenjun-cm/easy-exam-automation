import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchPaperUnitInfo,
  normalizePaperUnitInfo,
} from "./paper_unit_info.mjs";

test("normalizes paper sections and section time labels", () => {
  const result = normalizePaperUnitInfo({
    form: {
      sections: [
        { name: "选择题", timer: { time_min_limit: 300, time_limit: 3600 } },
        { name: "主观题", timer: { time_min_limit: 300, time_limit: 1800 } },
      ],
    },
  });

  assert.deepEqual(result, {
    unit_count: 2,
    unit_label: "2个单元",
    assessment_mode: "none",
    sections: [
      { name: "选择题", time_label: "5.0-60.0分钟" },
      { name: "主观题", time_label: "5.0-30.0分钟" },
    ],
  });
});

test("fetches paper unit info without mutating paper binding data", async () => {
  const calls = [];
  const requestJson = async (_login, url, options, action) => {
    calls.push({ url, options, action });
    return {
      form: {
        sections: [
          { name: "试考", timer: { time_min_limit: 600, time_limit: 5400 } },
        ],
      },
    };
  };

  const result = await fetchPaperUnitInfo({
    login: {},
    apiBase: "https://eztest.cn",
    formCode: "FORM-01",
    requestJson,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://eztest.cn/tenant/api/form/FORM-01/get/");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].action, "读取试卷单元 FORM-01");
  assert.deepEqual(result, {
    unit_count: 1,
    unit_label: "1个单元",
    assessment_mode: "none",
    sections: [
      { name: "试考", time_label: "10.0-90.0分钟" },
    ],
  });
});

test("classifies final paper structures for OPA archive fields", () => {
  assert.equal(normalizePaperUnitInfo({
    form: { sections: [{ name: "OPA 性格测评" }] },
  }).assessment_mode, "only_opa");
  assert.equal(normalizePaperUnitInfo({
    form: { sections: [{ name: "综合能力" }, { name: "OPA 性格测评" }] },
  }).assessment_mode, "includes_opa");
  assert.equal(normalizePaperUnitInfo({
    form: { sections: [{ name: "综合能力" }] },
  }).assessment_mode, "none");
  assert.equal(normalizePaperUnitInfo({
    form: {
      sections: [{
        name: "综合能力",
        section_type: "exam",
        groups: [{ items: [{ content: { stem: "审美是健全人格的组成部分。" } }] }],
      }],
    },
  }).assessment_mode, "none");
  assert.equal(normalizePaperUnitInfo({
    form: { sections: [{ name: "人才测评", section_type: "assessment" }] },
  }).assessment_mode, "only_opa");
  assert.equal(normalizePaperUnitInfo({
    form: { name: "综合能力", groups: [{ items: [{ content: { stem: "健全人格" } }] }] },
  }).assessment_mode, "none");
  assert.equal(normalizePaperUnitInfo({
    form: {
      name: "蜀道SHL-专业人士-情绪倾向报告（30Min）",
      form_type: "exam",
      sections: [{ name: "SHL测评", section_type: "shl" }],
    },
  }).assessment_mode, "only_opa");
  assert.equal(normalizePaperUnitInfo({
    form: {
      name: "新员工笔试",
      sections: [
        { name: "TBM管理岗", section_type: "exam" },
        { name: "SHL测评", section_type: "shl" },
      ],
    },
  }).assessment_mode, "includes_opa");
});
