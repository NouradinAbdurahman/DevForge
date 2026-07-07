// The generic executor for any registry package manifest (see
// docs/PlatformArchitecture.md section 6): dispatches an install/
// validate/repair/update/uninstall step on its `method`, runs any
// post_install steps after a successful install, and resolves a
// dependency-ordered install plan across one or more requested packages.
import { runShellCommand, captureShellCommandWithDetails } from "./shell.js";
import { getPackage } from "./registry.js";
import { DevForgeError } from "./errors.js";
import { emitInstallEvent } from "./events.js";
import { diagnoseFailure, logInstallation, updateVerificationStatus, INSTALL_STATUS } from "./installAudit.js";
import { getPlatform } from "./platform/index.js";

// resolvePlatformInstall(pkg) - if the manifest declares a
// `platformInstall` map with an entry for the current platform, return
// that step; otherwise fall back to the top-level `install` field.
// This lets a single package manifest support macOS (brew), Linux (apt),
// and Windows (winget) without variants or separate files.
function resolvePlatformInstall(pkg) {
    if (pkg.platformInstall) {
        const platformId = getPlatform().id;
        if (pkg.platformInstall[platformId]) {
            return pkg.platformInstall[platformId];
        }
    }
    return pkg.install;
}

// commandForStep(step, action) - "action" ("install"/"uninstall") picks
// the right verb per method, since most package managers use a different
// subcommand to remove something than to add it (`brew install` vs
// `brew uninstall`, etc.) - reusing the install command for uninstall
// would silently no-op instead of removing anything. Delegates to the
// current platform adapter (see core/platform/) rather than hardcoding
// Homebrew - on macOS this produces the exact same commands it always
// has (including tapping an optional `step.tap` before brew-formula/
// brew-cask steps); on Linux/Windows it throws a clear
// PlatformNotSupportedError for brew-specific methods while npm/pip/
// cargo/mise/shell steps (already OS-agnostic) work unchanged.
export function commandForStep(step, action) {
    return getPlatform().installCommand(step, action);
}

export function resolveInstallStep(pkg, variantId) {
    if (pkg.variants) {
        const variant = variantId
            ? pkg.variants.find((v) => v.id === variantId)
            : pkg.variants[0];
        if (!variant) {
            const known = pkg.variants.map((v) => v.id).join(", ");
            throw new DevForgeError(`Unknown variant '${variantId}' for '${pkg.name}'. Available: ${known}`);
        }
        if (variant.platformInstall) {
            const platformId = getPlatform().id;
            if (variant.platformInstall[platformId]) {
                return variant.platformInstall[platformId];
            }
        }
        return variant.install;
    }
    return resolvePlatformInstall(pkg);
}

// The optional `{ onOutput }` on install/repair/update/uninstall is the
// TUI's live-log hook (see core/shell.js) - omitted by every classic CLI
// caller, whose inherited-stdio behavior is unchanged.
export async function install(pkg, variantId, { onOutput } = {}) {
    const step = resolveInstallStep(pkg, variantId);
    const code = await runShellCommand(commandForStep(step, "install"), { onOutput });
    if (code !== 0) return code;

    for (const postStep of pkg.post_install || []) {
        const postCode = await runShellCommand(postStep, { onOutput });
        if (postCode !== 0) return postCode;
    }
    return 0;
}

// installWithDetails(pkg, variantId, { onOutput, timeoutMs }) - the
// structured-error counterpart to install(): returns a rich result object
// with exitCode, stdout, stderr, failureReason, and suggestedFix instead
// of a bare exit code. Used by the TUI and `registry verify` so every
// install failure includes a precise reason and actionable fix.
export async function installWithDetails(pkg, variantId, { onOutput, timeoutMs } = {}) {
    const step = resolveInstallStep(pkg, variantId);
    const command = commandForStep(step, "install");
    const installer = step.method || "shell";

    const result = await captureShellCommandWithDetails(command, { onOutput, timeoutMs });

    const installResult = {
        name: pkg.name,
        success: result.code === 0,
        exitCode: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        command,
        installer,
        elapsedMs: result.elapsedMs,
        timedOut: result.timedOut,
        timestamp: new Date().toISOString()
    };

    if (result.code !== 0) {
        const diagnosis = diagnoseFailure(command, result.stderr, result.code, result.timedOut);
        installResult.failureReason = diagnosis.reason;
        installResult.failureMessage = diagnosis.message;
        installResult.suggestedFix = diagnosis.suggestedFix;
        installResult.failureCategory = diagnosis.category;
    }

    // Run post-install steps if install succeeded
    if (result.code === 0 && pkg.post_install) {
        for (const postStep of pkg.post_install) {
            const postResult = await captureShellCommandWithDetails(postStep, { onOutput, timeoutMs });
            if (postResult.code !== 0) {
                const postDiagnosis = diagnoseFailure(postStep, postResult.stderr, postResult.code, postResult.timedOut);
                installResult.success = false;
                installResult.exitCode = postResult.code;
                installResult.stderr = postResult.stderr;
                installResult.failureReason = postDiagnosis.reason;
                installResult.failureMessage = `Post-install step failed: ${postDiagnosis.message}`;
                installResult.suggestedFix = postDiagnosis.suggestedFix;
                break;
            }
        }
    }

    // Log the installation
    logInstallation(pkg.name, installResult);

    return installResult;
}

