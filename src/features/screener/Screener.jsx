import {
  Box,
  Container,
  CssBaseline,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  CircularProgress,
  Chip,
  Button,
  Stack,
  FormControlLabel,
  Checkbox,
  MenuItem,
  Select,
  InputLabel,
  FormControl,
  RefreshIcon,
} from "@mui/material";
import { useEffect, useState } from "react";

const DEFAULT_SYMBOLS =
  "RELIANCE.NS,TCS.NS,HDFCBANK.NS,INFY.NS,ICICIBANK.NS,HINDUNILVR.NS,ITC.NS,SBIN.NS,BHARTIARTL.NS,BAJFINANCE.NS,KOTAKBANK.NS,LT.NS,AXISBANK.NS,ASIANPAINT.NS,HCLTECH.NS,MARUTI.NS,SUNPHARMA.NS,TITAN.NS,ULTRACEMCO.NS,NESTLEIND.NS";

const columns = [
  { key: "symbol", label: "Symbol", numeric: false },
  { key: "price", label: "Price (₹)", numeric: true },
  { key: "pe", label: "P/E", numeric: true },
  { key: "roe", label: "ROE (%)", numeric: true },
  { key: "de", label: "D/E", numeric: true },
  { key: "mcapCr", label: "MCap (₹ Cr)", numeric: true },
  { key: "divYield", label: "Div Yield (%)", numeric: true },
  { key: "beta", label: "Beta", numeric: true },
];

const fmt = (value, type) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  if (type === "price") return `₹${value.toFixed(2)}`;
  if (type === "roe") return `${(value * 100).toFixed(2)}`;
  if (type === "mcapCr") return value.toLocaleString("en-IN");
  return value.toFixed(2);
};

export default function Screener() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);
  const [filters, setFilters] = useState({
    maxPe: "",
    minRoe: "",
    maxDe: "",
    minMcap: "",
  });

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/screener?symbols=${encodeURIComponent(symbols)}`);
      if (!res.ok) throw new Error("Upstream data unavailable.");
      const json = await res.json();
      setData(json.results || []);
    } catch (e) {
      setError(e.message || "Failed to load screener data.");
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [symbols]);

  const applyFilters = (row) => {
    if (filters.maxPe && row.pe !== null && row.pe > Number(filters.maxPe)) return false;
    if (filters.minRoe && row.roe !== null && row.roe * 100 < Number(filters.minRoe)) return false;
    if (filters.maxDe && row.de !== null && row.de > Number(filters.maxDe)) return false;
    if (filters.minMcap && row.mcapCr !== null && row.mcapCr < Number(filters.minMcap)) return false;
    return true;
  };

  const filtered = data.filter(applyFilters);

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" fontWeight="bold" component="div" sx={{ mb: 2, fontFamily: "Exo" }}>
        Stock Screener — NSE
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Delayed fundamentals from Yahoo Finance. Not investment advice.
      </Typography>

      <Paper sx={{ p: 3, borderRadius: 2, mb: 3, border: 1, borderColor: "divider" }}>
        <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
          <TextField
            fullWidth
            label="Symbols (comma-separated)"
            value={symbols}
            onChange={(e) => setSymbols(e.target.value)}
            size="small"
            sx={{ minWidth: 320 }}
          />
          <Button variant="contained" startIcon={<RefreshIcon />} onClick={fetchData} disabled={loading}>
            Refresh
          </Button>
        </Stack>
        <Stack direction="row" spacing={2} sx={{ mt: 2, flexWrap: "wrap" }}>
          <TextField
            label="Max P/E"
            type="number"
            value={filters.maxPe}
            onChange={(e) => setFilters({ ...filters, maxPe: e.target.value })}
            size="small"
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="Min ROE (%)"
            type="number"
            value={filters.minRoe}
            onChange={(e) => setFilters({ ...filters, minRoe: e.target.value })}
            size="small"
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="Max D/E"
            type="number"
            value={filters.maxDe}
            onChange={(e) => setFilters({ ...filters, maxDe: e.target.value })}
            size="small"
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="Min MCap (₹ Cr)"
            type="number"
            value={filters.minMcap}
            onChange={(e) => setFilters({ ...filters, minMcap: e.target.value })}
            size="small"
            InputLabelProps={{ shrink: true }}
          />
        </Stack>
      </Paper>

      {error && (
        <Box sx={{ color: "error", mb: 2 }}>{error}</Box>
      )}

      <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" />
              {columns.map((col) => (
                <TableCell key={col.key} align={col.numeric ? "right" : "left"}>
                  <Typography variant="caption" fontWeight="bold">
                    {col.label}
                  </Typography>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} align="center">
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} align="center">
                  No stocks match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TableRow key={row.symbol} hover>
                  <TableCell padding="checkbox">
                    <Chip label={row.symbol} size="small" color="primary" />
                  </TableCell>
                  {columns.map((col) => (
                    <TableCell key={col.key} align={col.numeric ? "right" : "left"}>
                      {col.key === "symbol" ? (
                        <Typography variant="body2">{row.symbol}</Typography>
                      ) : (
                        <Typography variant="body2">{fmt(row[col.key], col.key)}</Typography>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 2 }}>
        Showing {filtered.length} of {data.length} stocks. Data delayed ~15 min (NSE).
      </Typography>
    </Container>
  );
}
