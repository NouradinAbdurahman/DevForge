// The Recipe Engine's runtime (v1.2.1, see docs/PlatformArchitecture.md's
// Recipe system section). Recipes reuse the exact same collection/
// component resolution and installer every profile already uses
// (core/registry.js's loadRecipes/expandRecipe, core/installer.js's
// installPlan) - this module only adds the two things a profile doesn't
// have: a `configure` step (cross-cutting dotfile/environment
// restoration) and a `verify` step (a post-install health pass), so
// `recipe install <name>` really is "install + configure + verify" in
// one command, matching the product brief's example verbatim.
import { spawn } from "node:child_process";
import { scriptPath } from "./paths.js";
import { getPackage } from "./registry.js";
import { validate } from "./installer.js";
import { DevForgeError } from "./errors.js";

// Cross-cutting configure actions a recipe can request, each a thin,
// zero-duplication call into the exact Layer 1 function
// scripts/restore.sh already runs for the same purpose (see
// restore_git/restore_editor/restore_zsh/restore_mise in
// scripts/common.sh). Kept as a lookup table, not a switch, so this
// implementation and the schema enum
// (registry/schema/recipe.schema.json's `configure` items) are trivially
// kept in sync - one entry each. Deliberately does *not* include "fonts"
// or tool-specific setup (e.g. "ollama") - those are just regular
// registry components/`post_install` steps (see registry/packages/
// ollama.yaml), not cross-cutting environment configuration.
const CONFIGURE_ACTIONS = {
    git: "restore_git",
    vscode: "restore_editor vscode",
    cursor: "restore_editor cursor",
    shell: "restore_zsh",
    mise: "restore_mise"
};

export function configureActionNames() {
    return Object.keys(CONFIGURE_ACTIONS);
}

// runConfigureStep(name, [{ onOutput }]) -> Promise<exitCode>. Sources
// scripts/common.sh in a fresh bash process and calls the one function
// needed - no new Layer 1 script or flag required, and no risk of
// re-running the other, unrelated restore steps scripts/restore.sh
// always runs as a fixed batch. Inherits stdio by default so the same
// log_success/log_warn output restore.sh itself prints shows up here
// too; `onOutput(text, stream)` switches to piped stdio for the TUI
// (same pattern as core/shell.js's runShellCommand - a child writing
// straight to the terminal would corrupt Ink's render loop).
export function runConfigureStep(name, { onOutput } = {}) {
    const fn = CONFIGURE_ACTIONS[name];
    if (!fn) {
        throw new DevForgeError(`Unknown configure action '${name}'. Known: ${configureActionNames().join(", ")}`);
    }
    const commonSh = scriptPath("scripts/common.sh");

    return new Promise((resolve, reject) => {
        const child = spawn("/bin/bash", ["-c", `source "${commonSh}" && ${fn}`], {
            stdio: onOutput ? ["ignore", "pipe", "pipe"] : "inherit"
        });
        if (onOutput) {
            child.stdout.on("data", (chunk) => onOutput(chunk.toString(), "stdout"));
            child.stderr.on("data", (chunk) => onOutput(chunk.toString(), "stderr"));
        }
        child.on("error", reject);
        child.on("close", (code) => resolve(code ?? 0));
    });
}

// verifyComponents(names, [options]) -> { total, passed, failed, results}.
// Runs every resolved component's `validate` command (the same one
// installPlan() uses to decide "already satisfied") and reports an
// explicit PASS/FAIL/skip per component instead of installPlan's silent
// skip decision - this is the recipe's "verify everything" step. A
// component with no `validate` command, or one no longer in the
// registry, is reported as skipped/unknown rather than a hard failure -
// verification can only be as complete as the manifests it's checking.
// `packages` is the same test-only registry override
// resolveInstallOrder/installPlan accept, letting unit tests exercise
// pass/fail/skip/unknown against an in-memory fixture instead of the
// real registry.
export async function verifyComponents(names, { packages } = {}) {
    const lookup = packages ? new Map(packages.map((p) => [p.name, p])) : null;
    const results = [];

    for (const name of names) {
        let pkg;
        try {
            pkg = lookup ? lookup.get(name) : getPackage(name);
        } catch {
            pkg = undefined;
        }
        if (!pkg) {
            results.push({ name, status: "unknown" });
            continue;
        }

        if (!pkg.validate) {
            results.push({ name, status: "skipped" });
            continue;
        }

        try {
            const code = await validate(pkg);
            results.push({ name, status: code === 0 ? "pass" : "fail" });
        } catch {
            results.push({ name, status: "fail" });
        }
    }

    const passed = results.filter((r) => r.status === "pass").length;
    const failed = results.filter((r) => r.status === "fail").length;
    return { total: results.length, passed, failed, results };
}
