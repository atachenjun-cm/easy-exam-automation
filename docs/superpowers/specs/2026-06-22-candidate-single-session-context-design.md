# 考生管理单场次上下文设计

## 目标

从考试详情的某个场次点击“管理考生”后，考生管理页的场次下拉框只显示该入口对应的考试场次，避免用户误选同一任务下的另一场考试。

## 根因

详情入口已通过查询参数传递正确的 `taskId` 和 `sessionId`，但 `resolveCandidateTaskContext()` 会把任务下正式考试和试考全部写入 `candidateUiState.sessions`，仅使用 `sessionId` 设置默认选中项。因此下拉框仍包含两个场次。

## 方案

修改纯函数 `resolveCandidateTaskContext(task, requestedSessionId)`：

- 从任务场次中查找 `session_id` 与 `requestedSessionId` 完全相等的有效正式考试或试考。
- 找到时返回只含该场次的 `sessions` 数组，并将其作为 `selectedSession`。
- 找不到、缺少 `requestedSessionId` 或场次没有 `session_id` 时，返回空数组和 `selectedSession: null`。

考生管理页面继续使用现有 `renderSessions()`、`renderSelectedSession()`、名单解析、考生导入、自动分班和监考账号导出逻辑，不修改接口或业务执行顺序。

直接从左侧导航进入 `/candidate-import` 时没有 `taskId`，保持现有行为：用户上传名单后可手动加载租户的未过期场次。

## 错误与提示

- 查询参数中的 `sessionId` 不属于任务时，下拉框显示任务无可用目标场次，导入按钮保持禁用。
- 日志改为“已带入目标考试场次”并报告实际带入数量，不再提示同时带入正式考试和试考。
- 任务详情加载失败时仍保留当前错误日志和手动加载场次入口。

## 保护边界

只修改：

- `web/exam_task_view_model.mjs`
- `server/test_exam_task_view_model.mjs`
- `outputs/web_prototype/easy_exam_automation.html` 中考生场次日志文字

不修改需求中心页面、路由、API、数据库、测试，也不修改现有考生导入接口。

## 测试与验收

- 正式考试 `sessionId` 只返回正式考试。
- 试考 `sessionId` 只返回试考。
- 无效或缺失的 `sessionId` 返回空场次且不允许导入。
- 考试列表聚合、双场次详情卡、九个进度步骤和需求中心回归测试继续通过。
- 部署后分别点击正式考试和试考的“管理考生”，确认下拉框各自只有一个选项。
