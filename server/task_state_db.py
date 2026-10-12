import json
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


STEP_DEFS = [
    ("requirement_parse", "需求单解析"),
    ("formal_session_create", "正式场次创建"),
    ("trial_session_create", "试考场次创建"),
    ("session_change", "场次信息修改"),
    ("trial_paper_bind", "试考试卷绑定"),
    ("course_create", "科目创建"),
    ("paper_bind", "正式场次绑定科目"),
    ("trial_candidate_import", "试考考生导入"),
    ("formal_candidate_import", "正式考试考生导入"),
    ("sessions_auto_rooms", "试考、正式考试自动分班"),
    ("sessions_invigilator_export", "试考、正式考试监考账号导出"),
    ("project_shared_sheet", "项目共享大表"),
    ("score_process", "成绩处理"),
]

VALID_STATUSES = {
    "pending", "running", "success", "failed", "waiting_manual", "skipped"
}
STEP_ORDER = {step_key: index for index, (step_key, _) in enumerate(STEP_DEFS)}
CORE_PROGRESS_STEPS = {
    "requirement_parse",
    "formal_session_create",
    "trial_session_create",
    "trial_paper_bind",
    "course_create",
    "paper_bind",
    "trial_candidate_import",
    "formal_candidate_import",
    "sessions_auto_rooms",
}
DISPLAY_STAGE_NAMES = {
    "requirement_parse": "需求单解析",
    "formal_session_create": "正式场次创建",
    "trial_session_create": "试考场次创建",
    "course_create": "科目创建",
    "trial_paper_bind": "试考试卷绑定",
    "paper_bind": "正式场次绑定科目",
    "trial_candidate_import": "试考考生导入 & 自动分班",
    "formal_candidate_import": "正式考试考生导入 & 自动分班",
    "sessions_auto_rooms": "试考考生导入 & 自动分班",
}

EXAM_LIST_STEP_KEYS = (
    "requirement_parse",
    "formal_session_create",
    "trial_session_create",
    "course_create",
    "paper_bind",
    "formal_candidate_import",
    "trial_candidate_import",
    "trial_paper_bind",
    "sessions_auto_rooms",
)

EXAM_LIST_RESPONSE_CONFIG_KEYS = (
    "examName",
    "examAddress",
    "examUrlType",
    "unifiedExamAddress",
    "examUrl",
    "unifiedExamCode",
    "unifiedExamPassword",
    "examPassword",
    "examCode",
    "mockExamEnabled",
)


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def loads(value, fallback):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def row_dict(row):
    return dict(row) if row else None


def operation_archive_count(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        count = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return str(count) if count >= 0 else None


def operation_archive_actuals_summary(config):
    if not isinstance(config, dict):
        return {}
    archive = config.get("operationArchive")
    if not isinstance(archive, dict):
        return {}
    if str(archive.get("status") or "") in {"submitted", "already_archived"}:
        submission = archive.get("lastSubmission")
        snapshot = submission.get("formSnapshot") if isinstance(submission, dict) else None
        archived_count = operation_archive_count(
            snapshot.get("attendedSubjects") if isinstance(snapshot, dict) else None
        )
        if archived_count is not None:
            return {"completedSubjects": archived_count}
    actuals = archive.get("actuals")
    if not isinstance(actuals, dict):
        return {}
    completed_subjects = operation_archive_count(actuals.get("completedSubjects"))
    if completed_subjects is None:
        return {}
    return {
        "completedSubjects": completed_subjects,
        **({"refreshedAt": str(actuals["refreshedAt"])} if str(actuals.get("refreshedAt") or "").strip() else {}),
    }


def exam_list_paper_summary(value):
    if not isinstance(value, dict) or "status" not in value:
        return {}
    return {"status": value["status"]}


def exam_list_response_requirement_summary(requirement):
    if not isinstance(requirement, dict):
        return {}
    fields = requirement.get("fields") if isinstance(requirement.get("fields"), dict) else {}
    config = requirement.get("config") if isinstance(requirement.get("config"), dict) else {}
    summary = {}
    if str(fields.get("考试名称") or "").strip():
        summary["fields"] = {"考试名称": fields["考试名称"]}
    requirement_config = {
        key: config[key]
        for key in ("examName", "mockExamEnabled")
        if key in config
    }
    if isinstance(config.get("courses"), list) and config["courses"]:
        requirement_config["courseCount"] = len(config["courses"])
    if requirement_config:
        summary["config"] = requirement_config
    return summary


def exam_list_sync_preview_summary(value):
    if not isinstance(value, dict):
        return None
    summary = {}
    if value.get("checkedAt"):
        summary["checkedAt"] = value["checkedAt"]
    source_sessions = value.get("sessions")
    sessions = []
    for item in source_sessions if isinstance(source_sessions, list) else []:
        if not isinstance(item, dict):
            continue
        session = {
            key: item[key]
            for key in ("sessionId", "sessionType", "checkedAt", "error", "readbackWarning")
            if key in item and item[key] not in (None, "")
        }
        difference_count = item.get("differenceCount")
        if difference_count is None and isinstance(item.get("diff"), list):
            difference_count = len(item["diff"])
        if difference_count is not None:
            session["differenceCount"] = difference_count
        sessions.append(session)
    if isinstance(source_sessions, list):
        summary["sessions"] = sessions
    return summary


def exam_list_response_config_summary(config):
    if not isinstance(config, dict):
        return {}
    summary = {key: config[key] for key in EXAM_LIST_RESPONSE_CONFIG_KEYS if key in config}
    if isinstance(config.get("courses"), list) and config["courses"]:
        summary["courseCount"] = len(config["courses"])
    requirements = config.get("examRequirements")
    if isinstance(requirements, list):
        summary["examRequirements"] = [
            exam_list_response_requirement_summary(requirement) for requirement in requirements
        ]
    if isinstance(config.get("examRequirement"), dict):
        summary["examRequirement"] = exam_list_response_requirement_summary(config["examRequirement"])
    if isinstance(config.get("paperFormBinds"), list):
        summary["paperFormBinds"] = [
            exam_list_paper_summary(value) for value in config["paperFormBinds"]
        ]
    paper_form_bind = exam_list_paper_summary(config.get("paperFormBind"))
    if paper_form_bind:
        summary["paperFormBind"] = paper_form_bind
    sync_preview = exam_list_sync_preview_summary(config.get("examListSyncPreviewCache"))
    if sync_preview is not None:
        summary["examListSyncPreviewCache"] = sync_preview
    return summary


def exam_list_config_summary(config):
    if not isinstance(config, dict):
        return {}
    summary = {key: config[key] for key in ("mockExamEnabled",) if key in config}
    if isinstance(config.get("courses"), list) and config["courses"]:
        summary["courseCount"] = len(config["courses"])
    requirements = config.get("examRequirements")
    if isinstance(requirements, list):
        summary["examRequirements"] = [
            {"config": exam_list_config_summary(requirement.get("config"))} if isinstance(requirement, dict) else {"config": {}}
            for requirement in requirements
        ]
    if isinstance(config.get("paperFormBinds"), list):
        summary["paperFormBinds"] = [
            exam_list_paper_summary(value) for value in config["paperFormBinds"]
        ]
    paper_form_bind = exam_list_paper_summary(config.get("paperFormBind"))
    if paper_form_bind:
        summary["paperFormBind"] = paper_form_bind
    return summary


def exam_list_step_summary(row):
    requirement_progress = loads(row["requirement_progress_json"], {})
    if not isinstance(requirement_progress, dict):
        requirement_progress = {}
    return {
        "stepKey": row["step_key"],
        "status": row["status"],
        "requirementProgress": {
            key: {
                "status": value["status"],
                **({"subStatus": value["subStatus"]} if isinstance(value.get("subStatus"), dict) and value["subStatus"] else {}),
            }
            for key, value in requirement_progress.items()
            if isinstance(value, dict) and "status" in value
        },
    }


def exam_list_aggregate_status(statuses):
    values = [status for status in statuses if status]
    if not values:
        return "pending"
    for status in ("failed", "running", "waiting_manual"):
        if status in values:
            return status
    if all(status in {"success", "skipped"} for status in values):
        return "success"
    if any(status in {"success", "skipped"} for status in values):
        return "running"
    return "pending"


def exam_list_display_progress(sessions):
    config = sessions[0]["config"]
    steps = {step["stepKey"]: step for step in sessions[0]["steps"]}
    if not steps:
        return sessions[0]["progress"]
    requirement_count = max(
        len(config.get("examRequirements") or []),
        max((session["requirementIndex"] + 1 for session in sessions), default=0),
        max((int(key) + 1 for step in steps.values() for key in step["requirementProgress"] if key.isdigit()), default=0),
        1,
    )
    requirements = config.get("examRequirements") or []
    trial_indexes = [index for index in range(requirement_count) if (
        bool((requirements[index].get("config") or {}).get("mockExamEnabled")) if index < len(requirements) else bool(config.get("mockExamEnabled"))
    ) or any(session["sessionType"] == "trial" and session["requirementIndex"] == index for session in sessions)]
    statuses = []
    for key in ("requirement_parse", "formal_session_create"):
        if key in steps:
            statuses.append(steps[key]["status"])
    for key in ("trial_session_create", "course_create", "trial_paper_bind", "paper_bind"):
        if key not in steps or key in {"trial_session_create", "trial_paper_bind"} and not trial_indexes:
            continue
        step = steps[key]
        if key in {"trial_session_create", "trial_paper_bind"}:
            selected = [step["requirementProgress"].get(str(index), {}).get("status") for index in trial_indexes]
            statuses.append(exam_list_aggregate_status(selected) if any(selected) else step["status"])
        else:
            statuses.append(step["status"])
    paper_states = config.get("paperFormBinds") or []
    paper_statuses = []
    for index in range(requirement_count):
        state = paper_states[index] if index < len(paper_states) else config.get("paperFormBind") if index == 0 else {}
        paper_statuses.append((state or {}).get("status") or "pending")
    statuses.append(exam_list_aggregate_status(paper_statuses))
    for session_type, indexes in (("trial", trial_indexes), ("formal", range(requirement_count))):
        if session_type == "trial" and not trial_indexes:
            continue
        import_step = steps.get(f"{session_type}_candidate_import", {})
        room_step = steps.get("sessions_auto_rooms", {})
        sub_key = "trialExamStatus" if session_type == "trial" else "formalExamStatus"
        statuses.append(exam_list_aggregate_status([
            exam_list_aggregate_status([
                import_step.get("requirementProgress", {}).get(str(index), {}).get("status", "pending"),
                room_step.get("requirementProgress", {}).get(str(index), {}).get("subStatus", {}).get(sub_key)
                or room_step.get("requirementProgress", {}).get(str(index), {}).get("status", "pending"),
            ])
            for index in indexes
        ]))
    completed = sum(status == "success" for status in statuses)
    return int(completed * 1000 / len(statuses) + 0.5) / 10 if statuses else sessions[0]["progress"]


def exam_list_task_status(sessions):
    statuses = [session["status"] or "pending" for session in sessions]
    if statuses and all(status == "success" for status in statuses):
        return "success"
    priority = {"failed": 5, "running": 4, "waiting_manual": 3, "success": 2, "pending": 1}
    return max(statuses, key=lambda status: priority.get(status, 1), default="pending")


def exam_list_time(value):
    text = str(value or "").strip().replace("/", "-")
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.now().astimezone().tzinfo)
    return parsed.timestamp()


