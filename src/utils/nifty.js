export const DAY_MS = 24 * 60 * 60 * 1000;

// Nifty rows are ["YYYY-MM-DD", close]. Work in UTC so dates never shift.
export const isoToTime = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
};

export const navDateToTime = (date) => {
  const [day, month, year] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
};

export const formatLevel = (level) =>
  Number(level).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export const formatDay = (time) =>
  new Date(time).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export const formatShortDay = (time) =>
  new Date(time).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });

/**
 * Find the most recent window in the Nifty series where the index climbed from
 * `fromLevel` (or below) to `toLevel` (or above).
 */
export const resolveNiftyWindow = (rows, fromLevel, toLevel) => {
  if (!rows || rows.length === 0) {
    return { status: "loading" };
  }

  const from = Number(fromLevel);
  const to = Number(toLevel);

  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) {
    return { status: "invalid", message: "Enter valid Nifty 50 levels above 0." };
  }

  if (from >= to) {
    return { status: "invalid", message: "The starting level must be lower than the ending level." };
  }

  // For each day, the nearest later day whose close is at or above `to`.
  const nextAtOrAbove = new Array(rows.length).fill(-1);
  let nextIndex = -1;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    nextAtOrAbove[i] = nextIndex;
    if (rows[i][1] >= to) nextIndex = i;
  }

  const maxClose = rows.reduce((max, row) => Math.max(max, row[1]), -Infinity);
  if (maxClose < to) {
    return {
      status: "nomatch",
      message: `Nifty 50 has not closed at or above ${formatLevel(to)} in the loaded history.`,
    };
  }

  // Walk backwards and take the most recent dip to/below `from` that was
  // followed by a close at/above `to`.
  let startIdx = -1;
  let endIdx = -1;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i][1] <= from && nextAtOrAbove[i] !== -1) {
      startIdx = i;
      endIdx = nextAtOrAbove[i];
      break;
    }
  }

  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
    return {
      status: "nomatch",
      message: `Nifty 50 did not close at or below ${formatLevel(from)} before reaching ${formatLevel(to)}.`,
    };
  }

  const startTime = isoToTime(rows[startIdx][0]);
  const endTime = isoToTime(rows[endIdx][0]);
  const startLevel = rows[startIdx][1];
  const endLevel = rows[endIdx][1];

  return {
    status: "ready",
    startDate: rows[startIdx][0],
    endDate: rows[endIdx][0],
    startTime,
    endTime,
    startLevel,
    endLevel,
    niftyReturn: (endLevel / startLevel - 1) * 100,
    tradingDays: endIdx - startIdx + 1,
    rows: rows.slice(startIdx, endIdx + 1),
  };
};

// Last NAV entry on or before `time` for a sorted [[time, nav], ...] array.
export const findNavOnOrBefore = (navs, time) => {
  let low = 0;
  let high = navs.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (navs[mid][0] <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found === -1 ? null : navs[found];
};

export const computeFundReturn = (navs, startTime, endTime) => {
  if (!navs || navs.length === 0) return null;

  const start = findNavOnOrBefore(navs, startTime) || navs[0];
  const end = findNavOnOrBefore(navs, endTime);

  if (!end || end[0] <= start[0]) return null;

  return {
    startTime: start[0],
    startNav: start[1],
    endTime: end[0],
    endNav: end[1],
    ret: (end[1] / start[1] - 1) * 100,
    staleDays: Math.round((endTime - end[0]) / DAY_MS),
  };
};
