import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorkspace, saveWorkspace, getWorkspace, workspaceDir } from "../src/core/workspace/store.js";
import {
    setSecret, getSecret, removeSecret, getAllSecrets, redactedEnvView,
    setVariable, removeVariable, parseEnvFile, serializeEnvFile,
    importEnvFile, exportEnvFile, writeWorkspaceEnvFile
} from "../src/core/workspace/env.js";

async function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-workspace-env-test-"));
    process.env.HOME = tempHome;
    try {
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

test("parseEnvFile handles comments, blank lines, export prefix, and quoted values", () => {
    const parsed = parseEnvFile('NODE_ENV=development\n\n# a comment\nexport FOO="bar baz"\nBROKEN_LINE\nQUOTED=\'hello world\'\n');
    assert.deepEqual(parsed, { NODE_ENV: "development", FOO: "bar baz", QUOTED: "hello world" });
});

test("serializeEnvFile quotes only values that need it, and round-trips through parseEnvFile", () => {
    const vars = { SIMPLE: "value", WITH_SPACE: "hello world", WITH_QUOTE: 'say "hi"' };
    const text = serializeEnvFile(vars);
    assert.match(text, /^SIMPLE=value$/m);
    assert.match(text, /^WITH_SPACE="hello world"$/m);
    assert.deepEqual(parseEnvFile(text), vars);
});

test("setSecret encrypts with AES-256-GCM: workspace.json never contains the plaintext or ciphertext", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        doc = setSecret(doc, "API_KEY", "sk-super-secret-value");
        saveWorkspace(doc);

        const raw = readFileSync(path.join(workspaceDir("acme-backend"), "workspace.json"), "utf8");
        assert.ok(!raw.includes("sk-super-secret-value"));
        assert.match(raw, /"secretKeys":\s*\[\s*"API_KEY"/);

        const reloaded = getWorkspace("acme-backend");
        assert.equal(getSecret(reloaded, "API_KEY"), "sk-super-secret-value");
        assert.deepEqual(reloaded.env.variables, {});
    });
});

test("the encrypted sidecar file holds ciphertext/iv/tag, never plaintext", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        doc = setSecret(doc, "API_KEY", "sk-super-secret-value");
        saveWorkspace(doc);

        const sidecar = JSON.parse(readFileSync(path.join(workspaceDir("acme-backend"), "env", "secrets.enc.json"), "utf8"));
        assert.ok(sidecar.API_KEY.iv && sidecar.API_KEY.tag && sidecar.API_KEY.ciphertext);
        assert.ok(!JSON.stringify(sidecar).includes("sk-super-secret-value"));
        assert.equal((statSync(path.join(workspaceDir("acme-backend"), "env", "secret.key")).mode & 0o777).toString(8), "600");
    });
});

test("setVariable refuses to shadow an existing secret key; removeSecret/removeVariable clean up correctly", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        doc = setSecret(doc, "API_KEY", "secret-value");
        assert.throws(() => setVariable(doc, "API_KEY", "oops"), /is a secret in this workspace/);

        doc = setVariable(doc, "NODE_ENV", "development");
        saveWorkspace(doc);

        let reloaded = getWorkspace("acme-backend");
        reloaded = removeSecret(reloaded, "API_KEY");
        reloaded = removeVariable(reloaded, "NODE_ENV");
        saveWorkspace(reloaded);

        const final = getWorkspace("acme-backend");
        assert.deepEqual(final.env.secretKeys, []);
        assert.deepEqual(final.env.variables, {});
        assert.equal(getSecret(final, "API_KEY"), null);
    });
});

test("redactedEnvView shows plain values as-is and secrets as a fixed placeholder", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        doc = setVariable(doc, "NODE_ENV", "development");
        doc = setSecret(doc, "API_KEY", "sk-super-secret-value");
        assert.deepEqual(redactedEnvView(doc), { NODE_ENV: "development", API_KEY: "<encrypted>" });
    });
});

test("getAllSecrets decrypts every declared secret and skips ones that fail to decrypt", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        doc = setSecret(doc, "API_KEY", "value-1");
        doc = setSecret(doc, "OTHER_KEY", "value-2");
        assert.deepEqual(getAllSecrets(doc), { API_KEY: "value-1", OTHER_KEY: "value-2" });

        // Simulate a secret declared but never actually encrypted (e.g. a
        // bundle import that dropped the sidecar) - must not throw.
        doc.env.secretKeys.push("GHOST_KEY");
        assert.deepEqual(getAllSecrets(doc), { API_KEY: "value-1", OTHER_KEY: "value-2" });
        assert.equal(getSecret(doc, "GHOST_KEY"), null);
    });
});

test("importEnvFile promotes listed keys to secrets and the rest to plain variables", async () => {
    await withTempHome(async (tempHome) => {
        const doc = createWorkspace({ name: "acme-backend", description: "x" });
        const src = path.join(tempHome, "external.env");
        writeFileSync(src, "EXTRA_VAR=hello\nSECRET_TOKEN=topsecret\n");

        const imported = importEnvFile(doc, src, { secretKeys: ["SECRET_TOKEN"] });
        assert.deepEqual(imported.env.variables, { EXTRA_VAR: "hello" });
        assert.deepEqual(imported.env.secretKeys, ["SECRET_TOKEN"]);
        assert.equal(getSecret(imported, "SECRET_TOKEN"), "topsecret");
    });
});

test("importEnvFile throws a clear error for a missing source file", async () => {
    await withTempHome(async (tempHome) => {
        const doc = createWorkspace({ name: "acme-backend", description: "x" });
        assert.throws(() => importEnvFile(doc, path.join(tempHome, "nope.env")), /No such file/);
    });
});

test("exportEnvFile writes plain vars by default, and decrypted secrets only with includeSecrets: true", async () => {
    await withTempHome(async (tempHome) => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        doc = setVariable(doc, "NODE_ENV", "development");
        doc = setSecret(doc, "API_KEY", "sk-value");

        const withoutSecrets = path.join(tempHome, "out1.env");
        exportEnvFile(doc, withoutSecrets, { includeSecrets: false });
        assert.ok(!readFileSync(withoutSecrets, "utf8").includes("sk-value"));

        const withSecrets = path.join(tempHome, "out2.env");
        exportEnvFile(doc, withSecrets, { includeSecrets: true });
        assert.match(readFileSync(withSecrets, "utf8"), /API_KEY=sk-value/);
    });
});

test("writeWorkspaceEnvFile regenerates <workspace dir>/env/vars.env with mode 0600, including secrets", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        doc = setVariable(doc, "NODE_ENV", "development");
        doc = setSecret(doc, "API_KEY", "sk-value");

        const filePath = writeWorkspaceEnvFile(doc);
        assert.equal(filePath, path.join(workspaceDir("acme-backend"), "env", "vars.env"));
        assert.equal((statSync(filePath).mode & 0o777).toString(8), "600");
        const content = readFileSync(filePath, "utf8");
        assert.match(content, /NODE_ENV=development/);
        assert.match(content, /API_KEY=sk-value/);
    });
});