def exam_list_task_ended(sessions, now):
    formal = [session for session in sessions if session["sessionType"] == "formal"]
    if not formal:
        return False
    for session in formal:
        end_time = exam_list_time(session["end"])
        comparison_time = end_time if end_time is not None else exam_list_time(session["start"])
        if comparison_time is None or comparison_time >= now:
            return False
    return True


def exam_list_status_snapshot(sessions):
    config = sessions[0]["config"]
    snapshot_config = {
        key: config[key]
        for key in ("paperFormBinds", "paperFormBind", "mockExamEnabled", "courseCount")
        if key in config
    }
    if isinstance(config.get("examRequirements"), list):
        snapshot_config["examRequirements"] = [
            {"config": {
                key: value
                for key, value in (requirement.get("config") or {}).items()
                if key in {"mockExamEnabled", "courseCount"}
            }}
            for requirement in config["examRequirements"]
        ]
    return {
        "progress": exam_list_display_progress(sessions),
        "status": exam_list_task_status(sessions),
        "config": snapshot_config,
        "steps": sessions[0]["steps"],
        "sessions": [{
            "sessionType": session["sessionType"],
            "requirementIndex": session["requirementIndex"],
            "session_id": session["session_id"],
        } for session in sessions],
    }


def status_from_sub_status(step_key, status, sub_status):
    if step_key not in {"sessions_auto_rooms", "sessions_invigilator_export"} or not sub_status:
        return status
    child_values = [sub_status.get("formalExamStatus"), sub_status.get("trialExamStatus")]
    if all(value == "success" for value in child_values):
        return "success"
    if any(value == "failed" for value in child_values):
        return "failed"
    if any(value == "running" for value in child_values):
        return "running"
    if any(value == "waiting_manual" for value in child_values):
        return "waiting_manual"
    return status


def aggregate_requirement_status(statuses):
    values = list(statuses or [])
    if not values:
        return "pending"
    if "failed" in values:
        return "failed"
    if "running" in values:
        return "running"
    if "waiting_manual" in values:
        return "waiting_manual"
    if all(value in {"success", "skipped"} for value in values):
        return "skipped" if all(value == "skipped" for value in values) else "success"
    if any(value in {"success", "skipped"} for value in values):
        return "running"
    return "pending"


def requirement_count_from_config(config):
    requirements = config.get("examRequirements") if isinstance(config, dict) else None
    if isinstance(requirements, list):
        return len(requirements)
    return 1


def collect_session_ids(value, found=None):
    found = found if found is not None else set()
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {"sessionId", "formalSessionId", "trialSessionId", "session_id"} and item is not None and str(item):
                found.add(str(item))
            else:
                collect_session_ids(item, found)
    elif isinstance(value, list):
        for item in value:
            collect_session_ids(item, found)
    return found


def reindex_requirement_mapping(value, deleted_index):
    if not isinstance(value, dict):
        return {}
    result = {}
    for key, item in value.items():
        try:
            index = int(key)
        except (TypeError, ValueError):
            result[key] = item
            continue
        if index == deleted_index:
            continue
        result[str(index - 1 if index > deleted_index else index)] = item
    return result


def reindex_requirement_records(value, deleted_index):
    if not isinstance(value, list):
        return []
    ownership_keys = ("requirementIndex", "courseRequirementIndex")
    index_keys = (*ownership_keys, "sourceRequirementIndex")
    result = []
    for item in value:
        if not isinstance(item, dict):
            result.append(item)
            continue
        indexed_values = []
        for key in index_keys:
            try:
                indexed_values.append((key, int(item[key])))
            except (KeyError, TypeError, ValueError):
                continue
        if any(key in ownership_keys and index == deleted_index for key, index in indexed_values):
            continue
        updated = dict(item)
        for key, index in indexed_values:
            if index > deleted_index:
                updated[key] = index - 1
        result.append(updated)
    return result


def reindex_content_task_remarks(value, deleted_index):
    if not isinstance(value, dict):
        return {}
    result = {}
    for key, item in value.items():
        parts = str(key).rsplit(":", 1)
        if len(parts) != 2 or not parts[1].isdigit():
            result[key] = item
            continue
        index = int(parts[1])
        if index == deleted_index:
            continue
        result[f"{parts[0]}:{index - 1 if index > deleted_index else index}"] = item
    return result


def step_summary_from_requirement_progress(requirement_progress, expected_count):
    if not requirement_progress or expected_count <= 0:
        return {
            "status": "pending", "startedAt": None, "completedAt": None, "durationMs": None,
            "errorMessage": None, "result": {}, "subStatus": {}, "logs": [], "retryCount": 0,
        }
    statuses = [
        (requirement_progress.get(str(index)) or {}).get("status", "pending")
        for index in range(expected_count)
    ]
    status = aggregate_requirement_status(statuses)
    entries = [
        requirement_progress[key]
        for key in sorted(requirement_progress, key=lambda value: int(value) if str(value).isdigit() else 10**9)
        if isinstance(requirement_progress[key], dict)
    ]
    started_values = [item.get("startedAt") for item in entries if item.get("startedAt")]
    completed_values = [item.get("completedAt") for item in entries if item.get("completedAt")]
    selected = entries[-1] if entries else {}
    logs = [log for item in entries for log in (item.get("logs") or [])]
    started_at = min(started_values) if started_values else None
    completed_at = max(completed_values) if completed_values and status in {"success", "failed", "skipped"} else None
    duration_ms = None
    if started_at and completed_at:
        start_dt = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
        duration_ms = max(0, int((end_dt - start_dt).total_seconds() * 1000))
    error_message = next(
        (str(item.get("errorMessage")) for item in entries if item.get("errorMessage")),
        None,
    )
    return {
        "status": status,
        "startedAt": started_at,
        "completedAt": completed_at,
        "durationMs": duration_ms,
        "errorMessage": error_message,
        "result": selected.get("result") or {},
        "subStatus": selected.get("subStatus") or {},
        "logs": logs,
        "retryCount": 0,
    }


