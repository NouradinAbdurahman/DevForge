// verifyWorkspace() - the workspace equivalent of scripts/doctor.sh: a
// PASS/WARNING/FAIL sweep across every subsystem a workspace touches,
// scored with the exact same core/health.js formula every other health
// check in this platform uses (so a workspace's score means the same
// thing a machine's or a recipe's does). FAIL is reserved for structural
// problems (a referenced profile/collection/recipe/component no longer
// exists in the registry - the workspace document itself is now
// internally inconsistent); everything about the *live machine* not yet
// matching the workspace's declared configuration (not installed, wrong
// context, missing CLI) is a WARNING - a workspace can legitimately
// describe a target environment you haven't fully set up yet.
import { existsSync } from "node:fs";
import path from "node:path";
import { homeDir } from "../paths.js";
import { commandExists, captureShellCommand } from "../shell.js";
import { getProfile, getCollection, getRecipe, getPackage, expandProfile, expandRecipe } from "../registry.js";
import { validate } from "../installer.js";
import { discoverPlugins } from "../plugins.js";
import { scoreResults } from "../health.js";
import { validateWorkspaceDoc } from "./schema.js";
import { getSecret } from "./env.js";
import { listDockerContexts } from "./docker.js";
import { listKubeContexts } from "./kubernetes.js";

function expandHome(p) {
    if (!p) return p;
    if (p === "~") return homeDir();
    if (p.startsWith("~/")) return path.join(homeDir(), p.slice(2));
    return p;
}

// resolveWorkspaceComponents(workspace) -> { adHoc: Set, viaExpansion: Set }
// `adHoc` is exactly `workspace.components` (already checked for
// existence, individually, above); `viaExpansion` is everything pulled
// in transitively via the profile/recipes/collections. Kept as two sets
// (rather than one merged list) so the "does this component still exist"
// check below never reports the same missing name twice - once plainly,
// once with a misleading "(pulled in via profile/collection/recipe)"
// suffix. Deliberately does not reuse expandProfile() for the ad hoc
// collections list - expandProfile() throws on the *first* unknown
// collection, which would abort resolving every other (valid) reference;
// each lookup here is isolated instead, so one broken reference (already
// reported as its own FAIL) never hides the rest of the workspace's
// health.
function resolveWorkspaceComponents(workspace) {
    const viaExpansion = new Set();
    if (workspace.profile) {
        try {
            for (const n of expandProfile(getProfile(workspace.profile))) viaExpansion.add(n);
        } catch {
            // Reported by the profile-reference check below.
        }
    }
    for (const recipeName of workspace.recipes || []) {
        try {
            for (const n of expandRecipe(getRecipe(recipeName))) viaExpansion.add(n);
        } catch {
            // Reported by the recipe-reference check below.
        }
    }
    for (const collectionName of workspace.collections || []) {
        try {
            for (const n of getCollection(collectionName).components) viaExpansion.add(n);
        } catch {
            // Reported by the collection-reference check below.
        }
    }
    return { adHoc: new Set(workspace.components || []), viaExpansion };
}

function brewIdsOf(pkg) {
    const steps = pkg.variants ? pkg.variants.map((v) => v.install) : [pkg.install];
    return steps.filter((s) => s && (s.method === "brew-formula" || s.method === "brew-cask")).map((s) => s.id);
}

