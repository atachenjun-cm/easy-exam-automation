import assert from "node:assert/strict";
import test from "node:test";
import {
  applyVirtualFanweiRequirementDefaults,
  buildVirtualFanweiReadPayload,
  isVirtualFanweiSerial,
} from "./fanwei_virtual_requirement.mjs";
import { validateFanweiReadPayload } from "./fanwei_requirement_mapper.mjs";

test("virtual Fanwei payload is synthetic, future-dated, and accepted by the normal validator", () => {
  const serialNo = "VIRTUAL-20260817-001";
  const payload = buildVirtualFanweiReadPayload(serialNo, { now: new Date("2026-08-17T12:00:00+08:00") });
  const validated = validateFanweiReadPayload(payload, serialNo);

  assert.equal(validated.fields["运控流水号"], serialNo);
  assert.equal(validated.fields["项目编码"], "VIRTUAL");
  assert.equal(validated.serviceConfirmation.fields["考试时间"], "2026年9月16日 14:00-16:00");
  assert.equal(validated.examSceneRows[0]["考试日期"], "2026-09-16");
  assert.match(validated.serviceConfirmation.fields["考试名称"], /^虚拟易考配置联调-VIRTUAL-/);
  assert.doesNotMatch(JSON.stringify(validated), /R\d{7}|F\d{7}|@ata\.net\.cn/);
});

test("virtual Fanwei serials are explicit and narrowly formatted", () => {
  assert.equal(isVirtualFanweiSerial("VIRTUAL-20260817-001"), true);
  assert.equal(isVirtualFanweiSerial("R0042182"), false);
  assert.equal(isVirtualFanweiSerial("VIRTUAL-"), false);
  assert.throws(() => buildVirtualFanweiReadPayload("R0042182"), /必须以 VIRTUAL-/);
});

test("virtual Fanwei requirements default to a formal session only", () => {
  const model = { requirementFields: { "考试名称": "虚拟考试", "试考日期时间": "2026/9/15 10:00-17:00" } };
  const virtual = applyVirtualFanweiRequirementDefaults(model, "VIRTUAL-20260817-001");
  const real = applyVirtualFanweiRequirementDefaults(model, "R0042182");

  assert.equal(virtual.requirementFields["试考日期时间"], "");
  assert.equal(virtual.requirementFields["考试名称"], "虚拟考试");
  assert.equal(real, model);
});