export async function validate(pkg) {
    if (!pkg.validate) {
        throw new DevForgeError(`'${pkg.name}' has no validate command defined`);
    }
    return runShellCommand(pkg.validate, { silent: true });
}

export async function repair(pkg, { onOutput } = {}) {
    if (!pkg.repair) {
        throw new DevForgeError(`'${pkg.name}' has no repair command defined`);
    }
    return runShellCommand(pkg.repair, { onOutput });
}

export async function update(pkg, { onOutput } = {}) {
    if (!pkg.update) {
        throw new DevForgeError(`'${pkg.name}' has no update command defined`);
    }
    return runShellCommand(pkg.update, { onOutput });
}

export async function uninstall(pkg, { onOutput } = {}) {
    const step = resolvePlatformInstall(pkg);
    const uninstallStep = pkg.uninstall || step;
    if (!uninstallStep) {
        throw new DevForgeError(`'${pkg.name}' has no uninstall command defined`);
    }
    return runShellCommand(commandForStep(uninstallStep, "uninstall"), { onOutput });
}

// resolveInstallOrder(names) -> [package manifest, ...] in dependency-first
// order (a component's `dependencies` are always resolved and returned
// before the component itself), deduplicated across the whole requested
// set (DFS post-order topological sort). Throws a clear DevForgeError on
// a dependency cycle rather than recursing forever - see
// docs/PlatformArchitecture.md's dependency-graph section. `packages` is
// an optional pre-loaded array to resolve against instead of the real
// registry - lets unit tests exercise cycle detection with a small
// in-memory fixture rather than needing a (deliberately broken) fixture
// on disk.
export function resolveInstallOrder(names, { packages } = {}) {
    const lookup = packages ? new Map(packages.map((p) => [p.name, p])) : null;
    const visited = new Set();
    const visiting = new Set();
    const order = [];

    function visit(name) {
        if (visited.has(name)) return;
        if (visiting.has(name)) {
            throw new DevForgeError(`Dependency cycle detected: '${name}' depends (directly or transitively) on itself`);
        }
        visiting.add(name);
        const pkg = lookup ? lookup.get(name) : getPackage(name);
        if (!pkg) {
            throw new DevForgeError(`Unknown component '${name}'`);
        }
        for (const dep of pkg.dependencies || []) {
            visit(dep);
        }
        visiting.delete(name);
        visited.add(name);
        order.push(pkg);
    }

    for (const name of names) {
        visit(name);
    }

    return order;
}

// installPlan(names, options) -> { plan, results }. Resolves the full
// dependency-ordered plan for `names`, then installs each step in order,
// skipping any step whose `validate` command already passes ("already
// satisfied" - cheap and avoids reinstalling a shared dependency five
// times when five requested components all depend on it). `variants` is
// an optional { [packageName]: variantId } map - only ever relevant for
// the top-level requested names, not pulled-in dependencies, since a
// dependency's variant choice isn't something the caller is asked about.
// `onStep(pkg, index, total)` is an optional callback fired before each
// step, so a command module can drive a progress bar without this
// (UI-agnostic) module depending on one. `packages` is the same
// test-only registry override `resolveInstallOrder` accepts.
export async function installPlan(names, { variants = {}, onStep, onOutput, packages } = {}) {
    const plan = resolveInstallOrder(names, { packages });
    const results = [];

    for (let i = 0; i < plan.length; i++) {
        const pkg = plan[i];
        if (onStep) onStep(pkg, i, plan.length);

        let alreadySatisfied = false;
        if (pkg.validate) {
            try {
                alreadySatisfied = (await validate(pkg)) === 0;
            } catch {
                alreadySatisfied = false;
            }
        }

        if (alreadySatisfied) {
            results.push({ name: pkg.name, status: "skipped", code: 0, durationMs: 0 });
            continue;
        }

        // Elapsed time is measured live, per install, rather than stored
        // as a static "install time" field on the manifest - actual time
        // varies by network speed, cache state, and hardware, so a
        // fabricated number would mislead; an observed one doesn't (same
        // reasoning as "install size" in docs/PlatformArchitecture.md).
        emitInstallEvent("before", { name: pkg.name, category: pkg.category });
        const start = Date.now();
        const details = await installWithDetails(pkg, variants[pkg.name], { onOutput });
        const durationMs = Date.now() - start;
        const status = details.success ? "installed" : "failed";
        results.push({
            name: pkg.name,
            status,
            code: details.exitCode,
            durationMs,
            failureReason: details.failureReason || null,
            failureMessage: details.failureMessage || null,
            suggestedFix: details.suggestedFix || null,
            stdout: details.stdout || null,
            stderr: details.stderr || null
        });
        emitInstallEvent("after", { name: pkg.name, category: pkg.category, status, code: details.exitCode, durationMs });
    }

    return { plan, results };
}
