import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTENT_PERSON_EMAIL_DIRECTORY,
  DEFAULT_CONTENT_EMAIL_CC,
  contentEmailDefaultsForTask,
  contentPersonnelNamesFromTask,
} from "./content_email_directory.mjs";

test("content personnel directory matches the supplied name and email document", () => {
  assert.equal(Object.keys(CONTENT_PERSON_EMAIL_DIRECTORY).length, 37);
  assert.equal(CONTENT_PERSON_EMAIL_DIRECTORY["卢宁"], "luning@ata.net.cn");
  assert.equal(CONTENT_PERSON_EMAIL_DIRECTORY["杨铭"], "yangming@ata.net.cn");
  assert.equal(CONTENT_PERSON_EMAIL_DIRECTORY["刘燕2"], "liuyan@ata.net.cn");
  assert.equal(CONTENT_PERSON_EMAIL_DIRECTORY["张红玲"], "zhangling@ata.net.cn");
});

test("content email defaults resolve personnel names and the supplied CC list", () => {
  const defaults = contentEmailDefaultsForTask({
    ownerEmail: "owner@ata.net.cn",
    config: { businessRequirement: { content_personnel: "卢宁；杨铭；未收录人员" } },
  }, "chenjun@ata.net.cn");

  assert.deepEqual(defaults.recipients, ["luning@ata.net.cn", "yangming@ata.net.cn", "chenjun@ata.net.cn"]);
  assert.deepEqual(defaults.unmatched, ["未收录人员"]);
  assert.deepEqual(defaults.cc, [
    "shihongjin@ata.net.cn",
    "yangming@ata.net.cn",
    "wangyafang@ata.net.cn",
    "panjunyan@ata.net.cn",
  ]);
  assert.deepEqual(defaults.cc, [...DEFAULT_CONTENT_EMAIL_CC]);
});

test("content personnel falls back to the content department flow recipient", () => {
  const task = {
    config: {
      fanweiSource: {
        raw: {
          flowOpinionRows: [
            { "部门": "项目实施三部", "接收人": "陈军" },
            { "部门": "内容开发部", "接收人": "卢宁" },
          ],
        },
      },
    },
  };

  assert.deepEqual(contentPersonnelNamesFromTask(task), ["卢宁"]);
  assert.deepEqual(contentEmailDefaultsForTask(task).recipients, ["luning@ata.net.cn"]);
});

test("content email defaults include the platform task owner when no content personnel is assigned", () => {
  const defaults = contentEmailDefaultsForTask({
    ownerEmail: "ChenJun@ata.net.cn",
    config: { businessRequirement: { content_personnel: "" } },
  });

  assert.deepEqual(defaults.recipients, ["chenjun@ata.net.cn"]);
});
