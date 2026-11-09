import PropTypes from "prop-types";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import { getCategoryColor } from "../data/funds";

const UP_COLOR = "#0fd183";
const DOWN_COLOR = "#f55361";

const FundPerformanceBars = ({ funds, benchmark, benchmarkLabel }) => {
  const items = funds
    .filter((fund) => fund.status === "succeeded" && Number.isFinite(fund.ret))
    .sort((a, b) => b.ret - a.ret);

  if (items.length === 0) {
    return (
      <Typography variant="body2" sx={{ fontSize: 12, color: "text.secondary", mt: 2 }}>
        Fund performance will appear once NAV data is loaded.
      </Typography>
    );
  }

  const values = items.map((item) => item.ret);
  const min = Math.min(0, ...values, benchmark);
  const max = Math.max(0, ...values, benchmark);
  const span = Math.max(max - min, 1);
  const zeroPct = ((0 - min) / span) * 100;
  const benchmarkPct = ((benchmark - min) / span) * 100;

  return (
    <Box>
      {items.map((fund) => {
        const left = ((Math.min(0, fund.ret) - min) / span) * 100;
        const barWidth = Math.max((Math.abs(fund.ret) / span) * 100, 0.6);
        const positive = fund.ret >= 0;

        return (
          <Box
            key={fund.code}
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "104px 1fr 52px", sm: "172px 1fr 58px" },
              alignItems: "center",
              columnGap: 1,
              mb: "5px",
            }}
          >
            <Tooltip title={fund.schemeName || fund.name} placement="top" arrow>
              <Typography variant="body2" noWrap sx={{ fontSize: 11.5, color: "text.secondary" }}>
                {fund.name}
              </Typography>
            </Tooltip>
            <Box
              sx={{
                position: "relative",
                height: 15,
                borderRadius: "3px",
                backgroundColor: "action.hover",
                overflow: "hidden",
              }}
            >
              <Box
                sx={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${zeroPct}%`,
                  width: "1px",
                  backgroundColor: "text.disabled",
                  opacity: 0.5,
                }}
              />
              <Box
                sx={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${left}%`,
                  width: `${barWidth}%`,
                  backgroundColor: getCategoryColor(fund.category),
                  borderRadius: "3px",
                }}
              />
              <Box
                sx={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${benchmarkPct}%`,
                  borderLeft: "1.5px dashed",
                  borderColor: "text.secondary",
                  opacity: 0.8,
                }}
              />
            </Box>
            <Typography
              variant="body2"
              sx={{
                fontSize: 11.5,
                fontWeight: 600,
                textAlign: "right",
                color: positive ? UP_COLOR : DOWN_COLOR,
              }}
            >
              {positive ? "+" : ""}
              {fund.ret.toFixed(2)}%
            </Typography>
          </Box>
        );
      })}

      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1.25, flexWrap: "wrap" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box sx={{ width: 16, borderTop: "1.5px dashed", borderColor: "text.secondary", opacity: 0.8 }} />
          <Typography variant="body2" sx={{ fontSize: 10.5, color: "text.secondary" }}>
            Nifty 50 {benchmarkLabel}
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ fontSize: 10.5, color: "text.secondary", ml: "auto" }}>
          Bars are coloured by fund category
        </Typography>
      </Box>
    </Box>
  );
};

FundPerformanceBars.propTypes = {
  funds: PropTypes.arrayOf(PropTypes.object).isRequired,
  benchmark: PropTypes.number.isRequired,
  benchmarkLabel: PropTypes.string.isRequired,
};

export default FundPerformanceBars;
