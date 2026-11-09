import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { FUND_UNIVERSE } from "../../data/funds";
import { mfapiGet } from "../../utils/mfapi";
import { navDateToTime } from "../../utils/nifty";

const toNavPairs = (data) =>
  data
    .map((row) => [navDateToTime(row.date), Number(row.nav)])
    .filter((row) => Number.isFinite(row[0]) && Number.isFinite(row[1]))
    .sort((a, b) => a[0] - b[0]);

// Full NAV history for one scheme. Kept as compact [timestamp, nav] pairs.
export const fetchFundHistory = createAsyncThunk("compare/fetchFundHistory", async (code) => {
  const data = await mfapiGet(String(code));
  return {
    code,
    schemeName: data?.meta?.scheme_name,
    navs: toNavPairs(data?.data || []),
  };
});

// Warm the whole comparison universe with a small amount of concurrency so we
// do not hammer the free API.
export const fetchAllFunds = createAsyncThunk("compare/fetchAllFunds", async (_, { dispatch }) => {
  const codes = FUND_UNIVERSE.map((fund) => fund.code);
  let next = 0;

  const worker = async () => {
    while (next < codes.length) {
      const code = codes[next];
      next += 1;
      try {
        await dispatch(fetchFundHistory(code)).unwrap();
      } catch {
        // Individual failures are stored on the slice; keep loading the rest.
      }
    }
  };

  await Promise.all(Array.from({ length: 8 }, worker));
});

const initialState = {
  items: {}, // code -> { status, navs, schemeName, error }
  allStatus: "idle",
};

const compareSlice = createSlice({
  name: "compare",
  initialState,
  reducers: {},
  extraReducers(builder) {
    builder
      .addCase(fetchFundHistory.pending, (state, action) => {
        state.items[action.meta.arg] = {
          ...(state.items[action.meta.arg] || {}),
          status: "loading",
          error: null,
        };
      })
      .addCase(fetchFundHistory.fulfilled, (state, action) => {
        state.items[action.payload.code] = {
          status: "succeeded",
          navs: action.payload.navs,
          schemeName: action.payload.schemeName,
          error: null,
        };
      })
      .addCase(fetchFundHistory.rejected, (state, action) => {
        state.items[action.meta.arg] = {
          ...(state.items[action.meta.arg] || {}),
          status: "failed",
          error: action.error.message,
        };
      })
      .addCase(fetchAllFunds.pending, (state) => {
        state.allStatus = "loading";
      })
      .addCase(fetchAllFunds.fulfilled, (state) => {
        state.allStatus = "succeeded";
      })
      .addCase(fetchAllFunds.rejected, (state) => {
        state.allStatus = "failed";
      });
  },
});

export const getFundItems = (store) => store.compare.items;
export const getFundsStatus = (store) => store.compare.allStatus;

export default compareSlice.reducer;
