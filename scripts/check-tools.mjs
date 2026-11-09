// Deterministic tool checks. Run with:
//   npm run check:tools
//
// These use the bundled snapshots, so they also catch a broken data refresh.

import assert from "node:assert/strict";
import { loadData } from "../server/data.mjs";
import { createToolRegistry, ToolError } from "../server/tools.mjs";

const data = loadData();
const registry = createToolRegistry(data.toolkit);
const { toolkit } = data;

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`FAIL ${name}: ${error.message}`);
  }
};

check("loads a complete snapshot", () => {
  assert.ok(data.status.nifty.rows > 500, "Nifty history should cover multiple years");
  assert.equal(data.status.funds.count, 62);
  assert.equal(data.status.funds.universe, 62);
  assert.ok(data.status.funds.fetchedAt);
});

check("resolves the default 22,600 → 25,000 window", () => {
  const window = toolkit.resolveWindow(22600, 25000);
  assert.equal(window.status, "ready");
  assert.equal(window.startDate, "2026-10-23");
  assert.equal(window.endDate, "2026-11-06");
  assert.ok(window.niftyReturn > 10.7 && window.niftyReturn < 10.8);
  assert.ok(window.tradingDays >= 2);
});

check("ranks all 62 funds and finds the known leader", () => {
  const ranked = toolkit.rankFunds({ from: 22600, to: 25000 });
  assert.equal(ranked.status, "ready");
  assert.equal(ranked.summary.analysed, 62);
  assert.equal(ranked.summary.excluded, 0);
  assert.equal(ranked.funds.length, 62);
  assert.equal(ranked.summary.best.name, "SBI Banking & Financial Services");
  assert.ok(ranked.summary.best.ret > 10.8 && ranked.summary.best.ret < 11.0);
  assert.ok(ranked.summary.beatNifty > 0);
  assert.ok(
    ranked.funds.every((fund) => fund.ret >= ranked.funds[ranked.funds.length - 1].ret),
    "funds must be sorted by descending return"
  );
});

check("filters rankings by category and limit", () => {
  const ranked = toolkit.rankFunds({ from: 22600, to: 25000, category: "Index", limit: 3 });
  assert.equal(ranked.status, "ready");
  assert.equal(ranked.funds.length, 3);
  assert.ok(ranked.funds.every((fund) => fund.category === "Index"));
  assert.ok(ranked.summary.analysed >= 3);
});

check("summarises all categories with valid breadth", () => {
  const stats = toolkit.categoryStats({ from: 22600, to: 25000 });
  assert.equal(stats.status, "ready");
  assert.equal(stats.categories.length, 9);
  assert.equal(stats.breadth.analysed, 62);
  assert.ok(stats.breadth.beatNiftyPct >= 0 && stats.breadth.beatNiftyPct <= 100);
  assert.ok(stats.categories.every((category) => category.count > 0));
  assert.ok(
    stats.categories.every(
      (category) =>
        category.averageReturn >= stats.categories[stats.categories.length - 1].averageReturn
    )
  );
});

check("finds analog windows and ranks consistency", () => {
  const analog = toolkit.analogWindows({
    movePct: 10,
    tolerancePct: 2,
    maxDays: 15,
    direction: "up",
    minObservations: 1,
    limit: 10,
  });
  assert.equal(analog.status, "ready");
  assert.ok(analog.summary.windows > 0);
  assert.ok(analog.funds.length > 0);
  assert.ok(analog.funds.length <= 10);
  assert.ok(
    analog.funds.every(
      (fund) => fund.hitRate >= 0 && fund.hitRate <= 100 && fund.observations >= 1
    )
  );
  assert.ok(
    analog.funds.every(
      (fund, index) =>
        index === 0 ||
        analog.funds[index - 1].hitRate > fund.hitRate ||
        (analog.funds[index - 1].hitRate === fund.hitRate &&
          analog.funds[index - 1].medianAlpha >= fund.medianAlpha)
    ),
    "analog funds must be sorted by hit rate then median alpha"
  );
});

check("returns one fund's NAV detail", () => {
  const detail = toolkit.fundDetail({ code: 133859, from: "2025-11-06", to: "2026-11-06" });
  assert.equal(detail.status, "ready");
  assert.equal(detail.name, "SBI Banking & Financial Services");
  assert.ok(detail.navs.length > 100);
  assert.ok(Number.isFinite(detail.returnPct));
  assert.ok(detail.firstNav.date >= "2025-11-06");
  assert.ok(detail.lastNav.date <= "2026-11-06");
});

check("exports bulk fund NAV data by levels and dates", () => {
  const byLevels = toolkit.fundData({ from: 22600, to: 25000, limit: 62 });
  assert.equal(byLevels.status, "ready");
  assert.equal(byLevels.requested, 62);
  assert.equal(byLevels.funds.length, 62);
  assert.equal(byLevels.window.startDate, "2026-10-23");
  assert.ok(byLevels.funds.some((fund) => fund.navs.length > 0));

  const byDates = toolkit.fundData({ fromDate: "2025-11-06", toDate: "2026-11-06", limit: 3 });
  assert.equal(byDates.status, "ready");
  assert.equal(byDates.funds.length, 3);
  assert.ok(byDates.funds.every((fund) => fund.navs.every((nav) => nav.date >= "2025-11-06" && nav.date <= "2026-11-06")));
});

check("reports market context from the last close", () => {
  const overview = toolkit.marketOverview({ lookbackDays: 365 });
  assert.equal(overview.status, "ready");
  assert.equal(overview.close, data.status.nifty.lastClose);
  assert.equal(overview.asOf, data.status.nifty.to);
  assert.ok(Number.isFinite(overview.dayChangePct));
  assert.ok(overview.range.high >= overview.close || overview.range.high > 0);
  assert.ok(overview.range.drawdownFromHighPct <= 0);
});

check("lists the full universe", () => {
  const funds = toolkit.listFunds();
  assert.equal(funds.length, 62);
  assert.ok(funds.every((fund) => fund.code && fund.name && fund.category));
});

check("rejects unknown tools and invalid arguments", () => {
  assert.throws(() => registry.execute("nope", {}), ToolError);
  assert.throws(() => registry.execute("rank_funds", { from: 22600 }), /to is required/);
  assert.throws(
    () => registry.execute("rank_funds", { from: 22600, to: 25000, category: "Crypto" }),
    /must be one of/
  );
  assert.throws(
    () => registry.execute("resolve_window", { from: -1, to: 25000 }),
    /must be > 0/
  );
});

check("coerces numeric strings and summarises list_funds", () => {
  const window = registry.execute("resolve_window", { from: "22600", to: "25000" });
  assert.equal(window.result.status, "ready");
  assert.equal(window.result.endDate, "2026-11-06");

  const listed = registry.execute("list_funds", {});
  assert.equal(listed.ok, true);
  assert.match(listed.summary, /62 funds across 9 categories/);
});

check("exposes eight tool definitions with schemas", () => {
  const tools = registry.list();
  assert.equal(tools.length, 8);
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    [
      "analog_windows",
      "category_stats",
      "fund_data",
      "fund_detail",
      "list_funds",
      "market_overview",
      "rank_funds",
      "resolve_window",
    ]
  );
  assert.ok(tools.every((tool) => tool.parameters.type === "object"));
});

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} tool check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${results.length} tool checks passed.`);