// verifyWorkspace(workspace) -> { pass, warn, fail, total, score, verdict, results }
export async function verifyWorkspace(workspace) {
    const results = [];
    const push = (status, description) => results.push({ status, description });

    try {
        validateWorkspaceDoc(workspace);
        push("PASS", "Workspace document matches the current schema");
    } catch (err) {
        push("FAIL", `Workspace document is invalid: ${err.message}`);
        return { ...scoreResults(results), results };
    }

    // Registry references
    if (workspace.profile) {
        try {
            getProfile(workspace.profile);
            push("PASS", `Profile '${workspace.profile}' exists in the registry`);
        } catch {
            push("FAIL", `Profile '${workspace.profile}' no longer exists in the registry`);
        }
    }
    for (const name of workspace.collections || []) {
        try {
            getCollection(name);
            push("PASS", `Collection '${name}' exists in the registry`);
        } catch {
            push("FAIL", `Collection '${name}' no longer exists in the registry`);
        }
    }
    for (const name of workspace.recipes || []) {
        try {
            getRecipe(name);
            push("PASS", `Recipe '${name}' exists in the registry`);
        } catch {
            push("FAIL", `Recipe '${name}' no longer exists in the registry`);
        }
    }
    for (const name of workspace.components || []) {
        try {
            getPackage(name);
            push("PASS", `Component '${name}' exists in the registry`);
        } catch {
            push("FAIL", `Component '${name}' no longer exists in the registry`);
        }
    }

    // Plugins - soft: a workspace can reference a plugin not installed
    // on this particular machine yet.
    if ((workspace.plugins || []).length > 0) {
        const discovered = discoverPlugins();
        for (const name of workspace.plugins) {
            const found = discovered.some((p) => p.name === name && p.valid);
            push(found ? "PASS" : "WARNING", found ? `Plugin '${name}' is installed and valid` : `Plugin '${name}' is not currently installed/valid on this machine`);
        }
    }

    // Resolved component installation + outdated Homebrew packages
    const { adHoc, viaExpansion } = resolveWorkspaceComponents(workspace);
    for (const name of viaExpansion) {
        if (adHoc.has(name)) continue; // already checked (and reported) above
        try {
            getPackage(name);
        } catch {
            push("FAIL", `Component '${name}' (pulled in via profile/collection/recipe) no longer exists in the registry`);
        }
    }
    const resolvedPackages = [];
    for (const name of new Set([...adHoc, ...viaExpansion])) {
        try {
            resolvedPackages.push(getPackage(name));
        } catch {
            // Already reported by one of the two existence checks above.
        }
    }
    for (const pkg of resolvedPackages) {
        if (!pkg.validate) continue;
        try {
            const ok = (await validate(pkg)) === 0;
            push(ok ? "PASS" : "WARNING", ok ? `${pkg.name} is installed` : `${pkg.name} is not currently installed on this machine`);
        } catch {
            push("WARNING", `${pkg.name}'s validate check could not run`);
        }
    }
    const brewIds = new Set(resolvedPackages.flatMap(brewIdsOf));
    if (brewIds.size > 0 && (await commandExists("brew"))) {
        const { stdout } = await captureShellCommand("brew outdated 2>/dev/null");
        const outdated = new Set(stdout.split("\n").map((l) => l.trim().split(" ")[0]).filter(Boolean));
        const outdatedInWorkspace = [...brewIds].filter((id) => outdated.has(id));
        push(outdatedInWorkspace.length === 0 ? "PASS" : "WARNING",
            outdatedInWorkspace.length === 0
                ? "No outdated Homebrew packages among this workspace's components"
                : `${outdatedInWorkspace.length} outdated Homebrew package(s) among this workspace's components: ${outdatedInWorkspace.join(", ")}`);
    }

    // Git
    const git = workspace.git || {};
    if (git.name || git.email || git.signingKey || git.lfs) {
        push((await commandExists("git")) ? "PASS" : "FAIL", (await commandExists("git")) ? "git is installed" : "git is not installed, but this workspace declares a git identity");
    }
    if (git.lfs === true) {
        push((await commandExists("git-lfs")) ? "PASS" : "WARNING", (await commandExists("git-lfs")) ? "git-lfs is installed" : "Workspace requests git-lfs, but git-lfs is not installed");
    }
    if (git.hooksPath && !existsSync(expandHome(git.hooksPath))) {
        push("WARNING", `git.hooksPath '${git.hooksPath}' does not exist on disk`);
    }

    // SSH - broken/missing key file paths
    for (const identity of (workspace.ssh || {}).identities || []) {
        if (!identity.identityFile) continue;
        const exists = existsSync(expandHome(identity.identityFile));
        push(exists ? "PASS" : "WARNING", exists
            ? `SSH identity file for '${identity.hostAlias || identity.host}' exists`
            : `SSH identity file '${identity.identityFile}' for '${identity.hostAlias || identity.host}' does not exist on this machine`);
    }

    // Secrets - every declared secret should actually decrypt.
    for (const key of (workspace.env || {}).secretKeys || []) {
        const value = getSecret(workspace, key);
        push(value !== null ? "PASS" : "WARNING", value !== null ? `Secret '${key}' decrypts successfully` : `Secret '${key}' is declared but could not be decrypted (missing/corrupt sidecar or key file)`);
    }

    // Docker / Kubernetes contexts
    if (workspace.docker?.context) {
        const contexts = await listDockerContexts();
        const ok = contexts.includes(workspace.docker.context);
        push(ok ? "PASS" : "WARNING", ok ? `Docker context '${workspace.docker.context}' exists` : `Docker context '${workspace.docker.context}' does not exist locally`);
    }
    if (workspace.kubernetes?.context) {
        const contexts = await listKubeContexts();
        const ok = contexts.includes(workspace.kubernetes.context);
        push(ok ? "PASS" : "WARNING", ok ? `Kubernetes context '${workspace.kubernetes.context}' exists` : `Kubernetes context '${workspace.kubernetes.context}' does not exist locally`);
    }

    // Cloud CLIs (only for the providers with a real switch - see cloud.js)
    for (const [provider, bin] of [["gcp", "gcloud"], ["azure", "az"]]) {
        if (!workspace.cloud?.[provider]?.ref) continue;
        const ok = await commandExists(bin);
        push(ok ? "PASS" : "WARNING", ok ? `${bin} is installed for the declared ${provider} reference` : `Workspace declares a ${provider} reference, but ${bin} is not installed`);
    }

    // AI
    const ai = workspace.ai || {};
    if (ai.provider === "ollama") {
        push((await commandExists("ollama")) ? "PASS" : "WARNING", (await commandExists("ollama")) ? "ollama is installed" : "Workspace's AI provider is ollama, but ollama is not installed");
    } else if (ai.provider && ai.provider !== "none" && ai.provider !== "local") {
        if (!ai.apiKeyRef) {
            push("WARNING", `AI provider '${ai.provider}' has no apiKeyRef declared`);
        } else if (!(workspace.env.secretKeys || []).includes(ai.apiKeyRef)) {
            push("WARNING", `AI provider's apiKeyRef '${ai.apiKeyRef}' is not a declared secret in this workspace`);
        } else {
            push("PASS", `AI provider '${ai.provider}' has a valid apiKeyRef`);
        }
    }

    // Editor
    if (workspace.editor?.app === "vscode" || workspace.editor?.app === "cursor") {
        const bin = workspace.editor.app === "vscode" ? "code" : "cursor";
        const ok = await commandExists(bin);
        push(ok ? "PASS" : "WARNING", ok ? `${workspace.editor.app} CLI ('${bin}') is installed` : `Workspace's editor is ${workspace.editor.app}, but its CLI ('${bin}') is not on PATH`);
    }

    // Package managers
    const pm = workspace.packageManagers || {};
    if (pm.mise && Object.keys(pm.mise.tools || {}).length > 0) {
        const ok = await commandExists("mise");
        push(ok ? "PASS" : "WARNING", ok ? "mise is installed" : "Workspace declares mise-managed tools, but mise is not installed");
    }
    if (pm.brew?.brewfile && !existsSync(expandHome(pm.brew.brewfile))) {
        push("WARNING", `packageManagers.brew.brewfile '${pm.brew.brewfile}' does not exist on disk`);
    }

    return { ...scoreResults(results), results };
}
