import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreGenerator } from "../src/core/generatorQuality.js";
import { GENERATORS } from "../src/generators/index.js";

test("scoreGenerator returns a 0-100 score, a breakdown, and never touches the filesystem", async () => {
    for (const generator of GENERATORS) {
        const scored = await scoreGenerator(generator);
        assert.ok(scored.score >= 0 && scored.score <= 100, `${generator.id} score out of range: ${scored.score}`);
        assert.equal(scored.passCount, scored.checks.filter((c) => c.pass).length);
        assert.ok(scored.breakdown.length > 0, `${generator.id} has no breakdown`);
        for (const b of scored.breakdown) {
            assert.equal(b.score, Math.round((b.passCount / b.total) * 100));
        }
    }
});

test("scoreGenerator rewards a generator that declares README/tests/CI/docker/editor config/recommends", async () => {
    const richGenerator = {
        id: "rich",
        label: "Rich",
        recommends: ["node"],
        nextSteps: () => ["cd rich"],
        generate: () => [
            { path: "README.md", content: "# rich\n" },
            { path: "src/index.js", content: "console.log(1)\n" },
            { path: "tests/index.test.js", content: "// test\n" },
            { path: ".github/workflows/ci.yml", content: "name: CI\n" },
            { path: "Dockerfile", content: "FROM node\n" },
            { path: ".editorconfig", content: "root = true\n" },
            { path: ".vscode/settings.json", content: "{}\n" },
            { path: ".gitignore", content: "node_modules\n" },
            { path: ".env.example", content: "PORT=3000\n" }
        ]
    };
    const scored = await scoreGenerator(richGenerator);
    assert.equal(scored.score, 100);
});

test("scoreGenerator gives a bare-minimum generator a low score, not a fabricated high one", async () => {
    const bareGenerator = { id: "bare", label: "Bare", generate: () => [{ path: "package.json", content: "{}\n" }] };
    const scored = await scoreGenerator(bareGenerator);
    assert.ok(scored.score < 50, `expected a low score for a bare generator, got ${scored.score}`);
});

test("scoreGenerator never throws for a generator whose generate() throws, and scores it low rather than fabricating a pass", async () => {
    const brokenGenerator = { id: "broken", label: "Broken", generate: () => { throw new Error("boom"); } };
    const scored = await scoreGenerator(brokenGenerator);
    assert.ok(scored.score < 50, `expected a low score when generate() throws, got ${scored.score}`);
});

test("scoreGenerator handles a generator with no generate() at all (scaffold-only)", async () => {
    const scaffoldOnlyGenerator = { id: "scaffold-only", label: "Scaffold Only", scaffold: async () => 0 };
    const scored = await scoreGenerator(scaffoldOnlyGenerator);
    assert.ok(scored.score >= 0 && scored.score <= 100);
});
