function text(value) {
  return String(value ?? "").trim();
}

function managerBase(login = {}) {
  const candidate = text(login.url || login.apiBase || "https://eztest.org");
  try {
    const url = new URL(candidate);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "https://eztest.org";
  }
}

function cookieHeaderFromResponse(response) {
  const raw = response?.headers?.get?.("set-cookie") || response?.headers?.get?.("Set-Cookie") || "";
  return String(raw)
    .split(/,(?=[^;,]+=)/)
    .map((item) => item.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function readJsonResponse(response, action) {
  const body = await response.text();
  let payload = null;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch {
    payload = body;
  }
  if (!response.ok) {
    const error = new Error(`${action}失败：HTTP ${response.status}`);
    error.status = response.status;
    error.detail = payload;
    throw error;
  }
  return payload;
}

async function loginToManager(login, fetchImpl) {
  const username = text(login?.username);
  const password = String(login?.password || "");
  if (!username || !password) throw new Error("缺少易考后台账号或密码，无法为新增考生分班。");
  const payload = username.includes("@")
    ? { email: username, password, remember: false, code: "" }
    : { phone: username, password, remember: false, code: "" };
  const response = await fetchImpl(`${managerBase(login)}/dapi/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await readJsonResponse(response, "登录易考后台进行增量分班");
  const cookie = cookieHeaderFromResponse(response);
  if (!cookie) throw new Error("登录易考后台进行增量分班失败：未返回登录 Cookie。");
  return cookie;
}

function managerHeaders(base, cookie, sessionId, json = false) {
  return {
    Accept: "application/json, text/plain, */*",
    Cookie: cookie,
    Origin: base,
    Referer: `${base}/manager/schedule/session/${encodeURIComponent(sessionId)}/roomlist/`,
    "X-Requested-With": "XMLHttpRequest",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function firstList(payload, keys = []) {
  for (const key of keys) {
    const value = key.split(".").reduce((result, part) => result?.[part], payload);
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function normalizeCandidateChangeRooms(payload = {}) {
  return firstList(payload, ["data.teachers_list", "teachers_list", "data.results", "results"])
    .map((item) => ({
      roomId: text(item?.room?.id || item?.room_id || item?.roomId),
      teacherId: text(item?.id || item?.teacher_id || item?.teacherId || item?.teacher?.id),
      roomName: text(item?.room?.name || item?.room_name || item?.roomName || item?.name),
      entriesCount: Math.max(0, Number(item?.entries_count ?? item?.entries_num ?? item?.entriesCount ?? item?.student_num ?? 0)),
    }))
    .filter((room) => room.roomId && room.teacherId);
}

export function planCandidateRoomAssignments(rooms = [], permits = []) {
  const candidates = [...new Set((Array.isArray(permits) ? permits : []).map(text).filter(Boolean))];
  const targets = normalizeCandidateChangeRooms({ teachers_list: rooms }).map((room) => ({ ...room }));
  if (!targets.length || !candidates.length) return [];
  const grouped = new Map();
  for (const permit of candidates) {
    targets.sort((left, right) => left.entriesCount - right.entriesCount || left.roomName.localeCompare(right.roomName, "zh-CN"));
    const target = targets[0];
    target.entriesCount += 1;
    const key = `${target.roomId}:${target.teacherId}`;
    if (!grouped.has(key)) grouped.set(key, { ...target, permits: [] });
    const assignment = grouped.get(key);
    assignment.entriesCount = target.entriesCount;
    assignment.permits.push(permit);
  }
  return [...grouped.values()];
}

function entryPermits(payload = {}, mode = "unassigned") {
  const keys = mode === "assigned"
    ? ["data.entry_data_list", "entry_data_list", "data.student_list", "student_list"]
    : ["data.student_list", "student_list", "data.entry_data_list", "entry_data_list"];
  return new Set(firstList(payload, keys).map((item) => text(item?.permit || item?.entry || item?.account)).filter(Boolean));
}

async function roomRequest({ base, cookie, sessionId, room, method = "GET", search = "", body, fetchImpl }) {
  const suffix = method === "POST" ? "student/add/" : "student/";
  const url = new URL(
    `/dapi/schedule/session/${encodeURIComponent(sessionId)}/room/${encodeURIComponent(room.roomId)}/teacher/${encodeURIComponent(room.teacherId)}/${suffix}`,
    base,
  );
  if (search) url.searchParams.set("search", search);
  url.searchParams.set("page", "1");
  url.searchParams.set("page_num", "50");
  const response = await fetchImpl(url, {
    method,
    headers: managerHeaders(base, cookie, sessionId, method === "POST"),
    ...(method === "POST" ? { body: JSON.stringify(body || {}) } : {}),
  });
  return await readJsonResponse(response, method === "POST" ? "追加考生到现有班级" : "校验考生班级");
}

async function unassignedRequest({ base, cookie, sessionId, room, permit, fetchImpl }) {
  const url = new URL(
    `/dapi/schedule/session/${encodeURIComponent(sessionId)}/room/${encodeURIComponent(room.roomId)}/teacher/${encodeURIComponent(room.teacherId)}/student/add/`,
    base,
  );
  url.searchParams.set("search", permit);
  url.searchParams.set("page", "1");
  url.searchParams.set("page_num", "20");
  const response = await fetchImpl(url, { headers: managerHeaders(base, cookie, sessionId) });
  return await readJsonResponse(response, "查询新增考生未分班状态");
}

export async function assignAddedCandidatesToExistingRooms({
  login = {},
  sessionId,
  permits = [],
  fetchImpl = fetch,
} = {}) {
  const requestedPermits = [...new Set((Array.isArray(permits) ? permits : []).map(text).filter(Boolean))];
  if (!requestedPermits.length) return { status: "not_needed", assignedCount: 0, assignments: [] };
  const base = managerBase(login);
  const cookie = await loginToManager(login, fetchImpl);
  const roomListUrl = new URL(`/dapi/schedule/session/${encodeURIComponent(sessionId)}/roomlist/`, base);
  roomListUrl.searchParams.set("page", "1");
  roomListUrl.searchParams.set("page_size", "1000");
  const roomListResponse = await fetchImpl(roomListUrl, { headers: managerHeaders(base, cookie, sessionId) });
  const roomListPayload = await readJsonResponse(roomListResponse, "读取现有班级");
  const rooms = normalizeCandidateChangeRooms(roomListPayload);
  if (!rooms.length) {
    return { status: "no_existing_rooms", assignedCount: 0, assignments: [], pendingPermits: requestedPermits };
  }

  const unassignedPermits = [];
  const alreadyAssignedPermits = [];
  for (const permit of requestedPermits) {
    let assigned = false;
    for (const room of rooms) {
      const payload = await roomRequest({ base, cookie, sessionId, room, search: permit, fetchImpl });
      if (entryPermits(payload, "assigned").has(permit)) {
        assigned = true;
        break;
      }
    }
    if (assigned) {
      alreadyAssignedPermits.push(permit);
      continue;
    }
    const payload = await unassignedRequest({ base, cookie, sessionId, room: rooms[0], permit, fetchImpl });
    if (entryPermits(payload).has(permit)) unassignedPermits.push(permit);
  }

  const assignments = planCandidateRoomAssignments(rooms, unassignedPermits);
  for (const assignment of assignments) {
    await roomRequest({
      base,
      cookie,
      sessionId,
      room: assignment,
      method: "POST",
      body: { permits: assignment.permits },
      fetchImpl,
    });
    for (const permit of assignment.permits) {
      const payload = await roomRequest({ base, cookie, sessionId, room: assignment, search: permit, fetchImpl });
      if (!entryPermits(payload, "assigned").has(permit)) {
        throw new Error(`新增考生 ${permit} 已导入，但易考班级回读未确认分班结果。`);
      }
    }
  }
  const assignedCount = assignments.reduce((sum, assignment) => sum + assignment.permits.length, 0);
  return {
    status: assignedCount ? "assigned" : "already_assigned",
    assignedCount,
    assignments,
    alreadyAssignedPermits,
    pendingPermits: requestedPermits.filter((permit) => (
      !alreadyAssignedPermits.includes(permit)
      && !assignments.some((assignment) => assignment.permits.includes(permit))
    )),
  };
}
