# Easy Exam Requirement Center Design

## Goal

Build a requirement interaction and confirmation layer on top of the existing `easy-exam-automation` platform.

The first phase uses Dify for customer-facing conversation and uses `easy-exam-automation` as the internal operations platform. Dify collects and structures customer requirements, then writes them into the platform. Internal staff reviews and confirms requirements before manually creating or linking execution tasks.

## Source Context

Primary application:

- GitHub repository: `atachenjun-cm/easy-exam-automation`
- Runtime style: Node.js local web server plus Python helpers
- Existing server entrypoint: `server/easy_exam_server.mjs`
- Existing task persistence: `server/task_state_db.py`
- Existing task concept: `exam_tasks`
- Existing frontend routes include `/requirements`, which can become the requirement center

Reference files:

- `/Users/ata/Yikao/易考新建考试需求单_样例.xlsx`
- `/Users/ata/Yikao/易考新建考试需求单_样例2.xlsx`
- `/Users/ata/Yikao/易考分解.xlsx`
- `/Users/ata/Yikao/导入数据模版.xlsx`
- `/Users/ata/Yikao/流程拆解.png`
- Existing repo docs: `易考新建考试需求单模板.md`, `exam_request.template.yaml`

## Product Boundary

### In Scope For Phase 1

- Dify Chatflow collects requirements from customers.
- Dify calls platform APIs to create or update requirement records.
- The platform stores requirement drafts, versions, confirmations, and change requests.
- Internal staff reviews requirements in `/requirements`.
- Internal staff generates a customer confirmation draft.
- Customer confirmation is recorded.
- Internal staff manually creates or links an execution task.
- Requirement detail shows linked execution task status.

### Out Of Scope For Phase 1

- Fully automatic task execution after customer confirmation.
- Customer-facing custom chat UI outside Dify.
- Payment, contract, invoice, or CRM features.
- Automatic platform operation beyond existing `exam_tasks`.
- Replacing the existing Excel parser and Playwright execution flow.
- Multi-tenant public SaaS permissions.

## System Architecture

```text
Customer
  -> Dify Chatflow
  -> Dify HTTP tool
  -> easy-exam-automation AI requirement API
  -> Requirement Center database
  -> Internal review page
  -> Manual task creation/linking
  -> Existing exam task execution flow
```

Dify owns conversation. `easy-exam-automation` owns business records, internal review, task linkage, and status display.

The platform should not depend on Dify internals. It accepts ordinary HTTP JSON payloads so that future customer portals, forms, or other chat tools can reuse the same API.

## Requirement Field Model

The phase 1 field model comes from the current Excel samples.

### Basic Information

| Field | Required | Source Label | Notes |
| --- | --- | --- | --- |
| `exam_name` | yes | 考试名称 | Main exam name shown in 易考 |
| `formal_exam_time_range` | yes | 考试日期时间 | Parsed as UTC+08 start and end |
| `trial_exam_time_range` | no | 试考日期时间 | Parsed as UTC+08 start and end |
| `early_login_minutes` | yes | 提前登录时间 | Extract integer minutes |
| `late_limit_minutes` | yes | 限制迟到时间 | Extract integer minutes |
| `pre_login_prompt_html` | no | 考前等待提示 | May contain HTML |
| `time_deduction_rule` | no | 试卷扣时规则 | Example: 迟到及离开扣时 |
| `welcome_message_html` | no | 欢迎语 | May contain HTML |

### Exam Configuration

| Field | Required | Source Label | Notes |
| --- | --- | --- | --- |
| `pledge_content_html` | no | 考试承诺书内容 | May contain HTML |
| `video_monitor_required` | yes | 视频监控 | Normalize 需要/不需要 |
| `video_record_required` | yes | 视频录制 | Normalize 开启录制/关闭 |
| `hawkeye_required` | yes | 鹰眼监控 | Normalize 需要/不需要 |
| `exam_client_type` | yes | 考试类型 | `web` or `client` |
| `leave_limit_count` | conditional | 允许离开次数（网页考试时填写） | Required when `exam_client_type=web` |
| `watermark_enabled` | yes | 答题水印 | Normalize 是/否 |
| `copy_forbidden` | yes | 禁止复制 | Normalize 是/否 |

