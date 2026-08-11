function millisecondsUntilNextHour(now = new Date()) {
  const current = new Date(now);
  if (!Number.isFinite(current.getTime())) return 60 * 60 * 1000;
  const nextHour = new Date(current);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);
  return Math.max(1, nextHour.getTime() - current.getTime());
}

export {
  millisecondsUntilNextHour,
};
