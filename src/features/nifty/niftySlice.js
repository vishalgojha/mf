import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

// Static daily Nifty 50 closes (NSE data, refreshed with `npm run update:nifty`).
// Bundled in public/data so the browser never has to fight CORS for index data.
export const fetchNiftyData = createAsyncThunk("nifty/fetchNiftyData", async () => {
  const base = import.meta.env.BASE_URL || "/";
  const res = await axios.get(`${base}data/nifty50.json`);
  return res.data;
});

const initialState = {
  rows: [],
  meta: null,
  status: "idle", // 'idle' | 'loading' | 'succeeded' | 'failed'
  error: null,
};

const niftySlice = createSlice({
  name: "nifty",
  initialState,
  reducers: {},
  extraReducers(builder) {
    builder
      .addCase(fetchNiftyData.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchNiftyData.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.rows = action.payload.rows || [];
        state.meta = {
          name: action.payload.name || "NIFTY 50",
          source: action.payload.source || "NSE",
          fetchedAt: action.payload.fetchedAt,
        };
      })
      .addCase(fetchNiftyData.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message;
      });
  },
});

export const getNiftyRows = (store) => store.nifty.rows;
export const getNiftyStatus = (store) => store.nifty.status;
export const getNiftyMeta = (store) => store.nifty.meta;

export default niftySlice.reducer;
