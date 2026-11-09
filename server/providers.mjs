// OpenAI-compatible provider layer for the optional Instinct agent.
//
// Both NVIDIA NIM and OpenRouter expose /chat/completions with tool calling.
// The API can run without either key: the deterministic tool endpoints still
// work, and /ask returns a clear 503 instead of pretending to be an LLM.
//
// Keys are read from the environment and never returned by any endpoint.

const DEFAULTS = {
  nvidia: {
    label: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keyEnv: "NVIDIA_API_KEY",
    modelEnv: "NVIDIA_MODEL",
    defaultModel: "meta/llama-3.3-70b-instruct",
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
  },
};

export class NoProviderError extends Error {
  constructor(message) {
    super(message);
    this.name = "NoProviderError";
    this.code = "no_provider";
  }
}

export class AllProvidersFailedError extends Error {
  constructor(errors) {
    super("All configured model providers failed.");
    this.name = "AllProvidersFailedError";
    this.code = "providers_failed";
    this.errors = errors;
  }
}

export class ProviderError extends Error {
  constructor(provider, status, message) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
  }
}

const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const providerOrder = () =>
  (process.env.INSTINCT_PROVIDERS || "nvidia,openrouter")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

const mockEnabled = () =>
  process.env.INSTINCT_ENABLE_MOCK === "1" && process.env.NODE_ENV !== "production";

export const getProviders = () => {
  const requested = providerOrder();
  const names = [...requested];
  if (mockEnabled() && !names.includes("mock")) names.push("mock");

  return names
    .filter((name) => DEFAULTS[name] || name === "mock")
    .map((name) => {
      if (name === "mock") {
        return {
          name,
          label: "Mock provider (tests only)",
          baseUrl: null,
          keyEnv: null,
          model: "mock-1",
          configured: true,
          mock: true,
        };
      }

      const definition = DEFAULTS[name];
      const key = process.env[definition.keyEnv] || "";
      const baseUrl = process.env[`${name.toUpperCase()}_BASE_URL`] || definition.baseUrl;
      const model = process.env[definition.modelEnv] || definition.defaultModel;

      return {
        name,
        label: definition.label,
        baseUrl,
        keyEnv: definition.keyEnv,
        model,
        configured: Boolean(key),
        mock: false,
      };
    });
};

export const getProviderInfo = () => {
  const providers = getProviders();
  return {
    mode: providers.some((provider) => provider.configured) ? "agent" : "tools-only",
    order: providers.map((provider) => provider.name),
    providers: providers.map(({ name, label, model, configured, keyEnv }) => ({
      name,
      label,
      model,
      configured,
      envKey: keyEnv,
    })),
    modelOverrideEnabled: process.env.INSTINCT_ALLOW_MODEL_OVERRIDE === "1",
  };
};

const parseToolArguments = (raw) => {
  if (raw === undefined || raw === null || raw === "") {
    return { arguments: {}, error: null };
  }
  if (typeof raw === "object") {
    return { arguments: raw, error: null };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { arguments: {}, error: "Tool arguments must be a JSON object." };
    }
    return { arguments: parsed, error: null };
  } catch {
    return { arguments: {}, error: "Tool arguments were not valid JSON." };
  }
};

const errorMessageFromBody = (body) => {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body);
    return (
      parsed?.error?.message ||
      parsed?.message ||
      (typeof parsed?.error === "string" ? parsed.error : "") ||
      body.slice(0, 300)
    );
  } catch {
    return body.slice(0, 300);
  }
};

const fetchJson = async ({ url, headers, body, timeoutMs, signal }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Provider request timed out")), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();

    if (!response.ok) {
      throw new ProviderError(
        "provider",
        response.status,
        errorMessageFromBody(text) || `HTTP ${response.status}`
      );
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError("provider", 502, "Provider returned a non-JSON response.");
    }
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
};

