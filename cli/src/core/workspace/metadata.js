// Rich workspace metadata extraction (v2.1.8). Provides a structured,
// human-readable summary of every subsystem a workspace declares, used by
// the CLI (`workspace metadata`), the TUI overview tab, and the switch
// preview. Pure data extraction — no side effects, no I/O, no async.
import { listSnapshots } from "./snapshot.js";

// getWorkspaceMetadata(doc, { activeName, snapshotCount }) -> a flat
// metadata object suitable for display, search, and the TUI. Every field
// is always present (null/0/[] when unset), so consumers never need
// optional-chaining chains.
export function getWorkspaceMetadata(doc, { activeName = null, snapshotCount = null } = {}) {
    const git = doc.git || {};
    const ssh = doc.ssh || {};
    const env = doc.env || {};
    const docker = doc.docker || {};
    const k8s = doc.kubernetes || {};
    const cloud = doc.cloud || {};
    const ai = doc.ai || {};
    const editor = doc.editor || {};
    const shell = doc.shell || {};
    const pm = doc.packageManagers || {};
    const compat = doc.compatibility || {};

    const cloudProviders = Object.entries(cloud)
        .filter(([, ref]) => ref && ref.ref)
        .map(([provider, ref]) => ({ provider, ref: ref.ref, region: ref.region || null }));

    const lastScan = (compat.scanHistory || []).slice(-1)[0] || null;
    const lastRepair = (compat.repairHistory || []).slice(-1)[0] || null;

    return {
        name: doc.name,
        description: doc.description || "",
        status: doc.status || "active",
        owner: doc.owner || "",
        tags: doc.tags || [],
        createdAt: doc.createdAt || null,
        modifiedAt: doc.modifiedAt || null,
        lastUsedAt: doc.lastUsedAt || null,
        isActive: activeName ? doc.name === activeName : false,
        healthScore: doc.healthScore ?? null,

        profile: doc.profile || null,
        collections: doc.collections || [],
        recipes: doc.recipes || [],
        components: doc.components || [],
        plugins: doc.plugins || [],

        git: {
            name: git.name || null,
            email: git.email || null,
            signingKey: git.signingKey || null,
            defaultBranch: git.defaultBranch || null,
            hooksPath: git.hooksPath || null,
            credentialHelper: git.credentialHelper || null,
            lfs: Boolean(git.lfs),
            aliases: Object.keys(git.aliases || {}).length,
        },
        ssh: {
            identities: (ssh.identities || []).length,
            knownHosts: (ssh.knownHosts || []).length,
            identityDetails: (ssh.identities || []).map((i) => ({
                host: i.host,
                alias: i.hostAlias || i.host,
                user: i.user || null,
                identityFile: i.identityFile || null,
                port: i.port || null,
                provider: i.provider || "custom",
            })),
        },
        env: {
            variableCount: Object.keys(env.variables || {}).length,
            secretCount: (env.secretKeys || []).length,
            variableKeys: Object.keys(env.variables || {}),
            secretKeys: env.secretKeys || [],
        },
        docker: {
            context: docker.context || null,
            composeFiles: docker.composeFiles || [],
            networks: docker.networks || [],
            volumes: docker.volumes || [],
        },
        kubernetes: {
            context: k8s.context || null,
            namespace: k8s.namespace || null,
            clusters: k8s.clusters || [],
        },
        cloud: {
            providers: cloudProviders,
            count: cloudProviders.length,
        },
        ai: {
            provider: ai.provider || "none",
            model: ai.model || null,
            endpoint: ai.endpoint || null,
            temperature: ai.temperature ?? null,
            apiKeyRef: ai.apiKeyRef || null,
        },
        editor: {
            app: editor.app || "none",
            theme: editor.theme || null,
            extensions: editor.extensions || [],
            snippetsProfile: editor.snippetsProfile || null,
        },
        shell: {
            shell: shell.shell || null,
            aliases: Object.keys(shell.aliases || {}).length,
            functions: Object.keys(shell.functions || {}).length,
            prompt: shell.prompt || null,
            theme: shell.theme || null,
            pathAdditions: shell.pathAdditions || [],
        },
        packageManagers: {
            brew: pm.brew?.brewfile || null,
            mise: Object.keys(pm.mise?.tools || {}).length,
            npm: pm.npm?.registry || null,
            pnpm: pm.pnpm?.registry || null,
            pip: pm.pip?.indexUrl || null,
            cargo: pm.cargo?.registry || null,
            go: pm.go?.proxy || null,
        },
        compatibility: {
            lastScanScore: lastScan?.score ?? null,
            lastScanVerdict: lastScan?.verdict || null,
            lastScanAt: lastScan?.timestamp || null,
            lastRepairAt: lastRepair?.timestamp || null,
            scanCount: (compat.scanHistory || []).length,
            repairCount: (compat.repairHistory || []).length,
        },
        projectHistory: doc.projectHistory || [],
        snapshotCount: snapshotCount,
    };
}

