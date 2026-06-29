export function incrementClock(clock, deviceId) {
  const updated = { ...clock };
  updated[deviceId] = (updated[deviceId] || 0) + 1;
  return updated;
}

export function mergeClock(clockA, clockB) {
  if (!clockA || Object.keys(clockA).length === 0) return { ...(clockB || {}) };
  if (!clockB || Object.keys(clockB).length === 0) return { ...(clockA || {}) };

  const merged = { ...clockA };
  for (const [device, count] of Object.entries(clockB)) {
    merged[device] = Math.max(merged[device] || 0, count);
  }
  return merged;
}

export function happenedBefore(clockA, clockB) {
  if (!clockA || Object.keys(clockA).length === 0) return false;
  if (!clockB || Object.keys(clockB).length === 0) return false;

  const devices = new Set([...Object.keys(clockA), ...Object.keys(clockB)]);
  let strictlyLess = false;

  for (const d of devices) {
    const a = clockA[d] || 0;
    const b = clockB[d] || 0;
    if (a > b) return false;
    if (a < b) strictlyLess = true;
  }
  return strictlyLess;
}

export function areConcurrent(clockA, clockB) {
  if (!clockA || !clockB) return false;
  return !happenedBefore(clockA, clockB) && !happenedBefore(clockB, clockA);
}

export function isIdentical(clockA, clockB) {
  if (!clockA && !clockB) return true;
  if (!clockA || !clockB) return false;

  const devices = new Set([...Object.keys(clockA), ...Object.keys(clockB)]);
  for (const d of devices) {
    if ((clockA[d] || 0) !== (clockB[d] || 0)) return false;
  }
  return true;
}

export function clockToString(clock) {
  if (!clock || Object.keys(clock).length === 0) return "{}";
  const parts = Object.entries(clock)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([device, count]) => `${device.slice(0, 8)}:${count}`);
  return `{${parts.join(", ")}}`;
}
