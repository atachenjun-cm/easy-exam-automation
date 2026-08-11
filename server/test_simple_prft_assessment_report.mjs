import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchSimplePrftAssessmentReports,
  isSimplePrftResponse,
  normalizeSimplePrftEntryReports,
} from "./simple_prft_assessment_report.mjs";

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers });
}

test("identifies only DataTalk simple_PRFT response forms", () => {
  assert.equal(isSimplePrftResponse({
    form_content: {
      sections: [{ custom_report: "datatalk", datatalk: { report_type: "simple_PRFT" } }],
    },
  }), true);
  assert.equal(isSimplePrftResponse({
    form_content: {
      sections: [{ custom_report: "datatalk", datatalk: { report_type: "other" } }],
    },
  }), false);
  assert.equal(isSimplePrftResponse({ reports: [{ name: "普通报告" }] }), false);
});

test("normalizes manager entry_reports without changing regular report payloads", () => {
  assert.deepEqual(normalizeSimplePrftEntryReports({
    data: {
      entry_reports: [
        ["报告(simple_PRFT)", "https://cdn.example/report.pdf", null],
        ["", "https://cdn.example/empty-name.pdf"],
      ],
    },
  }), [{
    name: "报告(simple_PRFT)",
    url: "https://cdn.example/report.pdf",
    status: "",
  }]);
  assert.deepEqual(normalizeSimplePrftEntryReports({ reports: [{ name: "原报告", url: "https://example.test/old.pdf" }] }), []);
});

test("queries manager entry reports only for candidates confirmed as simple_PRFT", async () => {
  const tenantCalls = [];
  const fetchCalls = [];
  const candidates = [
    { index: 0, row: { permit: "P-SPECIAL" } },
    { index: 1, row: { permit: "P-REGULAR" } },
  ];
  const results = await fetchSimplePrftAssessmentReports({
    login: {
      apiBase: "https://api.example.test",
      url: "https://manager.example.test/manager/accounts/login",
      username: "account@example.test",
      password: "secret",
    },
    sessionId: "S-1",
    candidates,
    requestTenantJson: async (_login, url) => {
      tenantCalls.push(String(url));
      const special = String(url).includes("P-SPECIAL");
      return {
        form_content: {
          sections: [{
            custom_report: "datatalk",
            datatalk: { report_type: special ? "simple_PRFT" : "other" },
          }],
        },
      };
    },
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push({ url: String(url), options });
      if (String(url).endsWith("/dapi/login/")) {
        return jsonResponse({ ok: true }, 200, { "set-cookie": "sessionid=manager-session; Path=/; HttpOnly" });
      }
      return jsonResponse({
        data: {
          entry_reports: [["报告(simple_PRFT)", "https://cdn.example/special.pdf", null]],
        },
      });
    },
  });

  assert.equal(tenantCalls.length, 2);
  assert.equal(fetchCalls.filter((call) => call.url.endsWith("/dapi/login/")).length, 1);
  assert.equal(fetchCalls.filter((call) => call.url.includes("/entry/P-SPECIAL/")).length, 1);
  assert.equal(fetchCalls.some((call) => call.url.includes("/entry/P-REGULAR/")), false);
  assert.equal(fetchCalls.find((call) => call.url.includes("/entry/P-SPECIAL/")).options.headers.Cookie, "sessionid=manager-session");
  assert.deepEqual(results, [{
    candidate: candidates[0],
    reports: [{
      name: "报告(simple_PRFT)",
      url: "https://cdn.example/special.pdf",
      status: "",
    }],
  }]);
});
