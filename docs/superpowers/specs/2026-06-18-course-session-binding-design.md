# 科目与正式考试场次绑定修复设计

## 目标

修复科目创建成功后绑定正式场次时因请求体错误导致的 HTTP 400。科目创建和试卷绑定作为两个独立步骤记录状态，绑定失败时只允许重试绑定。

## 数据流

1. 正式考试场次创建成功后，立即使用需求单中的科目信息查询或创建科目。
2. 创建或确认存在后，调用 `GET /tenant/api/courses/[course_code]/?apply=session` 回查科目详情。
3. 详情不存在或没有有效 `form_codes` 时，不发送任何绑定 POST，将 `paper_bind` 标记为“科目已创建，待试卷绑定”。
4. 用户在试卷创建后点击“继续绑定”，后端只重新回查科目详情并尝试绑定。
5. 从详情响应中提取真实 `code` 和 `form_codes`，不使用科目或试卷名称代替。
6. 严格验证 `session_id`、`course_code` 和非空字符串数组 `form_codes`，仅向 `POST /tenant/api/course/session/[session_id]/` 发送 `{ "course_code": "...", "form_codes": ["..."] }`。

## 状态与重试

- `course_create` 在所有科目已创建或确认存在后成功。
- `paper_bind` 在详情回查、参数验证和场次绑定期间独立运行。
- `paper_bind` 在试卷 code 缺失时进入 `waiting_manual`，不会回退或重跑场次创建和科目创建。
- “继续绑定”接口仅对 `paper_bind` 执行回查和绑定，如果仍无试卷 code 则保持 `waiting_manual`。

## 日志与错误

每次绑定记录 URL、HTTP Method、`session_id`、payload、`httpStatus` 和 `responseBody`。详情中没有有效 `form_codes` 时不调用绑定接口，并报错“科目已创建成功，但未获取到有效试卷 code，无法绑定到考试场次”。HTTP 400 报错增加“科目已创建，但绑定参数不合法，请检查 course_code / form_codes”。

## 验证

使用 Node `node:test` 覆盖正确回查与 payload、缺失试卷 code 时停止请求、参数校验、400 提示、独立步骤状态和绑定专属重试。
