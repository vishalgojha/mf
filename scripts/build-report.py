#!/usr/bin/env python3
"""Build a PDF performance report for a Nifty 50 level range.

Usage:
    python3 scripts/build-report.py
    python3 scripts/build-report.py --from 22600 --to 25000
    python3 scripts/build-report.py --out reports/custom.pdf

Data sources (both free, no API key):
  - Fund NAVs: MFAPI.in  (https://api.mfapi.in/mf/{code})
  - Nifty 50:  public/data/nifty50.json (refreshed with `npm run update:nifty`)

The report is rendered to HTML and printed to PDF with headless Chrome.
"""

import argparse
import concurrent.futures
import datetime as dt
import json
import math
import os
import re
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NIFTY_FILE = os.path.join(ROOT, "public", "data", "nifty50.json")
FUNDS_FILE = os.path.join(ROOT, "src", "data", "funds.js")

CATEGORY_COLORS = {
    "Index": "#4c78a8",
    "Large Cap": "#f58518",
    "Flexi Cap": "#54a24b",
    "Multi Cap": "#9d755d",
    "Value": "#72b7b2",
    "Mid Cap": "#b279a2",
    "Small Cap": "#e45756",
    "Sectoral": "#8c6bb1",
    "ELSS": "#eeca3b",
}

UP = "#0f9d63"
DOWN = "#d64550"
INK = "#1f2937"
MUTED = "#6b7280"
GRID = "#e5e7eb"
ACCENT = "#ff834f"


def parse_nifty_date(iso):
    return dt.date.fromisoformat(iso)


def parse_mfapi_date(text):
    day, month, year = map(int, text.split("-"))
    return dt.date(year, month, day)


def format_day(date, short=False):
    if short:
        return date.strftime("%d %b")
    return date.strftime("%d %b %Y")


def resolve_window(rows, from_level, to_level):
    """Mirror src/utils/nifty.js: most recent move from <= from to >= to."""
    next_at_or_above = [-1] * len(rows)
    next_index = -1
    for i in range(len(rows) - 1, -1, -1):
        next_at_or_above[i] = next_index
        if rows[i][1] >= to_level:
            next_index = i

    start_index = -1
    end_index = -1
    for i in range(len(rows) - 1, -1, -1):
        if rows[i][1] <= from_level and next_at_or_above[i] != -1:
            start_index = i
            end_index = next_at_or_above[i]
            break

    if start_index == -1 or end_index == -1 or start_index >= end_index:
        raise SystemExit(
            f"Could not find a window from {from_level:,} to {to_level:,} in the Nifty history."
        )

    start_date, start_close = rows[start_index]
    end_date, end_close = rows[end_index]

    return {
        "start_date": start_date,
        "end_date": end_date,
        "start_close": start_close,
        "end_close": end_close,
        "return": (end_close / start_close - 1) * 100,
        "trading_days": end_index - start_index + 1,
        "start_index": start_index,
        "end_index": end_index,
    }


def load_funds():
    source = open(FUNDS_FILE, encoding="utf-8").read()
    rows = re.findall(
        r'\{ code: (\d+), name: "([^"]+)", category: "([^"]+)" \}', source
    )
    return [
        {"code": int(code), "name": name, "category": category}
        for code, name, category in rows
    ]


def fetch_fund(fund, start_date, end_date):
    url = (
        f"https://api.mfapi.in/mf/{fund['code']}"
        f"?startDate={start_date.isoformat()}&endDate={end_date.isoformat()}"
        f"&_={fund['code']}"
    )
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    payload = json.load(urllib.request.urlopen(request, timeout=30))

    points = sorted(
        (parse_mfapi_date(row["date"]), float(row["nav"])) for row in payload["data"]
    )
    start_point = max((p for p in points if p[0] <= start_date), default=None)
    end_point = max((p for p in points if p[0] <= end_date), default=None)

    if not start_point or not end_point or end_point[0] <= start_point[0]:
        return {**fund, "status": "nodata"}

    return {
        **fund,
        "status": "ok",
        "scheme_name": payload["meta"]["scheme_name"],
        "start_date": start_point[0],
        "start_nav": start_point[1],
        "end_date": end_point[0],
        "end_nav": end_point[1],
        "return": (end_point[1] / start_point[1] - 1) * 100,
    }


