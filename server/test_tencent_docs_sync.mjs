import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBatchUpdateRequests,
  buildTencentDocRows,
} from "./tencent_docs_sync.mjs";

const config = {
  examName: "项目招聘考试",
  startTimeDisplay: "2026-07-01 09:00",
  endTimeDisplay: "2026-07-01 11:00",
  mockStartTimeDisplay: "2026-06-30 15:00",
  mockEndTimeDisplay: "2026-06-30 17:00",
  earlyLoginMinutes: 30,
  lateLimitMinutes: 20,
  examType: "客户端考试",
  clientExam: true,
  videoMonitor: true,
  hawkeye: true,
};

const created = [
  { kind: "main", id: "formal-1", name: "项目招聘考试", start: "2026-07-01 09:00", end: "2026-07-01 11:00", candidate_count: 81 },
  { kind: "mock", id: "trial-1", name: "项目招聘考试-试考", start: "2026-06-30 15:00", end: "2026-06-30 17:00", candidate_count: 62 },
];

test("builds Tencent Docs rows through AD with configured defaults", () => {
  const rows = buildTencentDocRows({ config, created });

  assert.equal(rows[0].length, 30);
  assert.equal(rows[0][1], "F0020795");
  assert.equal(rows[0][2], "");
  assert.equal(rows[0][3], "正式");
  assert.equal(rows[0][4], "蜀道集团");
  assert.equal(rows[0][5], "81");
  assert.equal(rows[0][10], "120分钟");
  assert.equal(rows[0][11], "客户端，10次");
  assert.equal(rows[0][12], "是，作答60分钟可交卷");
  assert.equal(rows[0][13], "一个单元，60-120分钟");
  assert.equal(rows[0][14], "准考证号");
  assert.equal(rows[0][16], "准点收卷，迟到及离开扣时");
  assert.equal(rows[0][17], "双监控");
  assert.equal(rows[0][18], "考中侦测");
  assert.equal(rows[0][19], "不需要");
  assert.equal(rows[0][20], "ATA短信");
  assert.equal(rows[0][21], "已通知");
  assert.equal(rows[0][22], "纸质草稿纸");
  assert.equal(rows[0][23], "客户端");
  assert.equal(rows[0][24], "仅在线客服");
  assert.equal(rows[0][28], "声音监控");
  assert.match(rows[0][29], /考生您好！项目招聘考试笔试将于北京时间2026年7月1日\(周三\)09:00-11:00举行。/);
  assert.match(rows[0][29], /试考时间为2026年6月30日15:00-6月30日17:00/);
  assert.match(rows[0][29], /客户端下载地址：https:\/\/eztest\.org\/exam\/session\/formal-1\/client\/download/);
  assert.match(rows[0][29], /考试口令统一为：formal-1/);

  assert.equal(rows[1][3], "试考-分散模式");
  assert.equal(rows[1][10], "90分钟");
  assert.equal(rows[1][12], "是，作答10分钟可交卷");
  assert.equal(rows[1][13], "一个单元，10-90分钟");
  assert.equal(rows[1][16], "不准点收卷，无迟到扣时");
  assert.equal(rows[1][17], "不需要");
  assert.equal(rows[1][18], "不需要");
});

test("appends to blank rows and writes font plus centered alignment", () => {
  const requests = buildBatchUpdateRequests({
    sheetId: "BB08J2",
    remoteRows: [
      ["考试名称"],
      Array.from({ length: 30 }, (_, index) => index === 15 ? "formal-1" : index === 0 ? "已有考试" : ""),
      Array(30).fill(""),
      Array(30).fill(""),
    ],
    rows: buildTencentDocRows({ config, created }),
  });

  assert.deepEqual(requests.map((item) => item.updateRangeRequest.gridData.startRow), [2, 3]);
  const cell = requests[0].updateRangeRequest.gridData.rows[0].values[29];
  assert.equal(cell.cellFormat.textFormat.fontSize, 10);
  assert.equal(cell.cellFormat.horizontalAlignment, "CENTER");
  assert.equal(cell.cellFormat.verticalAlignment, "MIDDLE");
});
