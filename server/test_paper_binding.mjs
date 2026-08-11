import assert from "node:assert/strict";
import test from "node:test";

import {
  bindPapersToFormalSession,
  detectSessionPaperBindings,
  validatePaperBinding,
} from "./paper_binding.mjs";

const MISSING_FORM_CODES_MESSAGE = "科目已创建成功，但未获取到有效试卷 code，无法绑定到考试场次";

test("matches the active paper by course code before posting it to the formal session", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (String(url).includes("/tenant/api/form/list/")) {
      return {
        form_list: [
          { code: "FORM-A", name: "20260725-04-01_总会试卷" },
          { code: "FORM-B", name: "20260725-04-02_总会备用卷" },
        ],
      };
    }
    return { __tenantResponse: true, httpStatus: 200, body: { ok: true } };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "427535",
    courses: [{ name: "总会", code: "20260725-04-01", form_codes: ["OLD-LOCAL"] }],
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(result.status, "success");
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, "https://eztest.cn/tenant/api/form/list/?form_type=active&order_by=-id");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].url, "https://eztest.cn/tenant/api/course/");
  assert.equal(calls[1].options.method, "PUT");
  assert.equal(calls[2].url, "https://eztest.cn/tenant/api/course/session/427535/");
  assert.equal(calls[2].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    course_code: "20260725-04-01",
    form_codes: ["FORM-A"],
  });
  assert.ok(logs.includes("[试卷绑定] 科目“总会”已绑定到正式场次"));
  assert.ok(logs.includes("[试卷绑定] 试卷绑定完成，共 1 个科目"));
  assert.equal(logs.some((message) => /responseBody|requestBody|payload|HTTP Method|httpStatus/.test(message)), false);
});

test("reads form codes from nested data res fields", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (String(url).includes("/tenant/api/form/list/")) return { data: { res: [{ form_code: "F-01", paper_name: "C-01语文卷" }] } };
    return { ok: true };
  };

  await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ name: "语文", code: "C-01" }],
    requestJson,
    emitLog: () => {},
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    course_code: "C-01",
    form_codes: ["F-01"],
  });
});

test("selects by course code and ignores a configured requirement paper name", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (String(url).includes("/tenant/api/form/list/")) {
      return {
        form_list: [
          { code: "FORM-A", name: "20260718-01-02_Python语言基础+大数据技术" },
          { code: "FORM-B", name: "20260718-01-01_Python语言基础+大数据技术" },
          { code: "FORM-C", name: "20260718-01-03_会计学与财务分析基础" },
        ],
      };
    }
    return { __tenantResponse: true, httpStatus: 200, body: { ok: true } };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ name: "综合二", code: "20260718-01-02", paper_name: "不会用于匹配的需求单试卷名" }],
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.results[0].paper_names, ["20260718-01-02_Python语言基础+大数据技术"]);
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    course_code: "20260718-01-02",
    form_codes: ["FORM-A"],
  });
  assert.ok(logs.includes("[试卷绑定] 已按科目编号“20260718-01-02”匹配活跃试卷“20260718-01-02_Python语言基础+大数据技术”"));
});

test("uses the workflow serial before the course name and never reads historical course bindings", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/tenant/api/courses/")) {
      throw new Error("historical course bindings must not be queried");
    }
    if (String(url).includes("/tenant/api/form/list/")) {
      return {
        form_list: [
          { code: "FORM-OLD", name: "20260730_R0042669_四川交建2026年社招" },
          { code: "FORM-CURRENT", name: "20260806_R0042904蜀道投资集团有限责任公司招聘笔试（四川省交通建设）" },
        ],
      };
    }
    return { __tenantResponse: true, httpStatus: 200, body: {} };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "434018",
    courses: [{ name: "四川交建2026年社招", code: "20260806-02-01" }],
    workflowSerial: "R0042904",
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.results[0].form_codes, ["FORM-CURRENT"]);
  assert.deepEqual(result.results[0].paper_names, [
    "20260806_R0042904蜀道投资集团有限责任公司招聘笔试（四川省交通建设）",
  ]);
  assert.ok(logs.some((message) => message.includes("已按泛微流水号“R0042904”匹配活跃试卷")));
  assert.equal(calls.some((call) => call.url.includes("/tenant/api/courses/")), false);
});

test("uses subject code first and workflow serial plus name as the multi-subject fallback", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/tenant/api/form/list/")) {
      return {
        form_list: [
          { code: "FORM-CODE-ONLY", name: "20260806-02-01_旧批次试卷" },
          { code: "FORM-SUBJECT-1", name: "20260806_R0042904_四川交建2026年社招_综合一" },
          { code: "FORM-SUBJECT-2", name: "20260806_R0042904_四川交建2026年社招_综合二" },
        ],
      };
    }
    return { __tenantResponse: true, httpStatus: 200, body: {} };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "434018",
    courses: [
      { name: "综合一", code: "20260806-02-01" },
      { name: "综合二", code: "20260806-02-02" },
    ],
    workflowSerial: "R0042904",
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.results.map((item) => item.form_codes), [
    ["FORM-CODE-ONLY"],
    ["FORM-SUBJECT-2"],
  ]);
  assert.ok(logs.some((message) => message.includes("按泛微流水号及科目名称")));
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 2);
});