def nice_ticks(minimum, maximum, count=5):
    if maximum <= minimum:
        return [minimum]
    span = maximum - minimum
    raw_step = span / (count - 1)
    magnitude = 10 ** math.floor(math.log10(raw_step))
    step = min((1, 2, 2.5, 5, 10), key=lambda m: abs(m * magnitude - raw_step)) * magnitude
    start = math.ceil(minimum / step) * step
    ticks = []
    value = start
    while value <= maximum + step * 0.01:
        ticks.append(value)
        value += step
    return ticks


def svg_nifty_chart(rows, window, width=1040, height=300):
    left, right, top, bottom = 62, 22, 26, 34
    inner_w = width - left - right
    inner_h = height - top - bottom

    last_date = rows[-1][0]
    context_start = max(rows[0][0], window["start_date"] - dt.timedelta(days=120))
    context = [(date, close) for date, close in rows if context_start <= date <= last_date]

    min_date = context[0][0].toordinal()
    max_date = context[-1][0].toordinal()
    closes = [close for _, close in context]
    min_close = min(closes)
    max_close = max(closes)
    pad = max((max_close - min_close) * 0.09, 60)
    low = min_close - pad
    high = max_close + pad

    def x(date):
        return left + (date.toordinal() - min_date) / (max_date - min_date) * inner_w

    def y(close):
        return top + (high - close) / (high - low) * inner_h

    path_parts = []
    for index, (date, close) in enumerate(context):
        path_parts.append(f"{'M' if index == 0 else 'L'}{x(date):.1f},{y(close):.1f}")
    line_path = " ".join(path_parts)
    area_path = (
        f"M{x(context[0][0]):.1f},{top + inner_h:.1f} "
        + " ".join(f"L{x(date):.1f},{y(close):.1f}" for date, close in context)
        + f" L{x(context[-1][0]):.1f},{top + inner_h:.1f} Z"
    )

    parts = [
        f'<svg viewBox="0 0 {width} {height}" width="100%" role="img" '
        f'aria-label="Nifty 50 daily close with the selected window highlighted">',
        "<defs>",
        '<linearGradient id="niftyFill" x1="0" y1="0" x2="0" y2="1">',
        f'<stop offset="0%" stop-color="{ACCENT}" stop-opacity="0.32"/>',
        f'<stop offset="100%" stop-color="{ACCENT}" stop-opacity="0"/>',
        "</linearGradient>",
        "</defs>",
    ]

    for tick in nice_ticks(low, high, 5):
        if tick < low or tick > high:
            continue
        yy = y(tick)
        parts.append(
            f'<line x1="{left}" y1="{yy:.1f}" x2="{left + inner_w}" y2="{yy:.1f}" '
            f'stroke="{GRID}" stroke-dasharray="3 4"/>'
        )
        parts.append(
            f'<text x="{left - 9}" y="{yy + 3.5:.1f}" text-anchor="end" '
            f'font-size="9.5" fill="{MUTED}">{tick:,.0f}</text>'
        )

    tick_count = 7
    seen_labels = set()
    for index in range(tick_count):
        ratio = index / (tick_count - 1)
        ordinal = min_date + ratio * (max_date - min_date)
        date = dt.date.fromordinal(round(ordinal))
        label = date.strftime("%d %b")
        if label in seen_labels:
            continue
        seen_labels.add(label)
        parts.append(
            f'<text x="{left + ratio * inner_w:.1f}" y="{top + inner_h + 20}" '
            f'text-anchor="middle" font-size="9.5" fill="{MUTED}">'
            f'{label}</text>'
        )

    x_start = x(window["start_date"])
    x_end = x(window["end_date"])
    parts.append(
        f'<rect x="{x_start:.1f}" y="{top}" width="{max(2, x_end - x_start):.1f}" '
        f'height="{inner_h}" fill="{UP}" opacity="0.14"/>'
    )
    for date in (window["start_date"], window["end_date"]):
        parts.append(
            f'<line x1="{x(date):.1f}" y1="{top}" x2="{x(date):.1f}" y2="{top + inner_h}" '
            f'stroke="{UP}" stroke-width="1" stroke-dasharray="4 3" opacity="0.8"/>'
        )

    parts.append(f'<path d="{area_path}" fill="url(#niftyFill)"/>')
    parts.append(
        f'<path d="{line_path}" fill="none" stroke="{ACCENT}" stroke-width="1.8" '
        f'stroke-linejoin="round"/>'
    )

    for date, close, label, above in (
        (window["start_date"], window["start_close"], f'{window["start_close"]:,.0f}', False),
        (window["end_date"], window["end_close"], f'{window["end_close"]:,.0f}', True),
    ):
        cx, cy = x(date), y(close)
        parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="4" fill="{UP}"/>')
        anchor = "end" if cx > left + inner_w - 55 else "start"
        offset = -11 if above else 17
        parts.append(
            f'<text x="{cx:.1f}" y="{cy + offset:.1f}" text-anchor="{anchor}" '
            f'font-size="10" font-weight="700" fill="{UP}">{label}</text>'
        )

    parts.append("</svg>")
    return "".join(parts)


