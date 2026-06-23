# WeChat Requirement Collector

当前阶段目标：从微信群中复制或采集一段可见聊天记录，整理成结构化需求草稿。此阶段不自动读取微信数据库，不自动发送消息，不自动生成最终需求单。

## 配置微信群

复制 `config/wechat-requirement-groups.example.json` 为本机配置文件，例如：

```bash
cp config/wechat-requirement-groups.example.json .easy_exam_runtime/wechat-requirement-groups.json
```

配置多个项目群：

```json
{
  "groups": [
    {
      "group_name": "AI赋能运营自动化小组",
      "project_name": "易考自动化需求",
      "customer_name": "内部测试客户",
      "enabled": true,
      "interval_minutes": 15
    },
    {
      "group_name": "某客户考试项目群",
      "project_name": "某客户校招考试",
      "customer_name": "某客户",
      "enabled": true,
      "interval_minutes": 15
    }
  ]
}
```

## 试运行

把微信群可见消息复制到文本文件：

```bash
node scripts/wechat_requirement_collect.mjs \
  --config .easy_exam_runtime/wechat-requirement-groups.json \
  --group AI赋能运营自动化小组 \
  --input /tmp/wechat-chat.txt
```

也可以复制微信群消息到剪贴板后运行：

```bash
node scripts/wechat_requirement_collect.mjs \
  --config .easy_exam_runtime/wechat-requirement-groups.json \
  --group AI赋能运营自动化小组 \
  --clipboard
```

输出内容包括：

- `source`：微信群来源和采集时间。
- `project`：群映射到的项目和客户。
- `requirement`：结构化需求草稿。
- `unresolvedQuestions`：仍需确认的问题。
- `changeRecords`：聊天中识别到的需求变更。
- `checkpoint`：本次消息数量和最后一条消息 hash，后续定时读取会用于去重。

## 从桌面微信采集当前可见内容

先确保：

- macOS 已登录微信桌面版。
- 系统设置中允许终端或 Codex 使用辅助功能控制微信。
- 采集脚本只会搜索指定群、复制当前可见聊天内容，不会发送消息。

运行单个群：

```bash
node scripts/wechat_visible_collect.mjs \
  --config .easy_exam_runtime/wechat-requirement-groups.json \
  --state .easy_exam_runtime/wechat-checkpoints.json \
  --group AI赋能运营自动化小组
```

运行配置里所有启用的群：

```bash
node scripts/wechat_visible_collect.mjs \
  --config .easy_exam_runtime/wechat-requirement-groups.json \
  --state .easy_exam_runtime/wechat-checkpoints.json
```

预览将执行的 AppleScript，不操作微信：

```bash
node scripts/wechat_visible_collect.mjs \
  --config .easy_exam_runtime/wechat-requirement-groups.json \
  --group AI赋能运营自动化小组 \
  --dry-run
```

`--state` 文件会记录每个群的 checkpoint。下一次采集时，脚本会跳过上次已经处理过的消息。

## 15 分钟定时

测试阶段建议先用 macOS `launchd` 每 15 分钟执行一次 `scripts/wechat_visible_collect.mjs`。定时任务只负责生成 JSON 输出和更新 checkpoint；写入需求中心放到后续阶段接入。

## 后续阶段

下一阶段会把输出写入 easy-exam 需求中心的“微信群来源需求草稿”，并在页面上显示每个微信群最近一次采集结果。
