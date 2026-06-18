# 页面路由与组件边界重构设计

## 目标

将现有靠 `hidden` 切换的单页主体改为 URL 驱动的原生 ES Modules 单页应用。公共布局只包含左侧导航、顶部栏和页面出口；自动配置内容只能由 `AutoConfigPage` 管理。

## 路由

- `/projects` 和 `/projects/:projectId`
- `/auto-config`，支持 `?projectId=...`
- `/exams` 和 `/exams/:examId`
- `/candidate-import`
- `/requirements`
- `/templates`
- `/logs`
- `/` 重定向 `/projects`

Node 服务对上述前端路由统一返回 HTML，静态资源从 `/web/` 提供，API 和 artifact 路由保持原样。因此直接刷新任意详情 URL 不会 404。

## 组件边界

`web/pages/` 中每个页面模块只声明自己的路由、根 DOM、数据加载和离开/进入行为。`web/components/auto-config/` 中定义 `RequirementUpload`、`AutoConfigProgress`、`ConfigPreview`、`FinalScreenshot`和 `AutoConfigLogs`，它们只由 `AutoConfigPage` 导入。

现有自动配置业务事件和 API 调用保留在现有控制器中，模块化只接管页面归属、导航和可见性，避免改变考试创建业务。

## 数据与交互

- 项目和考试页继续读取 SQLite 持久化 API。
- 项目 ID 和考试任务 ID 当前均使用 `taskId`。
- “进入自动配置”使用 `/auto-config?projectId=<taskId>`。
- 菜单高亮只由 `location.pathname` 决定，详情页归属各自列表菜单。
- `pushState` 负责站内跳转，`popstate` 负责前进/后退。

## 验证

使用 Node 测试覆盖路由匹配、详情参数、菜单唯一高亮、页面组件依赖边界、SPA fallback 和自动配置组件禁止引用。部署后逐个 HTTP 访问全部路由，并校验刷新后 URL 不变。
