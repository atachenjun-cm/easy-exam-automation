const VIRTUAL_SERIAL_PATTERN = /^VIRTUAL-[A-Z0-9-]{6,64}$/i;

function text(value) {
  return String(value ?? "").trim();
}

function futureExamDate(now, days = 30) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new TypeError("虚拟需求单基准时间无效。");
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return {
    iso: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    cn: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`,
  };
}

export function isVirtualFanweiSerial(value) {
  return VIRTUAL_SERIAL_PATTERN.test(text(value));
}

export function applyVirtualFanweiRequirementDefaults(model, serialNo) {
  if (!isVirtualFanweiSerial(serialNo)) return model;
  return {
    ...model,
    requirementFields: {
      ...(model?.requirementFields || {}),
      "试考日期时间": "",
    },
  };
}

export function buildVirtualFanweiReadPayload(serialNo, { now = new Date() } = {}) {
  const serial = text(serialNo).toUpperCase();
  if (!isVirtualFanweiSerial(serial)) {
    throw new TypeError("虚拟泛微流水号必须以 VIRTUAL- 开头，且只能包含字母、数字和连字符。");
  }
  const examDate = futureExamDate(now);
  const examName = `虚拟易考配置联调-${serial}`;
  return {
    requestid: `virtual-${serial}`,
    fields: {
      "标题": examName,
      "运控流水号": serial,
      "项目名称": examName,
      "项目编码": "VIRTUAL",
      "客户名称（仅供参考）": "虚拟测试单位",
      "客户及项目属性": "虚拟测试",
      "业务方向": "测试",
      "系统类型": "易考",
      "预估科次": "0",
      "预估收入": "0",
      "结算依据": "虚拟测试不结算",
      "考试服务范围": "虚拟配置联调",
      "报名方式": "不导入考生",
      "是否需要报名网站": "不需要",
      "是否需要ATA安排人工监考": "不需要",
      "是否需要ATA安排集中监考场地": "不需要",
      "ATA内容制题参与方式": "虚拟测试不制题",
      "内容来源": "虚拟测试",
      "试题类型": "客观题",
      "科目数": "1",
      "试卷数": "1",
      "是否需要封闭制题": "不需要",
      "是否需要人工阅卷": "不需要",
      "阅卷安排": "无需阅卷",
      "EPI测试": "不需要",
      "性格测试工具": "不需要",
      "考核内容是否仅性格测试": "否",
      "其他说明": `虚拟测试单位\n${examName}`,
    },
    serviceConfirmation: {
      fields: {
        "单位名称": "虚拟测试单位",
        "考试名称": examName,
        "考试时间": `${examDate.cn} 14:00-16:00`,
        "预计人次": "0",
        "科目数量": "1",
        "考场规则": "提前登录30分钟，迟到时间20分钟",
        "ATA人工监考": "不需要",
        "在线巡考": "需要",
      },
    },
    examSceneRows: [{
      "序号": "1",
      "考试日期": examDate.iso,
      "考试时间": "下午",
      "场次安排说明": "14:00-16:00",
    }],
    opaRows: [],
    flowOpinionRows: [],
  };
}
