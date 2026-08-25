import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildContentRequirementEmail,
  contentRequirementEmailFingerprint,
  normalizeEmailSettings,
  parseEmailRecipients,
  redactEmailSettings,
  sendContentRequirementEmail,
  writeEmailSettingsFile,
} from "./content_requirement_email.mjs";
import { createSmtpMessage, friendlySmtpErrorMessage } from "./smtp_mailer.mjs";

test("email settings use Outlook SMTP defaults and do not store default recipients", () => {
  const settings = normalizeEmailSettings({
    fromEmail: "ops@example.com",
    fromName: "运营自动化",
    username: "ops@example.com",
    password: "secret",
    defaultRecipients: "customer@example.com",
  });

  assert.equal(settings.host, "smtp.office365.com");
  assert.equal(settings.port, 587);
  assert.equal(settings.secure, false);
  assert.equal(settings.fromEmail, "ops@example.com");
  assert.equal(settings.fromName, "运营自动化");
  assert.equal(settings.username, "ops@example.com");
  assert.equal(settings.password, "secret");
  assert.equal(settings.defaultRecipients, undefined);

  const redacted = redactEmailSettings(settings);
  assert.equal(redacted.password, undefined);
  assert.equal(redacted.passwordConfigured, true);
  assert.equal(redacted.defaultRecipients, undefined);
});

test("content task email renders the approved template and preserves missing fields", async () => {
  const task = {
    taskId: "task-1",
    projectName: "北京农商银行公文大赛",
    config: {
      operationBatchCode: "QTT260007",
      operationBatch: {
        draft: {
          fields: {
            batchName: { value: "北京农商银行公文大赛_2026年7月" },
            examStartDate: { value: "2026-07-10" },
            examEndDate: { value: "2026-07-10" },
            systemType: { value: "易考" },
            estimatedMaxSubjectCount: { value: "2" },
          },
        },
      },
      businessRequirement: {
        customer_name: "北京农商银行",
        project_code: "F0020592",
      },
    },
  };
  const requirement = {
    latest: {
      requirement: {
        examName: "北京农商银行公文大赛",
        subjects: [{ name: "英语", durationMinutes: 60 }, "数学"],
        formalExamTime: "2026/7/10 10:00-12:00",
      },
    },
  };
  const message = buildContentRequirementEmail({ task, requirement });
  assert.equal(message.subject, "北京农商银行公文大赛_2026年7月、内容任务单");
  assert.match(message.text, /内容任务单/);
  assert.match(message.text, /项目编码：F0020592/);
  assert.match(message.text, /批次名称：北京农商银行公文大赛_2026年7月/);
  assert.match(message.text, /英语\s+60/);
  assert.match(message.text, /项目经理：—/);
  assert.match(message.html, /<table/);
  assert.match(message.html, /项目编码/);
  assert.match(message.html, /F0020592/);
  assert.match(message.html, /科目信息/);
  assert.match(message.html, /英语/);
  assert.match(message.html, /60/);
  assert.match(message.html, /系统自动发送，请勿回复本邮件/);
});

test("content task email tolerates a missing requirement snapshot", () => {
  const message = buildContentRequirementEmail({
    task: {
      taskId: "task-without-requirement",
      projectName: "无需求快照项目",
      config: {},
    },
    requirement: null,
  });

  assert.equal(message.subject, "无需求快照项目、内容任务单");
  assert.match(message.text, /项目名称：无需求快照项目/);
  assert.match(message.text, /需求版本：—/);
});

test("content task fingerprint changes only when sent operation fields change", () => {
  const task = {
    taskId: "task-fingerprint",
    projectName: "项目名称",
    config: {
      operationBatchCode: "EZT261018",
      examRequirements: [{
        version: 1,
        fields: {
          "考试名称": "原考试名称",
          "考试日期时间": "2026/8/20 09:00-2026/8/20 11:00",
          "欢迎语": "原欢迎语",
        },
      }],
    },
  };
  const baseline = contentRequirementEmailFingerprint({ task });

  task.config.contentRequirementEmail = { history: [{ sentAt: "2026-08-01" }] };
  task.config.examRequirements[0].version = 2;
  task.config.examRequirements[0].fields["欢迎语"] = "新欢迎语";
  assert.equal(contentRequirementEmailFingerprint({ task }), baseline);

  task.config.examRequirements[0].fields["考试名称"] = "新考试名称";
  assert.notEqual(contentRequirementEmailFingerprint({ task }), baseline);
});