// formatMetadataSummary(meta) -> string[] of lines for CLI output.
// Grouped by subsystem with labels, matching the "Better Verification"
// format from the v2.1.8 audit.
export function formatMetadataSummary(meta) {
    const lines = [];
    const r = (label, value) => lines.push(`  ${label.padEnd(14)} ${value}`);

    lines.push(`${meta.name}${meta.isActive ? " (active)" : ""}`);
    lines.push(`  ${meta.description}`);
    lines.push("");
    r("Status", meta.status);
    r("Owner", meta.owner || "(none)");
    r("Tags", meta.tags.join(", ") || "(none)");
    r("Created", meta.createdAt || "?");
    r("Modified", meta.modifiedAt || "?");
    r("Last used", meta.lastUsedAt || "(never)");
    if (meta.healthScore !== null) r("Health", `${meta.healthScore}%`);
    lines.push("");

    lines.push("Git");
    r("  User", meta.git.name || "(not set)");
    r("  Email", meta.git.email || "(not set)");
    r("  Branch", meta.git.defaultBranch || "(default)");
    r("  Signing", meta.git.signingKey ? "enabled" : "disabled");
    r("  LFS", meta.git.lfs ? "enabled" : "disabled");
    r("  Aliases", String(meta.git.aliases));
    lines.push("");

    lines.push("SSH");
    r("  Identities", String(meta.ssh.identities));
    r("  Known hosts", String(meta.ssh.knownHosts));
    for (const id of meta.ssh.identityDetails) {
        lines.push(`    ${id.alias} -> ${id.host}${id.user ? ` (user=${id.user})` : ""}${id.identityFile ? ` key=${id.identityFile}` : ""}`);
    }
    lines.push("");

    lines.push("Environment");
    r("  Variables", String(meta.env.variableCount));
    r("  Secrets", String(meta.env.secretCount));
    lines.push("");

    lines.push("Docker");
    r("  Context", meta.docker.context || "(none)");
    r("  Compose files", String(meta.docker.composeFiles.length));
    lines.push("");

    lines.push("Kubernetes");
    r("  Context", meta.kubernetes.context || "(none)");
    r("  Namespace", meta.kubernetes.namespace || "(default)");
    lines.push("");

    if (meta.cloud.count > 0) {
        lines.push("Cloud");
        for (const c of meta.cloud.providers) {
            r(`  ${c.provider}`, `${c.ref}${c.region ? ` (${c.region})` : ""}`);
        }
        lines.push("");
    }

    lines.push("AI");
    r("  Provider", meta.ai.provider);
    r("  Model", meta.ai.model || "(default)");
    lines.push("");

    lines.push("Editor");
    r("  App", meta.editor.app);
    r("  Extensions", String(meta.editor.extensions.length));
    lines.push("");

    lines.push("Shell");
    r("  Shell", meta.shell.shell || "(default)");
    r("  Aliases", String(meta.shell.aliases));
    r("  Functions", String(meta.shell.functions));
    r("  PATH adds", String(meta.shell.pathAdditions.length));
    lines.push("");

    if (meta.snapshotCount !== null) {
        lines.push("Snapshots");
        r("  Count", String(meta.snapshotCount));
        lines.push("");
    }

    if (meta.compatibility.scanCount > 0) {
        lines.push("Compatibility");
        r("  Scans", String(meta.compatibility.scanCount));
        r("  Last score", meta.compatibility.lastScanScore !== null ? `${meta.compatibility.lastScanScore}% (${meta.compatibility.lastScanVerdict})` : "(none)");
        r("  Repairs", String(meta.compatibility.repairCount));
        lines.push("");
    }

    if (meta.projectHistory.length > 0) {
        lines.push(`Projects (${meta.projectHistory.length})`);
        for (const p of meta.projectHistory.slice(-5)) {
            lines.push(`  ${p.createdAt}  ${p.stack.padEnd(12)}  ${p.name}  (${p.dir})`);
        }
    }

    return lines;
}