def svg_category_chart(category_stats, nifty_return, width=1040, height=270):
    left, right, top, bottom = 110, 70, 18, 22
    inner_w = width - left - right
    inner_h = height - top - bottom

    categories = sorted(category_stats.items(), key=lambda item: -item[1]["avg"])
    max_value = max(max(stats["avg"] for _, stats in categories), nifty_return) * 1.16
    min_value = min(0, min(stats["avg"] for _, stats in categories))
    span = max_value - min_value

    def x(value):
        return left + (value - min_value) / span * inner_w

    bar_height = inner_h / len(categories) * 0.58
    gap = inner_h / len(categories)

    parts = [
        f'<svg viewBox="0 0 {width} {height}" width="100%" role="img" '
        f'aria-label="Average fund return by category">'
    ]

    zero_x = x(0)
    parts.append(
        f'<line x1="{zero_x:.1f}" y1="{top}" x2="{zero_x:.1f}" y2="{top + inner_h}" '
        f'stroke="{GRID}"/>'
    )

    for index, (category, stats) in enumerate(categories):
        center = top + gap * index + gap / 2
        value = stats["avg"]
        bar_x = x(min(0, value))
        bar_w = abs(x(value) - x(0))
        color = CATEGORY_COLORS.get(category, "#8e8e8e")
        parts.append(
            f'<text x="{left - 10}" y="{center + 4:.1f}" text-anchor="end" '
            f'font-size="10" fill="{INK}">{category}</text>'
        )
        parts.append(
            f'<rect x="{bar_x:.1f}" y="{center - bar_height / 2:.1f}" '
            f'width="{max(1, bar_w):.1f}" height="{bar_height:.1f}" rx="2.5" fill="{color}"/>'
        )
        parts.append(
            f'<text x="{x(value) + 7:.1f}" y="{center + 4:.1f}" font-size="9.5" '
            f'font-weight="700" fill="{INK}">{value:+.2f}%</text>'
        )
        parts.append(
            f'<text x="{x(value) + 50:.1f}" y="{center + 4:.1f}" font-size="8.5" '
            f'fill="{MUTED}">n={stats["count"]}</text>'
        )

    bench_x = x(nifty_return)
    parts.append(
        f'<line x1="{bench_x:.1f}" y1="{top - 4}" x2="{bench_x:.1f}" y2="{top + inner_h}" '
        f'stroke="{INK}" stroke-width="1.2" stroke-dasharray="4 3"/>'
    )
    parts.append(
        f'<text x="{bench_x:.1f}" y="{top - 8}" text-anchor="middle" font-size="9" '
        f'font-weight="700" fill="{INK}">Nifty {nifty_return:+.2f}%</text>'
    )

    parts.append("</svg>")
    return "".join(parts)


