// Deterministic tools shared by the app and the MCP agent server.
//
// Every number an agent reports must come from here — the model only chooses
// tools and narrates the result. Keep these functions free of I/O so they can
// run in the browser, in Node, and in tests.

import { FUND_UNIVERSE } from "../data/funds.js";
import {
  DAY_MS,
  computeFundReturn,
  findNavOnOrBefore,
  isoToTime,
  navDateToTime,
  resolveNiftyWindow,
} from "../utils/nifty.js";

const timeToIso = (time) => new Date(time).toISOString().slice(0, 10);

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const average = (values) =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const round = (value, digits = 2) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : value;

const publicWindow = (window) => ({
  startDate: window.startDate,
  endDate: window.endDate,
  startLevel: window.startLevel,
  endLevel: window.endLevel,
  niftyReturn: round(window.niftyReturn),
  tradingDays: window.tradingDays,
});

const withoutTimes = (fund) => {
  const copy = { ...fund };
  delete copy.startTime;
  delete copy.endTime;
  return copy;
};

// Find non-overlapping windows where Nifty moved `movePct` (within tolerance)
// in at most `maxDays` sessions. Scanning stops for a start date once the move
// overshoots the target band, so a +30% run is not counted as a +10% window.
const findAnalogWindows = (rows, { movePct, tolerancePct, maxDays, direction }) => {
  const target = direction === "down" ? -Math.abs(movePct) : Math.abs(movePct);
  const tolerance = Math.abs(tolerancePct);
  const lower = target - tolerance;
  const upper = target + tolerance;
  const windows = [];
  let start = 0;

  while (start < rows.length - 1) {
    let found = null;

    for (let end = start + 1; end < Math.min(rows.length, start + maxDays + 1); end += 1) {
      const ret = (rows[end][1] / rows[start][1] - 1) * 100;
      if (ret >= lower && ret <= upper) {
        found = { startIdx: start, endIdx: end };
        break;
      }
      const overshot = target >= 0 ? ret > upper : ret < lower;
      if (overshot) break;
    }

    if (found) {
      windows.push(found);
      start = found.endIdx + 1;
    } else {
      start += 1;
    }
  }

  return windows;
};

