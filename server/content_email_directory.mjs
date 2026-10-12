function text(value) {
  return String(value ?? "").trim();
}

export const CONTENT_PERSON_EMAIL_DIRECTORY = Object.freeze({
  "曹龙杰": "caolongjie@ata.net.cn",
  "陈佩俊": "chenpeijun@ata.net.cn",
  "崔正涛": "cuizhengtao@ata.net.cn",
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
  "浦佳谞": "pujiaxu@ata.net.cn",
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
  "毛俊婕": "maojunjie@ata.net.cn",
  "潘君艳": "panjunyan@ata.net.cn",
  "张健翔": "zhangjianxiang@ata.net.cn",
  "张良": "zhangliang@ata.net.cn",
  "朱鹏涛": "zhupengtao@ata.net.cn",
  "周柳柳": "zhouliuliu@ata.net.cn",
});

function projectDepartmentGroup(name, people) {
  return Object.freeze({
    name,
    people: Object.freeze(people.map(([email, personName]) => Object.freeze({
      group: name,
      name: personName,
      email,
    }))),
  });
}

export const PROJECT_IMPLEMENTATION_EMAIL_GROUPS = Object.freeze([
  projectDepartmentGroup("项目实施一部", [
    ["luoxudong@ata.net.cn", "罗旭东"],
    ["mouxuehua@ata.net.cn", "牟雪华"],
    ["liuxinhui@ata.net.cn", "刘欣晖"],
    ["zhouyuheng@ata.net.cn", "周玉衡"],
    ["yuanyingwen@ata.net.cn", "袁英雯"],
    ["chenjun@ata.net.cn", "陈军"],
    ["luoanni@ata.net.cn", "罗安妮"],
    ["wangmaomao@ata.net.cn", "王毛毛"],
    ["zhanglei@ata.net.cn", "章蕾"],
    ["guzhenzhong@ata.net.cn", "顾振中"],
    ["fangzechen@ata.net.cn", "方泽晨"],
    ["zhangjunmei@ata.net.cn", "张俊梅"],
    ["luyuelin@ata.net.cn", "陆悦琳"],
    ["gaoke@ata.net.cn", "高珂"],
    ["liulintao@ata.net.cn", "刘林涛"],
    ["liyuanyuan@ata.net.cn", "李园园"],
    ["chenlinfeng@ata.net.cn", "陈林枫"],
    ["songzhijun@ata.net.cn", "宋之珺"],
  ]),
  projectDepartmentGroup("项目实施二部", [
    ["yuleiren@ata.net.cn", "俞磊人"],
    ["huangyao@ata.net.cn", "黄尧"],
    ["wuwenying@ata.net.cn", "吴文英"],
    ["yuminhua@ata.net.cn", "俞敏华"],
    ["fengkangping@ata.net.cn", "冯康萍"],
    ["huangjiafeng@ata.net.cn", "黄佳峰"],
    ["chenhuiqi@ata.net.cn", "陈辉琪"],
    ["yejian@ata.net.cn", "叶坚"],
    ["fanghui@ata.net.cn", "方慧"],
    ["zhangwei@ata.net.cn", "张玮"],
    ["jijingting@ata.net.cn", "季静婷"],
    ["lixu@ata.net.cn", "李旭"],
    ["lixuelong@ata.net.cn", "李学龙"],
    ["zhangxinling@ata.net.cn", "张心羚"],
  ]),
  projectDepartmentGroup("项目实施三部", [
    ["yanjingjing@ata.net.cn", "严晶晶"],
    ["chenzhixiang@ata.net.cn", "陈智翔"],
    ["wangjian@ata.net.cn", "王健"],
    ["caojiahao@ata.net.cn", "曹佳豪"],
    ["zhouyanjun@ata.net.cn", "周艳珺"],
    ["daiyu@ata.net.cn", "戴瑜"],
    ["wangluping@ata.net.cn", "王陆平"],
    ["liujuan@ata.net.cn", "刘娟"],
    ["zhuxiaodan@ata.net.cn", "朱晓丹"],
    ["huminmin@ata.net.cn", "胡敏敏"],
    ["xuetingting@ata.net.cn", "薛亭亭"],
    ["siyuanyuan@ata.net.cn", "司园园"],
    ["wangyayun@ata.net.cn", "汪亚运"],
  ]),
  projectDepartmentGroup("项目实施四部", [
    ["liuzhimin@ata.net.cn", "刘智敏"],
    ["zhaoqiqi@ata.net.cn", "赵琪琪"],
    ["wangjiaying@ata.net.cn", "王嘉莹"],
    ["geruiling@ata.net.cn", "葛瑞玲"],
    ["tutengyue@ata.net.cn", "屠滕悦"],
    ["humengxun@ata.net.cn", "胡梦寻"],
    ["wangshiyu@ata.net.cn", "王诗雨"],
    ["caojialu@ata.net.cn", "曹嘉璐"],
    ["maozuoyu@ata.net.cn", "毛作羽"],
    ["guochengcai@ata.net.cn", "郭城材"],
    ["liboming@ata.net.cn", "李博明"],
  ]),
  projectDepartmentGroup("项目实施五部", [
    ["wuxiaoxia@ata.net.cn", "吴晓霞"],
    ["jianghaibao@ata.net.cn", "蒋海宝"],
    ["yuxiaojuan@ata.net.cn", "于晓娟"],
    ["linqiaojun@ata.net.cn", "林俏君"],
    ["panhui@ata.net.cn", "潘晖"],
    ["tanyaqi@ata.net.cn", "谭亚奇"],
    ["zhoujie@ata.net.cn", "周杰"],
    ["lufeng@ata.net.cn", "陆峰"],
    ["wangxu@ata.net.cn", "王旭"],
    ["fengying@ata.net.cn", "冯莹"],
    ["wangtianzhen@ata.net.cn", "王天桢"],
    ["zhanglexiang@ata.net.cn", "张乐翔"],
    ["liujingjing@ata.net.cn", "刘晶晶"],
    ["zhouxiaolian@ata.net.cn", "周晓廉"],
    ["shikang@ata.net.cn", "施康"],
    ["shiwei@ata.net.cn", "石玮"],
    ["xubolu@ata.net.cn", "许博璐"],
    ["guoxin2@ata.net.cn", "郭欣"],
    ["wangyu@ata.net.cn", "王煜"],
  ]),
]);