const mockChat = async ({ messages }) => {
  const toolMessages = messages.filter((message) => message.role === "tool");
  if (toolMessages.length === 0) {
    return {
      content: "",
      toolCalls: [
        {
          id: "mock_call_1",
          name: "resolve_window",
          arguments: { from: 22600, to: 25000 },
          parseError: null,
        },
      ],
      finishReason: "tool_calls",
      usage: {},
    };
  }

  let window = null;
  try {
    window = JSON.parse(toolMessages[toolMessages.length - 1].content);
  } catch {
    window = null;
  }

  return {
    content: window
      ? `Mock answer: Nifty moved ${window.niftyReturn}% from ${window.startDate} to ${window.endDate}.`
      : "Mock answer: the tool returned no usable window.",
    toolCalls: [],
    finishReason: "stop",
    usage: {},
  };
};

export const chat = async ({
  provider,
  model = null,
  messages,
  tools = [],
  timeoutMs = numberFromEnv("INSTINCT_TIMEOUT_MS", 45000),
  signal = null,
}) => {
  const config = getProviders().find((item) => item.name === provider);
  if (!config) throw new NoProviderError(`Unknown provider "${provider}".`);
  if (!config.configured) {
    throw new NoProviderError(`${config.label} is not configured. Set ${config.keyEnv}.`);
  }
  if (config.mock) {
    return { ...(await mockChat({ messages })), provider: config.name, model: config.model };
  }

  const key = process.env[config.keyEnv];
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };

  if (config.name === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.INSTINCT_PUBLIC_URL || "https://mf.vishalojha.me";
    headers["X-Title"] = "LevelLens Instinct";
  }

  const configuredTemperature = Number(process.env.INSTINCT_TEMPERATURE || 0.2);
  const body = {
    model: model || config.model,
    messages,
    temperature: Number.isFinite(configuredTemperature) ? configuredTemperature : 0.2,
    max_tokens: numberFromEnv("INSTINCT_MAX_TOKENS", 900),
    stream: false,
  };

  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
    body.tool_choice = "auto";
  }

  const data = await fetchJson({
    url: `${config.baseUrl.replace(/\/$/, "")}/chat/completions`,
    headers,
    body,
    timeoutMs,
    signal,
  });

  const message = data?.choices?.[0]?.message || {};
  const rawContent = message.content;
  const content =
    typeof rawContent === "string"
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((part) => part?.text || "").join("")
        : "";

  const toolCalls = (message.tool_calls || []).map((call, index) => {
    const parsed = parseToolArguments(call?.function?.arguments);
    return {
      id: call?.id || `call_${index}`,
      name: call?.function?.name || null,
      arguments: parsed.arguments,
      parseError: parsed.error,
    };
  });

  return {
    content,
    toolCalls,
    finishReason: data?.choices?.[0]?.finish_reason || null,
    usage: data?.usage || {},
    provider: config.name,
    model: body.model,
  };
};

export const chatWithFallback = async ({
  messages,
  tools = [],
  provider = "auto",
  model = null,
  signal = null,
}) => {
  const requested = (provider || "auto").toLowerCase();
  const candidates = getProviders().filter(
    (item) => item.configured && (requested === "auto" || item.name === requested)
  );

  if (candidates.length === 0) {
    const hint =
      requested === "auto"
        ? "Set NVIDIA_API_KEY or OPENROUTER_API_KEY to enable /ask. The deterministic tool endpoints work without a key."
        : `Provider "${requested}" is not configured. Set its API key in the environment.`;
    throw new NoProviderError(hint);
  }

  const overrideAllowed = process.env.INSTINCT_ALLOW_MODEL_OVERRIDE === "1";
  const errors = [];

  for (const candidate of candidates) {
    try {
      const response = await chat({
        provider: candidate.name,
        model: overrideAllowed ? model : null,
        messages,
        tools,
        signal,
      });
      return response;
    } catch (error) {
      if (signal?.aborted) throw error;
      errors.push({
        provider: candidate.name,
        status: error.status || null,
        message: error.message || "Unknown provider error",
      });
    }
  }

  throw new AllProvidersFailedError(errors);
};
