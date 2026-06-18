# Page Routing and Component Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将单文档隐藏切换改为可刷新的 URL 路由和独立页面组件，彻底阻止自动配置组件混入其他页面。

**Architecture:** 使用原生 ES Modules 实现 History API 路由器和页面对象。Node 服务提供 `/web/` 静态模块与 SPA fallback，现有自动配置控制器只替换视图切换层。

**Tech Stack:** Node.js ES modules, History API, native HTML/CSS/JavaScript, `node:test`.

---

### Task 1: 路由器与 SPA fallback

- [ ] 创建失败测试，覆盖九类路由、动态参数和服务端刷新。
- [ ] 新建 `web/router.mjs`，实现 match/navigate/popstate。
- [ ] 修改 `server/easy_exam_server.mjs`，提供 `/web/` 和前端路由 fallback。
- [ ] 运行路由测试和语法检查。

### Task 2: 公共布局与页面模块

- [ ] 创建页面依赖边界失败测试。
- [ ] 新建 `web/layout.mjs` 和 `web/pages/*.mjs`。
- [ ] 将项目列表、项目详情、考试列表、考试详情、名单导入与辅助页面绑定到独立根 DOM。
- [ ] 实现 URL 驱动的唯一菜单高亮。

### Task 3: 自动配置组件归属

- [ ] 新建 `web/components/auto-config/*.mjs` 和 `AutoConfigPage.mjs`。
- [ ] 测试只有 `AutoConfigPage` 导入五个自动配置组件。
- [ ] 将现有自动配置 DOM 划分为五个组件边界，不修改业务事件。

### Task 4: 详情页与导航交互

- [ ] 增加项目详情独立 DOM 与数据渲染。
- [ ] 将考试任务详情迁移到 `/exams/:examId`。
- [ ] 修改列表、返回、进入自动配置按钮为路由跳转。
- [ ] 实现 `/requirements`、`/templates`、`/logs` 独立页面。

### Task 5: 部署与全路由验证

- [ ] 运行所有 Node/Python 测试与语法检查。
- [ ] 同步 `web/`、HTML 和 server 到安装目录并重启 8765。
- [ ] 逐一 GET 全部路由和动态详情路由，验证 HTTP 200。
- [ ] 验证页面刷新、前进/后退、唯一菜单高亮和自动配置组件隔离。