test("uses the closest subject name inside the shared workflow serial candidates", async () => {
  const logs = [];
  const requestJson = async (_login, url) => {
    if (String(url).includes("/tenant/api/form/list/")) {
      return {
        form_list: [
          { code: "FORM-MANAGER", name: "20260806_R0042904_项目经理（矿山主体岗位）" },
          { code: "FORM-ENGINEER", name: "20260806_R0042904_项目总工（矿山主体岗位）" },
        ],
      };
    }
    return { __tenantResponse: true, httpStatus: 200, body: {} };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "434018",
    courses: [
      { name: "项目经理（矿山主体类）", code: "20260806-02-01" },
      { name: "项目总工（矿山主体类）", code: "20260806-02-02" },
    ],
    workflowSerial: "R0042904",
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.results.map((item) => item.form_codes), [
    ["FORM-MANAGER"],
    ["FORM-ENGINEER"],
  ]);
  assert.ok(logs.some((message) => message.includes("科目名称近似")));
});

test("waits for manual confirmation when the course code matches more than one uploaded paper", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    return {
      form_list: [
        { code: "FORM-A", name: "20260718-01-03_财务分析案例A卷" },
        { code: "FORM-B", name: "20260718-01-03_财务分析案例B卷" },
      ],
    };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ name: "综合三", code: "20260718-01-03", paper_name: "财务分析案例" }],
    requestJson,
    emitLog: () => {},
  });

  assert.equal(result.status, "waiting_manual");
  assert.deepEqual(result.missingCourseCodes, ["20260718-01-03"]);
  assert.equal(calls.filter((call) => call.options?.method === "POST").length, 0);
});

test("fuzzily matches a unique paper when most of the course name appears in the paper name", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/tenant/api/form/list/")) {
      return {
        form_list: [
          {
            code: "FORM-TARGET",
            name: "20260802_R0042726_交通设计院公司2026年市政与建筑设计分院中层管理人员公开竞聘",
          },
          { code: "FORM-OTHER", name: "20260625_01项目管理类-四川公路桥梁建设" },
        ],
      };
    }
    return { __tenantResponse: true, httpStatus: 200, body: { ok: true } };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "432821",
    courses: [{ name: "市政与建筑设计分院副院长", code: "20260803-01-01" }],
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.results[0].form_codes, ["FORM-TARGET"]);
  assert.deepEqual(result.results[0].paper_names, [
    "20260802_R0042726_交通设计院公司2026年市政与建筑设计分院中层管理人员公开竞聘",
  ]);
  assert.ok(logs.some((message) => message.includes("已按科目名称近似")));
});

test("falls back to a unique Fanwei serial when course code and course name do not appear", async () => {
  const requestJson = async (_login, url, options) => {
    if (String(url).includes("/tenant/api/form/list/")) {
      return {
        form_list: [
          { code: "FORM-TARGET", name: "20260802_R0042726_完全不同的试卷标题" },
          { code: "FORM-OTHER", name: "20260802_R0042000_其他试卷" },
        ],
      };
    }
    return { __tenantResponse: true, httpStatus: 200, body: { ok: true } };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "432821",
    courses: [{ name: "原科目名称", code: "20260803-01-01" }],
    workflowSerial: "R0042726",
    requestJson,
    emitLog: () => {},
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.results[0].form_codes, ["FORM-TARGET"]);
});

test("uses only the active tenant form list when the course has no linked forms", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (String(url).includes("/tenant/api/form/list/")) {
      return {
        form_list: [
          { code: "FORM-PHY", name: "20260707-01-01物理", type: "form" },
          { code: "FORM-CHEM", name: "20260707-01-02化学", type: "form" },
        ],
      };
    }
    return { __tenantResponse: true, httpStatus: 200, body: { ok: true } };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ name: "物理", code: "20260707-01-01" }],
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.results[0].paper_names, ["20260707-01-01物理"]);
  assert.ok(calls.some((call) => String(call.url).endsWith("/tenant/api/form/list/?form_type=active&order_by=-id")));
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
    course_code: "20260707-01-01",
    form_codes: ["FORM-PHY"],
  });
  assert.ok(logs.includes("[试卷绑定] 已查询活跃试卷，共 2 份"));
  assert.equal(logs.some((message) => message.includes("FORM-CHEM")), false);
  assert.equal(calls.some((call) => String(call.url).includes("/tenant/api/courses/")), false);
});