### Paper And Subjects

| Field | Required | Source Label | Notes |
| --- | --- | --- | --- |
| `subjects_text` | yes | 科目信息 | Raw user text |
| `subjects` | yes | 科目信息 | Parsed list, split by comma/newline/顿号 |

### Candidate Data

Candidate import is not required to complete phase 1 requirement collection, but the model should reserve fields for it.

Candidate template columns:

```text
姓名
邮箱
手机号码
证件号
备用电话
报考岗位
准考证号
```

Reserved fields:

- `candidate_source`
- `candidate_file_name`
- `expected_candidate_count`
- `candidate_import_task_id`

## Requirement Status Model

```text
draft
collecting
pending_internal_review
pending_customer_confirm
customer_confirmed
ready_to_create_task
task_created
change_requested
blocked
completed
cancelled
```

### Status Meaning

- `draft`: Created but not enough useful information exists.
- `collecting`: Dify is still collecting missing fields.
- `pending_internal_review`: AI has submitted a structured draft for staff review.
- `pending_customer_confirm`: Staff reviewed and generated a customer confirmation.
- `customer_confirmed`: Customer confirmed the requirement summary.
- `ready_to_create_task`: Staff marked the requirement ready for task creation.
- `task_created`: Requirement is linked to an existing `exam_task`.
- `change_requested`: Customer requested changes after confirmation.
- `blocked`: Human intervention is needed.
- `completed`: Business flow is finished.
- `cancelled`: Requirement is cancelled.

Only internal staff can move a requirement to `ready_to_create_task` or `task_created`.

## Change Request Model

Customer changes after confirmation should not overwrite the confirmed version.

Change flow:

```text
change_requested
-> internal_review
-> pending_customer_confirm
-> applied / rejected
```

Each change request stores:

- Changed fields
- Customer message
- Previous value
- Proposed value
- Reviewer
- Review status
- Applied version id

## Database Design

Use a new SQLite database file or a new table group in the existing runtime database. To keep boundaries clear, prefer a new helper:

```text
server/requirement_request_db.py
```

### `requirement_requests`

```text
request_id TEXT PRIMARY KEY
title TEXT NOT NULL
customer_name TEXT NOT NULL DEFAULT ''
customer_contact TEXT NOT NULL DEFAULT ''
source_channel TEXT NOT NULL DEFAULT 'dify'
status TEXT NOT NULL
current_version INTEGER NOT NULL DEFAULT 1
linked_task_id TEXT
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
created_by TEXT NOT NULL DEFAULT ''
reviewer TEXT NOT NULL DEFAULT ''
```

### `requirement_versions`

```text
request_id TEXT NOT NULL
version INTEGER NOT NULL
source TEXT NOT NULL
payload_json TEXT NOT NULL
missing_fields_json TEXT NOT NULL DEFAULT '[]'
validation_errors_json TEXT NOT NULL DEFAULT '[]'
created_at TEXT NOT NULL
created_by TEXT NOT NULL DEFAULT ''
PRIMARY KEY(request_id, version)
```

### `requirement_confirmations`

```text
confirmation_id TEXT PRIMARY KEY
request_id TEXT NOT NULL
version INTEGER NOT NULL
confirmation_text TEXT NOT NULL
status TEXT NOT NULL
customer_reply TEXT NOT NULL DEFAULT ''
confirmed_at TEXT
created_at TEXT NOT NULL
```

### `requirement_change_requests`

```text
change_id TEXT PRIMARY KEY
request_id TEXT NOT NULL
base_version INTEGER NOT NULL
status TEXT NOT NULL
customer_message TEXT NOT NULL
changes_json TEXT NOT NULL
review_note TEXT NOT NULL DEFAULT ''
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
```

### `requirement_events`

