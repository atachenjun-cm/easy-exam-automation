# Course Session Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用科目详情接口返回的真实 code 构造严格的场次绑定请求，并支持绑定步骤独立失败和重试。

**Architecture:** 新建可依赖注入的科目绑定模块，集中负责详情解析、参数校验、请求发送和调试日志。主服务将创建与绑定分阶段编排，并在 `paper_bind` 重试时从已持久化的任务配置和正式场次恢复上下文。

**Tech Stack:** Node.js ES modules, `node:test`, 现有 SQLite 任务状态存储。

---

### Task 1: 科目绑定模块

**Files:**
- Create: `server/course_session_binding.mjs`
- Create: `server/test_course_session_binding.mjs`

- [x] 先编写失败测试，断言详情回查 URL、绑定 URL 及唯一允许的 payload 字段。
- [x] 运行 `node --test server/test_course_session_binding.mjs`，确认测试因模块缺失而失败。
- [x] 增加详情响应解析、严格参数校验、绑定请求与完整日志。
- [x] 增加缺失 `form_codes`、400 错误和无效字符串项的测试并确认通过。

### Task 2: 创建与绑定状态分离

**Files:**
- Modify: `server/easy_exam_server.mjs`
- Test: `server/test_course_session_binding.mjs`

- [ ] 增加编排级测试，断言 `course_create` 在 `paper_bind` 开始前成功，绑定失败不触发创建。
- [x] 将现有 `ensureFormalCourses` 拆成科目创建/确认与详情回查/绑定两阶段。
- [x] 分别更新 `course_create` 和 `paper_bind` 的 running/success/failed 状态。
- [x] 运行模块测试与 `node --check server/easy_exam_server.mjs`。

### Task 3: `paper_bind` 专属重试

**Files:**
- Modify: `server/easy_exam_server.mjs`
- Test: `server/test_course_session_binding.mjs`

- [ ] 增加 HTTP 重试端点集成测试，断言只执行详情回查和绑定。
- [x] 在单步骤重试处对 `paper_bind` 读取任务配置和 formal session，执行绑定并更新状态。
- [x] 对非 `paper_bind` 保持原有的 pending 行为。
- [x] 运行全部 Node/Python 测试和语法检查。
