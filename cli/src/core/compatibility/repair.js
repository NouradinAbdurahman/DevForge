// The Repair Engine: turns a scanCompatibility() result into a concrete,
// structured plan (planRepair), then optionally executes it
// (executeRepairPlan) - reusing core/installer.js's install/uninstall
// rather than reimplementing package management. Every destructive step
// (removing a conflicting package) always goes through a confirmation
// prompt unless the caller explicitly passes `assumeYes` - see
// docs/RepairGuide.md.
import { getPackage } from "../registry.js";
import { install, uninstall } from "../installer.js";
import { runShellCommand } from "../shell.js";
import { confirm } from "../../lib/prompts.js";

// planRepair(scanResult) -> [{ type: "install"|"shell"|"conflict"|"manual", ... }]
// Reads the structured fields engine.js attaches to each issue
// (`dependency`, `conflictWith`, `variantConflict`, `recommendation`)
// rather than parsing prose messages back apart - one issue can produce at
// most one action, and issues without an actionable recommendation are
// simply omitted (there's nothing to repair automatically).
export function planRepair(scanResult) {
    const actions = [];
    for (const issue of scanResult.issues) {
        if (issue.severity !== "CRITICAL" && issue.severity !== "WARNING") continue;

        if (issue.variantConflict) {
            actions.push({ type: "manual", tool: issue.tool, message: issue.message });
            continue;
        }
        if (issue.conflictWith) {
            actions.push({ type: "conflict", tool: issue.tool, conflictWith: issue.conflictWith, message: issue.message });
            continue;
        }
        if (issue.dependency && issue.recommendation?.startsWith("devforgekit component install ")) {
            actions.push({ type: "install", name: issue.dependency, reason: issue.message });
            continue;
        }
        if (issue.recommendation?.startsWith("Run: ")) {
            actions.push({ type: "shell", tool: issue.tool, command: issue.recommendation.slice("Run: ".length), reason: issue.message });
        }
    }
    return actions;
}

// executeRepairPlan(actions, [{ assumeYes, onOutput }]) -> [{ action, ok, skipped?, error? }]
// `manual` actions are never executable (see engine.js's variantConflict
// comment - the registry only tracks one package for two conflicting
// variants, so there's no single thing to uninstall) and are always
// reported as skipped.
export async function executeRepairPlan(actions, { assumeYes = false, onOutput } = {}) {
    const results = [];
    for (const action of actions) {
        if (action.type === "manual") {
            results.push({ action, ok: false, skipped: true });
            continue;
        }
        if (action.type === "install") {
            const pkg = getPackage(action.name);
            const code = await install(pkg, undefined, { onOutput });
            results.push({ action, ok: code === 0 });
            continue;
        }
        if (action.type === "shell") {
            const code = await runShellCommand(action.command, { onOutput });
            results.push({ action, ok: code === 0 });
            continue;
        }
        if (action.type === "conflict") {
            if (!assumeYes && !(await confirm(`${action.message} - uninstall '${action.conflictWith}' to resolve?`, false))) {
                results.push({ action, ok: false, skipped: true });
                continue;
            }
            try {
                const code = await uninstall(getPackage(action.conflictWith), { onOutput });
                results.push({ action, ok: code === 0 });
            } catch (err) {
                results.push({ action, ok: false, error: err.message });
            }
        }
    }
    return results;
}
