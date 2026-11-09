// The deterministic tool surface exposed to Instinct AI.
//
// Tool definitions are JSON Schema so any OpenAI-compatible model can call
// them. Handlers are thin wrappers around src/agent/tools.js, which means the
// HTTP API, the browser, and the tests all compute numbers the same way.

import { CATEGORY_COLORS } from "../src/data/funds.js";

export const CATEGORIES = Object.keys(CATEGORY_COLORS);

export class ToolError extends Error {
  constructor(message, code = "invalid_arguments") {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

const dateString = {
  type: "string",
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  description: "Date in YYYY-MM-DD format (UTC).",
};

const fromTo = {
  from: {
    type: "number",
    exclusiveMinimum: 0,
    description: "Lower Nifty 50 level. The most recent close at or below this level starts the window.",
  },
  to: {
    type: "number",
    exclusiveMinimum: 0,
    description: "Upper Nifty 50 level. The first later close at or above this level ends the window.",
  },
};

const TOOL_DEFINITIONS = [
  {
    name: "resolve_window",
    description:
      "Resolve two Nifty 50 levels to the most recent trading window. Use this first for any level-to-level question. Returns dates, closes, Nifty return and session count.",
    parameters: {
      type: "object",
      properties: fromTo,
      required: ["from", "to"],
      additionalProperties: false,
    },
    run: (toolkit, args) => toolkit.resolveWindow(args.from, args.to),
  },
  {
    name: "rank_funds",
    description:
      "Rank the 62 Direct-Growth funds by return over the most recent window between two Nifty levels. Returns return, alpha vs Nifty, dates, category and stale-NAV flags.",
    parameters: {
      type: "object",
      properties: {
        ...fromTo,
        category: {
          type: "string",
          enum: CATEGORIES,
          description: "Optional category filter.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 62,
          description: "Return only the top N funds after ranking.",
        },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
    run: (toolkit, args) =>
      toolkit.rankFunds({
        from: args.from,
        to: args.to,
        category: args.category || null,
        limit: args.limit ?? null,
      }),
  },
  {
    name: "category_stats",
    description:
      "Summarise fund performance by category for a Nifty level window: average/median return, average alpha, breadth, best and worst fund.",
    parameters: {
      type: "object",
      properties: fromTo,
      required: ["from", "to"],
      additionalProperties: false,
    },
    run: (toolkit, args) => toolkit.categoryStats({ from: args.from, to: args.to }),
  },
  {
    name: "analog_windows",
    description:
      "Find all historical Nifty moves similar to a given percentage move and rank funds by consistency (hit rate, median alpha, worst alpha) across those windows. Use for 'similar rallies', 'consistently', or 'how did funds do when Nifty moved like this' questions.",
    parameters: {
      type: "object",
      properties: {
        movePct: {
          type: "number",
          minimum: 1,
          maximum: 50,
          description: "Target absolute Nifty move in percent. Default 10.",
        },
        tolerancePct: {
          type: "number",
          minimum: 0.1,
          maximum: 10,
          description: "Allowed deviation from movePct. Default 2.",
        },
        maxDays: {
          type: "integer",
          minimum: 2,
          maximum: 60,
          description: "Maximum sessions allowed for the move. Default 15.",
        },
        direction: {
          type: "string",
          enum: ["up", "down"],
          description: "Look for rallies or drawdowns. Default up.",
        },
        category: {
          type: "string",
          enum: CATEGORIES,
          description: "Optional category filter.",
        },
        minObservations: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description: "Drop funds with fewer usable windows. Default 2.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 62,
          description: "Number of funds to return. Default 20.",
        },
      },
      additionalProperties: false,
    },
    run: (toolkit, args) => toolkit.analogWindows(args),
  },
  {
    name: "fund_detail",
    description:
      "Get one fund's NAV series and return for a date range. Use after ranking to explain a specific fund. Defaults to the last 365 days.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "integer",
          minimum: 1,
          description: "MFAPI.in scheme code from list_funds or rank_funds.",
        },
        from: dateString,
        to: dateString,
      },
      required: ["code"],
      additionalProperties: false,
    },
    run: (toolkit, args) =>
      toolkit.fundDetail({ code: args.code, from: args.from || null, to: args.to || null }),
  },
  {
    name: "market_overview",
    description:
      "Current Nifty 50 context: latest close, day change, 1w/1m/3m/6m/1y returns, 52-week high/low and drawdown. Use for 'what is the market doing now' questions.",
    parameters: {
      type: "object",
      properties: {
        lookbackDays: {
          type: "integer",
          minimum: 30,
          maximum: 1095,
          description: "Range for the high/low calculation. Default 365.",
        },
      },
      additionalProperties: false,
    },
    run: (toolkit, args) =>
      toolkit.marketOverview({
        lookbackDays: args.lookbackDays ?? 365,
      }),
  },
  {
    name: "list_funds",
    description:
      "List the 62-fund universe with codes, names and categories. Use when the user asks which funds are covered or when a scheme code is needed.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    run: (toolkit) => toolkit.listFunds(),
  },
];

