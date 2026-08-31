import assert from "node:assert/strict";
import test from "node:test";

import { buildAutoConfigFromRequirement } from "./requirement_auto_config_adapter.mjs";

test("converts a complete WeChat requirement into the existing auto config shape", () => {
  const result = buildAutoConfigFromRequirement({
    exam_name: "四川省通川工程技术开发有限公司校招考试",
    formal_exam_time_range: "时间：2026-07-05 09:30 到 2026-07-05 11:30",
    mock_exam_time_range: "时间：2026-07-04 10:00 到 2026-07-04 17:00",
    early_login_minutes: "30分钟",
    late_limit_minutes: "15分钟",
    video_monitor_required: "是",
    video_record_required: "是",
    hawkeye_required: "否",
    exam_client_type: "网页考试",
    leave_limit_count: 3,
    subjects: ["综合能力", "专业知识"],
    paper_names: ["第一场综合能力卷", "第一场专业知识卷"],
  }, {
    customerName: "四川省通川工程技术开发有限公司",
  });

  assert.deepEqual(result.warnings, []);
  assert.equal(result.config.examName, "四川省通川工程技术开发有限公司校招考试");
  assert.equal(result.config.customerName, "四川省通川工程技术开发有限公司");
  assert.equal(result.config.startTimeDisplay, "2026/07/05 09:30");
  assert.equal(result.config.endTimeDisplay, "2026/07/05 11:30");
  assert.equal(result.config.startTimeIso, "2026-07-05T09:30:00.000");
  assert.equal(result.config.endTimeIso, "2026-07-05T11:30:00.000");
  assert.equal(result.config.mockExamEnabled, true);
  assert.equal(result.config.mockExamName, "四川省通川工程技术开发有限公司校招考试-试考");
  assert.equal(result.config.mockStartTimeDisplay, "2026/07/04 10:00");
  assert.equal(result.config.mockEndTimeDisplay, "2026/07/04 17:00");
  assert.equal(result.config.earlyLoginMinutes, 30);
  assert.equal(result.config.lateLimitMinutes, 15);
  assert.equal(result.config.videoMonitor, true);
  assert.equal(result.config.videoRecord, true);
  assert.equal(result.config.hawkeye, false);
  assert.equal(result.config.examType, "网页考试");
  assert.equal(result.config.webExam, true);
  assert.equal(result.config.clientExam, false);
  assert.equal(result.config.leaveLimit, 3);
  assert.deepEqual(result.config.subjects, ["综合能力", "专业知识"]);
  assert.deepEqual(result.config.courses, [
    { name: "综合能力", paper_name: "第一场综合能力卷" },
    { name: "专业知识", paper_name: "第一场专业知识卷" },
  ]);
  assert.equal(result.config.confirmOnly, true);
});

test("warns when per-requirement paper names do not align with subjects", () => {
  const result = buildAutoConfigFromRequirement({
    exam_name: "多科目考试",
    formal_exam_time_range: "2026-07-05 09:30 到 2026-07-05 11:30",
    subjects_text: "综合能力、专业知识",
    paper_names_text: "仅一张试卷",
  });

  assert.equal(result.config.courses[0].paper_name, "仅一张试卷");
  assert.equal(result.config.courses[1].paper_name, undefined);
  assert.ok(result.warnings.includes("试卷名称数量与科目数量不一致，请按科目顺序逐项填写。"));
});

test("recognizes the Fanwei video recording option", () => {
  const result = buildAutoConfigFromRequirement({
    exam_name: "视频录制测试",
    formal_exam_time_range: "2026-07-05 09:30 到 2026-07-05 11:30",
    video_monitor_required: "需要",
    video_record_required: "开启录制",
  });

  assert.equal(result.config.videoMonitor, true);
  assert.equal(result.config.videoRecord, true);
});

test("treats blank rich waiting prompt and pledge HTML as cleared fields", () => {
  const result = buildAutoConfigFromRequirement({
    exam_name: "空富文本测试",
    formal_exam_time_range: "2026-07-05 09:30 到 2026-07-05 11:30",
    subjects: "综合能力",
    pre_login_prompt: "<p><br></p>",
    pledge_content: "<div>&nbsp;</div>",
  });

  assert.equal(result.config.preLoginPrompt, "");
  assert.equal(result.config.pledgeContent, "");
});

