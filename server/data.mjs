// Loads the bundled market snapshots for the Instinct API.
//
// The browser reads the same two JSON files from /data. In production the
// Docker image ships dist/data; in local development we fall back to public/data
// so the API can run before a build.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createToolkit } from "../src/agent/tools.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

const findDataDir = (explicit) => {
  const candidates = explicit
    ? [path.resolve(explicit)]
    : [path.join(repoRoot, "dist", "data"), path.join(repoRoot, "public", "data")];

  for (const dir of candidates) {
    if (
      fs.existsSync(path.join(dir, "nifty50.json")) &&
      fs.existsSync(path.join(dir, "funds.json"))
    ) {
      return dir;
    }
  }

  throw new Error(
    `Could not find nifty50.json and funds.json. Checked: ${candidates.join(", ")}. ` +
      "Run `npm run build` or `npm run update:nifty && npm run update:funds`."
  );
};

export const loadData = ({ dataDir = process.env.INSTINCT_DATA_DIR || null } = {}) => {
  const dir = findDataDir(dataDir);
  const niftySnapshot = readJson(path.join(dir, "nifty50.json"));
  const fundsSnapshot = readJson(path.join(dir, "funds.json"));

  const niftyRows = Array.isArray(niftySnapshot.rows) ? niftySnapshot.rows : [];
  const funds = fundsSnapshot.funds || {};

  if (niftyRows.length < 30) {
    throw new Error(`Nifty snapshot has only ${niftyRows.length} rows; refusing to start.`);
  }
  if (Object.keys(funds).length === 0) {
    throw new Error("Fund snapshot is empty; refusing to start.");
  }

  const toolkit = createToolkit({
    niftyRows,
    funds,
    meta: {
      nifty: {
        source: niftySnapshot.source,
        fetchedAt: niftySnapshot.fetchedAt,
      },
      funds: {
        source: fundsSnapshot.source,
        fetchedAt: fundsSnapshot.fetchedAt,
        coverage: fundsSnapshot.coverage,
      },
    },
  });

  return {
    toolkit,
    dataDir: dir,
    status: toolkit.dataStatus(),
    niftySnapshot,
    fundsSnapshot,
  };
};
