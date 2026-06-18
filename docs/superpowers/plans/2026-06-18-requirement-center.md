# Requirement Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a requirement center for exam-service demand collection, manual review, customer confirmation, change tracking, and task handoff.

**Architecture:** Add an independent SQLite-backed requirement store beside the existing task-state store, expose Dify-facing and internal staff APIs through the existing Node HTTP server, then add SPA pages under `/requirements`. Dify remains the conversation collector; this app becomes the auditable source of truth and manual execution handoff surface.

**Tech Stack:** Python 3 `sqlite3` for durable storage and validation; Node.js ESM HTTP handlers for API integration; existing vanilla web modules for the staff UI.

---

## File Structure

- Create `server/requirement_request_db.py`: SQLite schema, normalization, validation, CLI actions.
- Create `server/test_requirement_request_db.py`: Python unit tests for lifecycle, validation, confirmation, change requests, and task linking.
- Create `server/requirement_request_api.mjs`: Node API handler that calls the Python store and maps HTTP routes.
- Create `server/test_requirement_request_api.mjs`: Node tests for Dify and staff routes.
- Modify `server/easy_exam_server.mjs`: mount requirement API before existing task/detail routes.
- Modify `server/frontend_routes.mjs`: serve requirement routes through the SPA fallback.
- Modify `web/router.mjs`: register requirement list/detail routes.
- Create `web/pages/RequirementListPage.mjs`: staff queue page.
- Create `web/pages/RequirementDetailPage.mjs`: review, confirm, change, and task-link page.
- Modify `outputs/web_prototype/easy_exam_automation.html`: include generated web bundle when required by existing test harness.
- Keep `docs/superpowers/specs/2026-06-18-easy-exam-requirement-center-design.md`: product/architecture design reference.

## Requirement Data Contract

The normalized latest requirement payload uses these keys:

```json
{
  "exam_name": "2026年度招聘考试",
  "formal_exam_time_range": "2026-07-01 09:00 - 2026-07-01 11:00",
  "mock_exam_time_range": "2026-06-30 15:00 - 2026-06-30 16:00",
  "early_login_minutes": 30,
  "late_limit_minutes": 15,
  "waiting_notice": "请提前完成设备检测",
  "paper_time_rule": "进入考试后开始扣时",
  "welcome_message": "欢迎参加考试",
  "commitment_text": "本人承诺独立作答",
  "video_monitor_required": true,
  "video_record_required": true,
  "hawkeye_required": false,
  "exam_client_type": "web",
  "leave_limit_count": 8,
  "watermark_enabled": true,
  "copy_forbidden": true,
  "subjects": ["英语", "化学", "物理"],
  "candidate_template_required": true,
  "notes": "客户补充说明"
}
```

Statuses:

```text
collecting -> pending_internal_review -> customer_confirmed -> ready_to_create_task -> task_created
collecting -> change_requested -> pending_internal_review
```

## Task 1: Requirement Store

**Files:**
- Create: `server/test_requirement_request_db.py`
- Create: `server/requirement_request_db.py`

- [ ] **Step 1: Write failing lifecycle tests**

```python
def test_upsert_normalizes_complete_requirement_and_records_version(tmp_path):
    store = RequirementStore(tmp_path / "requirements.db")
    result = store.create_or_update_requirement(
        customer={"name": "ATA客户", "contact": "ops@example.com"},
        requirement={
            "exam_name": "2026招聘考试",
            "formal_exam_time_range": "2026-07-01 09:00 - 2026-07-01 11:00",
            "early_login_minutes": "30分钟",
            "late_limit_minutes": "15分钟",
            "video_monitor_required": "是",
            "video_record_required": "是",
            "hawkeye_required": "否",
            "exam_client_type": "网页考试",
            "leave_limit_count": 8,
            "watermark_enabled": "是",
            "copy_forbidden": "是",
            "subjects": "英语，化学，物理",
        },
    )
    assert result["status"] == "pending_internal_review"
    assert result["latest"]["requirement"]["subjects"] == ["英语", "化学", "物理"]
    assert result["latest"]["version"] == 1
```

- [ ] **Step 2: Run test to verify RED**

Run: `python3 -m unittest server/test_requirement_request_db.py -v`

Expected: FAIL because `server.requirement_request_db` does not exist.

- [ ] **Step 3: Implement minimal store schema and upsert**

Implement `RequirementStore` with tables `requirement_requests`, `requirement_versions`, and `requirement_events`, plus a CLI `upsert` action.

- [ ] **Step 4: Run lifecycle test to verify GREEN**