test("accepts short and Chinese time range formats", () => {
  const year = new Date().getFullYear();
  const result = buildAutoConfigFromRequirement({
    exam_name: "短时间格式测试",
    formal_exam_time_range: "7-21 15 ：00-16:30",
    mock_exam_time_range: "7-21 15 点-16 点半",
    subjects: "综合能力",
  });

  assert.equal(result.config.startTimeDisplay, `${year}/07/21 15:00`);
  assert.equal(result.config.endTimeDisplay, `${year}/07/21 16:30`);
  assert.equal(result.config.mockStartTimeDisplay, `${year}/07/21 15:00`);
  assert.equal(result.config.mockEndTimeDisplay, `${year}/07/21 16:30`);
  assert.equal(result.warnings.includes("正式考试时间无法解析。"), false);
  assert.equal(result.warnings.includes("试考时间无法解析，试考自动创建会跳过。"), false);
});

test("reports warnings when execution-critical fields cannot be normalized", () => {
  const result = buildAutoConfigFromRequirement({
    exam_name: "缺时间测试",
    formal_exam_time_range: "下周一上午",
    subjects: "语文，数学",
  });

  assert.equal(result.config.examName, "缺时间测试");
  assert.deepEqual(result.config.subjects, ["语文", "数学"]);
  assert.equal(result.config.startTimeDisplay, "");
  assert.equal(result.config.endTimeDisplay, "");
  assert.deepEqual(result.config.courses, [{ name: "语文" }, { name: "数学" }]);
  assert.ok(result.warnings.includes("正式考试时间无法解析。"));
  assert.ok(result.warnings.includes("未读取到试考时间，试考自动创建会跳过。"));
  assert.equal(result.warnings.some((warning) => warning.includes("code/form_codes")), false);
});

test("maps an explicit 42-item picker selection to public tenant fields and pending internal fields", () => {
  const result = buildAutoConfigFromRequirement({
    exam_name: "配置选择测试",
    formal_exam_time_range: "2026-08-20 09:00 到 2026-08-20 11:00",
  }, {
    configSelection: {
      explicit: true,
      selectedIds: [
        "allow_anonymous",
        "anonymous_unique",
        "anonymous_email",
        "unique_phone_as_permit",
        "ip_white_list",
        "monitor",
        "login_validation",
        "face_detection_dur",
        "ai_gaze",
        "lock_screen",
        "show_point",
        "public_score",
        "show_score_detail",
        "re_answer",
        "datum_line",
        "manual_score",
        "send_result_email",
      ],
      values: {
        anonymousMethod: "anonymous_email",
        ipWhiteList: "210.13.101.42,210.13.101.43",
        loginMode: "auto",
        loginMethod: "public_security",
        detectionLevel: "advanced",
        lockMode: "web",
        loginTimes: 7,
        webLeaveSeconds: 6,
        webLeaveTimes: 4,
        reAnswerTimes: 2,
        passingScore: 70,
        manualScoreMode: "new",
        resultEmail: "result@example.com",
      },
    },
  });

  assert.equal(result.config.sessionOptions.explicit, true);
  assert.deepEqual(result.config.sessionOptions.public, {
    allow_anonymous: true,
    anonymous_unique: true,
    ip_white_list: true,
    ip_white_list_str: "210.13.101.42,210.13.101.43",
    practice_mode: false,
    nda: false,
    entry_review: false,
    id_card_review: false,
    around_review: false,
    monitor: true,
    save_video: false,
    face_detection: false,
    face_detection_review: false,
    photo_review: false,
    police_detection: true,
    police_detection_after: false,
    face_detection_dur: true,
    eagle_eye: false,
    no_interfere: false,
    eagle_eye2: false,
    desktop_monitor: false,
    desktop_monitor_video: false,
    lock_screen: true,
    login_times: 7,
    lock_screen_exit_sec: 6,
    lock_screen_time: 4,
    client_required: false,
    app_required: false,
    exclusive_network: false,
    check_bluetooth: false,
    smart_input_disabled: false,
    watermark: false,
    copy_item_unable: false,
    show_point: true,
    public_score: true,
    show_score_detail: true,
    force_no_score: false,
    re_answer: true,
    re_answer_times: 2,
    answer_save_high: false,
    answer_save: false,
    wrong_practice: false,
    force_prohibit_retry: false,
    datum_line: true,
    datum_score: 70,
    manual_score: true,
    new_mark: true,
    send_result_email: true,
    result_email_address: "result@example.com",
  });
  assert.deepEqual(
    result.config.sessionOptions.pendingInternal.map((item) => item.id),
    ["anonymous_unique", "unique_phone_as_permit", "face_detection_dur", "ai_gaze"],
  );
  assert.ok(result.warnings.some((warning) => warning.includes("需报备后人工开启")));
});

