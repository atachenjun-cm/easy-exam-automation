# WeChat Requirement Collector

第一阶段目标：从微信群中复制一段可见聊天记录，整理成结构化需求草稿。此阶段不自动读取微信数据库，不自动发送消息，不自动生成最终需求单。

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

## 后续阶段

第二阶段会把本脚本接入桌面微信可见消息读取和 checkpoint。第三阶段再写入 easy-exam 需求中心的“微信群来源需求草稿”。