Run: `python3 -m unittest server/test_requirement_request_db.py -v`

Expected: PASS for lifecycle tests.

- [ ] **Step 5: Add failing validation and state tests**

Add tests for missing required fields, web exam leave limit, customer confirmation, change request separation, `mark_ready_to_create_task`, and `link_task`.

- [ ] **Step 6: Implement validation and transitions**

Add `missing_fields`, `validation_errors`, confirmation/change/link tables, and transition methods.

- [ ] **Step 7: Run store tests**

Run: `python3 -m unittest server/test_requirement_request_db.py -v`

Expected: all requirement store tests PASS.

## Task 2: Requirement API

**Files:**
- Create: `server/test_requirement_request_api.mjs`
- Create: `server/requirement_request_api.mjs`
- Modify: `server/easy_exam_server.mjs`

- [ ] **Step 1: Write failing API route tests**

```javascript
test('Dify upsert route stores a requirement and returns missing fields', async () => {
  const result = await callRequirementHandler('POST', '/api/ai/requirements/upsert', {
    customer: { name: 'ATA客户' },
    requirement: { exam_name: '2026招聘考试' }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.ok(result.body.requirement.missing_fields.includes('formal_exam_time_range'));
});
```

- [ ] **Step 2: Run API test to verify RED**

Run: `node --test server/test_requirement_request_api.mjs`

Expected: FAIL because `server/requirement_request_api.mjs` does not exist.

- [ ] **Step 3: Implement API handler**

Expose:

```text
POST /api/ai/requirements/upsert
GET /api/ai/requirements/:id
POST /api/ai/requirements/:id/customer-confirmed
POST /api/ai/requirements/:id/change-request
GET /api/requirements
GET /api/requirements/:id
POST /api/requirements/:id/mark-ready
POST /api/requirements/:id/link-task
```

- [ ] **Step 4: Mount API in server**

Import `handleRequirementRequest` and call it before existing task detail routes.

- [ ] **Step 5: Run API tests**

Run: `node --test server/test_requirement_request_api.mjs`

Expected: all API tests PASS.

## Task 3: Staff UI

**Files:**
- Modify: `server/frontend_routes.mjs`
- Modify: `web/router.mjs`
- Create: `web/pages/RequirementListPage.mjs`
- Create: `web/pages/RequirementDetailPage.mjs`
- Modify if required: `outputs/web_prototype/easy_exam_automation.html`

- [ ] **Step 1: Write failing UI route tests**

Add Node tests asserting `/requirements` and `/requirements/<id>` render SPA route links or page content.

- [ ] **Step 2: Implement routes and pages**

Add list/detail pages with status filters, missing-field display, latest version, customer confirmations, change requests, mark-ready, and link-task actions.

- [ ] **Step 3: Run UI tests**

Run: `node --test server/test_ui_views.mjs`

Expected: all UI route tests PASS.

## Task 4: Integration Verification

**Files:**
- Modify as needed: `package.json` scripts or existing test docs only if verification exposes a real gap.

- [ ] **Step 1: Run Python unit tests**

Run: `python3 -m unittest server/test_requirement_request_db.py -v`

Expected: PASS.

- [ ] **Step 2: Run Node API/UI tests**

Run: `node --test server/test_requirement_request_api.mjs server/test_app_router.mjs server/test_ui_views.mjs`

Expected: PASS.

- [ ] **Step 3: Run smoke server**

Run: `node server/easy_exam_server.mjs`, then call `/api/health`, `/api/ai/requirements/upsert`, and `/requirements`.

Expected: health is OK, API stores a requirement, and SPA route loads.

## Task 5: Git Handoff

**Files:**
- All files changed above.

- [ ] **Step 1: Review diff**

Run: `git status --short && git diff --stat`

Expected: only requirement-center files and route mounts changed.

- [ ] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/specs/2026-06-18-easy-exam-requirement-center-design.md docs/superpowers/plans/2026-06-18-requirement-center.md server web outputs
git commit -m "feat: add exam requirement center"
```

- [ ] **Step 3: Push**

Run: `git push origin codex/requirement-center`

Expected: fork branch updates on `foster21222-ux/easy-exam-automation`.

## Self-Review

- Spec coverage: requirement collection, Dify handoff, manual review, customer confirmation, change tracking, and task linking are mapped to Tasks 1-3.
- Placeholder scan: no `TBD`, `TODO`, `implement later`, or undefined route names remain in this plan.
- Type consistency: API route names, store method names, and normalized payload keys match across tasks.
