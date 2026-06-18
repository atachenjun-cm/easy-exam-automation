# 项目与考试任务详情 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加跨账号项目管理、考试列表和可持久化的九步骤任务详情。

**Architecture:** 使用 Python 标准库 SQLite 建立独立任务存储，通过 Node 服务包装为 REST API；现有业务函数只追加状态更新调用。前端在现有单页应用中增加三个视图并复用现有导航与 Apple 风格样式。

**Tech Stack:** Node.js、Python sqlite3、原生 HTML/CSS/JavaScript、node:test/pytest。

---

### Task 1: SQLite 任务存储

**Files:**
- Create: `server/task_state_db.py`
- Create: `server/test_task_state_db.py`

- [ ] 先编写任务初始化、跨账号查询、步骤更新和组合步骤汇总测试。
- [ ] 运行测试并确认因模块缺失而失败。
- [ ] 实现 SQLite 表、固定步骤和 JSON 命令接口。
- [ ] 运行测试并确认通过。

### Task 2: 后端任务 API 与业务接入

**Files:**
- Modify: `server/easy_exam_server.mjs`

- [ ] 增加任务存储调用器和 `updateTaskStep`。
- [ ] 增加项目列表、考试列表、任务详情、单步骤重试 API。
- [ ] 在需求单解析和现有创建流程事件中写入任务、场次与步骤状态。
- [ ] 运行 Node 语法检查和 API 冒烟测试。

### Task 3: 项目管理、考试列表、任务详情页面

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html`

- [ ] 增加三个导航入口和对应视图容器。
- [ ] 增加项目卡片、考试表格和九步骤详情渲染。
- [ ] 增加失败步骤单独重试和日志展开交互。
- [ ] 在浏览器验证导航高亮、跨账号列表和刷新持久化。

### Task 4: 完整验证

- [ ] 运行 SQLite 单元测试。
- [ ] 运行 Node 语法检查。
- [ ] 重启 8765 服务并调用健康检查与任务 API。
- [ ] 用浏览器检查页面布局和响应式表现。
