// Tests for the in-memory chat session (core/ai/chat/session.js),
// including the v2.1.3.1 `surface: "tui"` option that layers in the
// TUI-specific system prompt addendum. Uses an injected `fetchImpl` -
// the same dependency-injection convention every provider client
// already tests against - so this never makes a real network call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatSession } from "../src/core/ai/chat/session.js";

function jsonResponse(body) {
    return { ok: true, status: 200, json: async () => body };
}

function captureFirstRequestFetch() {
    const captured = { calls: [] };
    const fetchImpl = async (_url, init) => {
        const body = JSON.parse(init.body);
        captured.calls.push(body);
        return jsonResponse({ choices: [{ message: { content: "a response" } }], model: "gpt-4o-mini" });
    };
    return { captured, fetchImpl };
}

test("send() primes the session with a system message on the first turn only", async () => {
    const { captured, fetchImpl } = captureFirstRequestFetch();
    const session = createChatSession({ providerId: "openai", apiKey: "sk-test", model: "gpt-4o-mini", fetchImpl });

    await session.send("hello");
    await session.send("follow-up");

    assert.equal(captured.calls[0].messages[0].role, "system");
    assert.equal(captured.calls[1].messages.filter((m) => m.role === "system").length, 1);
    assert.equal(session.getTurns().length, 5); // system + user + assistant + user + assistant
});

test("without { surface: 'tui' }, the session's system prompt is the plain CLI prompt", async () => {
    const { captured, fetchImpl } = captureFirstRequestFetch();
    const session = createChatSession({ providerId: "openai", apiKey: "sk-test", model: "gpt-4o-mini", fetchImpl });
    await session.send("hello");
    assert.ok(!captured.calls[0].messages[0].content.includes("terminal dashboard"));
});

test("with { surface: 'tui' }, the session primes with the TUI system prompt addendum", async () => {
    const { captured, fetchImpl } = captureFirstRequestFetch();
    const session = createChatSession({ providerId: "openai", apiKey: "sk-test", model: "gpt-4o-mini", fetchImpl, surface: "tui" });
    await session.send("hello");
    assert.match(captured.calls[0].messages[0].content, /terminal dashboard/);
});

test("reset() clears turns and re-primes on the next send()", async () => {
    const { captured, fetchImpl } = captureFirstRequestFetch();
    const session = createChatSession({ providerId: "openai", apiKey: "sk-test", model: "gpt-4o-mini", fetchImpl });
    await session.send("hello");
    session.reset();
    assert.equal(session.getTurns().length, 0);
    await session.send("hello again");
    assert.equal(captured.calls[1].messages[0].role, "system");
});
