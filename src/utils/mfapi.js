import axios from "axios";

// Free MFAPI.in base URL. Override with VITE_MFAPI_URL in .env if needed.
// Search lives at {base}search?q=… and fund NAV at {base}{schemeCode}.
export const MFAPI_URL = (import.meta.env.VITE_MFAPI_URL || "https://api.mfapi.in/mf/").replace(
  /\/?$/,
  "/"
);

// MFAPI's CDN caches some responses without CORS headers, which makes the
// browser reject them ("No Access-Control-Allow-Origin"). Requesting a unique
// URL forces a cache MISS whose response includes the CORS header.
const cacheBust = (url) =>
  `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const mfapiGet = async (path, config = {}) => {
  const response = await axios.get(cacheBust(`${MFAPI_URL}${path}`), config);
  return response.data;
};
