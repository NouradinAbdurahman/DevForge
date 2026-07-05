import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorkspace, saveWorkspace, getWorkspace } from "../src/core/workspace/store.js";
import { setSecret } from "../src/core/workspace/env.js";
import { verifyWorkspace } from "../src/core/workspace/health.js";

// verifyWorkspace() checks real registry contents (git/component
// existence via loadPackages/loadProfiles/etc, which read from the repo
// itself, not HOME) and real installed-tool state (commandExists) -
// HOME is still isolated so any workspace-local state (secrets sidecar)
// never touches the developer's real ~/.config/devforgekit.
async function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-workspace-health-test-"));
    process.env.HOME = tempHome;
    try {
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

test("a freshly-created, empty workspace scores a clean PASS with no FAILs", async () => {
    await withTempHome(async () => {
        const doc = createWorkspace({ name: "acme-backend", description: "x" });
        const result = await verifyWorkspace(doc);
        assert.equal(result.fail, 0);
        assert.ok(result.results.some((r) => r.description.includes("matches the current schema")));
    });
});

test("an invalid document short-circuits to a single FAIL rather than cascading errors", async () => {
    await withTempHome(async () => {
        const doc = createWorkspace({ name: "acme-backend", description: "x" });
        const result = await verifyWorkspace({ ...doc, status: "not-a-real-status" });
        assert.equal(result.results.length, 1);
        assert.equal(result.results[0].status, "FAIL");
        assert.equal(result.score, 0);
    });
});

test("references to a real component/collection/recipe/profile all PASS", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        // Deliberately small real references (a 2-component profile, a
        // 2-component collection, and a collection-free 7-component
        // recipe) rather than e.g. "ai"/"backend"/"ai-engineer" - those
        // expand into dozens of components, each triggering a real
        // `validate` subprocess below and making this one test take
        // several seconds for no extra coverage.
        doc.profile = "figma";
        doc.collections = ["minimal"];
        doc.recipes = ["embedded-engineer"];
        doc.components = ["git"];
        saveWorkspace(doc);

        const result = await verifyWorkspace(getWorkspace("acme-backend"));
        assert.equal(result.fail, 0);
        assert.ok(result.results.some((r) => r.status === "PASS" && r.description.includes("Profile 'figma'")));
        assert.ok(result.results.some((r) => r.status === "PASS" && r.description.includes("Collection 'minimal'")));
        assert.ok(result.results.some((r) => r.status === "PASS" && r.description.includes("Recipe 'embedded-engineer'")));
        assert.ok(result.results.some((r) => r.status === "PASS" && r.description.includes("Component 'git'")));
    });
});

test("a dangling reference to an unknown profile/collection/recipe/component is a FAIL, reported exactly once each", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        doc.profile = "totally-fake-profile";
        doc.collections = ["totally-fake-collection"];
        doc.recipes = ["totally-fake-recipe"];
        doc.components = ["totally-fake-component"];
        saveWorkspace(doc);

        const result = await verifyWorkspace(getWorkspace("acme-backend"));
        const fails = result.results.filter((r) => r.status === "FAIL");
        assert.equal(fails.length, 4, `expected exactly 4 FAILs, got: ${JSON.stringify(fails)}`);
        assert.equal(fails.filter((r) => r.description.includes("totally-fake-component")).length, 1, "an ad hoc component should be reported as missing exactly once, not twice");
    });
});

test("a declared secret that fails to decrypt is a WARNING, and a healthy one is a PASS", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        doc = setSecret(doc, "API_KEY", "sk-value");
        doc.env.secretKeys.push("GHOST_KEY"); // declared, but never actually encrypted
        saveWorkspace(doc);

        const result = await verifyWorkspace(getWorkspace("acme-backend"));
        assert.ok(result.results.some((r) => r.status === "PASS" && r.description.includes("Secret 'API_KEY' decrypts")));
        assert.ok(result.results.some((r) => r.status === "WARNING" && r.description.includes("Secret 'GHOST_KEY'")));
    });
});

test("a missing SSH identity file and a missing git.hooksPath are WARNINGs, not FAILs", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        doc.git.hooksPath = "/definitely/not/a/real/path";
        doc.ssh.identities = [{ host: "github.com", hostAlias: "gh-acme", identityFile: "/definitely/not/a/real/key" }];
        saveWorkspace(doc);

        const result = await verifyWorkspace(getWorkspace("acme-backend"));
        assert.ok(result.results.some((r) => r.status === "WARNING" && r.description.includes("git.hooksPath")));
        assert.ok(result.results.some((r) => r.status === "WARNING" && r.description.includes("SSH identity file")));
        assert.equal(result.fail, 0);
    });
});

test("an AI provider with no apiKeyRef, or one pointing at an undeclared secret, is a WARNING", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        doc.ai = { provider: "openai", model: "gpt-4", endpoint: null, temperature: null, apiKeyRef: null };
        saveWorkspace(doc);
        let result = await verifyWorkspace(getWorkspace("acme-backend"));
        assert.ok(result.results.some((r) => r.status === "WARNING" && r.description.includes("no apiKeyRef declared")));

        doc = getWorkspace("acme-backend");
        doc.ai.apiKeyRef = "OPENAI_KEY"; // declared but never actually a secret
        saveWorkspace(doc);
        result = await verifyWorkspace(getWorkspace("acme-backend"));
        assert.ok(result.results.some((r) => r.status === "WARNING" && r.description.includes("not a declared secret")));
    });
});