const typeMatches = (value, type) => {
  switch (type) {
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
};

const describe = (value) => {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
};

// A deliberately small JSON Schema validator: enough for model-generated
// arguments without adding a dependency.
export const validateArguments = (value, schema, path = "arguments") => {
  if (schema.type && !typeMatches(value, schema.type)) {
    throw new ToolError(`${path} must be a ${schema.type}, got ${describe(value)}.`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    throw new ToolError(`${path} must be one of: ${schema.enum.join(", ")}.`);
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      throw new ToolError(`${path} must be >= ${schema.minimum}.`);
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      throw new ToolError(`${path} must be > ${schema.exclusiveMinimum}.`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      throw new ToolError(`${path} must be <= ${schema.maximum}.`);
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      throw new ToolError(`${path} is too short.`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      throw new ToolError(`${path} is too long.`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      throw new ToolError(`${path} does not match ${schema.pattern}.`);
    }
  }

  if (schema.type === "object" || typeof value === "object") {
    if (value === null || Array.isArray(value)) return;

    for (const key of schema.required || []) {
      if (value[key] === undefined) {
        throw new ToolError(`${path}.${key} is required.`);
      }
    }

    const properties = schema.properties || {};
    for (const [key, child] of Object.entries(value)) {
      if (properties[key]) {
        validateArguments(child, properties[key], `${path}.${key}`);
      } else if (schema.additionalProperties === false) {
        throw new ToolError(`${path}.${key} is not a supported argument.`);
      }
    }
  }
};

// Models occasionally emit numbers as strings ("22600"). Coerce only the
// fields the schema declares as numbers, then run the strict validation.
const coerceArguments = (value, schema) => {
  if (!schema) return value;

  if ((schema.type === "number" || schema.type === "integer") && typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed !== "" && Number.isFinite(Number(trimmed))) return Number(trimmed);
  }

  if (
    schema.type === "object" &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const copy = { ...value };
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (key in copy) copy[key] = coerceArguments(copy[key], child);
    }
    return copy;
  }

  return value;
};

const summarize = (name, result) => {
  if (name === "list_funds" && Array.isArray(result)) {
    return `${result.length} funds across ${new Set(result.map((fund) => fund.category)).size} categories.`;
  }

  if (!result || result.status !== "ready") {
    return `${name}: ${result?.status || "error"}${result?.message ? ` — ${result.message}` : ""}`;
  }

  switch (name) {
    case "resolve_window":
      return (
        `Nifty ${result.startLevel} (${result.startDate}) → ${result.endLevel} ` +
        `(${result.endDate}), ${result.niftyReturn}% over ${result.tradingDays} sessions.`
      );
    case "rank_funds":
      return (
        `${result.summary.analysed} funds analysed, ${result.summary.beatNifty} beat Nifty ` +
        `(${result.window.niftyReturn}%). Best: ${result.summary.best?.name} ` +
        `${result.summary.best?.ret}% (alpha ${result.summary.best?.alpha}pp). ` +
        `${result.summary.excluded} excluded.`
      );
    case "category_stats":
      return (
        `${result.categories.length} categories. Leader: ` +
        `${result.categories[0]?.category} ${result.categories[0]?.averageReturn}% average. ` +
        `${result.breadth.beatNifty}/${result.breadth.analysed} funds beat Nifty.`
      );
    case "analog_windows":
      return (
        `${result.summary.windows} similar windows; ${result.summary.fundsRanked} funds ranked. ` +
        `Top: ${result.funds[0]?.name} (${result.funds[0]?.hitRate}% hit rate, ` +
        `${result.funds[0]?.medianAlpha}pp median alpha).`
      );
    case "fund_detail":
      return (
        `${result.name}: ${result.firstNav?.date} → ${result.lastNav?.date}, ` +
        `${result.returnPct}% (${result.navs.length} NAVs).`
      );
    case "market_overview":
      return (
        `Nifty ${result.close} on ${result.asOf} (day ${result.dayChangePct}%). ` +
        `1w ${result.returns.oneWeek?.returnPct ?? "n/a"}%, ` +
        `1m ${result.returns.oneMonth?.returnPct ?? "n/a"}%, ` +
        `drawdown from high ${result.range.drawdownFromHighPct}%.`
      );
    default:
      return `${name}: ready.`;
  }
};

export const createToolRegistry = (toolkit) => {
  const byName = new Map(
    TOOL_DEFINITIONS.map((definition) => [
      definition.name,
      {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
        run: definition.run,
      },
    ])
  );

  const list = () =>
    [...byName.values()].map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));

  const execute = (name, rawArguments) => {
    const definition = byName.get(name);
    if (!definition) {
      throw new ToolError(`Unknown tool "${name}".`, "unknown_tool");
    }

    const args = coerceArguments(
      rawArguments && typeof rawArguments === "object" ? rawArguments : {},
      definition.parameters
    );
    validateArguments(args, definition.parameters);

    const result = definition.run(toolkit, args);
    return {
      name,
      ok: result?.status === "ready" || name === "list_funds",
      summary: summarize(name, result),
      result,
    };
  };

  return { list, execute };
};