export const PROJECT_IMPLEMENTATION_EMAIL_PEOPLE = Object.freeze(
  PROJECT_IMPLEMENTATION_EMAIL_GROUPS.flatMap((group) => group.people),
);

export function projectImplementationPerson(value) {
  const identity = text(value);
  const email = identity.toLowerCase();
  return PROJECT_IMPLEMENTATION_EMAIL_PEOPLE.find((person) => (
    person.name === identity || person.email === email
  )) || null;
}

export function projectImplementationPersonByEmail(value) {
  const person = projectImplementationPerson(value);
  return person?.email === text(value).toLowerCase() ? person : null;
}

export function projectImplementationDepartmentForPerson(value) {
  return projectImplementationPerson(value)?.group || "";
}

const CONTENT_PERSON_NAME_ALIASES = Object.freeze({
  "浦佳霁": "浦佳谞",
  "蒲佳婿": "浦佳谞",
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
  const personnel = explicit ? splitPersonnel(explicit) : flowRecipients;
  return [...new Set(personnel.map((name) => CONTENT_PERSON_NAME_ALIASES[name] || name))];
}

export function contentEmailDefaultsForTask(task = {}, actorEmail = "") {
  const personnel = contentPersonnelNamesFromTask(task);
  const matched = personnel.flatMap((name) => {
    const email = CONTENT_PERSON_EMAIL_DIRECTORY[name];
    return email ? [{ name, email }] : [];
  });
  const projectOwnerEmail = text(task.ownerEmail).toLowerCase();
  const currentUserEmail = text(actorEmail).toLowerCase();
  const contentDirectoryPeople = Object.entries(CONTENT_PERSON_EMAIL_DIRECTORY)
    .map(([name, email]) => ({ group: "内容开发部", name, email }));
  const directoryPeople = [...contentDirectoryPeople, ...PROJECT_IMPLEMENTATION_EMAIL_PEOPLE];
  const projectPeople = [];
  if (currentUserEmail && !directoryPeople.some((person) => person.email === currentUserEmail)) {
    projectPeople.push({
      group: "当前项目",
      name: currentUserEmail === projectOwnerEmail ? "当前用户（项目负责人）" : "当前用户",
      email: currentUserEmail,
    });
  }
  if (
    projectOwnerEmail
    && projectOwnerEmail !== currentUserEmail
    && !directoryPeople.some((person) => person.email === projectOwnerEmail)
  ) {
    projectPeople.push({ group: "当前项目", name: "项目负责人", email: projectOwnerEmail });
  }
  const people = [...projectPeople, ...directoryPeople];
  const ccPeople = DEFAULT_CONTENT_EMAIL_CC.map((email) => {
    const directoryEntry = Object.entries(CONTENT_PERSON_EMAIL_DIRECTORY)
      .find(([, directoryEmail]) => directoryEmail === email);
    return { group: "固定抄送", name: directoryEntry?.[0] || email, email };
  });
  return {
    personnel,
    matched,
    unmatched: personnel.filter((name) => !CONTENT_PERSON_EMAIL_DIRECTORY[name]),
    recipients: [...new Set([...matched.map((item) => item.email), projectOwnerEmail].filter(Boolean))],
    cc: [...DEFAULT_CONTENT_EMAIL_CC],
    people,
    ccPeople,
    projectDepartmentPeople: PROJECT_IMPLEMENTATION_EMAIL_PEOPLE,
  };
}

function mergeEmailAddresses(...values) {
  const seen = new Set();
  return values.flatMap((value) => Array.isArray(value) ? value : [value])
    .flatMap((value) => text(value).split(/[\s,，;；]+/))
    .map((value) => value.toLowerCase())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

export function contentEmailDeliveryForTask(
  task = {},
  _actorEmail = "",
  { recipients = "", cc = "" } = {},
) {
  const defaults = contentEmailDefaultsForTask(task);
  const resolvedRecipients = mergeEmailAddresses(recipients);
  return {
    ...defaults,
    recipients: resolvedRecipients,
    cc: mergeEmailAddresses(cc),
  };
}
