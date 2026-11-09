// Agent-loop checks with a scripted provider. No API keys or network needed.
//   npm run check:agent

import assert from "node:assert/strict";
import { runAgent } from "../server/agent.mjs";
import { loadData } from "../server/data.mjs";
import { createToolRegistry } from "../server/tools.mjs";

const data = loadData();
const registry = createToolRegistry(data.toolkit);

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

const mockResponse = (overrides = {}) => ({
  content: "",
  toolCalls: [],
  finishReason: "stop",
  usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  provider: "mock",
  model: "mock-1",
  ...overrides,
});

const lastToolResult = (messages) => {
  const toolMessage = [...messages].reverse().find((message) => message.role === "tool");
  assert.ok(toolMessage, "expected a tool result in the conversation");
  return JSON.parse(toolMessage.content);
};

await check("runs a tool then returns a grounded answer", async () => {
  let calls = 0;
  const chat = async ({ messages, tools }) => {
    calls += 1;

    if (calls === 1) {
      assert.ok(tools.some((tool) => tool.name === "rank_funds"));
      return mockResponse({
        toolCalls: [
          {
            id: "call_rank",
            name: "rank_funds",
            arguments: { from: 22600, to: 25000, limit: 5 },
            parseError: null,
          },
        ],
        finishReason: "tool_calls",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    }

    const result = lastToolResult(messages);
    assert.equal(result.status, "ready");
    assert.equal(result.funds.length, 5);
    assert.equal(result.window.startDate, "2026-10-23");

    return mockResponse({
      content: "Nifty rose 10.75% over the window; the table shows the top five funds.",
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    });
  };

  const output = await runAgent({
    question: "Who won the 22,600 to 25,000 move?",
    registry,
    status: data.status,
    chat,
  });

  assert.equal(calls, 2);
  assert.equal(output.steps, 2);
  assert.equal(output.trace.length, 1);
  assert.equal(output.trace[0].name, "rank_funds");
  assert.equal(output.trace[0].ok, true);
  assert.equal(output.window.startDate, "2026-10-23");
  assert.equal(output.window.endDate, "2026-11-06");
  assert.match(output.answer, /10\.75%/);
  assert.equal(output.usage.total_tokens, 45);
  assert.equal(output.provider, "mock");
});

await check("feeds invalid tool arguments back to the model", async () => {
  let calls = 0;
  const chat = async ({ messages }) => {
    calls += 1;

    if (calls === 1) {
      return mockResponse({
        toolCalls: [
          {
            id: "call_bad",
            name: "rank_funds",
            arguments: { from: 22600 },
            parseError: null,
          },
        ],
        finishReason: "tool_calls",
      });
    }

    const result = lastToolResult(messages);
    assert.equal(result.status, "error");
    assert.equal(result.code, "invalid_arguments");
    assert.match(result.message, /to is required/);
    return mockResponse({ content: "I need both levels to rank funds." });
  };

  const output = await runAgent({
    question: "Rank funds from 22,600",
    registry,
    status: data.status,
    chat,
  });

  assert.equal(output.trace.length, 1);
  assert.equal(output.trace[0].ok, false);
  assert.match(output.trace[0].error, /to is required/);
  assert.match(output.answer, /both levels/);
});

await check("handles malformed JSON from the provider", async () => {
  let calls = 0;
  const chat = async ({ messages }) => {
    calls += 1;
    if (calls === 1) {
      return mockResponse({
        toolCalls: [
          {
            id: "call_json",
            name: "resolve_window",
            arguments: {},
            parseError: "Tool arguments were not valid JSON.",
          },
        ],
        finishReason: "tool_calls",
      });
    }

    const result = lastToolResult(messages);
    assert.equal(result.code, "invalid_arguments");
    return mockResponse({ content: "The tool call could not be parsed." });
  };

  const output = await runAgent({
    question: "Resolve a window",
    registry,
    status: data.status,
    chat,
  });

  assert.equal(output.trace[0].ok, false);
  assert.match(output.trace[0].error, /not valid JSON/);
});

await check("stops at the step limit and asks for a final answer", async () => {
  let calls = 0;
  const chat = async ({ tools }) => {
    calls += 1;
    if (tools.length === 0) {
      return mockResponse({ content: "Partial answer from the tool results." });
    }
    return mockResponse({
      toolCalls: [
        {
          id: `call_${calls}`,
          name: "list_funds",
          arguments: {},
          parseError: null,
        },
      ],
      finishReason: "tool_calls",
    });
  };

  const output = await runAgent({
    question: "List every fund and keep looking things up",
    registry,
    status: data.status,
    chat,
    maxSteps: 2,
  });

  assert.equal(calls, 3);
  assert.equal(output.steps, 3);
  assert.equal(output.trace.length, 2);
  assert.equal(output.truncated, true);
  assert.match(output.note, /step limit/);
  assert.match(output.answer, /Partial answer/);
});

await check("can include full tool results for auditing", async () => {
  let calls = 0;
  const chat = async () =>
    calls++ === 0
      ? mockResponse({
          toolCalls: [
            {
              id: "call_window",
              name: "resolve_window",
              arguments: { from: 22600, to: 25000 },
              parseError: null,
            },
          ],
          finishReason: "tool_calls",
        })
      : mockResponse({ content: "Resolved." });

  const output = await runAgent({
    question: "Resolve 22,600 to 25,000",
    registry,
    status: data.status,
    chat,
    includeToolResults: true,
  });

  assert.equal(output.trace[0].result.status, "ready");
  assert.equal(output.trace[0].result.endDate, "2026-11-06");
});

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} agent check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${results.length} agent checks passed.`);