test("content task email uses the Fanwei project name separately from the latest exam name", () => {
  const task = {
    taskId: "task-stale",
    projectName: "旧任务考试名称",
    config: {
      fanweiSource: {
        raw: {
          fields: {
            "项目名称": "泛微项目名称",
          },
        },
      },
      businessRequirement: {
        project_name: "旧泛微项目名称",
        formal_exam_time_range: "2025/1/10 09:00-2025/1/10 11:00",
      },
    },
  };
  const requirement = {
    requestId: "request-current",
    customer: { name: "最新客户" },
    latest: {
      version: 3,
      source: "staff_manual_edit",
      requirement: {
        exam_name: "最新招聘考试",
        formal_exam_time_range: "2026/8/20 09:00-2026/8/21 11:00",
        mock_exam_time_range: "2026/8/19 15:00-16:00",
        subjects: ["英语", "数学"],
      },
    },
  };

  const message = buildContentRequirementEmail({ task, requirement });

  assert.equal(message.subject, "泛微项目名称、内容任务单");
  assert.match(message.text, /项目名称：泛微项目名称/);
  assert.match(message.text, /考试名称：最新招聘考试/);
  assert.match(message.text, /考试开始日期：2026-08-20/);
  assert.match(message.text, /考试结束日期：2026-08-21/);
  assert.match(message.text, /需求版本：3/);
  assert.doesNotMatch(message.text, /旧任务考试名称|旧泛微项目名称|2025-01-10/);
});

test("content task email reads formal exam candidates, applies defaults, and splits trial time", () => {
  const task = {
    taskId: "task-current",
    projectName: "四川宏达股份有限公司所属企业第三季度毕业生招聘笔试",
    sessions: [
      {
        sessionType: "formal",
        requirementIndex: 0,
        name: "四川宏达股份有限公司所属企业第三季度毕业生招聘笔试",
        start: "2026-08-10 19:00",
        end: "2026-08-10 20:30",
        candidateCount: 136,
      },
      {
        sessionType: "trial",
        requirementIndex: 0,
        name: "四川宏达股份有限公司所属企业第三季度毕业生招聘笔试-试考",
        start: "2026-08-09 10:00",
        end: "2026-08-09 17:00",
        candidateCount: 136,
      },
    ],
    config: {
      tenantId: "107921",
      fanweiSource: {
        raw: {
          fields: {
            "项目名称": "蜀道投资集团有限责任公司招聘笔试",
          },
        },
      },
      businessRequirement: {
        project_name: "蜀道投资集团有限责任公司招聘笔试",
        candidate_count: "",
        estimated_subject_count: "120",
        project_manager: "陈军",
      },
      examRequirement: {
        fields: {
          "考试名称": "四川宏达股份有限公司所属企业第三季度毕业生招聘笔试",
          "考试日期时间": "2026/8/10 19:00:00-2026/8/10 20:30:00",
          "试考日期时间": "2026/8/9 10:00:00-2026/8/9 17:00:00",
          "科目信息": "四川宏达股份有限公司所属企业第三季度毕业生招聘笔试",
        },
        config: {
          candidateCount: "",
          mockStartTimeDisplay: "2026/08/09 10:00",
          mockEndTimeDisplay: "2026/08/09 17:00",
          mockExamName: "四川宏达股份有限公司所属企业第三季度毕业生招聘笔试-试考",
        },
        supplements: {},
      },
      operationBatch: {
        draft: {
          fields: {
            estimatedMaxSubjectCount: { value: "120" },
          },
        },
      },
    },
    steps: [
      {
        stepKey: "course_create",
        status: "success",
        result: {
          courses: [{
            name: "四川宏达股份有限公司所属企业第三季度毕业生招聘笔试",
            code: "20260810-01-01",
          }],
        },
      },
    ],
  };

  const message = buildContentRequirementEmail({ task });

  assert.match(message.text, /项目名称：蜀道投资集团有限责任公司招聘笔试/);
  assert.match(message.text, /考试名称：四川宏达股份有限公司所属企业第三季度毕业生招聘笔试/);
  assert.match(message.text, /界面背景：ATA通用模板/);
  assert.match(message.text, /登录方式：准考证号/);
  assert.match(message.text, /单科最大科次：136/);
  assert.match(message.text, /试卷使用语言：简体中文/);
  assert.match(message.text, /操作系统语言：简体中文/);
  assert.match(message.text, /项目经理：陈军/);
  assert.match(message.text, /封场或试考开始时间：2026\/8\/9 10:00:00/);
  assert.match(message.text, /封场或试考结束时间：2026\/8\/9 17:00:00/);
  assert.doesNotMatch(message.text, /封场或试考开始时间：2026\/8\/9 10:00:00-/);
  assert.match(message.text, /考试名称  考试时间  科目名称  时长（分钟）  备注/);
  assert.match(message.text, /四川宏达股份有限公司所属企业第三季度毕业生招聘笔试\s+2026\/8\/10 19:00:00-2026\/8\/10 20:30:00\s+四川宏达股份有限公司所属企业第三季度毕业生招聘笔试\s+90\s+租户 ID：107921；科目编号：四川宏达股份有限公司所属企业第三季度毕业生招聘笔试（20260810-01-01）/);
  assert.doesNotMatch(message.text, /四川宏达股份有限公司所属企业第三季度毕业生招聘笔试-试考\s+2026\/8\/9/);
  assert.match(message.html, /<th>考试名称<\/th><th>考试时间<\/th><th>科目名称<\/th><th>时长（分钟）<\/th><th>备注<\/th>/);
});

