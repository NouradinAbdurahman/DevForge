// Validates a built environment model against the real filesystem/shell
// state - the engine behind `devforgekit env doctor` and the eventual
// `environment` repair.js scanner category. Returns one result per real
// check performed (PASS included, not just failures) so callers can
// feed the array straight into core/health.js's scoreResults() - the
// same PASS/WARNING/FAIL formula check.sh/doctor.sh/every other
// "doctor"-style command in this CLI already uses.
//
// Every failing PATH/variable check is attributed to the package that
// contributed it (model.pathOwners / def.sourcePackage) and carries the
// concrete fix - `devforgekit component repair <pkg>` - not just
// "regenerate the shell file", because a missing directory usually
// means the PACKAGE is broken/removed, and regenerating would only
// reproduce the same dangling reference.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { homeDir } from "../paths.js";
import { commandExists } from "../shell.js";
import { isEnvironmentHookInstalled } from "./hook.js";
import { shellFilePath } from "./shellFile.js";
import { renderShellFile } from "./writers/index.js";
import { trackedNames } from "./state.js";
import { discoverPackage } from "./discovery.js";
import { findBinaryConflicts, describeConflict } from "./conflicts.js";
import { getPackage } from "../registry.js";

// findVersionedReplacement(missingPath) -> when a missing directory's
// path contains a version-looking segment ("openjdk@21", "node-18",
// "3.44.4"), look for a sibling that differs ONLY in that version token
// and whose remaining sub-path also exists - the classic `brew upgrade`
// aftermath, where /opt/homebrew/opt/openjdk@21/bin vanishes and
// .../openjdk@22/bin appears. Returns the replacement path or null.
// Detection only: the entry comes from a registry manifest, which the
// engine reports but never rewrites (a dynamic `$(brew --prefix ...)`
// entry is the durable fix, and never hits this case at all).
const VERSION_SEGMENT = /^(.*?)(\d+(?:\.\d+)*)([^/]*)$/;

export function findVersionedReplacement(missingPath) {
    const segments = missingPath.split(path.sep);
    for (let i = segments.length - 1; i > 0; i--) {
        const match = VERSION_SEGMENT.exec(segments[i]);
        if (!match || !/[@\-.\d]/.test(segments[i])) continue;
        const [, prefix, , suffix] = match;
        if (!prefix && !suffix) continue; // a purely-numeric segment has nothing stable to match on

        const parent = segments.slice(0, i).join(path.sep) || path.sep;
        if (!existsSync(parent)) continue;

        let siblings;
        try {
            siblings = readdirSync(parent);
        } catch {
            continue;
        }
        for (const sibling of siblings) {
            if (sibling === segments[i]) continue;
            const siblingMatch = VERSION_SEGMENT.exec(sibling);
            if (!siblingMatch || siblingMatch[1] !== prefix || siblingMatch[3] !== suffix) continue;
            const candidate = [parent, sibling, ...segments.slice(i + 1)].join(path.sep);
            if (existsSync(candidate)) return candidate;
        }
    }
    return null;
}

// expandExpression(expr, variables) -> best-effort literal value, expanding
// $HOME and any value-based variable this same model defines. A
// command-based variable's value can't be known without executing it,
// so a reference to one is left unexpanded - an honest "can't verify"
// rather than a guessed value.
function expandExpression(expr, variables, depth = 0) {
    if (depth > 5) return expr;
    return expr.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (match, name) => {
        if (name === "HOME") return homeDir();
        const def = variables[name];
        if (def?.value) return expandExpression(def.value, variables, depth + 1);
        if (process.env[name]) return process.env[name];
        return match;
    });
}

function owners(model, entry) {
    const list = model.pathOwners?.[entry] || [];
    return list.length > 0 ? list : null;
}

function repairHint(packages) {
    if (!packages) return "";
    const from = ` (from ${packages.join(", ")})`;
    const fix = ` - suggested repair: devforgekit component repair ${packages[0]}`;
    return `${from}${fix}`;
}