class TaskStore:
    def __init__(self, db_path):
        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def connect(self):
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_schema(self):
        with self.connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS exam_tasks (
                    task_id TEXT PRIMARY KEY,
                    project_name TEXT NOT NULL,
                    source_account TEXT NOT NULL DEFAULT '',
                    owner_email TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'pending',
                    current_stage TEXT NOT NULL DEFAULT '需求单解析',
                    progress REAL NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    hidden_at TEXT,
                    config_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS exam_sessions (
                    task_id TEXT NOT NULL,
                    requirement_index INTEGER NOT NULL DEFAULT 0,
                    session_type TEXT NOT NULL,
                    session_id TEXT NOT NULL DEFAULT '',
                    name TEXT NOT NULL DEFAULT '',
                    start_time TEXT NOT NULL DEFAULT '',
                    end_time TEXT NOT NULL DEFAULT '',
                    candidate_count INTEGER NOT NULL DEFAULT 0,
                    room_count INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'pending',
                    url TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(task_id, requirement_index, session_type),
                    FOREIGN KEY(task_id) REFERENCES exam_tasks(task_id)
                );
                CREATE TABLE IF NOT EXISTS exam_task_steps (
                    task_id TEXT NOT NULL,
                    step_key TEXT NOT NULL,
                    step_name TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    started_at TEXT,
                    completed_at TEXT,
                    duration_ms INTEGER,
                    error_message TEXT,
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    result_json TEXT NOT NULL DEFAULT '{}',
                    sub_status_json TEXT NOT NULL DEFAULT '{}',
                    logs_json TEXT NOT NULL DEFAULT '[]',
                    requirement_progress_json TEXT NOT NULL DEFAULT '{}',
                    PRIMARY KEY(task_id, step_key),
                    FOREIGN KEY(task_id) REFERENCES exam_tasks(task_id)
                );
                CREATE TABLE IF NOT EXISTS exam_list_status_snapshots (
                    task_id TEXT PRIMARY KEY,
                    snapshot_json TEXT NOT NULL,
                    captured_at TEXT NOT NULL,
                    FOREIGN KEY(task_id) REFERENCES exam_tasks(task_id)
                );
                CREATE TABLE IF NOT EXISTS exam_candidates (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    session_id TEXT NOT NULL DEFAULT '',
                    permit TEXT NOT NULL DEFAULT '',
                    full_name TEXT NOT NULL DEFAULT '',
                    identity_id TEXT NOT NULL DEFAULT '',
                    course_code TEXT NOT NULL DEFAULT '',
                    mobile TEXT NOT NULL DEFAULT '',
                    email TEXT NOT NULL DEFAULT '',
                    custom_fields_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(task_id, session_id, permit),
                    FOREIGN KEY(task_id) REFERENCES exam_tasks(task_id)
                );
                CREATE TABLE IF NOT EXISTS exam_custom_fields (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    session_id TEXT NOT NULL DEFAULT '',
                    field_name TEXT NOT NULL DEFAULT '',
                    field_code TEXT NOT NULL DEFAULT '',
                    yikao_field_id TEXT NOT NULL DEFAULT '',
                    source_column TEXT NOT NULL DEFAULT '',
                    field_type TEXT NOT NULL DEFAULT 'text',
                    required INTEGER NOT NULL DEFAULT 0,
                    order_index INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(task_id, session_id, field_code),
                    FOREIGN KEY(task_id) REFERENCES exam_tasks(task_id)
                );
                CREATE TABLE IF NOT EXISTS candidate_change_sets (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    source_type TEXT NOT NULL DEFAULT 'full_list',
                    reason TEXT NOT NULL DEFAULT '',
                    baseline_hash TEXT NOT NULL DEFAULT '',
                    proposed_hash TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'waiting_review',
                    created_by TEXT NOT NULL DEFAULT '',
                    summary_json TEXT NOT NULL DEFAULT '{}',
                    impact_json TEXT NOT NULL DEFAULT '{}',
                    error_text TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    applied_at TEXT,
                    FOREIGN KEY(task_id) REFERENCES exam_tasks(task_id)
                );
                CREATE INDEX IF NOT EXISTS candidate_change_sets_task_session_idx
                    ON candidate_change_sets(task_id, session_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS candidate_change_items (
                    id TEXT PRIMARY KEY,
                    change_set_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL DEFAULT 0,
                    operation TEXT NOT NULL,
                    old_permit TEXT NOT NULL DEFAULT '',
                    permit TEXT NOT NULL DEFAULT '',
                    before_json TEXT NOT NULL DEFAULT 'null',
                    after_json TEXT NOT NULL DEFAULT 'null',
                    changed_fields_json TEXT NOT NULL DEFAULT '[]',
                    risk_level TEXT NOT NULL DEFAULT 'low',
                    blocked INTEGER NOT NULL DEFAULT 0,
                    block_reason TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'pending',
                    error_text TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(change_set_id) REFERENCES candidate_change_sets(id)
                );
                CREATE INDEX IF NOT EXISTS candidate_change_items_set_idx
                    ON candidate_change_items(change_set_id, sequence);
                CREATE TABLE IF NOT EXISTS candidate_roster_snapshots (
                    id TEXT PRIMARY KEY,
                    change_set_id TEXT NOT NULL,
                    phase TEXT NOT NULL,
                    roster_hash TEXT NOT NULL DEFAULT '',
                    roster_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(change_set_id) REFERENCES candidate_change_sets(id)
                );
                CREATE INDEX IF NOT EXISTS candidate_roster_snapshots_set_idx
                    ON candidate_roster_snapshots(change_set_id, created_at);
                """
            )
            columns = {row["name"] for row in db.execute("PRAGMA table_info(exam_tasks)").fetchall()}
            if "owner_email" not in columns:
                db.execute("ALTER TABLE exam_tasks ADD COLUMN owner_email TEXT NOT NULL DEFAULT ''")
            if "hidden_at" not in columns:
                db.execute("ALTER TABLE exam_tasks ADD COLUMN hidden_at TEXT")
            self._ensure_exam_sessions_schema(db)
            step_columns = {row["name"] for row in db.execute("PRAGMA table_info(exam_task_steps)").fetchall()}
            if "requirement_progress_json" not in step_columns:
                db.execute("ALTER TABLE exam_task_steps ADD COLUMN requirement_progress_json TEXT NOT NULL DEFAULT '{}'")

    def _ensure_exam_sessions_schema(self, db):
        columns = db.execute("PRAGMA table_info(exam_sessions)").fetchall()
        column_names = {row["name"] for row in columns}
        primary_key = [row["name"] for row in sorted(columns, key=lambda row: row["pk"]) if row["pk"]]
        if "requirement_index" in column_names and primary_key == ["task_id", "requirement_index", "session_type"]:
            return

        db.execute("ALTER TABLE exam_sessions RENAME TO exam_sessions_legacy")
        db.execute(
            """CREATE TABLE exam_sessions (
                task_id TEXT NOT NULL,
                requirement_index INTEGER NOT NULL DEFAULT 0,
                session_type TEXT NOT NULL,
                session_id TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL DEFAULT '',
                start_time TEXT NOT NULL DEFAULT '',
                end_time TEXT NOT NULL DEFAULT '',
                candidate_count INTEGER NOT NULL DEFAULT 0,
                room_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                url TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                PRIMARY KEY(task_id, requirement_index, session_type),
                FOREIGN KEY(task_id) REFERENCES exam_tasks(task_id)
            )"""
        )
        requirement_index = "COALESCE(requirement_index, 0)" if "requirement_index" in column_names else "0"
        db.execute(
            f"""INSERT INTO exam_sessions
                (task_id, requirement_index, session_type, session_id, name, start_time, end_time,
                 candidate_count, room_count, status, url, updated_at)
                SELECT task_id, {requirement_index}, session_type, session_id, name, start_time, end_time,
                       candidate_count, room_count, status, url, updated_at
                FROM exam_sessions_legacy"""
        )
        db.execute("DROP TABLE exam_sessions_legacy")

    def _ensure_steps(self, db, task_id):
        for step_key, step_name in STEP_DEFS:
            db.execute(
                """INSERT OR IGNORE INTO exam_task_steps
                (task_id, step_key, step_name) VALUES (?, ?, ?)""",
                (task_id, step_key, step_name),
            )

    def create_task(self, project_name, source_account="", config=None, task_id=None, owner_email=""):
        task_id = task_id or str(uuid.uuid4())
        now = utc_now()
        with self.connect() as db:
            db.execute(
                """INSERT OR IGNORE INTO exam_tasks
                (task_id, project_name, source_account, owner_email, created_at, updated_at, config_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (task_id, project_name or "未命名项目", source_account or "", owner_email or "", now, now, json.dumps(config or {}, ensure_ascii=False)),
            )
            self._ensure_steps(db, task_id)
        return self.get_task(task_id)

    def upsert_session(self, task_id, session_type, session, requirement_index=0):
        now = utc_now()
        try:
            requirement_index = max(int(requirement_index or 0), 0)
        except (TypeError, ValueError):
            requirement_index = 0
        with self.connect() as db:
            task = db.execute("SELECT config_json FROM exam_tasks WHERE task_id=?", (task_id,)).fetchone()
            if not task:
                raise ValueError("Task not found")
            task_config = loads(task["config_json"], {})
            if requirement_index >= requirement_count_from_config(task_config):
                raise ValueError("Requirement index out of range")
            db.execute(
                """INSERT INTO exam_sessions
                (task_id, requirement_index, session_type, session_id, name, start_time, end_time,
                 candidate_count, room_count, status, url, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(task_id, requirement_index, session_type) DO UPDATE SET
                  session_id=excluded.session_id, name=excluded.name,
                  start_time=excluded.start_time, end_time=excluded.end_time,
                  candidate_count=excluded.candidate_count, room_count=excluded.room_count,
                  status=excluded.status, url=excluded.url, updated_at=excluded.updated_at""",
                (
                    task_id, requirement_index, session_type, str(session.get("session_id") or session.get("id") or ""),
                    str(session.get("name") or ""), str(session.get("start") or session.get("start_time") or ""),
                    str(session.get("end") or session.get("end_time") or ""),
                    int(session.get("candidate_count") or 0), int(session.get("room_count") or 0),
                    str(session.get("status") or "success"), str(session.get("url") or ""), now,
                ),
            )
            db.execute("UPDATE exam_tasks SET updated_at=? WHERE task_id=?", (now, task_id))
        return self.get_task(task_id)

    def sync_session(self, task_id, session_type, session, config=None, requirement_index=0):
        now = utc_now()
        try:
            requirement_index = max(int(requirement_index or 0), 0)
        except (TypeError, ValueError):
            requirement_index = 0
        session_id = str(session.get("session_id") or session.get("id") or "").strip()
        if not session_id:
            raise ValueError("Session id is required")
        with self.connect() as db:
            task = db.execute("SELECT config_json FROM exam_tasks WHERE task_id=?", (task_id,)).fetchone()
            if not task:
                raise ValueError("Task not found")
            cursor = db.execute(
                """UPDATE exam_sessions SET name=?, start_time=?, end_time=?, updated_at=?
                WHERE task_id=? AND requirement_index=? AND session_type=? AND session_id=?""",
                (
                    str(session.get("name") or ""),
                    str(session.get("start") or session.get("start_time") or ""),
                    str(session.get("end") or session.get("end_time") or ""),
                    now,
                    task_id,
                    requirement_index,
                    session_type,
                    session_id,
                ),
            )
            if cursor.rowcount != 1:
                raise ValueError("Session not found")
            current_config = loads(task["config_json"], {})
            next_config = {
                **current_config,
                **(config or {}),
            }
            db.execute(
                "UPDATE exam_tasks SET config_json=?, updated_at=? WHERE task_id=?",
                (json.dumps(next_config, ensure_ascii=False), now, task_id),
            )
        return self.get_task(task_id)

    def update_config(self, task_id, config, project_name=None, source_account=None):
        now = utc_now()
        with self.connect() as db:
            current = db.execute("SELECT * FROM exam_tasks WHERE task_id=?", (task_id,)).fetchone()
            if not current:
                raise ValueError("Task not found")
            current_config = loads(current["config_json"], {})
            next_config = {
                **current_config,
                **(config or {}),
            }
            next_project_name = str(project_name or current["project_name"] or "").strip() or current["project_name"]
            next_source_account = str(
                current["source_account"] if source_account is None else source_account
            ).strip()
            db.execute(
                "UPDATE exam_tasks SET project_name=?, source_account=?, config_json=?, updated_at=? WHERE task_id=?",
                (next_project_name, next_source_account, json.dumps(next_config, ensure_ascii=False), now, task_id),
            )
        return self.get_task(task_id)

    def hide_task(self, task_id):
        now = utc_now()
        with self.connect() as db:
            current = db.execute("SELECT task_id FROM exam_tasks WHERE task_id=?", (task_id,)).fetchone()
            if not current:
                return False
            db.execute("UPDATE exam_tasks SET hidden_at=?, updated_at=? WHERE task_id=?", (now, now, task_id))
        return True

    def delete_task(self, task_id):
        with self.connect() as db:
            current = db.execute("SELECT task_id FROM exam_tasks WHERE task_id=?", (task_id,)).fetchone()
            if not current:
                return False
            change_set_ids = [
                row["id"] for row in db.execute(
                    "SELECT id FROM candidate_change_sets WHERE task_id=?", (task_id,)
                ).fetchall()
            ]
            for change_set_id in change_set_ids:
                db.execute("DELETE FROM candidate_roster_snapshots WHERE change_set_id=?", (change_set_id,))
                db.execute("DELETE FROM candidate_change_items WHERE change_set_id=?", (change_set_id,))
            db.execute("DELETE FROM candidate_change_sets WHERE task_id=?", (task_id,))
            db.execute("DELETE FROM exam_custom_fields WHERE task_id=?", (task_id,))
            db.execute("DELETE FROM exam_candidates WHERE task_id=?", (task_id,))
            db.execute("DELETE FROM exam_task_steps WHERE task_id=?", (task_id,))
            db.execute("DELETE FROM exam_list_status_snapshots WHERE task_id=?", (task_id,))
            db.execute("DELETE FROM exam_sessions WHERE task_id=?", (task_id,))
            db.execute("DELETE FROM exam_tasks WHERE task_id=?", (task_id,))
        return True

    def delete_requirement(self, task_id, requirement_index):
        try:
            requirement_index = int(requirement_index)
        except (TypeError, ValueError):
            raise ValueError("Requirement index out of range")
        now = utc_now()
        with self.connect() as db:
            task = db.execute("SELECT * FROM exam_tasks WHERE task_id=?", (task_id,)).fetchone()
            if not task:
                raise ValueError("Task not found")
            config = loads(task["config_json"], {})
            requirements = config.get("examRequirements")
            if not isinstance(requirements, list) or not requirements:
                legacy = config.get("examRequirement")
                requirements = [legacy] if isinstance(legacy, dict) else []
            if requirement_index < 0 or requirement_index >= len(requirements):
                raise ValueError("Requirement index out of range")

            step_rows = db.execute(
                "SELECT * FROM exam_task_steps WHERE task_id=?", (task_id,)
            ).fetchall()
            deleted_session_ids = {
                str(row["session_id"])
                for row in db.execute(
                    "SELECT session_id FROM exam_sessions WHERE task_id=? AND requirement_index=?",
                    (task_id, requirement_index),
                ).fetchall()
                if row["session_id"]
            }
            for row in step_rows:
                progress = loads(row["requirement_progress_json"], {})
                if isinstance(progress, dict):
                    collect_session_ids(progress.get(str(requirement_index)), deleted_session_ids)
            session_sync = config.get("sessionSync")
            if isinstance(session_sync, dict):
                for session_id, snapshot in (session_sync.get("snapshots") or {}).items():
                    try:
                        snapshot_index = int((snapshot or {}).get("requirementIndex"))
                    except (TypeError, ValueError):
                        continue
                    if snapshot_index == requirement_index:
                        deleted_session_ids.add(str(session_id))

            placeholders = ",".join("?" for _ in deleted_session_ids)
            deleted_change_set_ids = []
            if deleted_session_ids:
                params = [task_id, *sorted(deleted_session_ids)]
                deleted_change_set_ids = [
                    row["id"] for row in db.execute(
                        f"SELECT id FROM candidate_change_sets WHERE task_id=? AND session_id IN ({placeholders})",
                        params,
                    ).fetchall()
                ]
                for change_set_id in deleted_change_set_ids:
                    db.execute("DELETE FROM candidate_roster_snapshots WHERE change_set_id=?", (change_set_id,))
                    db.execute("DELETE FROM candidate_change_items WHERE change_set_id=?", (change_set_id,))
                db.execute(
                    f"DELETE FROM candidate_change_sets WHERE task_id=? AND session_id IN ({placeholders})",
                    params,
                )
                db.execute(
                    f"DELETE FROM exam_custom_fields WHERE task_id=? AND session_id IN ({placeholders})",
                    params,
                )
                db.execute(
                    f"DELETE FROM exam_candidates WHERE task_id=? AND session_id IN ({placeholders})",
                    params,
                )

            db.execute(
                "DELETE FROM exam_sessions WHERE task_id=? AND requirement_index=?",
                (task_id, requirement_index),
            )
            db.execute(
                "UPDATE exam_sessions SET requirement_index=-requirement_index-1 WHERE task_id=? AND requirement_index>?",
                (task_id, requirement_index),
            )
            db.execute(
                "UPDATE exam_sessions SET requirement_index=-requirement_index-2, updated_at=? WHERE task_id=? AND requirement_index<0",
                (now, task_id),
            )

            remaining_items = [item for index, item in enumerate(requirements) if index != requirement_index]
            remaining_requirements = [
                {**item, "order": index + 1} if isinstance(item, dict) else item
                for index, item in enumerate(remaining_items)
            ]
            next_config = dict(config)
            if requirement_index == 0 and remaining_requirements:
                primary_config = remaining_requirements[0].get("config") if isinstance(remaining_requirements[0], dict) else None
                if isinstance(primary_config, dict):
                    next_config.update(primary_config)
            next_config["examRequirements"] = remaining_requirements
            next_config["examRequirement"] = remaining_requirements[0] if remaining_requirements else None
            next_config["examListSyncPreviewCache"] = None
            next_config["sessionSyncPreviewCache"] = None

            for plural_key, legacy_key in (
                ("paperFormBinds", "paperFormBind"),
                ("paperBindReminders", "paperBindReminder"),
            ):
                values = config.get(plural_key)
                if isinstance(values, list):
                    remaining_values = [item for index, item in enumerate(values) if index != requirement_index]
                    next_config[plural_key] = remaining_values
                    next_config[legacy_key] = remaining_values[0] if remaining_values else {}
                elif requirement_index == 0 and legacy_key in config:
                    next_config[legacy_key] = {}

            next_config["contentTaskRemarks"] = reindex_content_task_remarks(
                config.get("contentTaskRemarks"), requirement_index
            )
            for history_key in ("projectSourceChangeHistory", "examRequirementChangeHistory"):
                if history_key in config:
                    next_config[history_key] = reindex_requirement_records(config.get(history_key), requirement_index)

            for session_key in ("sessionPersonalById", "candidateChangePending"):
                value = config.get(session_key)
                if isinstance(value, dict):
                    next_config[session_key] = {
                        key: item for key, item in value.items() if str(key) not in deleted_session_ids
                    }

            if isinstance(session_sync, dict):
                next_session_sync = dict(session_sync)
                snapshots = {}
                for session_id, snapshot in (session_sync.get("snapshots") or {}).items():
                    if str(session_id) in deleted_session_ids:
                        continue
                    updated_snapshot = dict(snapshot) if isinstance(snapshot, dict) else snapshot
                    if isinstance(updated_snapshot, dict):
                        try:
                            snapshot_index = int(updated_snapshot.get("requirementIndex"))
                        except (TypeError, ValueError):
                            snapshot_index = None
                        if snapshot_index == requirement_index:
                            continue
                        if snapshot_index is not None and snapshot_index > requirement_index:
                            updated_snapshot["requirementIndex"] = snapshot_index - 1
                    snapshots[session_id] = updated_snapshot
                next_session_sync["snapshots"] = snapshots
                next_session_sync["history"] = reindex_requirement_records(
                    session_sync.get("history"), requirement_index
                )
                next_config["sessionSync"] = next_session_sync

            message_center = config.get("messageCenter")
            if isinstance(message_center, dict):
                next_message_center = dict(message_center)
                next_message_center["requirements"] = reindex_requirement_mapping(
                    message_center.get("requirements"), requirement_index
                )
                candidate_changes = message_center.get("candidateChanges")
                if isinstance(candidate_changes, dict):
                    next_message_center["candidateChanges"] = {
                        key: item for key, item in candidate_changes.items() if key not in deleted_change_set_ids
                    }
                next_config["messageCenter"] = next_message_center
            project_card = config.get("projectCard")
            if isinstance(project_card, dict):
                next_config["projectCard"] = {**project_card, "updatedAt": now}

            expected_count = len(remaining_requirements)
            for row in step_rows:
                progress = loads(row["requirement_progress_json"], {})
                if not isinstance(progress, dict) or not progress:
                    if row["step_key"] == "session_change":
                        result = loads(row["result_json"], {})
                        result_index = result.get("requirementIndex") if isinstance(result, dict) else None
                        try:
                            result_index = int(result_index)
                        except (TypeError, ValueError):
                            result_index = None
                        if result_index == requirement_index:
                            db.execute(
                                """UPDATE exam_task_steps SET status='pending', started_at=NULL, completed_at=NULL,
                                duration_ms=NULL, error_message=NULL, retry_count=0, result_json='{}',
                                sub_status_json='{}', logs_json='[]' WHERE task_id=? AND step_key=?""",
                                (task_id, row["step_key"]),
                            )
                        elif result_index is not None and result_index > requirement_index:
                            result["requirementIndex"] = result_index - 1
                            result["history"] = reindex_requirement_records(result.get("history"), requirement_index)
                            db.execute(
                                "UPDATE exam_task_steps SET result_json=? WHERE task_id=? AND step_key=?",
                                (json.dumps(result, ensure_ascii=False), task_id, row["step_key"]),
                            )
                    continue
                reindexed_progress = reindex_requirement_mapping(progress, requirement_index)
                summary = step_summary_from_requirement_progress(reindexed_progress, expected_count)
                db.execute(
                    """UPDATE exam_task_steps SET status=?, started_at=?, completed_at=?, duration_ms=?,
                    error_message=?, retry_count=?, result_json=?, sub_status_json=?, logs_json=?,
                    requirement_progress_json=? WHERE task_id=? AND step_key=?""",
                    (
                        summary["status"], summary["startedAt"], summary["completedAt"], summary["durationMs"],
                        summary["errorMessage"], summary["retryCount"],
                        json.dumps(summary["result"], ensure_ascii=False),
                        json.dumps(summary["subStatus"], ensure_ascii=False),
                        json.dumps(summary["logs"], ensure_ascii=False),
                        json.dumps(reindexed_progress, ensure_ascii=False),
                        task_id, row["step_key"],
                    ),
                )

            db.execute("DELETE FROM exam_list_status_snapshots WHERE task_id=?", (task_id,))
            db.execute(
                "UPDATE exam_tasks SET config_json=?, updated_at=? WHERE task_id=?",
                (json.dumps(next_config, ensure_ascii=False), now, task_id),
            )
            self._refresh_task(db, task_id)
        return self.get_task(task_id)

    def upsert_custom_fields(self, task_id, session_id, fields):
        now = utc_now()
        saved = 0
        with self.connect() as db:
            for index, field in enumerate(fields or []):
                field_name = str(field.get("field_name") or field.get("target_name") or "").strip()
                field_code = str(field.get("field_code") or field.get("code") or "").strip()
                if not field_name or not field_code:
                    continue
                db.execute(
                    """INSERT INTO exam_custom_fields
                    (id, task_id, session_id, field_name, field_code, yikao_field_id, source_column,
                     field_type, required, order_index, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(task_id, session_id, field_code) DO UPDATE SET
                      field_name=excluded.field_name,
                      yikao_field_id=excluded.yikao_field_id,
                      source_column=excluded.source_column,
                      field_type=excluded.field_type,
                      required=excluded.required,
                      order_index=excluded.order_index,
                      updated_at=excluded.updated_at""",
                    (
                        str(uuid.uuid4()), task_id, str(session_id or ""), field_name, field_code,
                        str(field.get("yikao_field_id") or ""), str(field.get("source_column") or field_name),
                        str(field.get("field_type") or "text"), 1 if field.get("required") else 0,
                        int(field.get("order_index") if field.get("order_index") is not None else index),
                        now, now,
                    ),
                )
                saved += 1
            db.execute("UPDATE exam_tasks SET updated_at=? WHERE task_id=?", (now, task_id))
        return {"savedCount": saved, "taskId": task_id, "sessionId": str(session_id or "")}

    def list_custom_fields(self, task_id, session_id=None):
        with self.connect() as db:
            if session_id is None:
                rows = db.execute(
                    "SELECT * FROM exam_custom_fields WHERE task_id=? ORDER BY order_index, field_name", (task_id,)
                ).fetchall()
            else:
                rows = db.execute(
                    """SELECT * FROM exam_custom_fields
                    WHERE task_id=? AND session_id=? ORDER BY order_index, field_name""",
                    (task_id, str(session_id or "")),
                ).fetchall()
        return [self._custom_field(row) for row in rows]

    def upsert_candidates(self, task_id, session_id, candidates):
        now = utc_now()
        saved = 0
        with self.connect() as db:
            for candidate in candidates or []:
                permit = str(candidate.get("permit") or "").strip()
                if not permit:
                    continue
                custom_fields = candidate.get("custom_fields") or {}
                if not isinstance(custom_fields, dict):
                    custom_fields = {}
                db.execute(
                    """INSERT INTO exam_candidates
                    (id, task_id, session_id, permit, full_name, identity_id, course_code, mobile, email,
                     custom_fields_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(task_id, session_id, permit) DO UPDATE SET
                      full_name=excluded.full_name,
                      identity_id=excluded.identity_id,
                      course_code=excluded.course_code,
                      mobile=excluded.mobile,
                      email=excluded.email,
                      custom_fields_json=excluded.custom_fields_json,
                      updated_at=excluded.updated_at""",
                    (
                        str(uuid.uuid4()), task_id, str(session_id or ""), permit,
                        str(candidate.get("full_name") or ""), str(candidate.get("identity_id") or ""),
                        str(candidate.get("course_code") or ""), str(candidate.get("mobile") or ""),
                        str(candidate.get("email") or ""), json.dumps(custom_fields, ensure_ascii=False),
                        now, now,
                    ),
                )
                saved += 1
            db.execute("UPDATE exam_tasks SET updated_at=? WHERE task_id=?", (now, task_id))
        return {"savedCount": saved, "taskId": task_id, "sessionId": str(session_id or "")}

    def list_candidates(self, task_id, session_id=None):
        with self.connect() as db:
            if session_id is None:
                rows = db.execute(
                    "SELECT * FROM exam_candidates WHERE task_id=? ORDER BY created_at, permit", (task_id,)
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT * FROM exam_candidates WHERE task_id=? AND session_id=? ORDER BY created_at, permit",
                    (task_id, str(session_id or "")),
                ).fetchall()
        return [self._candidate(row) for row in rows]

    def replace_candidates(self, task_id, session_id, candidates):
        now = utc_now()
        session_id = str(session_id or "")
        saved = 0
        with self.connect() as db:
            db.execute(
                "DELETE FROM exam_candidates WHERE task_id=? AND session_id=?",
                (task_id, session_id),
            )
            for candidate in candidates or []:
                permit = str(candidate.get("permit") or "").strip()
                if not permit:
                    continue
                custom_fields = candidate.get("custom_fields") or {}
                if not isinstance(custom_fields, dict):
                    custom_fields = {}
                db.execute(
                    """INSERT INTO exam_candidates
                    (id, task_id, session_id, permit, full_name, identity_id, course_code, mobile, email,
                     custom_fields_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        str(uuid.uuid4()), task_id, session_id, permit,
                        str(candidate.get("full_name") or ""), str(candidate.get("identity_id") or ""),
                        str(candidate.get("course_code") or ""), str(candidate.get("mobile") or ""),
                        str(candidate.get("email") or ""), json.dumps(custom_fields, ensure_ascii=False),
                        now, now,
                    ),
                )
                saved += 1
            db.execute("UPDATE exam_tasks SET updated_at=? WHERE task_id=?", (now, task_id))
        return {"savedCount": saved, "taskId": task_id, "sessionId": session_id}

    def create_candidate_change(self, payload):
        now = utc_now()
        change_set_id = str(payload.get("id") or uuid.uuid4())
        task_id = str(payload.get("taskId") or "")
        session_id = str(payload.get("sessionId") or "")
        items = payload.get("items") or []
        before_roster = payload.get("beforeRoster") or []
        with self.connect() as db:
            if not db.execute("SELECT task_id FROM exam_tasks WHERE task_id=?", (task_id,)).fetchone():
                raise ValueError("Task not found")
            db.execute(
                """INSERT INTO candidate_change_sets
                (id, task_id, session_id, source_type, reason, baseline_hash, proposed_hash, status,
                 created_by, summary_json, impact_json, error_text, created_at, updated_at, applied_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, NULL)""",
                (
                    change_set_id, task_id, session_id, str(payload.get("sourceType") or "full_list"),
                    str(payload.get("reason") or ""), str(payload.get("baselineHash") or ""),
                    str(payload.get("proposedHash") or ""), str(payload.get("status") or "waiting_review"),
                    str(payload.get("createdBy") or ""),
                    json.dumps(payload.get("summary") or {}, ensure_ascii=False),
                    json.dumps(payload.get("impact") or {}, ensure_ascii=False), now, now,
                ),
            )
            for index, item in enumerate(items):
                db.execute(
                    """INSERT INTO candidate_change_items
                    (id, change_set_id, sequence, operation, old_permit, permit, before_json, after_json,
                     changed_fields_json, risk_level, blocked, block_reason, status, error_text, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?, ?)""",
                    (
                        str(item.get("id") or uuid.uuid4()), change_set_id, index,
                        str(item.get("operation") or ""), str(item.get("old_permit") or ""),
                        str(item.get("permit") or ""), json.dumps(item.get("before"), ensure_ascii=False),
                        json.dumps(item.get("after"), ensure_ascii=False),
                        json.dumps(item.get("changed_fields") or [], ensure_ascii=False),
                        str(item.get("risk_level") or "low"), 1 if item.get("blocked") else 0,
                        str(item.get("block_reason") or ""), now, now,
                    ),
                )
            db.execute(
                """INSERT INTO candidate_roster_snapshots
                (id, change_set_id, phase, roster_hash, roster_json, created_at)
                VALUES (?, ?, 'before', ?, ?, ?)""",
                (
                    str(uuid.uuid4()), change_set_id, str(payload.get("baselineHash") or ""),
                    json.dumps(before_roster, ensure_ascii=False), now,
                ),
            )
        return self.get_candidate_change(change_set_id)

    def list_candidate_changes(self, task_id, session_id):
        with self.connect() as db:
            rows = db.execute(
                """SELECT * FROM candidate_change_sets
                WHERE task_id=? AND session_id=? ORDER BY created_at DESC""",
                (task_id, str(session_id or "")),
            ).fetchall()
        return [self._candidate_change_set(row) for row in rows]

    def get_candidate_change(self, change_set_id):
        with self.connect() as db:
            row = db.execute("SELECT * FROM candidate_change_sets WHERE id=?", (change_set_id,)).fetchone()
            if not row:
                return None
            items = db.execute(
                "SELECT * FROM candidate_change_items WHERE change_set_id=? ORDER BY sequence",
                (change_set_id,),
            ).fetchall()
            snapshots = db.execute(
                "SELECT * FROM candidate_roster_snapshots WHERE change_set_id=? ORDER BY created_at",
                (change_set_id,),
            ).fetchall()
        result = self._candidate_change_set(row)
        result["items"] = [self._candidate_change_item(item) for item in items]
        result["snapshots"] = [self._candidate_roster_snapshot(snapshot) for snapshot in snapshots]
        return result

    def update_candidate_change(self, change_set_id, status, item_results=None, error_text="", after_roster=None, after_hash=""):
        now = utc_now()
        terminal = status in {"applied", "partial_failed"}
        with self.connect() as db:
            current = db.execute("SELECT id FROM candidate_change_sets WHERE id=?", (change_set_id,)).fetchone()
            if not current:
                raise ValueError("Candidate change not found")
            db.execute(
                """UPDATE candidate_change_sets
                SET status=?, error_text=?, updated_at=?, applied_at=CASE WHEN ? THEN ? ELSE applied_at END
                WHERE id=?""",
                (str(status or ""), str(error_text or ""), now, 1 if terminal else 0, now, change_set_id),
            )
            for item in item_results or []:
                db.execute(
                    """UPDATE candidate_change_items SET status=?, error_text=?, updated_at=?
                    WHERE id=? AND change_set_id=?""",
                    (
                        str(item.get("status") or "pending"), str(item.get("error") or ""), now,
                        str(item.get("id") or ""), change_set_id,
                    ),
                )
            if after_roster is not None:
                db.execute(
                    """INSERT INTO candidate_roster_snapshots
                    (id, change_set_id, phase, roster_hash, roster_json, created_at)
                    VALUES (?, ?, 'after', ?, ?, ?)""",
                    (
                        str(uuid.uuid4()), change_set_id, str(after_hash or ""),
                        json.dumps(after_roster or [], ensure_ascii=False), now,
                    ),
                )
        return self.get_candidate_change(change_set_id)

    def update_step(self, task_id, step_key, status, result=None, requirement_index=None):
        if status not in VALID_STATUSES:
            raise ValueError("Invalid step status: %s" % status)
        if step_key not in {key for key, _ in STEP_DEFS}:
            raise ValueError("Unknown step key: %s" % step_key)
        result = result or {}
        now = utc_now()
        with self.connect() as db:
            current = db.execute(
                "SELECT * FROM exam_task_steps WHERE task_id=? AND step_key=?",
                (task_id, step_key),
            ).fetchone()
            if not current:
                raise ValueError("Task step not found")

            task_row = db.execute("SELECT config_json FROM exam_tasks WHERE task_id=?", (task_id,)).fetchone()
            if not task_row:
                raise ValueError("Task not found")
            task_config = loads(task_row["config_json"], {})

            requirement_progress = loads(current["requirement_progress_json"], {})
            normalized_requirement_index = None
            if requirement_index is not None:
                try:
                    normalized_requirement_index = max(int(requirement_index), 0)
                except (TypeError, ValueError):
                    normalized_requirement_index = 0
                if normalized_requirement_index >= requirement_count_from_config(task_config):
                    raise ValueError("Requirement index out of range")

            sub_status = result.get("subStatus") or loads(current["sub_status_json"], {})
            if normalized_requirement_index is not None:
                requirement_key = str(normalized_requirement_index)
                current_requirement = requirement_progress.get(requirement_key) or {}
                requirement_sub_status = result.get("subStatus") or current_requirement.get("subStatus") or {}
                requirement_status = status_from_sub_status(step_key, status, requirement_sub_status)
                requirement_started_at = current_requirement.get("startedAt") or (now if requirement_status != "pending" else None)
                requirement_completed_at = now if requirement_status in {"success", "failed", "skipped"} else None
                requirement_duration_ms = None
                if requirement_started_at and requirement_completed_at:
                    start_dt = datetime.fromisoformat(requirement_started_at.replace("Z", "+00:00"))
                    end_dt = datetime.fromisoformat(requirement_completed_at.replace("Z", "+00:00"))
                    requirement_duration_ms = max(0, int((end_dt - start_dt).total_seconds() * 1000))
                requirement_logs = list(current_requirement.get("logs") or [])
                message = str(result.get("message") or "").strip()
                if message:
                    requirement_logs.append({"time": now, "message": message})
                requirement_progress[requirement_key] = {
                    "status": requirement_status,
                    "startedAt": requirement_started_at,
                    "completedAt": requirement_completed_at,
                    "durationMs": requirement_duration_ms,
                    "errorMessage": str(result.get("errorMessage") or "") or None,
                    "result": result.get("result") or {},
                    "subStatus": requirement_sub_status,
                    "logs": requirement_logs,
                }
                requirements = task_config.get("examRequirements")
                expected_count = len(requirements) if isinstance(requirements, list) and requirements else normalized_requirement_index + 1
                expected_count = max(expected_count, normalized_requirement_index + 1, 1)
                requirement_statuses = [
                    (requirement_progress.get(str(index)) or {}).get("status", "pending")
                    for index in range(expected_count)
                ]
                status = aggregate_requirement_status(requirement_statuses)
                started_values = [item.get("startedAt") for item in requirement_progress.values() if item.get("startedAt")]
                completed_values = [item.get("completedAt") for item in requirement_progress.values() if item.get("completedAt")]
                started_at = min(started_values) if started_values else None
                completed_at = max(completed_values) if completed_values and status in {"success", "failed", "skipped"} else None
                sub_status = requirement_sub_status
            else:
                status = status_from_sub_status(step_key, status, sub_status)
                started_at = current["started_at"] or (now if status != "pending" else None)
                completed_at = now if status in {"success", "failed", "skipped"} else None
            duration_ms = None
            if started_at and completed_at:
                start_dt = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                end_dt = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
                duration_ms = max(0, int((end_dt - start_dt).total_seconds() * 1000))
            logs = loads(current["logs_json"], [])
            message = str(result.get("message") or "").strip()
            if message:
                logs.append({"time": now, "message": message})
            retry_count = current["retry_count"] + (1 if result.get("incrementRetry") else 0)
            db.execute(
                """UPDATE exam_task_steps SET status=?, started_at=?, completed_at=?, duration_ms=?,
                error_message=?, retry_count=?, result_json=?, sub_status_json=?, logs_json=?, requirement_progress_json=?
                WHERE task_id=? AND step_key=?""",
                (
                    status, started_at, completed_at, duration_ms,
                    str(result.get("errorMessage") or "") or None, retry_count,
                    json.dumps(result.get("result") or {}, ensure_ascii=False),
                    json.dumps(sub_status, ensure_ascii=False), json.dumps(logs, ensure_ascii=False),
                    json.dumps(requirement_progress, ensure_ascii=False),
                    task_id, step_key,
                ),
            )
            self._refresh_task(db, task_id)
        return self.get_task(task_id)

    def _refresh_task(self, db, task_id):
        rows = db.execute(
            "SELECT step_key, step_name, status FROM exam_task_steps WHERE task_id=?", (task_id,)
        ).fetchall()
        rows = sorted(rows, key=lambda row: STEP_ORDER.get(row["step_key"], len(STEP_ORDER)))
        core_rows = [row for row in rows if row["step_key"] in CORE_PROGRESS_STEPS and row["status"] != "skipped"]
        core_completed = sum(1 for row in core_rows if row["status"] == "success")
        progress = round((core_completed / len(core_rows) * 100) if core_rows else 100, 1)
        if any(row["status"] == "failed" for row in core_rows):
            status = "failed"
        elif core_rows and core_completed == len(core_rows):
            status = "success"
        elif any(row["status"] == "running" for row in core_rows):
            status = "running"
        elif any(row["status"] == "waiting_manual" for row in core_rows):
            status = "waiting_manual"
        else:
            status = "pending"
        active = next(
            (
                DISPLAY_STAGE_NAMES.get(row["step_key"], row["step_name"])
                for row in core_rows
                if row["status"] in {"running", "waiting_manual", "failed"}
            ),
            "",
        )
        if not active and status != "success":
            active = next(
                (
                    DISPLAY_STAGE_NAMES.get(row["step_key"], row["step_name"])
                    for row in core_rows
                    if row["status"] == "pending"
                ),
                "",
            )
        db.execute(
            "UPDATE exam_tasks SET status=?, current_stage=?, progress=?, updated_at=? WHERE task_id=?",
            (status, active or ("已完成" if status == "success" else "等待执行"), progress, utc_now(), task_id),
        )

    def list_tasks(self, include_hidden=False):
        with self.connect() as db:
            if include_hidden:
                rows = db.execute("SELECT * FROM exam_tasks ORDER BY updated_at DESC").fetchall()
            else:
                rows = db.execute("SELECT * FROM exam_tasks WHERE hidden_at IS NULL ORDER BY updated_at DESC").fetchall()
        return [self._task_summary(row) for row in rows]

    def list_sessions(self, now=None):
        with self.connect() as db:
            rows = db.execute(
                """SELECT s.*, t.project_name, t.source_account, t.owner_email,
                          t.progress AS task_progress,
                          t.config_json
                FROM exam_sessions s JOIN exam_tasks t ON t.task_id=s.task_id
                ORDER BY s.updated_at DESC"""
            ).fetchall()
            step_rows = db.execute(
                """SELECT task_id, step_key, status, requirement_progress_json
                FROM exam_task_steps WHERE step_key IN (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ORDER BY task_id, step_key""",
                EXAM_LIST_STEP_KEYS,
            ).fetchall()
            saved_snapshots = {
                row["task_id"]: loads(row["snapshot_json"], None)
                for row in db.execute("SELECT task_id, snapshot_json FROM exam_list_status_snapshots")
            }
            steps_by_task = {}
            for row in step_rows:
                summary = exam_list_step_summary(row)
                steps_by_task.setdefault(row["task_id"], []).append(summary)
            sessions = [self._session(row) for row in rows]
            sessions_by_task = {}
            for session in sessions:
                sessions_by_task.setdefault(session["taskId"], []).append(session)
            comparison_time = (now or datetime.now().astimezone()).timestamp()
            for task_id, task_sessions in sessions_by_task.items():
                compact_sessions = [{
                    **session,
                    "config": exam_list_config_summary(session["config"]),
                    "steps": steps_by_task.get(task_id, []),
                } for session in task_sessions]
                snapshot = exam_list_status_snapshot(compact_sessions)
                saved = saved_snapshots.get(task_id)
                if exam_list_task_ended(task_sessions, comparison_time):
                    if isinstance(saved, dict) and isinstance(saved.get("sessions"), list) and isinstance(saved.get("steps"), list):
                        snapshot = saved
                    else:
                        db.execute(
                            "INSERT OR IGNORE INTO exam_list_status_snapshots VALUES (?, ?, ?)",
                            (task_id, json.dumps(snapshot, ensure_ascii=False), utc_now()),
                        )
                    for session in task_sessions:
                        session["statusSnapshot"] = snapshot
                elif saved != snapshot:
                    db.execute(
                        """INSERT INTO exam_list_status_snapshots VALUES (?, ?, ?)
                        ON CONFLICT(task_id) DO UPDATE SET
                        snapshot_json=excluded.snapshot_json, captured_at=excluded.captured_at""",
                        (task_id, json.dumps(snapshot, ensure_ascii=False), utc_now()),
                    )
        return [
            {**session, "config": exam_list_response_config_summary(session["config"])}
            for session in sessions
        ]

    def list_sessions_full(self):
        with self.connect() as db:
            rows = db.execute(
                """SELECT s.*, t.project_name, t.source_account, t.owner_email, t.progress AS task_progress,
                          t.config_json
                FROM exam_sessions s JOIN exam_tasks t ON t.task_id=s.task_id
                ORDER BY s.updated_at DESC"""
            ).fetchall()
        return [self._session(row) for row in rows]

    def get_task(self, task_id):
        with self.connect() as db:
            task = db.execute("SELECT * FROM exam_tasks WHERE task_id=?", (task_id,)).fetchone()
            if not task:
                return None
            self._ensure_steps(db, task_id)
            sessions = db.execute(
                "SELECT * FROM exam_sessions WHERE task_id=? ORDER BY requirement_index, session_type",
                (task_id,),
            ).fetchall()
            steps = db.execute("SELECT * FROM exam_task_steps WHERE task_id=?", (task_id,)).fetchall()
            steps = [row for row in steps if row["step_key"] in STEP_ORDER]
            steps = sorted(steps, key=lambda row: STEP_ORDER.get(row["step_key"], len(STEP_ORDER)))
        result = self._task_summary(task)
        result["config"] = loads(task["config_json"], {})
        result["sessions"] = [self._session(row) for row in sessions]
        result["steps"] = [self._step(row) for row in steps]
        result["customFields"] = self.list_custom_fields(task_id)
        return result

    def get_tasks(self, task_ids):
        details = []
        seen = set()
        for task_id in task_ids or []:
            normalized = str(task_id or "").strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            task = self.get_task(normalized)
            if task:
                details.append(task)
        return details

    def _task_summary(self, row):
        config = loads(row["config_json"], {})
        project_card = config.get("projectCard") if isinstance(config.get("projectCard"), dict) else {}
        operation_workflow_archive_snapshot = (
            config.get("operationWorkflowArchiveSnapshot")
            if isinstance(config.get("operationWorkflowArchiveSnapshot"), dict)
            else {}
        )
        requirements = config.get("examRequirements")
        if not isinstance(requirements, list) or not requirements:
            legacy_requirement = config.get("examRequirement")
            requirements = [legacy_requirement] if isinstance(legacy_requirement, dict) else []
        psychological_requirement_indexes = []
        for index, requirement in enumerate(requirements):
            if not isinstance(requirement, dict):
                continue
            config_selection = requirement.get("configSelection")
            values = config_selection.get("values") if isinstance(config_selection, dict) else None
            if (
                isinstance(values, dict)
                and values.get("requirementTemplate") == "psychological_assessment"
            ):
                psychological_requirement_indexes.append(index)
        if not psychological_requirement_indexes and len(requirements) == 1:
            fanwei_source = config.get("fanweiSource")
            raw = fanwei_source.get("raw") if isinstance(fanwei_source, dict) else None
            raw_fields = raw.get("fields") if isinstance(raw, dict) else None
            if (
                isinstance(raw_fields, dict)
                and raw_fields.get("考核内容是否仅性格测试") == "是"
            ):
                psychological_requirement_indexes.append(0)
        exam_name_candidates = [config.get("examName")]
        for requirement in requirements:
            fields = requirement.get("fields") if isinstance(requirement.get("fields"), dict) else {}
            requirement_config = requirement.get("config") if isinstance(requirement.get("config"), dict) else {}
            exam_name_candidates.extend([fields.get("考试名称"), requirement_config.get("examName")])
        exam_name = next((str(value).strip() for value in exam_name_candidates if str(value or "").strip()), "")
        return {
            "taskId": row["task_id"], "projectName": row["project_name"],
            "examName": exam_name,
            "sourceAccount": row["source_account"], "status": row["status"],
            "ownerEmail": row["owner_email"],
            "hiddenAt": row["hidden_at"] if "hidden_at" in row.keys() else None,
            "customerName": str(config.get("customerName") or ""),
            "projectCode": str(config.get("projectCode") or ""),
            "psychologicalRequirementIndexes": psychological_requirement_indexes,
            "operationArchiveActuals": operation_archive_actuals_summary(config),
            "projectCard": {
                "createdAt": str(project_card.get("createdAt") or ""),
                "updatedAt": str(project_card.get("updatedAt") or ""),
                "status": str(project_card.get("status") or ""),
                "sourceType": str(project_card.get("sourceType") or ""),
                "sourceKey": str(project_card.get("sourceKey") or ""),
            } if project_card else {},
            "operationWorkflowArchiveSnapshot": operation_workflow_archive_snapshot,
            "currentStage": row["current_stage"], "progress": row["progress"],
            "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        }

    def _session(self, row):
        data = row_dict(row)
        config = loads(data.get("config_json"), {})
        return {
            "taskId": data["task_id"], "sessionType": data["session_type"],
            "requirementIndex": int(data.get("requirement_index") or 0),
            "session_id": data["session_id"], "name": data["name"],
            "start": data["start_time"], "end": data["end_time"],
            "candidateCount": data["candidate_count"], "roomCount": data["room_count"],
            "status": data["status"], "url": data["url"],
            "projectName": data.get("project_name", ""),
            "sourceAccount": data.get("source_account", ""),
            "ownerEmail": data.get("owner_email", ""),
            "progress": data.get("task_progress", 0),
            "config": config,
        }

    def _step(self, row):
        return {
            "stepKey": row["step_key"], "stepName": row["step_name"], "status": row["status"],
            "startedAt": row["started_at"], "completedAt": row["completed_at"],
            "durationMs": row["duration_ms"], "errorMessage": row["error_message"],
            "retryCount": row["retry_count"], "result": loads(row["result_json"], {}),
            "subStatus": loads(row["sub_status_json"], {}), "logs": loads(row["logs_json"], []),
            "requirementProgress": loads(row["requirement_progress_json"], {}),
        }

    def _candidate(self, row):
        return {
            "id": row["id"], "taskId": row["task_id"], "session_id": row["session_id"],
            "permit": row["permit"], "full_name": row["full_name"], "identity_id": row["identity_id"],
            "course_code": row["course_code"], "mobile": row["mobile"], "email": row["email"],
            "custom_fields": loads(row["custom_fields_json"], {}),
            "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        }

    def _custom_field(self, row):
        return {
            "id": row["id"],
            "taskId": row["task_id"],
            "session_id": row["session_id"],
            "field_name": row["field_name"],
            "field_code": row["field_code"],
            "yikao_field_id": row["yikao_field_id"],
            "source_column": row["source_column"],
            "field_type": row["field_type"],
            "required": bool(row["required"]),
            "order_index": row["order_index"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    def _candidate_change_set(self, row):
        return {
            "id": row["id"], "taskId": row["task_id"], "sessionId": row["session_id"],
            "sourceType": row["source_type"], "reason": row["reason"],
            "baselineHash": row["baseline_hash"], "proposedHash": row["proposed_hash"],
            "status": row["status"], "createdBy": row["created_by"],
            "summary": loads(row["summary_json"], {}), "impact": loads(row["impact_json"], {}),
            "error": row["error_text"], "createdAt": row["created_at"],
            "updatedAt": row["updated_at"], "appliedAt": row["applied_at"],
        }

    def _candidate_change_item(self, row):
        return {
            "id": row["id"], "changeSetId": row["change_set_id"], "sequence": row["sequence"],
            "operation": row["operation"], "old_permit": row["old_permit"], "permit": row["permit"],
            "before": loads(row["before_json"], None), "after": loads(row["after_json"], None),
            "changed_fields": loads(row["changed_fields_json"], []), "risk_level": row["risk_level"],
            "blocked": bool(row["blocked"]), "block_reason": row["block_reason"],
            "status": row["status"], "error": row["error_text"],
            "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        }

    def _candidate_roster_snapshot(self, row):
        return {
            "id": row["id"], "changeSetId": row["change_set_id"], "phase": row["phase"],
            "rosterHash": row["roster_hash"], "roster": loads(row["roster_json"], []),
            "createdAt": row["created_at"],
        }


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: task_state_db.py DB_PATH ACTION")
    store = TaskStore(sys.argv[1])
    action = sys.argv[2]
    payload = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    if action == "create":
        result = store.create_task(payload.get("projectName"), payload.get("sourceAccount", ""), payload.get("config", {}), payload.get("taskId"), payload.get("ownerEmail", ""))
    elif action == "list":
        result = store.list_tasks(bool(payload.get("includeHidden")))
    elif action == "list_all":
        result = store.list_tasks(True)
    elif action == "list_sessions":
        result = store.list_sessions()
    elif action == "list_sessions_full":
        result = store.list_sessions_full()
    elif action == "get":
        result = store.get_task(payload.get("taskId"))
    elif action == "get_many":
        result = store.get_tasks(payload.get("taskIds") or [])
    elif action == "update_step":
        result = store.update_step(
            payload.get("taskId"), payload.get("stepKey"), payload.get("status"), payload.get("result"),
            payload.get("requirementIndex"),
        )
    elif action == "update_config":
        result = store.update_config(
            payload.get("taskId"), payload.get("config") or {}, payload.get("projectName"),
            payload.get("sourceAccount") if "sourceAccount" in payload else None,
        )
    elif action == "hide":
        result = {"hidden": store.hide_task(payload.get("taskId"))}
    elif action == "delete":
        result = {"deleted": store.delete_task(payload.get("taskId"))}
    elif action == "delete_requirement":
        result = store.delete_requirement(payload.get("taskId"), payload.get("requirementIndex"))
    elif action == "upsert_session":
        result = store.upsert_session(
            payload.get("taskId"), payload.get("sessionType"), payload.get("session") or {},
            payload.get("requirementIndex", 0),
        )
    elif action == "sync_session":
        result = store.sync_session(
            payload.get("taskId"), payload.get("sessionType"), payload.get("session") or {},
            payload.get("config") or {}, payload.get("requirementIndex", 0),
        )
    elif action == "upsert_candidates":
        result = store.upsert_candidates(payload.get("taskId"), payload.get("sessionId"), payload.get("candidates") or [])
    elif action == "list_candidates":
        result = store.list_candidates(payload.get("taskId"), payload.get("sessionId"))
    elif action == "replace_candidates":
        result = store.replace_candidates(payload.get("taskId"), payload.get("sessionId"), payload.get("candidates") or [])
    elif action == "create_candidate_change":
        result = store.create_candidate_change(payload)
    elif action == "list_candidate_changes":
        result = store.list_candidate_changes(payload.get("taskId"), payload.get("sessionId"))
    elif action == "get_candidate_change":
        result = store.get_candidate_change(payload.get("changeSetId"))
    elif action == "update_candidate_change":
        result = store.update_candidate_change(
            payload.get("changeSetId"), payload.get("status"), payload.get("itemResults") or [],
            payload.get("error") or "", payload.get("afterRoster") if "afterRoster" in payload else None,
            payload.get("afterHash") or "",
        )
    elif action == "upsert_custom_fields":
        result = store.upsert_custom_fields(payload.get("taskId"), payload.get("sessionId"), payload.get("fields") or [])
    elif action == "list_custom_fields":
        result = store.list_custom_fields(payload.get("taskId"), payload.get("sessionId"))
    else:
        raise SystemExit("unknown action: %s" % action)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
