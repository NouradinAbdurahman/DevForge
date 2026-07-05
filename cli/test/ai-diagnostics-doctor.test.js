import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAIDoctor } from "../src/core/ai/diagnostics/doctor.js";

// runAIDoctor() records an AI memory event on every call (core/ai/memory/
// history.js) - isolate HOME so these tests never touch the real
// developer's ~/.config/devforgekit/ai/history.json.
function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-ai-doctor-test-"));
    process.env.HOME = tempHome;
    return async () => {
        try {
            await fn();
        } finally {
            process.env.HOME = originalHome;
            rmSync(tempHome, { recursive: true, force: true });
        }
    };
}

function jsonResponse(body) {
    return { ok: true, status: 200, json: async () => body };
}

function fetchReturning(content) {
    return async () => jsonResponse({ choices: [{ message: { content } }], model: "gpt-4o-mini" });
}

const minimalContext = { cwd: "/tmp", config: {}, workspace: null, git: { isRepo: false }, dockerAvailable: false };

test("runAIDoctor parses a well-formed strict-JSON response into its structured shape", async () => {
    await withTempHome(async () => {
        const content = JSON.stringify({
            summary: "Flutter itself is healthy. The iOS toolchain cannot build.",
            reason: "CocoaPods 1.15 is below the required version.",
            fix: "brew upgrade cocoapods",
            estimatedTime: "15 seconds",
            risk: "none"
        });
        const result = await runAIDoctor({ providerId: "openai", apiKey: "k", fetchImpl: fetchReturning(content), context: minimalContext });
        assert.equal(result.unstructured, undefined);
        assert.match(result.summary, /Flutter itself is healthy/);
        assert.equal(result.fix, "brew upgrade cocoapods");
        assert.equal(result.estimatedTime, "15 seconds");
        assert.equal(result.risk, "none");
    })();
});

test("runAIDoctor tolerates a response wrapped in markdown fences", async () => {
    await withTempHome(async () => {
        const content = "```json\n" + JSON.stringify({ summary: "ok", risk: "low" }) + "\n```";
        const result = await runAIDoctor({ providerId: "openai", apiKey: "k", fetchImpl: fetchReturning(content), context: minimalContext });
        assert.equal(result.summary, "ok");
        assert.equal(result.risk, "low");
    })();
});

test("runAIDoctor falls back to the raw text (marked unstructured) when the model doesn't return valid JSON", async () => {
    await withTempHome(async () => {
        const content = "Everything looks fine, nothing to report.";
        const result = await runAIDoctor({ providerId: "openai", apiKey: "k", fetchImpl: fetchReturning(content), context: minimalContext });
        assert.equal(result.unstructured, true);
        assert.equal(result.summary, content);
        assert.equal(result.risk, "unknown");
    })();
});

test("runAIDoctor never fabricates a fix/estimatedTime the model didn't actually provide", async () => {
    await withTempHome(async () => {
        const content = JSON.stringify({ summary: "Nothing wrong." });
        const result = await runAIDoctor({ providerId: "openai", apiKey: "k", fetchImpl: fetchReturning(content), context: minimalContext });
        assert.equal(result.fix, "");
        assert.equal(result.estimatedTime, "");
    })();
});
