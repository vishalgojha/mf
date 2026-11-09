import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { useDispatch, useSelector } from "react-redux";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import Alert from "@mui/material/Alert";
import LinearProgress from "@mui/material/LinearProgress";
import CircularProgress from "@mui/material/CircularProgress";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import { getNiftyRows, getNiftyStatus, getNiftyMeta, fetchNiftyData } from "../features/nifty/niftySlice";
import { fetchFundSnapshot, getFundItems, getFundsStatus, getFundsMeta } from "../features/compare/compareSlice";
import { FUND_UNIVERSE, getCategoryColor } from "../data/funds";
import { computeFundReturn, formatDay, formatLevel, resolveNiftyWindow } from "../utils/nifty";
import NiftyContextChart from "./NiftyContextChart";
import FundPerformanceBars from "./FundPerformanceBars";

const UP_COLOR = "#0fd183";
const DOWN_COLOR = "#f55361";
const DEFAULT_FROM = "22600";
const DEFAULT_TO = "25000";

const cardSx = {
  backgroundColor: "background.contrast",
  borderRadius: "5px",
  border: 1,
  borderColor: "border.secondary",
};

const signed = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const SummaryCard = ({ label, children }) => (
  <Box sx={{ ...cardSx, p: "12px", height: "100%" }}>
    <Typography variant="body2" sx={{ fontSize: 11, color: "text.secondary", opacity: 0.8, textTransform: "uppercase", letterSpacing: 0.4 }}>
      {label}
    </Typography>
    <Box sx={{ mt: "5px" }}>{children}</Box>
  </Box>
);

