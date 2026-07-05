import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { recordEvent, getHistory, clearHistory } from "../src/core/ai/memory/history.js";

function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-ai-memory-test-"));
    process.env.HOME = tempHome;
    return async () => {
        try {
            await fn(tempHome);
        } finally {
            process.env.HOME = originalHome;
            rmSync(tempHome, { recursive: true, force: true });
        }
    };
}

test("getHistory() returns [] when nothing has been recorded yet", async () => {
    await withTempHome(async () => {
        assert.deepEqual(getHistory(), []);
    })();
});

test("recordEvent() persists a structured entry - type, summary, timestamp, and any extra fields - never a conversation transcript", async () => {
    await withTempHome(async () => {
        const entry = recordEvent("ai-doctor", "Everything looks healthy", { risk: "none" });
        assert.equal(entry.type, "ai-doctor");
        assert.equal(entry.summary, "Everything looks healthy");
        assert.equal(entry.risk, "none");
        assert.ok(entry.timestamp);
        assert.ok(!("messages" in entry), "history entries must never carry raw chat content");

        const history = getHistory();
        assert.equal(history.length, 1);
        assert.deepEqual(history[0], entry);
    })();
});

test("recordEvent() appends across calls and caps at 200 entries", async () => {
    await withTempHome(async () => {
        for (let i = 0; i < 205; i++) recordEvent("ai-chat", `turn ${i}`);
        const history = getHistory();
        assert.equal(history.length, 200);
        assert.equal(history[0].summary, "turn 5"); // the oldest 5 were dropped
        assert.equal(history[199].summary, "turn 204");
    })();
});

test("clearHistory() resets to an empty log", async () => {
    await withTempHome(async () => {
        recordEvent("ai-chat", "one");
        clearHistory();
        assert.deepEqual(getHistory(), []);
    })();
});

test("getHistory() degrades to [] rather than throwing on a corrupt history file", async () => {
    await withTempHome(async (tempHome) => {
        const fs = await import("node:fs");
        const file = path.join(tempHome, ".config", "devforgekit", "ai", "history.json");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "{not valid json");
        assert.deepEqual(getHistory(), []);
    })();
});
