import assert from "node:assert/strict";
import test from "node:test";

import { clearCandidateChangeRooms } from "./candidate_change_room_cleanup.mjs";

test("clears every room with the tenant room-list replacement API and verifies readback", async () => {
  const calls = [];
  const payloads = [
    { rooms: [{ id: "R1" }, { id: "R2" }] },
    { ok: true },
    { rooms: [] },
  ];
  const result = await clearCandidateChangeRooms({
    login: {},
    apiBase: "https://eztest.cn/",
    sessionId: "S 01",
    requestJson: async (_login, url, options, action) => {
      calls.push({ url, options, action });
      return payloads.shift();
    },
  });

  assert.deepEqual(result, { status: "cleared", removedCount: 2 });
  assert.deepEqual(calls.map((call) => call.options.method), ["GET", "PUT", "GET"]);
  assert.equal(calls[1].url, "https://eztest.cn/tenant/api/session/S%2001/rooms/");
  assert.deepEqual(JSON.parse(calls[1].options.body), { room_ids: [] });
});

test("stops when room readback is not empty", async () => {
  const payloads = [
    { data: [{ id: "R1" }] },
    { ok: true },
    { data: [{ id: "R1" }] },
  ];
  await assert.rejects(
    clearCandidateChangeRooms({
      apiBase: "https://eztest.cn",
      sessionId: "S1",
      requestJson: async () => payloads.shift(),
    }),
    /仍有 1 个班级/,
  );
});

test("does not write when the session already has no rooms", async () => {
  const calls = [];
  const result = await clearCandidateChangeRooms({
    apiBase: "https://eztest.cn",
    sessionId: "S1",
    requestJson: async (_login, _url, options) => {
      calls.push(options.method);
      return { rooms: [] };
    },
  });

  assert.deepEqual(result, { status: "already_empty", removedCount: 0 });
  assert.deepEqual(calls, ["GET"]);
});