test("waits for manual confirmation when tenant form list has duplicate paper names", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (String(url).includes("/tenant/api/form/list/")) {
      return {
        form_list: [
          { code: "FORM-LATEST", name: "20260707-02-01项目", type: "form" },
          { code: "FORM-OLD", name: "20260707-02-01项目", type: "form" },
          { code: "FORM-BIZ", name: "20260707-02-02 业务", type: "form" },
        ],
      };
    }
    return { __tenantResponse: true, httpStatus: 200, body: { ok: true } };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ name: "项目", code: "20260707-02-01" }],
    requestJson,
    emitLog: () => {},
  });

  assert.equal(result.status, "waiting_manual");
  assert.deepEqual(result.missingCourseCodes, ["20260707-02-01"]);
  assert.deepEqual(result.duplicatePaperMatches, [
    {
      course_code: "20260707-02-01",
      course_name: "项目",
      matched_by: "course_code_and_course_name",
      matched_value: "20260707-02-01 / 项目",
      candidates: [
        { code: "FORM-LATEST", name: "20260707-02-01项目" },
        { code: "FORM-OLD", name: "20260707-02-01项目" },
      ],
    },
  ]);
  assert.equal(calls.some((call) => call.options.method === "PUT" || call.options.method === "POST"), false);
});

test("updates the course with matched paper before binding the course to the session", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (String(url).includes("/tenant/api/form/list/")) {
      return {
        form_list: [
          { code: "FORM-PHY", name: "20260707-01-01物理", type: "form" },
          { code: "FORM-CHEM", name: "20260707-01-02化学", type: "form" },
        ],
      };
    }
    return { __tenantResponse: true, httpStatus: 200, body: { ok: true } };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ name: "物理", code: "20260707-01-01" }],
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(result.status, "success");
  assert.deepEqual(calls.map((call) => [call.options.method, call.url]), [
    ["GET", "https://eztest.cn/tenant/api/form/list/?form_type=active&order_by=-id"],
    ["PUT", "https://eztest.cn/tenant/api/course/"],
    ["POST", "https://eztest.cn/tenant/api/course/session/S-01/"],
  ]);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    code: "20260707-01-01",
    name: "物理",
    form_codes: ["FORM-PHY"],
  });
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    course_code: "20260707-01-01",
    form_codes: ["FORM-PHY"],
  });
  assert.ok(logs.includes("[试卷绑定] 已将 1 份活跃试卷关联到科目“物理”"));
});

test("waits for manual confirmation when the active paper list has no matching paper", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    return { form_list: [] };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "427535",
    courses: [{ name: "总会", code: "20260725-04-01" }],
    requestJson,
    emitLog: () => {},
  });

  assert.deepEqual(result, { status: "waiting_manual", missingCourseCodes: ["20260725-04-01"] });
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 0);
  assert.equal(calls[0].options.method, "GET");
});

test("detects manually bound paper from tenant session detail", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    return {
      id: "429102",
      name: "四川省通川工程技术开发有限公司校招笔试",
      courses: [
        {
          code: "20260705-01-01",
          name: "四川通川工程",
          forms: [{ code: "FORM-01", name: "20260705_蜀道投资集团有限责任公司招聘笔试（四川通川工程）" }],
        },
      ],
    };
  };

  const result = await detectSessionPaperBindings({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "429102",
    courses: [{ name: "四川通川工程", code: "20260705-01-01" }],
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.results, [
    {
      session_id: "429102",
      course_name: "四川通川工程",
      course_code: "20260705-01-01",
      form_codes: ["FORM-01"],
      paper_names: ["20260705_蜀道投资集团有限责任公司招聘笔试（四川通川工程）"],
      source: "session_detail",
    },
  ]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://eztest.cn/tenant/api/session/429102/forms/");
  assert.equal(calls[1].url, "https://eztest.cn/tenant/api/session/429102/");
  assert.equal(calls[1].options.method, "GET");
  assert.ok(logs.includes("[试卷绑定] 已检查正式场次，当前已绑定 0 份试卷"));
  assert.ok(logs.includes("[试卷绑定] 人工绑定回查确认正式场次已有试卷"));
});

test("detects manually bound paper from tenant session forms endpoint first", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url: String(url), options });
    return {
      results: [
        { code: "FORM-SESSION", name: "场次已绑定试卷", course_code: "C-01", course_name: "单科目" },
      ],
    };
  };

  const result = await detectSessionPaperBindings({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "429514",
    courses: [],
    requestJson,
    emitLog: () => {},
  });

  assert.equal(result.status, "success");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://eztest.cn/tenant/api/session/429514/forms/");
  assert.deepEqual(result.results, [
    {
      session_id: "429514",
      course_name: "单科目",
      course_code: "C-01",
      form_codes: ["FORM-SESSION"],
      paper_names: ["场次已绑定试卷"],
      source: "session_forms",
    },
  ]);
});