test("submits desktop-only client options only when desktop is selected", () => {
  const requirement = {
    exam_name: "客户端配置依赖测试",
    formal_exam_time_range: "2026-08-20 09:00 到 2026-08-20 11:00",
  };
  const build = (selectedIds) => buildAutoConfigFromRequirement(requirement, {
    configSelection: {
      explicit: true,
      selectedIds: ["lock_screen", ...selectedIds],
      values: { lockMode: "client" },
    },
  }).config.sessionOptions.public;

  const withoutDesktop = build(["exclusive_network", "check_bluetooth", "smart_input_disabled"]);
  assert.equal(withoutDesktop.client_required, false);
  assert.equal(withoutDesktop.exclusive_network, false);
  assert.equal(withoutDesktop.check_bluetooth, false);
  assert.equal(withoutDesktop.smart_input_disabled, false);

  const withDesktop = build(["client_required", "exclusive_network", "check_bluetooth", "smart_input_disabled"]);
  assert.equal(withDesktop.client_required, true);
  assert.equal(withDesktop.exclusive_network, true);
  assert.equal(withDesktop.check_bluetooth, true);
  assert.equal(withDesktop.smart_input_disabled, true);

  const invalidBoth = build(["client_required", "app_required"]);
  assert.equal(invalidBoth.client_required, true);
  assert.equal(invalidBoth.app_required, false);
});

test("manual login verification uses EasyExam's dedicated photo review mode", () => {
  const result = buildAutoConfigFromRequirement({
    exam_name: "人工审核配置测试",
    formal_exam_time_range: "2026-08-20 09:00 到 2026-08-20 11:00",
  }, {
    configSelection: {
      explicit: true,
      selectedIds: ["monitor", "login_validation"],
      values: { loginMode: "manual" },
    },
  });

  assert.equal(result.config.sessionOptions.public.face_detection, false);
  assert.equal(result.config.sessionOptions.public.face_detection_review, false);
  assert.equal(result.config.sessionOptions.public.photo_review, true);
  assert.equal(result.config.sessionOptions.public.police_detection, false);
  assert.equal(result.config.sessionOptions.public.police_detection_after, false);
});

test("omits disabled numeric option fields from the tenant session payload", () => {
  const result = buildAutoConfigFromRequirement({
    exam_name: "显式配置空值测试",
    formal_exam_time_range: "2026-08-20 09:00 到 2026-08-20 11:00",
  }, {
    configSelection: {
      explicit: true,
      selectedIds: ["lock_screen", "client_required", "show_point"],
      values: { lockMode: "client", loginTimes: 10 },
    },
  });

  assert.equal(result.config.sessionOptions.public.login_times, 10);
  assert.equal(result.config.sessionOptions.public.show_point, true);
  assert.equal(Object.hasOwn(result.config.sessionOptions.public, "lock_screen_exit_sec"), false);
  assert.equal(Object.hasOwn(result.config.sessionOptions.public, "lock_screen_time"), false);
  assert.equal(Object.hasOwn(result.config.sessionOptions.public, "re_answer_times"), false);
  assert.equal(Object.hasOwn(result.config.sessionOptions.public, "datum_score"), false);
  assert.equal(Object.values(result.config.sessionOptions.public).includes(null), false);
});