```text
event_id TEXT PRIMARY KEY
request_id TEXT NOT NULL
event_type TEXT NOT NULL
message TEXT NOT NULL
payload_json TEXT NOT NULL DEFAULT '{}'
created_at TEXT NOT NULL
created_by TEXT NOT NULL DEFAULT ''
```

This event table powers the requirement timeline.

## Validation Rules

Phase 1 validation should be deterministic and conservative.

Required for internal review:

- `exam_name`
- Formal exam start and end time
- `early_login_minutes`
- `late_limit_minutes`
- `video_monitor_required`
- `video_record_required`
- `hawkeye_required`
- `exam_client_type`
- `watermark_enabled`
- `copy_forbidden`
- `subjects`

Conditional:

- `leave_limit_count` is required when `exam_client_type=web`.
- Trial exam time is optional, but if present, start must be before end.
- Formal exam end must be after formal exam start.
- Time values use UTC+08.

Warnings:

- HTML fields should be shown in preview before confirmation.
- Long subject lists should be previewed as parsed subjects.
- Empty optional fields should display as “未填写，按系统默认处理”.

## API Design

### Dify-Facing APIs

These endpoints are stable integration points for Dify HTTP Request nodes.

#### `POST /api/ai/requirements/upsert`

Create or update a requirement draft.

Request:

```json
{
  "requestId": "optional-existing-id",
  "customer": {
    "name": "客户名称",
    "contact": "联系方式"
  },
  "message": "客户原始描述",
  "requirement": {
    "exam_name": "蜀道集团考试",
    "formal_exam_time_range": "2026/6/23 09:00:00-2026/6/23 16:00:00",
    "trial_exam_time_range": "2026/6/22 09:43:00-2026/6/22 16:48:00",
    "early_login_minutes": 30,
    "late_limit_minutes": 20,
    "video_monitor_required": true,
    "video_record_required": true,
    "hawkeye_required": false,
    "exam_client_type": "web",
    "leave_limit_count": 8,
    "watermark_enabled": true,
    "copy_forbidden": true,
    "subjects": ["英语", "化学", "物理", "天文", "地理"]
  }
}
```

Response:

```json
{
  "requestId": "req_...",
  "status": "pending_internal_review",
  "version": 2,
  "missingFields": [],
  "validationErrors": [],
  "nextAction": "internal_review"
}
```

#### `GET /api/ai/requirements/:requestId`

Return current requirement status, missing fields, latest confirmation text, and linked task id.

#### `POST /api/ai/requirements/:requestId/customer-confirmed`

Record that the customer confirmed the latest confirmation text.

Request:

```json
{
  "customerReply": "确认",
  "conversationId": "dify conversation id"
}
```

Response:

```json
{
  "requestId": "req_...",
  "status": "customer_confirmed",
  "nextAction": "internal_staff_create_task"
}
```

#### `POST /api/ai/requirements/:requestId/change-request`

Record a customer change request after confirmation.

### Internal APIs

These APIs power the `/requirements` pages.

```text
GET  /api/requirements
GET  /api/requirements/:requestId
PATCH /api/requirements/:requestId
POST /api/requirements/:requestId/review
POST /api/requirements/:requestId/confirmation-draft
POST /api/requirements/:requestId/mark-ready
POST /api/requirements/:requestId/create-task
POST /api/requirements/:requestId/link-task
GET  /api/requirements/:requestId/timeline
```

`create-task` should call the existing task store instead of duplicating execution task logic.

## Frontend Design

Use the existing frontend style and routes.

### Routes

```text
/requirements
/requirements/:requestId
```

The route `/requirements` already exists in `web/router.mjs` and `server/frontend_routes.mjs`.

### Requirement List

Columns:

- Requirement title
- Customer
- Status
- Missing fields count
- Current version
- Linked task id
- Updated time

Filters:

- All
- Pending internal review
- Pending customer confirm
- Customer confirmed
- Change requested
- Task created

### Requirement Detail

Sections:

- Customer info
- Requirement fields grouped by source sheet stage
- Missing fields and validation errors
- Confirmation draft
- Version history
- Change requests
- Timeline
- Linked execution task summary

