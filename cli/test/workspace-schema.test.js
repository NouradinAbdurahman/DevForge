import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceDoc, validateWorkspaceDoc, migrateWorkspace, CURRENT_SCHEMA_VERSION } from "../src/core/workspace/schema.js";

test("createWorkspaceDoc produces a fully-shaped, already-valid document", () => {
    const doc = createWorkspaceDoc({ name: "acme-backend", description: "Acme backend", owner: "nouradin" });
    assert.equal(doc.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(doc.name, "acme-backend");
    assert.equal(doc.status, "active");
    assert.deepEqual(doc.tags, []);
    assert.deepEqual(doc.git, { name: null, email: null, signingKey: null, defaultBranch: null, hooksPath: null, aliases: {}, credentialHelper: null, lfs: false });
    assert.deepEqual(doc.env, { variables: {}, secretKeys: [] });
    assert.deepEqual(doc.cloud.aws, { ref: null, region: null });
    assert.equal(doc.ai.provider, "none");
    assert.equal(doc.sync.remoteId, null);
    // The factory's own output must satisfy the schema it was built from.
    assert.doesNotThrow(() => validateWorkspaceDoc(doc));
});

test("createWorkspaceDoc falls back to a generated description when none is given", () => {
    const doc = createWorkspaceDoc({ name: "acme-backend" });
    assert.equal(doc.description, "Workspace: acme-backend");
    assert.equal(doc.owner, "");
});

test("validateWorkspaceDoc rejects an unknown top-level field", () => {
    const doc = createWorkspaceDoc({ name: "acme-backend", description: "x" });
    assert.throws(() => validateWorkspaceDoc({ ...doc, bogusField: 1 }), /Invalid workspace document/);
});

test("validateWorkspaceDoc rejects a malformed name", () => {
    assert.throws(
        () => validateWorkspaceDoc({ ...createWorkspaceDoc({ name: "acme-backend", description: "x" }), name: "Bad Name" }),
        /Invalid workspace document/
    );
});

test("validateWorkspaceDoc rejects an invalid status/ai.provider enum value", () => {
    const doc = createWorkspaceDoc({ name: "acme-backend", description: "x" });
    assert.throws(() => validateWorkspaceDoc({ ...doc, status: "not-a-real-status" }));
    assert.throws(() => validateWorkspaceDoc({ ...doc, ai: { ...doc.ai, provider: "not-a-real-provider" } }));
});

test("migrateWorkspace is a no-op for a document already at the current schema version", () => {
    const doc = createWorkspaceDoc({ name: "acme-backend", description: "x" });
    assert.deepEqual(migrateWorkspace(doc), doc);
});

test("migrateWorkspace throws for a schema version newer than this CLI understands", () => {
    const doc = createWorkspaceDoc({ name: "acme-backend", description: "x" });
    assert.throws(
        () => migrateWorkspace({ ...doc, schemaVersion: CURRENT_SCHEMA_VERSION + 1 }),
        /newer version of DevForgeKit/
    );
});

test("migrateWorkspace upgrades a real v1 document (predating the Compatibility Engine) to the current schema, adding `compatibility` with its documented default shape", () => {
    const v2Doc = createWorkspaceDoc({ name: "acme-backend", description: "x" });
    const v1Doc = { ...v2Doc };
    delete v1Doc.compatibility;
    v1Doc.schemaVersion = 1;

    const migrated = migrateWorkspace(v1Doc);
    assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(migrated.compatibility, { scanHistory: [], repairHistory: [] });
    assert.doesNotThrow(() => validateWorkspaceDoc(migrated));
});
