function text(value) {
  return String(value ?? "").trim();
}

export const CONTENT_PERSON_EMAIL_DIRECTORY = Object.freeze({
  "曹龙杰": "caolongjie@ata.net.cn",
  "陈佩俊": "chenpeijun@ata.net.cn",
  "崔正涛": "cuizhentao@ata.net.cn",
  "李晶": "lijing@ata.net.cn",
  "刘朔": "liushuo@ata.net.cn",
  "刘星山": "liuxingshan@ata.net.cn",
  "马天野": "matianye@ata.net.cn",
  "施洪锦": "shihongjin@ata.net.cn",
  "杨朝政": "yangchaozheng@ata.net.cn",
  "于硕": "yushuo@ata.net.cn",
  "周彬": "zhoubin@ata.net.cn",
  "金胜峰": "jinshengfeng@ata.net.cn",
  "卢宁": "luning@ata.net.cn",
  "聂贝聪": "niebeicong@ata.net.cn",
  "蒲佳婿": "pujiaxu@ata.net.cn",
  "张力月": "zhangliyue@ata.net.cn",
  "朱虹": "zhuhong@ata.net.cn",
  "杨慧": "yanghui@ata.net.cn",
  "刘炳琰": "liubingyan@ata.net.cn",
  "陈媚": "chenmei@ata.net.cn",
  "陈珊珊": "chenshanshan@ata.net.cn",
  "龚杰": "gongjie@ata.net.cn",
  "梁春风": "liangchunfeng@ata.net.cn",
  "刘燕2": "liuyan@ata.net.cn",
  "陆许华": "luxuhua@ata.net.cn",
  "缪丽杰": "miaolijie@ata.net.cn",
  "王亚芳": "wangyafang@ata.net.cn",
  "杨铭": "yangming@ata.net.cn",
  "张红玲": "zhangling@ata.net.cn",
  "洪昱": "hongyu@ata.net.cn",
  "刘明慧": "liuminghui@ata.net.cn",
  "毛俊捷": "maojunjie@ata.net.cn",
  "潘君艳": "panjunyan@ata.net.cn",
  "张健翔": "zhangjianxiang@ata.net.cn",
  "张良": "zhangliang@ata.net.cn",
  "朱鹏涛": "zhupengtao@ata.net.cn",
  "周柳柳": "zhouliuliu@ata.net.cn",
});

export const DEFAULT_CONTENT_EMAIL_CC = Object.freeze([
  "shihongjin@ata.net.cn",
  "yangming@ata.net.cn",
  "wangyafang@ata.net.cn",
  "panjunyan@ata.net.cn",
]);

function splitPersonnel(value) {
  return text(value)
    .split(/[\s、,，;；]+/)
    .map(text)
    .filter(Boolean);
}

export function contentPersonnelNamesFromTask(task = {}) {
  const business = task.config?.businessRequirement || {};
  const raw = task.config?.fanweiSource?.raw || {};
  const explicit = text(business.content_personnel || raw.fields?.["内容人员"]);
  const flowRecipients = (Array.isArray(raw.flowOpinionRows) ? raw.flowOpinionRows : [])
    .filter((row) => text(row?.["部门"] ?? row?.department) === "内容开发部")
    .flatMap((row) => splitPersonnel(row?.["接收人"] ?? row?.recipient));
  return [...new Set(explicit ? splitPersonnel(explicit) : flowRecipients)];
}

export function contentEmailDefaultsForTask(task = {}, currentUserEmail = "") {
  const personnel = contentPersonnelNamesFromTask(task);
  const matched = personnel.flatMap((name) => {
    const email = CONTENT_PERSON_EMAIL_DIRECTORY[name];
    return email ? [{ name, email }] : [];
  });
  const platformEmail = text(currentUserEmail || task.ownerEmail).toLowerCase();
  return {
    personnel,
    matched,
    unmatched: personnel.filter((name) => !CONTENT_PERSON_EMAIL_DIRECTORY[name]),
    recipients: [...new Set([...matched.map((item) => item.email), platformEmail].filter(Boolean))],
    cc: [...DEFAULT_CONTENT_EMAIL_CC],
  };
}