export async function validateEnvironment(model, { shell, state, resolvePackage = getPackage, capture, detectVersion } = {}) {
    const results = [];

    // Entries containing a command substitution ($(...), e.g.
    // "$(brew --prefix openjdk)/bin") can't be existence-checked without
    // executing them - checked the same honest way as a command-based
    // variable instead (does the underlying binary resolve at all),
    // rather than falsely reporting the literal, unexpanded string as a
    // missing directory. Plain entries (possibly with $HOME/$VAR)
    // resolve to a real path and get a real existence + duplicate check.
    const resolvedPaths = new Map();
    for (const entry of model.path) {
        const entryOwners = owners(model, entry);
        const pkg = entryOwners?.[0];
        const commandMatch = entry.match(/\$\(([^)]+)\)/);
        if (commandMatch) {
            const bin = commandMatch[1].trim().split(/\s+/)[0];
            const exists = bin ? await commandExists(bin) : false;
            results.push(
                exists
                    ? { status: "PASS", package: pkg, message: `PATH entry's command is resolvable: ${entry}` }
                    : { status: "WARNING", package: pkg, message: `PATH entry depends on '${bin}', which is not on PATH: ${entry}${repairHint(entryOwners)}` }
            );
            continue;
        }

        const expanded = expandExpression(entry, model.variables);
        const resolved = path.resolve(expanded);
        if (!resolvedPaths.has(resolved)) resolvedPaths.set(resolved, []);
        resolvedPaths.get(resolved).push(entry);
        if (existsSync(expanded)) {
            results.push({ status: "PASS", package: pkg, message: `PATH entry exists: ${entry}` });
        } else {
            // A vanished versioned directory usually means an upgrade
            // moved it - report the found replacement instead of only
            // "missing" (detection only; manifests are never rewritten).
            const replacement = findVersionedReplacement(expanded);
            const migration = replacement ? ` - replacement found: ${replacement} (likely a version upgrade; update the package's environment metadata, or prefer a dynamic $(...) entry)` : "";
            results.push({ status: "WARNING", package: pkg, message: `PATH entry does not exist on disk: ${entry}${migration}${replacement ? "" : repairHint(entryOwners)}` });
        }
    }
    let hasDuplicates = false;
    for (const [resolved, entries] of resolvedPaths) {
        if (entries.length > 1) {
            hasDuplicates = true;
            results.push({
                status: "WARNING",
                message: `Duplicate PATH entries resolve to the same directory (${resolved}): ${entries.join(", ")}`
            });
        }
    }
    if (model.path.length > 0 && !hasDuplicates) {
        results.push({ status: "PASS", message: "No duplicate PATH entries" });
    }

    for (const [key, def] of Object.entries(model.variables)) {
        const sourceHint = def.sourcePackage ? [def.sourcePackage] : null;
        const pkg = def.sourcePackage || undefined;
        if (def.command) {
            const bin = def.command.trim().split(/\s+/)[0];
            const exists = bin ? await commandExists(bin) : false;
            results.push(
                exists
                    ? { status: "PASS", package: pkg, message: `${key} is resolvable ($(${def.command}))` }
                    : { status: "WARNING", package: pkg, message: `${key}: command '${def.command}' depends on '${bin}', which is not on PATH${repairHint(sourceHint)}` }
            );
        } else if (def.value && def.value.includes("/")) {
            const expanded = expandExpression(def.value, model.variables);
            const replacement = existsSync(expanded) ? null : findVersionedReplacement(expanded);
            results.push(
                existsSync(expanded)
                    ? { status: "PASS", package: pkg, message: `${key} is valid` }
                    : { status: "WARNING", package: pkg, message: `${key} points to a path that does not exist: ${def.value}${replacement ? ` - replacement found: ${replacement} (likely a version upgrade)` : repairHint(sourceHint)}` }
            );
        } else if (def.value) {
            results.push({ status: "PASS", package: pkg, message: `${key} is set` });
        }
    }

    for (const collision of model.collisions) {
        results.push({
            status: "WARNING",
            package: collision.packages[collision.packages.length - 1],
            message: `${collision.key} is defined by more than one package: ${collision.packages.join(", ")} (last one wins)`
        });
    }

    for (const name of model.missingPackages) {
        results.push({
            status: "WARNING",
            message: `Tracked package '${name}' no longer exists in the registry - run 'devforgekit env regenerate' to clean up`
        });
    }

    // Live re-verification of every tracked package (not just declared-
    // environment ones): re-discovers the binary and version right now,
    // so `env doctor` reports "java 21.0.2 ✓" from a fresh observation,
    // never a stale recorded value - and checks whether the same binary
    // is reachable from MORE than one place (`which -a`), the classic
    // shadowed-installation problem.
    if (state) {
        for (const name of trackedNames(state)) {
            let pkg;
            try {
                pkg = resolvePackage(name);
            } catch {
                continue; // already reported via model.missingPackages
            }
            const discovered = await discoverPackage(pkg, { capture, detectVersion });
            if (discovered.verified) {
                const version = discovered.version ? ` ${discovered.version}` : "";
                results.push({ status: "PASS", package: name, message: `${name}${version} verified (${discovered.location})` });

                const conflict = await findBinaryConflicts(discovered.binary, capture ? { capture } : {});
                if (conflict) {
                    results.push({ status: "WARNING", package: name, message: describeConflict(name, conflict) });
                } else {
                    results.push({ status: "PASS", package: name, message: `${name}: single installation (no shadowed copies)` });
                }
            } else {
                results.push({
                    status: "WARNING",
                    package: name,
                    message: `${name}: '${discovered.binary}' is not on PATH - suggested repair: devforgekit component repair ${name}`
                });
            }
        }
    }

    if (shell) {
        const file = shellFilePath(shell);
        const actualContent = existsSync(file) ? readFileSync(file, "utf8") : null;
        if (actualContent === null) {
            results.push({ status: "FAIL", message: `Generated shell file for ${shell} does not exist - run 'devforgekit env regenerate'` });
        } else if (actualContent !== renderShellFile(shell, model)) {
            results.push({ status: "WARNING", message: `Generated shell file for ${shell} is out of date - run 'devforgekit env regenerate'` });
        } else {
            results.push({ status: "PASS", message: `Shell config synchronized (${shell})` });
        }

        results.push(
            isEnvironmentHookInstalled(shell)
                ? { status: "PASS", message: `Shell hook installed (${shell})` }
                : { status: "WARNING", message: `Shell hook is not installed for ${shell} - run 'devforgekit env regenerate'` }
        );
    }

    return results;
}
