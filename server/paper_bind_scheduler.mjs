function parseTimeMs(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function millisecondsUntilNextHour(now = new Date()) {
  const current = new Date(now);
  if (!Number.isFinite(current.getTime())) return 60 * 60 * 1000;
  const nextHour = new Date(current);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);
  return Math.max(1, nextHour.getTime() - current.getTime());
}

function latestPaperBindCheckTimeMs(state = {}) {
  const times = [
    parseTimeMs(state.completedAt),
    parseTimeMs(state.startedAt),
    ...(Array.isArray(state.logs) ? state.logs.map((log) => parseTimeMs(log?.time)) : []),
  ];
  return Math.max(0, ...times);
}

function shouldSkipFailedPaperBindCheckInCurrentHour(state = {}, now = new Date()) {
  if (state.status !== "failed") return false;
  const lastCheckTime = latestPaperBindCheckTimeMs(state);
  if (!lastCheckTime) return false;
  const currentHour = new Date(now);
  if (!Number.isFinite(currentHour.getTime())) return false;
  currentHour.setMinutes(0, 0, 0);
  return lastCheckTime >= currentHour.getTime() && lastCheckTime <= new Date(now).getTime();
}

export {
  latestPaperBindCheckTimeMs,
  millisecondsUntilNextHour,
  shouldSkipFailedPaperBindCheckInCurrentHour,
};