const NiftyRange = () => {
  const dispatch = useDispatch();
  const niftyRows = useSelector(getNiftyRows);
  const niftyStatus = useSelector(getNiftyStatus);
  const niftyMeta = useSelector(getNiftyMeta);
  const fundItems = useSelector(getFundItems);
  const fundsStatus = useSelector(getFundsStatus);
  const fundsMeta = useSelector(getFundsMeta);

  const [fromInput, setFromInput] = useState(DEFAULT_FROM);
  const [toInput, setToInput] = useState(DEFAULT_TO);

  useEffect(() => {
    if (niftyStatus === "idle") dispatch(fetchNiftyData());
  }, [dispatch, niftyStatus]);

  useEffect(() => {
    if (fundsStatus === "idle") dispatch(fetchFundSnapshot());
  }, [dispatch, fundsStatus]);

  const windowInfo = useMemo(
    () => resolveNiftyWindow(niftyRows, fromInput, toInput),
    [niftyRows, fromInput, toInput]
  );

  const performance = useMemo(() => {
    if (!windowInfo || windowInfo.status !== "ready") return [];

    return FUND_UNIVERSE.map((fund) => {
      const item = fundItems[fund.code];
      if (!item || item.status !== "succeeded") {
        return { ...fund, status: item?.status || "missing" };
      }

      const result = computeFundReturn(item.navs, windowInfo.startTime, windowInfo.endTime);

      return {
        ...fund,
        schemeName: item.schemeName,
        status: result ? "succeeded" : "nodata",
        ...(result || {}),
      };
    });
  }, [fundItems, windowInfo]);

  const loadedCount = FUND_UNIVERSE.filter((fund) => fundItems[fund.code]?.status === "succeeded").length;
  const failedCount = FUND_UNIVERSE.filter((fund) => fundItems[fund.code]?.status === "failed").length;
  const missingCount = performance.filter((fund) => fund.status === "missing").length;
  const nodataCount = performance.filter((fund) => fund.status === "nodata").length;
  const unavailableCount = failedCount + missingCount + nodataCount;

  const ranked = performance
    .filter((fund) => fund.status === "succeeded" && Number.isFinite(fund.ret))
    .sort((a, b) => b.ret - a.ret);

  const best = ranked[0];
  const staleCount = ranked.filter(
    (fund) => Math.max(fund.staleDays || 0, fund.startStaleDays || 0) > 3
  ).length;
  const allLoaded = fundsStatus === "succeeded";
  const snapshotDate = fundsMeta?.fetchedAt ? String(fundsMeta.fetchedAt).slice(0, 10) : null;
  const lastUpdated = niftyMeta?.fetchedAt ? String(niftyMeta.fetchedAt).slice(0, 10) : null;

  const resetLevels = () => {
    setFromInput(DEFAULT_FROM);
    setToInput(DEFAULT_TO);
  };

  return (
    <Box sx={{ m: "10px" }}>
      <Box sx={{ ...cardSx, p: "14px", mb: "10px" }}>
        <Typography variant="body1" fontWeight="bold" sx={{ mb: "4px" }}>
          Nifty level range → fund performance
        </Typography>
        <Typography variant="body2" sx={{ fontSize: 12, color: "text.secondary", maxWidth: 820 }}>
          Pick two Nifty 50 levels. The app finds the most recent time the index travelled from the
          first level to the second, then compares how popular funds performed over exactly those
          dates.
        </Typography>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center", mt: "12px" }}>
          <TextField
            size="small"
            label="From Nifty level"
            value={fromInput}
            onChange={(event) => setFromInput(event.target.value)}
            inputProps={{ inputMode: "numeric" }}
            sx={{ width: 150 }}
          />
          <TextField
            size="small"
            label="To Nifty level"
            value={toInput}
            onChange={(event) => setToInput(event.target.value)}
            inputProps={{ inputMode: "numeric" }}
            sx={{ width: 150 }}
          />
          <Button variant="outlined" size="small" onClick={resetLevels}>
            Reset
          </Button>
          <Chip
            label="22,600 → 25,000 · recent rally"
            size="small"
            variant={fromInput === DEFAULT_FROM && toInput === DEFAULT_TO ? "filled" : "outlined"}
            onClick={() => {
              setFromInput(DEFAULT_FROM);
              setToInput(DEFAULT_TO);
            }}
            sx={{ fontSize: 11 }}
          />
        </Box>

        {windowInfo.status === "ready" && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center", mt: "10px" }}>
            <Chip
              size="small"
              color="success"
              variant="outlined"
              label={`${formatDay(windowInfo.startTime)} → ${formatDay(windowInfo.endTime)}`}
              sx={{ fontSize: 11 }}
            />
            <Typography variant="body2" sx={{ fontSize: 11.5, color: "text.secondary" }}>
              {windowInfo.tradingDays} trading days · {formatLevel(windowInfo.startLevel)} →{" "}
              {formatLevel(windowInfo.endLevel)} ·{" "}
              <Box component="span" sx={{ color: windowInfo.niftyReturn >= 0 ? UP_COLOR : DOWN_COLOR, fontWeight: 600 }}>
                {signed(windowInfo.niftyReturn)}
              </Box>
            </Typography>
          </Box>
        )}
      </Box>

      {niftyStatus === "loading" && (
        <Box sx={{ ...cardSx, display: "flex", justifyContent: "center", alignItems: "center", gap: 1.5, p: 4 }}>
          <CircularProgress size="1.4rem" />
          <Typography variant="body2" sx={{ fontSize: 12, color: "text.secondary" }}>
            Loading Nifty 50 history…
          </Typography>
        </Box>
      )}

      {niftyStatus === "failed" && (
        <Alert severity="error" sx={{ mb: "10px" }}>
          Could not load the bundled Nifty 50 data. Run <code>npm run update:nifty</code> and reload.
        </Alert>
      )}

      {fundsStatus === "failed" && (
        <Alert severity="error" sx={{ mb: "10px" }}>
          Could not load the bundled fund NAV snapshot. Run <code>npm run update:funds</code> and
          redeploy.
        </Alert>
      )}

      {niftyStatus === "succeeded" && windowInfo.status !== "ready" && windowInfo.status !== "loading" && (
        <Alert severity="warning">{windowInfo.message}</Alert>
      )}

      {windowInfo.status === "ready" && (
        <>
          <Grid container spacing={1.25} sx={{ mb: "10px" }}>
            <Grid item xs={6} md={3}>
              <SummaryCard label="Nifty window">
                <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600 }}>
                  {formatDay(windowInfo.startTime)} → {formatDay(windowInfo.endTime)}
                </Typography>
                <Typography variant="body2" sx={{ fontSize: 11, color: "text.secondary" }}>
                  {windowInfo.tradingDays} trading days
                </Typography>
              </SummaryCard>
            </Grid>
            <Grid item xs={6} md={3}>
              <SummaryCard label="Nifty 50 move">
                <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600, color: windowInfo.niftyReturn >= 0 ? UP_COLOR : DOWN_COLOR }}>
                  {signed(windowInfo.niftyReturn)}
                </Typography>
                <Typography variant="body2" sx={{ fontSize: 11, color: "text.secondary" }}>
                  {formatLevel(windowInfo.startLevel)} → {formatLevel(windowInfo.endLevel)}
                </Typography>
              </SummaryCard>
            </Grid>
            <Grid item xs={6} md={3}>
              <SummaryCard label="Funds analysed">
                <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600 }}>
                  {ranked.length} of {FUND_UNIVERSE.length}
                </Typography>
                <Typography variant="body2" sx={{ fontSize: 11, color: "text.secondary" }}>
                  Direct plans · NAV growth
                </Typography>
                {unavailableCount > 0 && fundsStatus === "succeeded" && (
                  <Typography variant="body2" sx={{ fontSize: 10, color: "warning.main", mt: "2px" }}>
                    {unavailableCount} unavailable
                  </Typography>
                )}
              </SummaryCard>
            </Grid>
            <Grid item xs={6} md={3}>
              <SummaryCard label="Best performer">
                <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600, color: UP_COLOR }}>
                  {best ? signed(best.ret) : "—"}
                </Typography>
                <Typography variant="body2" noWrap sx={{ fontSize: 11, color: "text.secondary" }}>
                  {best ? best.name : "Waiting for NAV data"}
                </Typography>
              </SummaryCard>
            </Grid>
          </Grid>

          <Grid container spacing={1.25} sx={{ mb: "10px" }}>
            <Grid item xs={12} md={7}>
              <Box sx={{ ...cardSx, p: "12px", height: "100%" }}>
                <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>
                    Nifty 50 · daily close
                  </Typography>
                  <Typography variant="body2" sx={{ fontSize: 10.5, color: "text.secondary" }}>
                    green band = selected window
                  </Typography>
                </Box>
                <NiftyContextChart rows={niftyRows} windowInfo={windowInfo} />
              </Box>
            </Grid>
            <Grid item xs={12} md={5}>
              <Box sx={{ ...cardSx, p: "12px", height: "100%" }}>
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13, mb: "2px" }}>
                  Fund returns in the same window
                </Typography>
                <Typography variant="body2" sx={{ fontSize: 10.5, color: "text.secondary", mb: "10px" }}>
                  {ranked.length} funds · sorted best to worst · scroll for all
                </Typography>

                {!allLoaded && (
                  <Box sx={{ mb: "10px" }}>
                    <LinearProgress
                      variant="determinate"
                      value={(loadedCount / FUND_UNIVERSE.length) * 100}
                      sx={{ height: 4, borderRadius: 2 }}
                    />
                    <Typography variant="body2" sx={{ fontSize: 10.5, color: "text.secondary", mt: "4px" }}>
                      Loading bundled NAV data… {loadedCount}/{FUND_UNIVERSE.length}
                    </Typography>
                  </Box>
                )}

                <Box sx={{ maxHeight: 430, overflowY: "auto", pr: "4px" }}>
                  <FundPerformanceBars
                    funds={performance}
                    benchmark={windowInfo.niftyReturn}
                    benchmarkLabel={signed(windowInfo.niftyReturn)}
                  />
                </Box>

                {unavailableCount > 0 && fundsStatus === "succeeded" && (
                  <Typography variant="body2" sx={{ fontSize: 10.5, color: "text.secondary", mt: 1 }}>
                    {unavailableCount} fund{unavailableCount > 1 ? "s" : ""} excluded from the
                    ranking (no NAV at the window start or no snapshot data).
                  </Typography>
                )}
              </Box>
            </Grid>
          </Grid>

          <Box sx={{ ...cardSx, p: "12px" }}>
            <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13, mb: "6px" }}>
              Fund-by-fund breakdown ({ranked.length})
            </Typography>
            <TableContainer sx={{ maxHeight: 460 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontSize: 11 }}>Fund</TableCell>
                    <TableCell sx={{ fontSize: 11 }}>Category</TableCell>
                    <TableCell align="right" sx={{ fontSize: 11 }}>NAV at start</TableCell>
                    <TableCell align="right" sx={{ fontSize: 11 }}>NAV at end</TableCell>
                    <TableCell align="right" sx={{ fontSize: 11 }}>Return</TableCell>
                    <TableCell align="right" sx={{ fontSize: 11 }}>vs Nifty</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ranked.map((fund) => {
                    const alpha = fund.ret - windowInfo.niftyReturn;
                    const positive = fund.ret >= 0;
                    return (
                      <TableRow key={fund.code} hover>
                        <TableCell sx={{ fontSize: 11.5, maxWidth: 230 }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                            <Box
                              sx={{
                                width: 7,
                                height: 7,
                                borderRadius: "50%",
                                flexShrink: 0,
                                backgroundColor: getCategoryColor(fund.category),
                              }}
                            />
                            <Box>
                              <Typography variant="body2" sx={{ fontSize: 11.5, lineHeight: 1.25 }}>
                                {fund.name}
                              </Typography>
                              <Typography variant="body2" sx={{ fontSize: 9.5, color: "text.secondary", opacity: 0.75 }}>
                                {fund.schemeName}
                              </Typography>
                            </Box>
                          </Box>
                        </TableCell>
                        <TableCell sx={{ fontSize: 11 }}>{fund.category}</TableCell>
                        <TableCell align="right" sx={{ fontSize: 11 }}>
                          {fund.startNav.toFixed(2)}
                          <Typography variant="body2" sx={{ fontSize: 9.5, color: "text.secondary" }}>
                            {formatDay(fund.startTime)}
                          </Typography>
                          {(fund.startStaleDays || 0) > 3 && (
                            <Typography variant="body2" sx={{ fontSize: 9, color: "warning.main" }}>
                              stale {fund.startStaleDays}d
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: 11 }}>
                          {fund.endNav.toFixed(2)}
                          <Typography variant="body2" sx={{ fontSize: 9.5, color: "text.secondary" }}>
                            {formatDay(fund.endTime)}
                          </Typography>
                          {(fund.staleDays || 0) > 3 && (
                            <Typography variant="body2" sx={{ fontSize: 9, color: "warning.main" }}>
                              stale {fund.staleDays}d
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: 11.5, fontWeight: 600, color: positive ? UP_COLOR : DOWN_COLOR }}>
                          {signed(fund.ret)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: 11.5, color: alpha >= 0 ? UP_COLOR : DOWN_COLOR }}>
                          {signed(alpha)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {ranked.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Typography variant="body2" sx={{ fontSize: 11.5, color: "text.secondary" }}>
                          Loading fund NAV histories…
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <Typography variant="body2" sx={{ fontSize: 10, color: "text.secondary", opacity: 0.8, mt: "8px" }}>
              Fund NAVs: {fundsMeta?.source || "MFAPI.in"} snapshot
              {snapshotDate ? ` (${snapshotDate})` : ""}. Nifty 50 closes:{" "}
              {niftyMeta?.source || "NSE daily archive"}
              {lastUpdated ? `, last updated ${lastUpdated}` : ""}. Returns use the closest available
              NAV on or before each boundary date.
              {unavailableCount > 0 && fundsStatus === "succeeded"
                ? ` ${unavailableCount} fund${unavailableCount > 1 ? "s" : ""} excluded: no NAV at the window start or no snapshot data.`
                : ""}
              {staleCount > 0
                ? ` ${staleCount} fund${staleCount > 1 ? "s" : ""} use a NAV more than 3 days away from a boundary.`
                : ""}
            </Typography>
          </Box>
        </>
      )}
    </Box>
  );
};

SummaryCard.propTypes = {
  label: PropTypes.string.isRequired,
  children: PropTypes.node,
};

SummaryCard.defaultProps = {
  children: null,
};

export default NiftyRange;
