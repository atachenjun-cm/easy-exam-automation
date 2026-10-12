import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyTenantSingleScoreError,
  isTenantEmptyPageError,
  isTenantMissingScoreError,
} from "./tenant_pagination.mjs";

test("recognizes only the tenant empty-page 403 as pagination completion", () => {
  assert.equal(isTenantEmptyPageError({ status: 403, detail: { detail: "本页结果为空" } }), true);
  assert.equal(isTenantEmptyPageError({ status: 403, detail: { error: "not found score" } }), false);
  assert.equal(isTenantEmptyPageError({ status: 401, detail: { detail: "本页结果为空" } }), false);
});

test("recognizes only an explicit missing-score 403 as an empty score", () => {
  assert.equal(isTenantMissingScoreError({ status: 403, detail: { error: "not found score" } }), true);
  assert.equal(isTenantMissingScoreError({ status: 403, detail: { message: "Not Found Score." } }), true);
  assert.equal(isTenantMissingScoreError({ status: 403, detail: { error: "permission denied" } }), false);
  assert.equal(isTenantMissingScoreError({ status: 401, detail: { error: "not found score" } }), false);
});

test("keeps permission failures distinct from missing scores", () => {
  assert.equal(classifyTenantSingleScoreError({ status: 403, detail: { error: "not found score" } }), "missing");
  assert.equal(classifyTenantSingleScoreError({ status: 404, detail: "not found" }), "missing");
  assert.equal(classifyTenantSingleScoreError({ status: 403, detail: { error: "permission denied" } }), "forbidden");
  assert.equal(classifyTenantSingleScoreError({ status: 500, detail: "upstream failed" }), "other");
});
