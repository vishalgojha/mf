import { useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import * as d3 from "d3";
import { useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { DAY_MS, formatDay, formatLevel, isoToTime } from "../utils/nifty";

const MARGIN = { top: 26, right: 18, bottom: 26, left: 54 };

const NiftyContextChart = ({ rows, windowInfo }) => {
  const theme = useTheme();
  const parentRef = useRef(null);
  const chartRef = useRef(null);
  const tooltipRef = useRef(null);
  const [width, setWidth] = useState(0);

  const height = 260;

  // Context = roughly the last six months, always wide enough to contain the window.
  const context = useMemo(() => {
    if (!rows || rows.length === 0 || !windowInfo || windowInfo.status !== "ready") return [];

    const lastTime = isoToTime(rows[rows.length - 1][0]);
    let start = lastTime - 183 * DAY_MS;
    if (windowInfo.startTime - 21 * DAY_MS < start) {
      start = windowInfo.startTime - 21 * DAY_MS;
    }

    return rows
      .map(([date, close]) => ({ date: isoToTime(date), close }))
      .filter((row) => row.date >= start);
  }, [rows, windowInfo]);

  useEffect(() => {
    if (!parentRef.current) return undefined;

    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0].target.clientWidth);
    });
    observer.observe(parentRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (width <= 0 || context.length === 0) return;

    const svgRoot = d3.select(chartRef.current);
    svgRoot.selectAll("*").remove();

    const innerWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
    const innerHeight = height - MARGIN.top - MARGIN.bottom;

    const svg = svgRoot
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${MARGIN.left}, ${MARGIN.top})`);

    const xScale = d3
      .scaleTime()
      .domain(d3.extent(context, (d) => d.date))
      .range([0, innerWidth]);

    const closes = context.map((d) => d.close);
    const [minClose, maxClose] = d3.extent(closes);
    const pad = Math.max((maxClose - minClose) * 0.08, 40);

    const yScale = d3
      .scaleLinear()
      .domain([minClose - pad, maxClose + pad])
      .range([innerHeight, 0]);

    const axisColor = theme.palette.text.secondary;
    const gridColor = theme.palette.border.secondary;
    const accent = theme.palette.accent?.primary || "#ff834f";
    const upColor = "#0fd183";

    svg
      .append("g")
      .attr("transform", `translate(0, ${innerHeight})`)
      .call(
        d3
          .axisBottom(xScale)
          .ticks(Math.max(2, Math.floor(innerWidth / 110)))
          .tickSize(0)
          .tickPadding(8)
      )
      .call((g) => g.select(".domain").attr("stroke", gridColor))
      .call((g) => g.selectAll(".tick text").attr("fill", axisColor).style("font-size", "10px"));

    svg
      .append("g")
      .call(
        d3
          .axisLeft(yScale)
          .ticks(5)
          .tickSize(-innerWidth)
          .tickFormat((d) => d3.format(",")(d))
      )
      .call((g) => g.select(".domain").remove())
      .call((g) =>
        g
          .selectAll(".tick line")
          .attr("stroke", gridColor)
          .attr("stroke-dasharray", "3,3")
          .attr("opacity", 0.55)
      )
      .call((g) => g.selectAll(".tick text").attr("fill", axisColor).style("font-size", "10px"));

    const gradientId = "nifty-area-gradient";
    const gradient = svg
      .append("defs")
      .append("linearGradient")
      .attr("id", gradientId)
      .attr("x1", "0%")
      .attr("x2", "0%")
      .attr("y1", "0%")
      .attr("y2", "100%");

    gradient.append("stop").attr("offset", "0%").attr("stop-color", accent).attr("stop-opacity", 0.35);
    gradient.append("stop").attr("offset", "100%").attr("stop-color", accent).attr("stop-opacity", 0);

    const area = d3
      .area()
      .x((d) => xScale(d.date))
      .y0(innerHeight)
      .y1((d) => yScale(d.close))
      .curve(d3.curveMonotoneX);

    const line = d3
      .line()
      .x((d) => xScale(d.date))
      .y((d) => yScale(d.close))
      .curve(d3.curveMonotoneX);

    svg.append("path").datum(context).attr("d", area).attr("fill", `url(#${gradientId})`);

    svg
      .append("path")
      .datum(context)
      .attr("d", line)
      .attr("fill", "none")
      .attr("stroke", accent)
      .attr("stroke-width", 1.8);

    // Highlight the level-range window.
    const xStart = xScale(windowInfo.startTime);
    const xEnd = xScale(windowInfo.endTime);

    svg
      .append("rect")
      .attr("x", xStart)
      .attr("y", 0)
      .attr("width", Math.max(1.5, xEnd - xStart))
      .attr("height", innerHeight)
      .attr("fill", upColor)
      .attr("opacity", 0.16);

    [windowInfo.startTime, windowInfo.endTime].forEach((time) => {
      svg
        .append("line")
        .attr("x1", xScale(time))
        .attr("x2", xScale(time))
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .attr("stroke", upColor)
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4,3")
        .attr("opacity", 0.8);
    });

    const points = [
      { time: windowInfo.startTime, close: windowInfo.startLevel, label: formatLevel(windowInfo.startLevel), above: false },
      { time: windowInfo.endTime, close: windowInfo.endLevel, label: formatLevel(windowInfo.endLevel), above: true },
    ];

    points.forEach((point) => {
      const cx = xScale(point.time);
      const cy = yScale(point.close);

      svg.append("circle").attr("cx", cx).attr("cy", cy).attr("r", 4).attr("fill", upColor);

      svg
        .append("text")
        .attr("x", cx)
        .attr("y", point.above ? cy - 10 : cy + 17)
        .attr("text-anchor", cx > innerWidth - 60 ? "end" : "start")
        .attr("font-size", "10px")
        .attr("font-weight", 700)
        .attr("fill", upColor)
        .text(point.label);
    });

    // Hover tooltip.
    const tooltip = d3.select(tooltipRef.current);
    const crosshairX = svg
      .append("line")
      .attr("stroke", accent)
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "6,6")
      .attr("opacity", 0.7)
      .attr("y1", 0)
      .attr("y2", innerHeight);
    const hoverDot = svg.append("circle").attr("r", 3.5).attr("fill", accent).attr("opacity", 0);
    const bisect = d3.bisector((d) => d.date).left;

    svg
      .append("rect")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .attr("fill", "transparent")
      .attr("cursor", "crosshair")
      .on("mousemove", (event) => {
        const [pointerX] = d3.pointer(event);
        const date = xScale.invert(pointerX);
        const index = bisect(context, date);
        const point = context[Math.min(index, context.length - 1)];
        if (!point) return;

        const cx = xScale(point.date);
        const cy = yScale(point.close);

        crosshairX.attr("x1", cx).attr("x2", cx);
        hoverDot.attr("cx", cx).attr("cy", cy).attr("opacity", 1);

        const tooltipWidth = tooltipRef.current.clientWidth || 150;
        const left = cx + 12 + tooltipWidth > innerWidth ? cx - tooltipWidth - 12 : cx + 12;
        tooltip
          .style("visibility", "visible")
          .style("left", `${MARGIN.left + left}px`)
          .style("top", `${MARGIN.top + Math.max(0, cy - 34)}px`)
          .text(`${formatDay(point.date)} · ${formatLevel(point.close)}`);
      })
      .on("mouseleave", () => {
        tooltip.style("visibility", "hidden");
        hoverDot.attr("opacity", 0);
        crosshairX.attr("x1", 0).attr("x2", 0);
      });
  }, [width, context, windowInfo, theme]);

  return (
    <Box ref={parentRef} sx={{ position: "relative", width: "100%" }}>
      <div ref={chartRef} />
      <Box
        ref={tooltipRef}
        sx={{
          visibility: "hidden",
          position: "absolute",
          zIndex: 2,
          pointerEvents: "none",
          px: "6px",
          py: "3px",
          borderRadius: "4px",
          backgroundColor: "primary.main",
          color: "text.tooltip",
          fontSize: "11px",
          whiteSpace: "nowrap",
        }}
      />
      {context.length === 0 && (
        <Typography variant="body2" sx={{ fontSize: 12, color: "text.secondary", p: 2 }}>
          Nifty context data is not available for this window.
        </Typography>
      )}
    </Box>
  );
};

NiftyContextChart.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.array).isRequired,
  windowInfo: PropTypes.object,
};

NiftyContextChart.defaultProps = {
  windowInfo: null,
};

export default NiftyContextChart;