test("email settings are atomically stored with owner-only permissions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "email-settings-"));
  const filePath = path.join(dir, "email_settings.json");
  await writeEmailSettingsFile(filePath, normalizeEmailSettings({
    fromEmail: "ops@example.com",
    username: "ops@example.com",
    password: "secret",
  }));

  const fileStat = await stat(filePath);
  assert.equal(fileStat.mode & 0o777, 0o600);
  const stored = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(stored.password, "secret");
});

test("email recipients and headers reject malformed or injected values", () => {
  assert.throws(
    () => parseEmailRecipients("good@example.com; bad-address"),
    /邮箱地址格式不正确/,
  );
  assert.throws(
    () => createSmtpMessage({
      from: { email: "ops@example.com", name: "运营自动化" },
      to: ["customer@example.com"],
      subject: "内容任务单\r\nBcc: attacker@example.com",
      text: "test",
    }),
    /邮件头/,
  );
});

test("content task email requires explicit recipients and sends text plus HTML", async () => {
  const task = {
    taskId: "task-1",
    projectName: "北京农商银行公文大赛",
    config: {
      operationBatchCode: "QTT260007",
      businessRequirement: {
        customer_name: "北京农商银行",
        project_code: "F0020592",
      },
    },
  };
  const requirement = {
    latest: {
      requirement: {
        examName: "北京农商银行公文大赛",
        subjects: ["英语", "数学"],
        formalExamTime: "2026/7/10 10:00-12:00",
      },
    },
  };

  await assert.rejects(
    () => sendContentRequirementEmail({
      task,
      requirement,
      recipients: "",
      emailSettings: normalizeEmailSettings({
        fromEmail: "ops@example.com",
        username: "ops@example.com",
        password: "secret",
      }),
      sendMail: async () => ({}),
    }),
    /请填写收件人/,
  );

  const sent = [];
  const result = await sendContentRequirementEmail({
    task,
    requirement,
    recipients: "customer@example.com; owner@example.com",
    ccRecipients: "cc@example.com; customer@example.com",
    emailSettings: normalizeEmailSettings({
      fromEmail: "ops@example.com",
      fromName: "运营自动化",
      username: "ops@example.com",
      password: "secret",
    }),
    sendMail: async (payload) => {
      sent.push(payload);
      return { messageId: "test-message-id" };
    },
  });

  assert.deepEqual(result.recipients, ["customer@example.com", "owner@example.com"]);
  assert.deepEqual(result.cc, ["cc@example.com"]);
  assert.equal(result.messageId, "test-message-id");
  assert.equal(result.sourceFingerprint, contentRequirementEmailFingerprint({ task, requirement }));
  assert.equal(sent[0].from.email, "ops@example.com");
  assert.deepEqual(sent[0].to, ["customer@example.com", "owner@example.com"]);
  assert.deepEqual(sent[0].cc, ["cc@example.com"]);
  assert.match(sent[0].text, /客户名称：北京农商银行/);
  assert.match(sent[0].html, /北京农商银行/);
});

test("SMTP message uses multipart alternative when HTML content is provided", () => {
  const message = createSmtpMessage({
    from: { email: "ops@example.com", name: "运营自动化" },
    to: ["customer@example.com"],
    cc: ["cc@example.com"],
    subject: "内容任务单",
    text: "纯文本内容",
    html: "<p>HTML 内容</p>",
  });

  assert.match(message.raw, /Content-Type: multipart\/alternative; boundary=/);
  assert.match(message.raw, /Cc: cc@example\.com/);
  assert.match(message.raw, /Content-Type: text\/plain; charset=utf-8/);
  assert.match(message.raw, /Content-Type: text\/html; charset=utf-8/);
  assert.match(message.raw, /纯文本内容/);
  assert.match(message.raw, /<p>HTML 内容<\/p>/);
});

test("SMTP auth failures are translated to actionable Outlook guidance", () => {
  const message = friendlySmtpErrorMessage("535 5.7.3 Authentication unsuccessful");

  assert.match(message, /Outlook 公司邮箱认证失败/);
  assert.match(message, /SMTP AUTH/);
  assert.match(message, /应用密码/);
});