test("manual readback trusts the paper bound to the requested session course and ignores requirement paper_name", async () => {
  const requestJson = async (_login, url) => {
    if (String(url).endsWith("/forms/")) {
      return { results: [{ code: "FORM-A", name: "第一场综合卷", course_code: "C-01", course_name: "综合能力" }] };
    }
    return {
      id: "S-02",
      courses: [{
        code: "C-01",
        name: "综合能力",
        forms: [{ code: "FORM-A", name: "第一场综合卷" }],
      }],
    };
  };

  const result = await detectSessionPaperBindings({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-02",
    courses: [{ code: "C-01", name: "综合能力", paper_name: "第二场综合卷" }],
    requestJson,
    emitLog: () => {},
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.results[0].form_codes, ["FORM-A"]);
});

test("detects manually bound single-subject paper even when task has no configured courses", async () => {
  const requestJson = async (_login, url) => {
    if (String(url).endsWith("/forms/")) return [];
    return {
    id: "429514",
    name: "考试状态同步最新版本测试",
    courses: [
      {
        code: "MANUAL-01",
        name: "单科目",
        forms: [{ code: "FORM-MANUAL", name: "考试状态同步最新版本测试-人工绑定卷" }],
      },
    ],
    };
  };

  const result = await detectSessionPaperBindings({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "429514",
    courses: [],
    requestJson,
    emitLog: () => {},
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.results, [
    {
      session_id: "429514",
      course_name: "单科目",
      course_code: "MANUAL-01",
      form_codes: ["FORM-MANUAL"],
      paper_names: ["考试状态同步最新版本测试-人工绑定卷"],
      source: "session_detail",
    },
  ]);
});

test("falls back to tenant session list when session detail lookup fails during manual detection", async () => {
  const calls = [];
  const requestJson = async (_login, url) => {
    calls.push(String(url));
    if (String(url).endsWith("/forms/")) return [];
    if (String(url).includes("/tenant/api/session/429514/")) {
      const error = new Error("租户 API 回查正式场次试卷 429514失败：500");
      error.status = 500;
      throw error;
    }
    return {
      results: [
        {
          id: "429514",
          name: "考试状态同步最新版本测试",
          courses: [
            {
              code: "MANUAL-01",
              name: "单科目",
              forms: [{ code: "FORM-MANUAL", name: "考试状态同步最新版本测试-人工绑定卷" }],
            },
          ],
        },
      ],
    };
  };

  const result = await detectSessionPaperBindings({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "429514",
    courses: [],
    requestJson,
    emitLog: () => {},
  });

  assert.equal(result.status, "success");
  assert.equal(calls[0], "https://eztest.cn/tenant/api/session/429514/forms/");
  assert.equal(calls[1], "https://eztest.cn/tenant/api/session/429514/");
  assert.equal(calls[2], "https://eztest.cn/tenant/api/session/?session_ids=429514");
  assert.deepEqual(result.results[0].form_codes, ["FORM-MANUAL"]);
});

test("manual binding detection waits when a course still has no paper in session detail", async () => {
  const requestJson = async (_login, url) => {
    if (String(url).endsWith("/forms/")) return [];
    return {
    data: {
      id: "S-01",
      courses: [
        { code: "C-01", name: "语文", forms: [{ form_code: "F-01", paper_name: "语文卷" }] },
        { code: "C-02", name: "数学", forms: [] },
      ],
    },
    };
  };

  const result = await detectSessionPaperBindings({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ code: "C-01", name: "语文" }, { code: "C-02", name: "数学" }],
    requestJson,
    emitLog: () => {},
  });

  assert.deepEqual(result, { status: "waiting_manual", missingCourseCodes: ["C-02"] });
});

test("does not partially bind when any course has no form codes", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (String(url).includes("/tenant/api/form/list/")) {
      return { form_list: [{ code: "F-01", name: "C-01语文卷" }] };
    }
    return { __tenantResponse: true, httpStatus: 200, body: { ok: true } };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ name: "语文", code: "C-01" }, { name: "数学", code: "C-02" }],
    requestJson,
    emitLog: () => {},
  });

  assert.deepEqual(result, { status: "waiting_manual", missingCourseCodes: ["C-02"] });
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 0);
});

test("validates paper binding inputs", () => {
  assert.throws(() => validatePaperBinding({ sessionId: "", courseCode: "C1", formCodes: ["F1"] }));
  assert.throws(() => validatePaperBinding({ sessionId: "S1", courseCode: "", formCodes: ["F1"] }));
  assert.throws(() => validatePaperBinding({ sessionId: "S1", courseCode: "C1", formCodes: [] }), {
    message: MISSING_FORM_CODES_MESSAGE,
  });
});
