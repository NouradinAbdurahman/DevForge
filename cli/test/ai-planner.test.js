import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { planGoal } from "../src/core/ai/planner/planner.js";

// planGoal() records an AI memory event (core/ai/memory/history.js) -
// isolate HOME so these tests never touch the real developer's history.
function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-ai-planner-test-"));
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

function fetchReturning(body) {
    return async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }) });
}

test("planGoal resolves a well-formed plan using only real registry names", async () => {
    await withTempHome(async () => {
        const plan = await planGoal("I want to become a backend engineer", {
            providerId: "openai",
            apiKey: "k",
            fetchImpl: fetchReturning({ profileName: "backend-path", description: "Backend engineering setup", collections: ["backend"], recipes: ["backend-developer"], components: ["git"] })
        });
        assert.equal(plan.profileName, "backend-path");
        assert.deepEqual(plan.collections, ["backend"]);
        assert.deepEqual(plan.recipes, ["backend-developer"]);
        assert.deepEqual(plan.components, ["git"]);
        assert.deepEqual(plan.dropped, []);
    })();
});

test("planGoal drops (never installs) any name the model invents that isn't real", async () => {
    await withTempHome(async () => {
        const plan = await planGoal("some goal", {
            providerId: "openai",
            apiKey: "k",
            fetchImpl: fetchReturning({
                profileName: "made-up",
                collections: ["backend", "totally-fake-collection"],
                recipes: ["totally-fake-recipe"],
                components: ["git", "totally-fake-component"]
            })
        });
        assert.deepEqual(plan.collections, ["backend"]);
        assert.deepEqual(plan.recipes, []);
        assert.deepEqual(plan.components, ["git"]);
        assert.deepEqual(plan.dropped.sort(), ["totally-fake-collection", "totally-fake-component", "totally-fake-recipe"].sort());
    })();
});

test("planGoal throws a clear error rather than guessing when the model's response has no profileName", async () => {
    await withTempHome(async () => {
        await assert.rejects(
            () => planGoal("goal", { providerId: "openai", apiKey: "k", fetchImpl: fetchReturning({ notes: "not a plan" }) }),
            /unexpected response/
        );
    })();
});

test("planGoal falls back to a generated description when the model omits one", async () => {
    await withTempHome(async () => {
        const plan = await planGoal("learn devops", {
            providerId: "openai",
            apiKey: "k",
            fetchImpl: fetchReturning({ profileName: "devops-path", collections: [], recipes: [], components: [] })
        });
        assert.match(plan.description, /learn devops/);
    })();
});