export const createToolkit = ({
  niftyRows = [],
  funds = {},
  universe = FUND_UNIVERSE,
  meta = {},
} = {}) => {
  const navCache = new Map();

  const dataStatus = () => {
    const first = niftyRows[0];
    const last = niftyRows[niftyRows.length - 1];
    return {
      nifty: {
        rows: niftyRows.length,
        from: first ? first[0] : null,
        to: last ? last[0] : null,
        lastClose: last ? last[1] : null,
        source: meta.nifty?.source || null,
        fetchedAt: meta.nifty?.fetchedAt || null,
      },
      funds: {
        count: Object.keys(funds).length,
        universe: universe.length,
        source: meta.funds?.source || null,
        fetchedAt: meta.funds?.fetchedAt || null,
        coverage: meta.funds?.coverage || null,
      },
    };
  };

  const getFund = (code) => {
    const key = String(code);
    if (!navCache.has(key)) {
      const entry = funds[key];
      const navs = (entry?.navs || [])
        .map(([date, nav]) => [navDateToTime(date), Number(nav)])
        .filter(([time, nav]) => Number.isFinite(time) && Number.isFinite(nav))
        .sort((a, b) => a[0] - b[0]);
      navCache.set(key, { navs, schemeName: entry?.schemeName || null });
    }
    return navCache.get(key);
  };

  const resolveWindow = (from, to) => {
    const window = resolveNiftyWindow(niftyRows, from, to);
    return window.status === "ready"
      ? { status: "ready", ...publicWindow(window) }
      : { status: window.status, message: window.message };
  };

  // Returns the ranked list plus a summary. `window` is the resolved Nifty move.
  // Optional `category` and `limit` narrow the response for agent use.
  const rankFunds = ({ from, to, category = null, limit = null } = {}) => {
    const window = resolveNiftyWindow(niftyRows, from, to);
    if (window.status !== "ready") {
      return { status: window.status, message: window.message, funds: [], excluded: [] };
    }

    const fundsWithData = universe.map((fund) => {
      const { navs, schemeName } = getFund(fund.code);
      if (navs.length === 0) {
        return { ...fund, status: "missing", reason: "no NAV history in snapshot" };
      }
      const result = computeFundReturn(navs, window.startTime, window.endTime);
      if (!result) {
        return {
          ...fund,
          status: "nodata",
          reason: "no NAV on or before the window start, or no NAV before the window end",
        };
      }
      return {
        ...fund,
        status: "succeeded",
        schemeName,
        ...result,
        startDate: timeToIso(result.startTime),
        endDate: timeToIso(result.endTime),
        ret: round(result.ret),
        alpha: round(result.ret - window.niftyReturn),
        beatNifty: result.ret > window.niftyReturn,
      };
    });

    const ranked = fundsWithData
      .filter((fund) => fund.status === "succeeded")
      .filter((fund) => !category || fund.category === category)
      .sort((a, b) => b.ret - a.ret);
    const excluded = fundsWithData
      .filter((fund) => fund.status !== "succeeded")
      .filter((fund) => !category || fund.category === category)
      .map(({ code, name, category, status, reason }) => ({ code, name, category, status, reason }));
    const returned = Number.isInteger(limit) && limit > 0 ? ranked.slice(0, limit) : ranked;

    return {
      status: "ready",
      window: publicWindow(window),
      summary: {
        universe: universe.length,
        analysed: ranked.length,
        returned: returned.length,
        excluded: excluded.length,
        beatNifty: ranked.filter((fund) => fund.beatNifty).length,
        best: ranked[0]
          ? { code: ranked[0].code, name: ranked[0].name, ret: ranked[0].ret, alpha: ranked[0].alpha }
          : null,
        worst: ranked.length
          ? {
              code: ranked[ranked.length - 1].code,
              name: ranked[ranked.length - 1].name,
              ret: ranked[ranked.length - 1].ret,
              alpha: ranked[ranked.length - 1].alpha,
            }
          : null,
      },
      funds: returned.map(withoutTimes),
      excluded,
    };
  };

  const categoryStats = ({ from, to } = {}) => {
    const result = rankFunds({ from, to });
    if (result.status !== "ready") return { status: result.status, message: result.message };

    const groups = new Map();
    result.funds.forEach((fund) => {
      if (!groups.has(fund.category)) groups.set(fund.category, []);
      groups.get(fund.category).push(fund);
    });

    const categories = [...groups.entries()]
      .map(([category, funds]) => {
        const returns = funds.map((fund) => fund.ret);
        const alphas = funds.map((fund) => fund.alpha);
        return {
          category,
          count: funds.length,
          averageReturn: round(average(returns)),
          medianReturn: round(median(returns)),
          averageAlpha: round(average(alphas)),
          beatNifty: funds.filter((fund) => fund.beatNifty).length,
          best: funds.reduce((best, fund) => (fund.ret > best.ret ? fund : best), funds[0]).name,
          worst: funds.reduce((worst, fund) => (fund.ret < worst.ret ? fund : worst), funds[0]).name,
        };
      })
      .sort((a, b) => b.averageReturn - a.averageReturn);

    return {
      status: "ready",
      window: result.window,
      breadth: {
        analysed: result.summary.analysed,
        beatNifty: result.summary.beatNifty,
        beatNiftyPct:
          result.summary.analysed > 0
            ? round((result.summary.beatNifty / result.summary.analysed) * 100)
            : 0,
      },
      categories,
    };
  };

  // Rank funds across every historical window that looks like the requested move.
  // This separates skill (consistency across analogs) from one lucky window.
  const analogWindows = ({
    movePct = 10,
    tolerancePct = 2,
    maxDays = 15,
    direction = "up",
    category = null,
    minObservations = 2,
    limit = 20,
  } = {}) => {
    const windows = findAnalogWindows(niftyRows, { movePct, tolerancePct, maxDays, direction });
    if (windows.length === 0) {
      return {
        status: "nomatch",
        message: `No ${direction} moves of ${movePct}% ±${tolerancePct}% within ${maxDays} sessions in the loaded history.`,
        windows: [],
        funds: [],
      };
    }

    const pool = category ? universe.filter((fund) => fund.category === category) : universe;
    const stats = new Map();

    const resolved = windows.map(({ startIdx, endIdx }) => {
      const startTime = isoToTime(niftyRows[startIdx][0]);
      const endTime = isoToTime(niftyRows[endIdx][0]);
      const niftyReturn = (niftyRows[endIdx][1] / niftyRows[startIdx][1] - 1) * 100;

      pool.forEach((fund) => {
        const { navs, schemeName } = getFund(fund.code);
        const result = computeFundReturn(navs, startTime, endTime);
        if (!result) return;

        const alpha = result.ret - niftyReturn;
        const key = String(fund.code);
        if (!stats.has(key)) {
          stats.set(key, {
            code: fund.code,
            name: fund.name,
            category: fund.category,
            schemeName,
            observations: 0,
            beats: 0,
            returns: [],
            alphas: [],
          });
        }
        const entry = stats.get(key);
        entry.observations += 1;
        entry.beats += result.ret > niftyReturn ? 1 : 0;
        entry.returns.push(result.ret);
        entry.alphas.push(alpha);
      });

      return {
        startDate: niftyRows[startIdx][0],
        endDate: niftyRows[endIdx][0],
        tradingDays: endIdx - startIdx + 1,
        niftyReturn: round(niftyReturn),
      };
    });

    const funds = [...stats.values()]
      .filter((entry) => entry.observations >= minObservations)
      .map((entry) => ({
        code: entry.code,
        name: entry.name,
        category: entry.category,
        schemeName: entry.schemeName,
        observations: entry.observations,
        hitRate: round((entry.beats / entry.observations) * 100),
        medianAlpha: round(median(entry.alphas)),
        averageAlpha: round(average(entry.alphas)),
        bestAlpha: round(Math.max(...entry.alphas)),
        worstAlpha: round(Math.min(...entry.alphas)),
        medianReturn: round(median(entry.returns)),
        averageReturn: round(average(entry.returns)),
      }))
      .sort((a, b) => b.hitRate - a.hitRate || b.medianAlpha - a.medianAlpha)
      .slice(0, limit);

    return {
      status: "ready",
      parameters: { movePct, tolerancePct, maxDays, direction, category, minObservations },
      summary: {
        windows: resolved.length,
        firstWindow: resolved[0],
        lastWindow: resolved[resolved.length - 1],
        fundsRanked: funds.length,
      },
      windows: resolved,
      funds,
    };
  };

  // Recent Nifty context. Keeps the model from doing its own arithmetic when a
  // question is about "now" rather than a level-to-level window.
  const marketOverview = ({ lookbackDays = 365 } = {}) => {
    if (niftyRows.length < 2) {
      return { status: "loading", message: "No Nifty history loaded." };
    }

    const last = niftyRows[niftyRows.length - 1];
    const previous = niftyRows[niftyRows.length - 2];
    const lastTime = isoToTime(last[0]);

    const since = (days) => {
      const row = findNavOnOrBefore(niftyRows, lastTime - days * DAY_MS);
      if (!row || row[0] === last[0]) return null;
      return { date: row[0], close: row[1], returnPct: round((last[1] / row[1] - 1) * 100) };
    };

    const windowRows = niftyRows.filter(
      (row) => isoToTime(row[0]) >= lastTime - Math.max(7, lookbackDays) * DAY_MS
    );
    const closes = windowRows.map((row) => row[1]);
    const high = Math.max(...closes);
    const low = Math.min(...closes);

    return {
      status: "ready",
      asOf: last[0],
      close: last[1],
      previousClose: previous[1],
      dayChangePct: round((last[1] / previous[1] - 1) * 100),
      returns: {
        oneWeek: since(7),
        oneMonth: since(30),
        threeMonths: since(91),
        sixMonths: since(182),
        oneYear: since(365),
      },
      range: {
        lookbackDays,
        from: windowRows[0]?.[0] || null,
        high: round(high),
        low: round(low),
        drawdownFromHighPct: round((last[1] / high - 1) * 100),
      },
      source: meta.nifty?.source || null,
      fetchedAt: meta.nifty?.fetchedAt || null,
    };
  };

  const fundDetail = ({ code, from = null, to = null } = {}) => {
    const fund = universe.find((item) => String(item.code) === String(code));
    if (!fund) return { status: "notfound", message: `Unknown fund code ${code}.` };

    const { navs, schemeName } = getFund(code);
    if (navs.length === 0) return { status: "missing", code: fund.code, name: fund.name };

    const lastTime = navs[navs.length - 1][0];
    const fromTime = from ? isoToTime(from) : lastTime - 365 * DAY_MS;
    const toTime = to ? isoToTime(to) : lastTime;
    const series = navs.filter(([time]) => time >= fromTime && time <= toTime);

    return {
      status: "ready",
      code: fund.code,
      name: fund.name,
      category: fund.category,
      schemeName,
      from: timeToIso(fromTime),
      to: timeToIso(toTime),
      firstNav: series[0] ? { date: timeToIso(series[0][0]), nav: series[0][1] } : null,
      lastNav: series.length
        ? { date: timeToIso(series[series.length - 1][0]), nav: series[series.length - 1][1] }
        : null,
      returnPct:
        series.length >= 2
          ? round((series[series.length - 1][1] / series[0][1] - 1) * 100)
          : null,
      navs: series.map(([time, nav]) => ({ date: timeToIso(time), nav })),
    };
  };

  return {
    resolveWindow,
    rankFunds,
    categoryStats,
    analogWindows,
    fundDetail,
    marketOverview,
    dataStatus,
    listFunds: () =>
      universe.map(({ code, name, category }) => ({ code, name, category })),
  };
};
