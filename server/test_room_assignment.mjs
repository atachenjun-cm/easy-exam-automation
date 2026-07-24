import assert from "node:assert/strict";
import test from "node:test";

import { calculateRoomSizes } from "./room_assignment.mjs";

test("room size calculation balances every room near the target and prefers fewer rooms on ties", () => {
  assert.deepEqual(calculateRoomSizes(30, 30), [30]);
  assert.deepEqual(calculateRoomSizes(31, 30), [31]);
  assert.deepEqual(calculateRoomSizes(32, 30), [32]);
  assert.deepEqual(calculateRoomSizes(33, 30), [33]);
  assert.deepEqual(calculateRoomSizes(40, 30), [40]);
  assert.deepEqual(calculateRoomSizes(59, 30), [30, 29]);
  assert.deepEqual(calculateRoomSizes(60, 30), [30, 30]);
  assert.deepEqual(calculateRoomSizes(61, 30), [31, 30]);
  assert.deepEqual(calculateRoomSizes(89, 30), [30, 30, 29]);
  assert.deepEqual(calculateRoomSizes(90, 30), [30, 30, 30]);
  assert.deepEqual(calculateRoomSizes(91, 30), [31, 30, 30]);
  assert.deepEqual(calculateRoomSizes(278, 50), [47, 47, 46, 46, 46, 46]);
});
