// Workspace manifest schema (v1): ajv validation, a fully-shaped
// defaults factory, and a migration skeleton (see
// docs/WorkspaceManager.md and docs/PlatformArchitecture.md section 14's
// versioning strategy). Mirrors core/plugins.js's "one ajv compile, one
// validate function" pattern - store.js (load), bundle.js (import), and
// every command that hand-builds a workspace document all funnel through
// validateWorkspaceDoc() here, so there is exactly one definition of
// "valid workspace."
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { DevForgeError } from "../errors.js";

// See core/registry.js for why this needs the draft-2020-12 Ajv build.
const ajv = new Ajv2020({ allErrors: true });
const schemaPath = fileURLToPath(new URL("../../schemas/workspace.schema.json", import.meta.url));
const compiledWorkspaceSchema = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")));

export const CURRENT_SCHEMA_VERSION = 2;

function formatAjvErrors(errors) {
    return (errors || []).map((e) => `  ${e.instancePath || "/"} ${e.message}`).join("\n");
}

// validateWorkspaceDoc(doc) -> doc (unchanged) or throws. The one gate
// every workspace document passes through - every other core/workspace/
// module assumes a document that reached it already satisfies this
// schema and never re-checks individual fields itself.
export function validateWorkspaceDoc(doc) {
    if (!compiledWorkspaceSchema(doc)) {
        throw new DevForgeError(`Invalid workspace document:\n${formatAjvErrors(compiledWorkspaceSchema.errors)}`);
    }
    return doc;
}

// createWorkspaceDoc({ name, description, owner }) -> a brand-new,
// fully-shaped, already-valid workspace document. Every subsystem key is
// always present (empty arrays/objects or explicit nulls, never absent)
// specifically so every other core/workspace/*.js module can read
// `workspace.git.name`, `workspace.cloud.aws.ref`, etc. directly - no
// chain of optional-chaining or "did this field ever get added" guards
// scattered across a dozen files. This factory and the schema above are
// the single source of truth for the full shape.
export function createWorkspaceDoc({ name, description, owner = "" }) {
    const now = new Date().toISOString();
    const doc = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        name,
        description: description || `Workspace: ${name}`,
        createdAt: now,
        modifiedAt: now,
        version: "1.0.0",
        owner,
        tags: [],
        status: "active",
        profile: null,
        collections: [],
        recipes: [],
        components: [],
        plugins: [],
        templates: [],
        projectHistory: [],
        variables: {},
        git: {
            name: null,
            email: null,
            signingKey: null,
            defaultBranch: null,
            hooksPath: null,
            aliases: {},
            credentialHelper: null,
            lfs: false
        },
        ssh: { identities: [], knownHosts: [] },
        env: { variables: {}, secretKeys: [] },
        docker: { context: null, composeFiles: [], networks: [], volumes: [] },
        kubernetes: { context: null, namespace: null, clusters: [] },
        cloud: {
            aws: { ref: null, region: null },
            azure: { ref: null, region: null },
            gcp: { ref: null, region: null },
            firebase: { ref: null, region: null },
            supabase: { ref: null, region: null },
            cloudflare: { ref: null, region: null },
            vercel: { ref: null, region: null },
            netlify: { ref: null, region: null }
        },
        ai: { provider: "none", model: null, endpoint: null, temperature: null, apiKeyRef: null },
        editor: { app: "none", theme: null, extensions: [], snippetsProfile: null },
        browser: { app: null, profile: null, extensions: [], bookmarksExportPath: null },
        shell: { shell: null, aliases: {}, functions: {}, prompt: null, theme: null, pathAdditions: [] },
        packageManagers: {
            brew: { brewfile: null },
            mise: { tools: {} },
            npm: { registry: null },
            pnpm: { registry: null },
            pip: { indexUrl: null },
            cargo: { registry: null },
            go: { proxy: null },
            composer: { repository: null },
            gem: { source: null },
            nuget: { source: null }
        },
        sync: { remoteId: null, provider: null, lastSyncedAt: null },
        compatibility: { scanHistory: [], repairHistory: [] }
    };
    return validateWorkspaceDoc(doc);
}

// Migration table: migrations[N] upgrades a valid schemaVersion-N document
// to N+1. The v1 -> v2 entry below (Compatibility Engine, v1.2.5) is the
// first real migration this table has ever needed - every workspace
// created before it predates the `compatibility` field entirely, so
// upgrading just adds it with its documented default shape rather than
// guessing at history that was never recorded.
const migrations = {
    1: (doc) => ({ ...doc, schemaVersion: 2, compatibility: { scanHistory: [], repairHistory: [] } })
};

// migrateWorkspace(doc) -> a document valid under CURRENT_SCHEMA_VERSION,
// applying any registered migrations in order. Throws instead of
// guessing when `doc.schemaVersion` is newer than this CLI understands
// (an older devforgekit reading a workspace written by a newer one) -
// silently truncating unrecognized fields on the next save would be
// real, unrecoverable data loss.
export function migrateWorkspace(doc) {
    let current = doc;
    if (current.schemaVersion > CURRENT_SCHEMA_VERSION) {
        throw new DevForgeError(`Workspace '${current.name}' was created by a newer version of DevForgeKit (schema v${current.schemaVersion}; this CLI supports up to v${CURRENT_SCHEMA_VERSION}). Update DevForgeKit to use it.`);
    }
    while (current.schemaVersion < CURRENT_SCHEMA_VERSION) {
        const migrate = migrations[current.schemaVersion];
        if (!migrate) {
            throw new DevForgeError(`No migration path from workspace schema v${current.schemaVersion} to v${CURRENT_SCHEMA_VERSION}`);
        }
        current = migrate(current);
    }
    return validateWorkspaceDoc(current);
}
