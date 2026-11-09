// Provider transport checks against a fake OpenAI-compatible server.
//   npm run check:provider
//
// Verifies the real fetch path, tool-call parsing, Authorization header and
// fallback between providers, without needing NVIDIA or OpenRouter keys.

import assert from "node:assert/strict";
import http from "node:http";
import { chatWithFallback, NoProviderError } from "../server/providers.mjs";

const startFakeProvider = ({ failAlways = false } = {}) =>
  new Promise((resolve) => {
    let requests = 0;
    const seen = { authorization: null, tools: null, toolChoice: null };

    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        requests += 1;
        const body = JSON.parse(raw);
        seen.authorization = req.headers.authorization;
        seen.tools = body.tools;
        seen.toolChoice = body.tool_choice;
        seen.model = body.model;

        const send = (status, payload) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(payload));
        };

        if (failAlways) {
          send(429, { error: { message: "rate limited for test" } });
          return;
        }

        const toolMessage = [...body.messages].reverse().find((message) => message.role === "tool");

        if (!toolMessage) {
          send(200, {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_window",
                      type: "function",
                      function: {
                        name: "resolve_window",
                        arguments: JSON.stringify({ from: 22600, to: 25000 }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          });
          return;
        }

        const toolResult = JSON.parse(toolMessage.content);
        send(200, {
          choices: [
            {
              message: {
                role: "assistant",
                content: `Nifty returned ${toolResult.niftyReturn}% over the window.`,
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
        });
      });
    });

    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port, seen, requests: () => requests });
    });
  });

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`FAIL ${name}: ${error.message}`);
  }
};

const tools = [
  {
    name: "resolve_window",
    description: "Resolve levels to a window.",
    parameters: {
      type: "object",
      properties: { from: { type: "number" }, to: { type: "number" } },
      required: ["from", "to"],
    },
  },
];

const baseMessages = [
  { role: "system", content: "Use tools." },
  { role: "user", content: "Resolve 22,600 to 25,000." },
];

const fake = await startFakeProvider();

process.env.NODE_ENV = "test";
process.env.INSTINCT_PROVIDERS = "nvidia";
delete process.env.INSTINCT_ENABLE_MOCK;
process.env.NVIDIA_API_KEY = "test-key";
process.env.NVIDIA_BASE_URL = `http://127.0.0.1:${fake.port}`;
process.env.NVIDIA_MODEL = "test-model";

try {
  await check("calls an OpenAI-compatible provider with tools", async () => {
    const response = await chatWithFallback({
      messages: baseMessages,
      tools,
      provider: "nvidia",
    });

    assert.equal(response.provider, "nvidia");
    assert.equal(response.model, "test-model");
    assert.equal(response.toolCalls.length, 1);
    assert.equal(response.toolCalls[0].name, "resolve_window");
    assert.deepEqual(response.toolCalls[0].arguments, { from: 22600, to: 25000 });
    assert.equal(fake.seen.authorization, "Bearer test-key");
    assert.equal(fake.seen.tools.length, 1);
    assert.equal(fake.seen.toolChoice, "auto");
  });

  await check("parses a final answer and usage", async () => {
    const response = await chatWithFallback({
      messages: [
        ...baseMessages,
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_window",
              type: "function",
              function: {
                name: "resolve_window",
                arguments: JSON.stringify({ from: 22600, to: 25000 }),
              },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_window", content: JSON.stringify({ niftyReturn: 10.75 }) },
      ],
      tools,
      provider: "nvidia",
    });

    assert.match(response.content, /10\.75%/);
    assert.equal(response.toolCalls.length, 0);
    assert.equal(response.usage.total_tokens, 28);
  });

  await check("falls back to the next provider after a 429", async () => {
    const failing = await startFakeProvider({ failAlways: true });

    process.env.INSTINCT_PROVIDERS = "openrouter,nvidia";
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${failing.port}`;
    process.env.NVIDIA_BASE_URL = `http://127.0.0.1:${fake.port}`;
    process.env.OPENROUTER_MODEL = "openrouter-test";
    process.env.NVIDIA_MODEL = "nvidia-test";

    try {
      const response = await chatWithFallback({
        messages: baseMessages,
        tools,
        provider: "auto",
      });

      assert.equal(response.provider, "nvidia");
      assert.equal(response.model, "nvidia-test");
      assert.equal(failing.requests(), 1, "failing provider should be tried once");
    } finally {
      failing.server.close();
    }
  });

  await check("fails clearly when no provider is configured", async () => {
    delete process.env.NVIDIA_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    await assert.rejects(
      () => chatWithFallback({ messages: baseMessages, tools }),
      (error) => error instanceof NoProviderError && /NVIDIA_API_KEY/.test(error.message)
    );

    process.env.NVIDIA_API_KEY = "test-key";
  });
} finally {
  fake.server.close();
}

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} provider check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${results.length} provider checks passed.`);
