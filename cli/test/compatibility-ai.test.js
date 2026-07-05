import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAIRecommendations } from "../src/core/compatibility/ai.js";

function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-compat-ai-test-"));
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

const fakeScanResult = { issues: [{ severity: "PASS", tool: "git", message: "ok" }], score: 100, verdict: "Healthy" };

test("getAIRecommendations throws a clear, actionable error when no provider is configured", async () => {
    await withTempHome(async () => {
        await assert.rejects(() => getAIRecommendations(fakeScanResult), /No AI provider configured/);
    })();
});

test("getAIRecommendations throws when a cloud provider is configured but has no resolvable API key", async () => {
    await withTempHome(async () => {
        await assert.rejects(
            () => getAIRecommendations(fakeScanResult, { providerId: "openai" }),
            /no API key was found/
        );
    })();
});

test("getAIRecommendations calls the real provider chat() and returns its content when properly configured", async () => {
    await withTempHome(async () => {
        const original = process.env.OPENAI_API_KEY;
        process.env.OPENAI_API_KEY = "sk-test";
        try {
            const fetchImpl = async () => ({
                ok: true,
                status: 200,
                json: async () => ({ choices: [{ message: { content: "Everything here is healthy." } }] })
            });
            const result = await getAIRecommendations(fakeScanResult, { providerId: "openai", fetchImpl });
            assert.equal(result, "Everything here is healthy.");
        } finally {
            if (original === undefined) delete process.env.OPENAI_API_KEY;
            else process.env.OPENAI_API_KEY = original;
        }
    })();
});