def build_html(report, generated_at):
    window = report["window"]
    funds = report["funds"]
    nifty_return = window["return"]
    best = funds[0]
    worst = funds[-1]
    beat = sum(1 for fund in funds if fund["return"] > nifty_return)
    index_funds = [f for f in funds if f["category"] == "Index" and "Nifty 50 Index" in f["name"]]
    index_avg = sum(f["return"] for f in index_funds) / len(index_funds)
    total = len(funds)

    category_stats = {}
    for fund in funds:
        stats = category_stats.setdefault(fund["category"], {"total": 0.0, "count": 0})
        stats["total"] += fund["return"]
        stats["count"] += 1
    for stats in category_stats.values():
        stats["avg"] = stats["total"] / stats["count"]

    def signed(value):
        return f"{value:+.2f}%"

    rows = []
    for rank, fund in enumerate(funds, start=1):
        positive = fund["return"] >= 0
        alpha = fund["return"] - nifty_return
        color = UP if positive else DOWN
        dot = CATEGORY_COLORS.get(fund["category"], "#8e8e8e")
        start_note = (
            "" if fund["start_date"] == window["start_date"] else format_day(fund["start_date"], True)
        )
        end_note = (
            "" if fund["end_date"] == window["end_date"] else format_day(fund["end_date"], True)
        )
        rows.append(
            "<tr>"
            f'<td class="rank">{rank}</td>'
            f'<td class="fund"><div class="fund-name">{fund["name"]}</div>'
            f'<div class="scheme">{fund["scheme_name"]}</div></td>'
            f'<td class="category"><span class="dot" style="background:{dot}"></span>{fund["category"]}</td>'
            f'<td class="num">{fund["start_nav"]:,.2f}'
            + (f'<div class="date">{start_note}</div>' if start_note else "")
            + "</td>"
            f'<td class="num">{fund["end_nav"]:,.2f}'
            + (f'<div class="date">{end_note}</div>' if end_note else "")
            + "</td>"
            f'<td class="num strong" style="color:{color}">{signed(fund["return"])}</td>'
            f'<td class="num" style="color:{color}">{signed(alpha)}</td>'
            "</tr>"
        )

    nifty_chart = svg_nifty_chart(report["nifty_rows"], window)
    category_chart = svg_category_chart(category_stats, nifty_return)

    category_note = " · ".join(
        f'{category} {stats["avg"]:+.2f}%'
        for category, stats in sorted(category_stats.items(), key=lambda item: -item[1]["avg"])
    )

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Nifty {report['from_level']:,.0f} to {report['to_level']:,.0f} - Fund Performance</title>
<style>
  * {{ box-sizing: border-box; }}
  @page {{ size: A4; margin: 11mm 12mm 12mm; }}
  html, body {{ margin: 0; padding: 0; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    color: {INK};
    background: #ffffff;
    font-size: 10px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }}
  .page {{ padding: 0; }}
  .section {{ break-before: page; }}
  .eyebrow {{
    color: {ACCENT}; font-size: 8.5px; font-weight: 700; letter-spacing: 1.6px;
    text-transform: uppercase; margin-bottom: 5px;
  }}
  h1 {{ font-size: 25px; line-height: 1.15; margin: 0 0 5px; letter-spacing: -0.5px; }}
  h2 {{ font-size: 13px; margin: 16px 0 7px; }}
  .sub {{ color: {MUTED}; font-size: 11px; margin: 0 0 3px; max-width: 860px; }}
  .meta {{ color: {MUTED}; font-size: 8.5px; margin-top: 9px; }}
  .cards {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-top: 13px; }}
  .card {{ border: 1px solid {GRID}; border-radius: 6px; padding: 8px 10px; }}
  .card .label {{
    color: {MUTED}; font-size: 7.5px; font-weight: 700; letter-spacing: 0.7px;
    text-transform: uppercase;
  }}
  .card .value {{ font-size: 17px; font-weight: 700; margin-top: 2px; }}
  .card .note {{ color: {MUTED}; font-size: 8.5px; margin-top: 1px; }}
  .chart-card {{ border: 1px solid {GRID}; border-radius: 6px; padding: 9px 11px 4px; margin-top: 11px; }}
  .chart-title {{ font-size: 10px; font-weight: 700; margin-bottom: 1px; }}
  .chart-note {{ color: {MUTED}; font-size: 8px; margin-bottom: 2px; }}
  ul {{ margin: 4px 0 0 14px; padding: 0; }}
  li {{ margin: 2.5px 0; font-size: 9.3px; line-height: 1.42; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 8.2px; }}
  thead {{ display: table-header-group; }}
  tr {{ break-inside: avoid; }}
  th {{
    text-align: left; font-size: 7.3px; text-transform: uppercase; letter-spacing: 0.45px;
    color: {MUTED}; border-bottom: 1.2px solid #cbd5e1; padding: 5px 5px;
  }}
  td {{ border-bottom: 1px solid #eef1f5; padding: 4.2px 5px; vertical-align: top; }}
  tbody tr:nth-child(even) {{ background: #fafbfc; }}
  .rank {{ color: {MUTED}; width: 18px; }}
  .fund {{ width: 40%; }}
  .fund-name {{ font-size: 8.6px; font-weight: 650; line-height: 1.25; }}
  .scheme {{ color: {MUTED}; font-size: 6.9px; line-height: 1.25; margin-top: 1px; }}
  .category {{ white-space: nowrap; }}
  .dot {{ display: inline-block; width: 5.5px; height: 5.5px; border-radius: 50%; margin-right: 4px; }}
  .num {{ text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }}
  .strong {{ font-weight: 700; }}
  .date {{ color: {MUTED}; font-size: 6.8px; margin-top: 1px; }}
  .th-right {{ text-align: right; }}
  .footer {{ margin-top: 12px; border-top: 1px solid {GRID}; padding-top: 7px; color: {MUTED}; font-size: 7.7px; line-height: 1.5; }}
  .pill {{
    display: inline-block; background: #ecfdf5; color: #047857; border-radius: 10px;
    padding: 2px 7px; font-size: 8px; font-weight: 700;
  }}
  .obs {{ background: #f8fafc; border-left: 2.5px solid {ACCENT}; padding: 8px 11px; border-radius: 0 5px 5px 0; margin-top: 10px; }}
  .obs-title {{ font-size: 9.5px; font-weight: 700; margin-bottom: 2px; }}
  .method {{ color: {MUTED}; font-size: 8px; line-height: 1.5; margin: 6px 0 8px; }}
</style>
</head>
<body>
<div class="page">
  <div class="eyebrow">Fund performance report</div>
  <h1>Nifty 50: {report['from_level']:,.0f} → {report['to_level']:,.0f}</h1>
  <p class="sub">How {total} popular Direct-Growth mutual funds performed over the index's most recent move between these levels.</p>
  <div class="meta">Window: {format_day(window['start_date'])} → {format_day(window['end_date'])} · Generated {generated_at} · Data: MFAPI.in and NSE/Yahoo Finance</div>

  <div class="cards">
    <div class="card"><div class="label">Nifty move</div><div class="value" style="color:{UP}">{signed(nifty_return)}</div><div class="note">{window['start_close']:,.0f} → {window['end_close']:,.0f}</div></div>
    <div class="card"><div class="label">Trading days</div><div class="value">{window['trading_days']}</div><div class="note">{format_day(window['start_date'], True)} → {format_day(window['end_date'], True)}</div></div>
    <div class="card"><div class="label">Funds compared</div><div class="value">{total}</div><div class="note">9 categories · Direct plans</div></div>
    <div class="card"><div class="label">Beat the Nifty</div><div class="value">{beat} / {total}</div><div class="note">return &gt; {signed(nifty_return)}</div></div>
  </div>

  <div class="chart-card">
    <div class="chart-title">Nifty 50 daily close</div>
    <div class="chart-note">Shaded band = selected window · orange line = daily close · last four months of context</div>
    {nifty_chart}
  </div>

  <div class="chart-card">
    <div class="chart-title">Average return by category</div>
    <div class="chart-note">Equal-weight average of the funds in each category · dashed line = Nifty {signed(nifty_return)}</div>
    {category_chart}
  </div>

  <div class="obs">
    <div class="obs-title">What stands out</div>
    <ul>
      <li><strong>{best['name']}</strong> ({best['category']}) was the best performer at <strong>{signed(best['return'])}</strong>, narrowly ahead of <strong>{funds[1]['name']}</strong> at {signed(funds[1]['return'])}.</li>
      <li>Large-cap active funds averaged <strong>{signed(category_stats['Large Cap']['avg'])}</strong>, while Nifty 50 index funds averaged <strong>{signed(index_avg)}</strong> — broadly in line with the index itself.</li>
      <li>Small-cap funds lagged, averaging <strong>{signed(category_stats['Small Cap']['avg'])}</strong>, with HDFC Small Cap at {signed(next(f['return'] for f in funds if f['name'] == 'HDFC Small Cap'))}.</li>
      <li><strong>{worst['name']}</strong> was the weakest at <strong>{signed(worst['return'])}</strong> and the only negative return in the set, a reminder that this window was specific to Indian equities.</li>
      <li>Sectoral results were wide: SBI Banking &amp; Financial Services {signed(next(f['return'] for f in funds if f['name'] == 'SBI Banking & Financial Services'))} versus ICICI Pru Technology {signed(next(f['return'] for f in funds if f['name'] == 'ICICI Pru Technology'))}.</li>
    </ul>
  </div>

  <div class="footer">
    <span class="pill">{total} funds · 9 categories</span>
    <div style="margin-top:5px">Category averages: {category_note}.</div>
    <div style="margin-top:3px">Returns use the closest available NAV on or before each boundary date. Past performance does not guarantee future results. This report is for information only and is not investment advice.</div>
  </div>
</div>

<div class="section">
  <div class="eyebrow">Full ranking</div>
  <h1 style="font-size:19px">Fund-by-fund results</h1>
  <p class="sub">All {total} Direct-Growth plans, sorted by return over {format_day(window['start_date'], True)} → {format_day(window['end_date'], True)}. “vs Nifty” is the fund return minus the Nifty's {signed(nifty_return)}.</p>
  <div class="method"><strong>Method:</strong> pick a Nifty level range; the app finds the most recent day the index closed at or below the start level followed by a close at or above the end level. Fund returns use the closest available NAV on or before each boundary. Fund NAVs from MFAPI.in; Nifty 50 closes from the bundled NSE/Yahoo Finance snapshot. Data as of {generated_at}.</div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Fund</th>
        <th>Category</th>
        <th class="th-right">NAV at start</th>
        <th class="th-right">NAV at end</th>
        <th class="th-right">Return</th>
        <th class="th-right">vs Nifty</th>
      </tr>
    </thead>
    <tbody>
      {''.join(rows)}
    </tbody>
  </table>
</div>
</body>
</html>
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="from_level", type=float, default=22600)
    parser.add_argument("--to", dest="to_level", type=float, default=25000)
    parser.add_argument(
        "--out",
        default=os.path.join(ROOT, "reports", "nifty-fund-performance-22600-25000.pdf"),
    )
    args = parser.parse_args()

    payload = json.load(open(NIFTY_FILE, encoding="utf-8"))
    nifty_rows = [(parse_nifty_date(date), float(close)) for date, close in payload["rows"]]
    window = resolve_window(nifty_rows, args.from_level, args.to_level)

    funds = load_funds()
    print(f"Fetching {len(funds)} funds for {window['start_date']} → {window['end_date']}…")

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        results = list(
            executor.map(
                lambda fund: fetch_fund(fund, window["start_date"], window["end_date"]), funds
            )
        )

    ok = [fund for fund in results if fund["status"] == "ok"]
    failed = [fund for fund in results if fund["status"] != "ok"]
    if failed:
        print("Skipped funds without NAV data:", ", ".join(f["name"] for f in failed))
    if not ok:
        raise SystemExit("No fund data loaded, cannot build the report.")

    ok.sort(key=lambda fund: -fund["return"])

    html = build_html(
        {"window": window, "funds": ok, "nifty_rows": nifty_rows, "from_level": args.from_level, "to_level": args.to_level},
        dt.date.today().strftime("%d %b %Y"),
    )

    html_path = "/tmp/nifty-fund-report.html"
    with open(html_path, "w", encoding="utf-8") as handle:
        handle.write(html)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    chrome = "google-chrome" if subprocess.run(["which", "google-chrome"], capture_output=True).returncode == 0 else "google-chrome-stable"

    command = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--no-pdf-header-footer",
        f"--print-to-pdf={args.out}",
        f"file://{html_path}",
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0 or not os.path.exists(args.out):
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        raise SystemExit("Chrome failed to render the PDF.")

    size_kb = os.path.getsize(args.out) / 1024
    print(f"Wrote {args.out} ({size_kb:.0f} KB) with {len(ok)} funds.")
    print(f"Nifty window: {window['start_date']} → {window['end_date']} ({window['return']:+.2f}%)")
    print(f"Best: {ok[0]['name']} {ok[0]['return']:+.2f}% | Worst: {ok[-1]['name']} {ok[-1]['return']:+.2f}%")


if __name__ == "__main__":
    main()