Actions:

- Save edits
- Generate confirmation draft
- Mark pending customer confirmation
- Mark customer confirmed
- Mark ready to create task
- Create execution task
- Link existing task
- Record change request

## Dify Chatflow Design

### Dify Responsibilities

- Collect exam requirements through multi-turn conversation.
- Ask only for missing fields.
- Normalize user input into the phase 1 JSON schema.
- Call the platform upsert API.
- Present a customer-friendly confirmation text.
- Record customer confirmation or change request.

### Recommended Chatflow Nodes

```text
Start
-> Intent classification
-> Requirement extraction
-> Missing field checker
-> Follow-up question
-> Requirement JSON builder
-> HTTP request: upsert requirement
-> Confirmation text generator
-> Customer confirmation branch
-> HTTP request: customer-confirmed or change-request
```

### Dify Should Not

- Create execution tasks directly.
- Start Playwright automation.
- Modify `exam_tasks` directly.
- Read or display platform secrets.
- Assume missing optional fields are required.

## Existing Task Integration

The new requirement layer should integrate with existing `exam_tasks` only after internal staff clicks “Create execution task”.

Mapping to existing task config:

- `exam_name` -> existing parsed config exam name
- Formal exam time range -> formal session dates
- Trial exam time range -> trial session dates
- `early_login_minutes` -> early login config
- `late_limit_minutes` -> late limit config
- `pre_login_prompt_html` -> pre-login prompt
- `time_deduction_rule` -> time rule
- `welcome_message_html` -> welcome text
- `pledge_content_html` -> pledge content
- Video and anti-cheat fields -> exam config
- `subjects` -> generated course records

The first implementation can create an `exam_task` with config JSON and status `pending`, then let existing screens handle execution.

## Implementation Files

Create:

```text
server/requirement_request_db.py
server/requirement_request_api.mjs
web/pages/RequirementListPage.mjs
web/pages/RequirementDetailPage.mjs
```

Modify:

```text
server/easy_exam_server.mjs
server/frontend_routes.mjs
web/router.mjs
web/layout.mjs
```

Avoid modifying in phase 1 unless required for task creation integration:

```text
server/easy_exam_runner.mjs
server/course_session_binding.mjs
server/task_state_db.py
```

## Testing Strategy

### Unit Tests

- Requirement DB creates records.
- Upsert creates new version.
- Status transitions reject invalid moves.
- Validation detects missing required fields.
- Web exam requires leave limit count.
- Customer confirmation records event.
- Change request does not overwrite confirmed version.

### API Tests

- `POST /api/ai/requirements/upsert`
- `GET /api/ai/requirements/:id`
- `POST /api/ai/requirements/:id/customer-confirmed`
- Internal review and create-task endpoints

### UI Tests

- Requirement list renders records.
- Requirement detail groups fields correctly.
- Missing fields appear clearly.
- Confirmation draft is visible.
- Task link appears after creation.

### Integration Test

Use the sample requirement payload from `易考新建考试需求单_样例2.xlsx`:

```text
Create requirement
-> Review
-> Generate confirmation
-> Mark customer confirmed
-> Mark ready
-> Create task
-> Verify linked task id
```

## Phase 1 Acceptance Criteria

- Dify can write a structured requirement into the platform through HTTP.
- Internal staff can view, edit, and review the requirement.
- Platform can generate a customer confirmation draft.
- Customer confirmation can be recorded.
- Staff can manually create or link an execution task.
- Requirement detail displays linked task status.
- Customer changes after confirmation create change records instead of overwriting history.
- Existing execution automation remains untouched except the explicit task creation/link point.

## Open Follow-Up Decisions

- Whether Dify will be exposed only internally at first or to real customers.
- Whether customer confirmation is typed in Dify only, or also supported from internal staff entry.
- Whether generated confirmation text should be AI-generated by Dify or deterministic from platform templates.
- Whether the requirement center should export the current Excel需求单 format.
