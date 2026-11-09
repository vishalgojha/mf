// Small sanity check for the boundary logic. Run with:
//   node scripts/check-returns.mjs
//
// Covers the late-launch regression: a fund with no NAV on/before the window
// start must return null instead of silently measuring from its first NAV.

import { computeFundReturn, isoToTime } from "../src/utils/nifty.js";

const day = (iso) => isoToTime(iso);
const navs = [
  [day("2026-10-20"), 100],
  [day("2026-10-23"), 101],
  [day("2026-10-30"), 105],
  [day("2026-11-06"), 110],
];

const start = day("2026-10-23");
const end = day("2026-11-06");

const cases = [
  {
    name: "full coverage",
    actual: computeFundReturn(navs, start, end),
    check: (r) => r && Math.abs(r.ret - (110 / 101 - 1) * 100) < 1e-9 && r.staleDays === 0,
  },
  {
    name: "fund launched after window start",
    actual: computeFundReturn(
      [
        [day("2026-10-28"), 200],
        [day("2026-11-06"), 210],
      ],
      start,
      end
    ),
    check: (r) => r === null,
  },
  {
    name: "no NAV at window end",
    actual: computeFundReturn(
      [
        [day("2026-10-23"), 100],
        [day("2026-10-25"), 102],
      ],
      start,
      end
    ),
    check: (r) => r && r.endTime === day("2026-10-25") && r.staleDays === 12,
  },
  {
    name: "empty history",
    actual: computeFundReturn([], start, end),
    check: (r) => r === null,
  },
];

let failed = 0;
cases.forEach(({ name, actual, check }) => {
  const ok = Boolean(check(actual));
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, ok ? "" : actual);
});

if (failed > 0) {
  console.error(`${failed} check(s) failed.`);
  process.exit(1);
}
console.log(`All ${cases.length} checks passed.`);
