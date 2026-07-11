import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadEnvironmentState, saveEnvironmentState, upsertPackage, removePackage, trackedNames, environmentStateFile } from "../src/core/environment/state.js";
import { buildEnvironmentModel, pathTier, normalizePathEntry } from "../src/core/environment/model.js";
import { binaryNameFor, providerForPackage, discoverPackage } from "../src/core/environment/discovery.js";
import { renderPosixShellFile } from "../src/core/environment/writers/posix.js";
import { renderFishShellFile, translatePosixToFish } from "../src/core/environment/writers/fish.js";
import { renderShellFile, shellFileExtension, shellHookLine, SUPPORTED_SHELLS, ALL_SHELLS, isShellImplemented, EnvironmentUnsupportedShellError } from "../src/core/environment/writers/index.js";
import { installEnvironmentHook, uninstallEnvironmentHook, isEnvironmentHookInstalled } from "../src/core/environment/hook.js";
import { writeShellFile, shellFilePath, contentHash, detectManualEdit } from "../src/core/environment/shellFile.js";
import { validateEnvironment } from "../src/core/environment/validator.js";
import { createEnvironmentSnapshot, listEnvironmentSnapshots, restoreEnvironmentSnapshot, snapshotsDir } from "../src/core/environment/snapshot.js";
import { regenerateEnvironment, registerPackageEnvironment, unregisterPackageEnvironment, getEnvironmentReport, reloadGuidance, restoreEnvironment } from "../src/core/environment/index.js";
import { findBinaryConflicts, describeConflict, classifyLocation } from "../src/core/environment/conflicts.js";
import { findVersionedReplacement } from "../src/core/environment/validator.js";
import { diffModels, recordTransaction, readTransactions, listTransactionDays } from "../src/core/environment/changelog.js";
import { dependentsOf, renderEnvironmentTree } from "../src/core/environment/graph.js";
import { shellCapabilities } from "../src/core/environment/writers/index.js";
import { diffEnvironment } from "../src/core/environment/diff.js";
import { scanOnce, registryBinaryMap } from "../src/core/environment/watch.js";
import { detectRunningEditors, editorReloadGuidance } from "../src/core/environment/editors.js";
import { installShellHook as installWorkspaceHook } from "../src/core/workspace/shellIntegration.js";

// $HOME-relative files (environment.json, the generated shell files, and
// the real .zshrc/.bashrc rc-file hooks) all read process.env.HOME at
// call time, so pointing it at a scratch directory is what makes these
// tests safe to run without ever touching the developer's actual shell
// config or ~/.config/devforgekit - the same isolation
// workspace-git.test.js uses for the real git binary. Discovery probes
// (`command -v`, version commands) are injected fakes everywhere a test
// asserts on their outcome, so nothing depends on what the host machine
// happens to have installed.
async function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-environment-test-"));
    process.env.HOME = tempHome;
    try {
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

// A discovery stub: resolves every probed binary to a fixed fake
// location with a fixed version - deterministic on any machine/CI.
function fakeDiscovery({ found = true, version = "1.2.3" } = {}) {
    return async (pkg) => ({
        binary: pkg.name,
        location: found ? `/fake/bin/${pkg.name}` : null,
        version: found ? version : null,
        provider: "brew-formula",
        declared: Boolean(pkg.environment),
        verified: found,
        lastVerified: "2026-01-01T00:00:00.000Z"
    });
}

// ─── state.js ────────────────────────────────────────────────────────

test("loadEnvironmentState() returns empty v2 state when the file doesn't exist", async () => {
    await withTempHome(() => {
        const state = loadEnvironmentState();
        assert.deepEqual(state.packages, {});
        assert.deepEqual(state.files, {});
        assert.equal(state.generatedAt, null);
        assert.equal(state.version, 2);
    });
});

test("loadEnvironmentState() migrates a v1 document (string array) to v2 (object map)", async () => {
    await withTempHome(() => {
        mkdirSync(path.dirname(environmentStateFile()), { recursive: true });
        writeFileSync(environmentStateFile(), JSON.stringify({ packages: ["java", "go"], generatedAt: "2026-01-01T00:00:00.000Z", version: 1 }));
        const state = loadEnvironmentState();
        assert.deepEqual(trackedNames(state), ["go", "java"]);
        assert.equal(state.version, 2);
        assert.equal(state.packages.java.verified, false, "migrated entries start unverified until discovery re-runs");
    });
});

test("saveEnvironmentState()/loadEnvironmentState() round-trip package metadata", async () => {
    await withTempHome(() => {
        const state = upsertPackage(loadEnvironmentState(), "java", {
            provider: "brew-formula", binary: "java", location: "/x/java", version: "21", declared: true, verified: true, lastVerified: "2026-01-01T00:00:00.000Z"
        });
        saveEnvironmentState(state);
        const reloaded = loadEnvironmentState();
        assert.equal(reloaded.packages.java.version, "21");
        assert.equal(reloaded.packages.java.provider, "brew-formula");
        assert.ok(reloaded.generatedAt);
    });
});

test("loadEnvironmentState() tolerates a corrupt file instead of throwing", async () => {
    await withTempHome(() => {
        mkdirSync(path.dirname(environmentStateFile()), { recursive: true });
        writeFileSync(environmentStateFile(), "{ not json");
        assert.deepEqual(loadEnvironmentState().packages, {});
    });
});

test("upsertPackage()/removePackage() are pure; unchanged upsert returns the same reference", () => {
    const state = { packages: {}, files: {}, generatedAt: null, version: 2 };
    const added = upsertPackage(state, "go", { verified: true });
    assert.deepEqual(trackedNames(added), ["go"]);
    assert.deepEqual(state.packages, {}, "original state must not mutate");

    const unchanged = upsertPackage(added, "go", { verified: true });
    assert.equal(unchanged, added, "an upsert that changes nothing returns the same reference");

    const removed = removePackage(added, "go");
    assert.deepEqual(trackedNames(removed), []);
    assert.equal(removePackage(removed, "go"), removed, "removing an untracked package returns the same reference");
});

// ─── discovery.js ────────────────────────────────────────────────────

test("binaryNameFor() prefers versionCommand's first word, skipping env/assignment prefixes", () => {
    assert.equal(binaryNameFor({ name: "flutter", versionCommand: "flutter --version" }), "flutter");
    assert.equal(binaryNameFor({ name: "java", validate: "java --version" }), "java");
    assert.equal(binaryNameFor({ name: "tool", versionCommand: "env FOO=1 tool -v" }), "tool");
    assert.equal(binaryNameFor({ name: "plain" }), "plain");
});

// Registry Completion (v3.0) regression: ~30 cask/font packages have a
// versionCommand shaped like "ls /Applications | grep Foo" (a directory
// listing, not a binary invocation) - the old binaryNameFor() naively
// returned "ls" as "the binary to probe," and since /bin/ls always
// exists, discoverPackage() below would report every one of those
// packages as permanently verified/installed regardless of reality.
test("binaryNameFor() skips shell-builtin words (ls/test/find/...) that aren't the package's real binary", () => {
    // versionCommand is builtin-shaped -> falls through to validate.
    assert.equal(
        binaryNameFor({ name: "vscode", versionCommand: "ls /Applications | grep 'Visual Studio'", validate: "code --version" }),
        "code"
    );
    // Both versionCommand and validate are builtin-shaped -> honest
    // fallback to the package name itself, not a false "ls"/"test" match.
    assert.equal(
        binaryNameFor({ name: "firefox", versionCommand: "ls /Applications | grep Firefox", validate: "test -d '/Applications/Firefox.app'" }),
        "firefox"
    );
    assert.equal(
        binaryNameFor({ name: "cascadia-code", versionCommand: "ls ~/Library/Fonts | grep -i cascadia", validate: 'test -n "$(find /Library/Fonts -iname \'*Cascadia*\')"' }),
        "cascadia-code"
    );
});

test("binaryNameFor() prefers an explicit `binary` field over any inference", () => {
    assert.equal(binaryNameFor({ name: "docker", binary: "docker-real", versionCommand: "docker --version" }), "docker-real");
});

test("providerForPackage() resolves the platform-specific install method, falling back to the top-level step", () => {
    const pkg = {
        name: "go",
        install: { method: "brew-formula", id: "go" },
        platformInstall: { linux: { method: "apt", id: "golang" } }
    };
    assert.equal(providerForPackage(pkg, { platformId: "linux" }), "apt");
    assert.equal(providerForPackage(pkg, { platformId: "macos" }), "brew-formula");
    assert.equal(providerForPackage({ name: "x", variants: [{ install: { method: "mise", id: "x" } }] }, { platformId: "macos" }), "mise");
});

// Registry Completion (v3.0): platformInstall entries can now be an
// array of installSteps (one per package manager - apt+dnf+pacman) or an
// explicit { unsupported, reason } declaration, not just a single step.
test("providerForPackage() handles array platformInstall entries (reports the first array method) and unsupported declarations (reports null)", () => {
    const multiPm = {
        name: "bat", install: { method: "brew-formula", id: "bat" },
        platformInstall: { linux: [{ method: "apt", id: "bat" }, { method: "dnf", id: "bat" }] }
    };
    assert.equal(providerForPackage(multiPm, { platformId: "linux" }), "apt");

    const unsupported = {
        name: "xcode", install: { method: "brew-formula", id: "xcodes" },
        platformInstall: { linux: { unsupported: true, reason: "macOS-only" } }
    };
    assert.equal(providerForPackage(unsupported, { platformId: "linux" }), null);
});

test("discoverPackage() records the observed location and version when the binary resolves", async () => {
    const facts = await discoverPackage(
        { name: "terraform", versionCommand: "terraform version", install: { method: "brew-formula", id: "terraform" } },
        {
            capture: async () => ({ code: 0, stdout: "/opt/homebrew/bin/terraform\n" }),
            detectVersion: async () => "1.13.0",
            platformId: "macos"
        }
    );
    assert.equal(facts.location, "/opt/homebrew/bin/terraform");
    assert.equal(facts.version, "1.13.0");
    assert.equal(facts.provider, "brew-formula");
    assert.equal(facts.verified, true);
});

test("discoverPackage() reports not-found honestly - null location, unverified, no version probe", async () => {
    let versionProbed = false;
    const facts = await discoverPackage(
        { name: "gone", install: { method: "brew-formula", id: "gone" } },
        {
            capture: async () => ({ code: 1, stdout: "" }),
            detectVersion: async () => { versionProbed = true; return "9.9.9"; },
            platformId: "macos"
        }
    );
    assert.equal(facts.location, null);
    assert.equal(facts.verified, false);
    assert.equal(facts.version, null);
    assert.equal(versionProbed, false, "no version command runs for a binary that isn't there");
});

// ─── model.js ────────────────────────────────────────────────────────

function fakeResolver(packages) {
    return (name) => {
        if (!packages[name]) throw new Error(`unknown package '${name}'`);
        return packages[name];
    };
}

function stateWith(names) {
    const packages = {};
    for (const name of names) packages[name] = {};
    return { packages, files: {}, generatedAt: null, version: 2 };
}

test("buildEnvironmentModel() dedupes PATH entries (trailing slashes normalized) and attributes owners", () => {
    const resolvePackage = fakeResolver({
        a: { name: "a", environment: { path: ["$HOME/shared/bin/", "$HOME/a/bin"] } },
        b: { name: "b", environment: { path: ["$HOME/shared/bin", "$HOME/b/bin"] } }
    });
    const model = buildEnvironmentModel(stateWith(["a", "b"]), { resolvePackage });
    assert.deepEqual(model.path, ["$HOME/shared/bin", "$HOME/a/bin", "$HOME/b/bin"]);
    assert.deepEqual(model.pathOwners["$HOME/shared/bin"], ["a", "b"]);
    assert.deepEqual(model.pathOwners["$HOME/a/bin"], ["a"]);
});

test("pathTier()/canonical ordering: devforgekit < mise < homebrew < package bins < system", () => {
    assert.equal(pathTier("$HOME/.config/devforgekit/bin"), 0);
    assert.equal(pathTier("$HOME/.local/share/mise/shims"), 1);
    assert.equal(pathTier("$(brew --prefix openjdk)/bin"), 2);
    assert.equal(pathTier("/opt/homebrew/bin"), 2);
    assert.equal(pathTier("$HOME/go/bin"), 3);
    assert.equal(pathTier("/usr/bin"), 4);

    const resolvePackage = fakeResolver({
        a: { name: "a", environment: { path: ["/usr/bin", "$HOME/go/bin", "$HOME/.local/share/mise/shims", "/opt/homebrew/bin"] } }
    });
    const model = buildEnvironmentModel(stateWith(["a"]), { resolvePackage });
    assert.deepEqual(model.path, ["$HOME/.local/share/mise/shims", "/opt/homebrew/bin", "$HOME/go/bin", "/usr/bin"]);
});

test("normalizePathEntry() strips trailing slashes only", () => {
    assert.equal(normalizePathEntry("$HOME/go/bin/"), "$HOME/go/bin");
    assert.equal(normalizePathEntry("$HOME/go/bin"), "$HOME/go/bin");
    assert.equal(normalizePathEntry("/"), "/");
});

test("buildEnvironmentModel() is last-write-wins on a variable collision and records it", () => {
    const resolvePackage = fakeResolver({
        a: { name: "a", environment: { variables: { FOO: { value: "from-a" } } } },
        b: { name: "b", environment: { variables: { FOO: { value: "from-b" } } } }
    });
    const model = buildEnvironmentModel(stateWith(["a", "b"]), { resolvePackage });
    assert.equal(model.variables.FOO.value, "from-b");
    assert.deepEqual(model.collisions, [{ key: "FOO", packages: ["a", "b"] }]);
});

test("buildEnvironmentModel() skips packages with no environment field and reports missing packages", () => {
    const resolvePackage = fakeResolver({
        a: { name: "a", environment: { path: ["$HOME/bin"] } },
        "no-env": { name: "no-env" }
    });
    const model = buildEnvironmentModel(stateWith(["a", "missing", "no-env"]), { resolvePackage });
    assert.deepEqual(model.sourcePackages, ["a"]);
    assert.deepEqual(model.missingPackages, ["missing"]);
});

// ─── writers ─────────────────────────────────────────────────────────

test("renderPosixShellFile() prepends PATH entries and expands variables/commands without escaping $", () => {
    const model = {
        path: ["$HOME/go/bin", "$(brew --prefix openjdk)/bin"],
        variables: {
            JAVA_HOME: { command: "echo $(brew --prefix openjdk)/libexec/openjdk.jdk/Contents/Home" },
            FOO: { value: "$HOME/literal" }
        },
        shell: [{ packageName: "mise", line: 'eval "$(mise activate zsh)"' }]
    };
    const output = renderPosixShellFile(model, { shellName: "zsh" });
    assert.match(output, /export PATH="\$HOME\/go\/bin:\$\(brew --prefix openjdk\)\/bin:\$PATH"/);
    assert.match(output, /export JAVA_HOME="\$\(echo \$\(brew --prefix openjdk\)\/libexec\/openjdk\.jdk\/Contents\/Home\)"/);
    assert.match(output, /export FOO="\$HOME\/literal"/);
    assert.match(output, /# mise\neval "\$\(mise activate zsh\)"/);
    assert.match(output, /Do not edit by hand/);
});

test("renderFishShellFile() emits native fish syntax - set -gx, (command) substitution, no export", () => {
    const model = {
        path: ["$HOME/go/bin", "$(brew --prefix openjdk)/bin"],
        variables: {
            JAVA_HOME: { command: "echo $(brew --prefix openjdk)/x" },
            FOO: { value: "$HOME/literal" }
        },
        shell: [{ packageName: "mise", line: 'eval "$(mise activate zsh)"' }]
    };
    const output = renderFishShellFile(model);
    assert.match(output, /set -gx PATH \$HOME\/go\/bin \$PATH/);
    assert.match(output, /set -gx PATH \(brew --prefix openjdk\)\/bin \$PATH/);
    assert.match(output, /set -gx JAVA_HOME \(echo \(brew --prefix openjdk\)\/x\)/);
    assert.match(output, /set -gx FOO "\$HOME\/literal"/);
    assert.ok(!output.includes("export "), "fish has no export statement");
    assert.match(output, /# mise: declared shell line is POSIX syntax/, "POSIX raw shell lines are commented out, never emitted broken");
});

test("translatePosixToFish() converts $(...) and refuses untranslatable POSIX-only syntax", () => {
    assert.equal(translatePosixToFish("$(brew --prefix)/bin"), "(brew --prefix)/bin");
    assert.equal(translatePosixToFish("$HOME/go/bin"), "$HOME/go/bin");
    assert.equal(translatePosixToFish("`brew --prefix`/bin"), null);
    assert.equal(translatePosixToFish("${VAR%suffix}/bin"), null);
});

test("writer registry: zsh/bash/fish implemented, powershell declared but honestly unimplemented", () => {
    assert.deepEqual(SUPPORTED_SHELLS, ["zsh", "bash", "fish"]);
    assert.deepEqual(ALL_SHELLS, ["zsh", "bash", "fish", "powershell"]);
    assert.equal(isShellImplemented("powershell"), false);
    assert.equal(shellFileExtension("zsh"), "zsh");
    assert.equal(shellFileExtension("bash"), "sh");
    assert.equal(shellFileExtension("fish"), "fish");
    const model = { path: [], variables: {}, shell: [] };
    assert.ok(renderShellFile("fish", model).length > 0);
    assert.throws(() => renderShellFile("powershell", model), EnvironmentUnsupportedShellError);
    assert.throws(() => renderShellFile("nushell", model), EnvironmentUnsupportedShellError);
});

test("shellHookLine() emits per-shell source syntax (fish is not POSIX)", () => {
    assert.equal(shellHookLine("zsh", "/x/shell.zsh"), '[ -f "/x/shell.zsh" ] && source "/x/shell.zsh"');
    assert.equal(shellHookLine("fish", "/x/shell.fish"), 'test -f "/x/shell.fish"; and source "/x/shell.fish"');
});

// ─── shellFile.js (manual-edit detection) ────────────────────────────

test("writeShellFile() backs up a manually-edited managed file before overwriting, and never falsely on an untouched one", async () => {
    await withTempHome(() => {
        const model = { path: ["$HOME/bin"], variables: {}, shell: [] };
        const first = writeShellFile("zsh", model);
        assert.equal(first.manualEditBackup, null, "first generation has nothing to compare");

        const untouched = writeShellFile("zsh", model, { lastHash: first.hash });
        assert.equal(untouched.manualEditBackup, null, "regenerating an untouched file is silent");

        appendFileSync(shellFilePath("zsh"), "# my manual tweak\n");
        assert.ok(detectManualEdit("zsh", first.hash) !== null);

        const afterEdit = writeShellFile("zsh", model, { lastHash: first.hash });
        assert.ok(afterEdit.manualEditBackup, "edited content must be preserved");
        assert.match(readFileSync(afterEdit.manualEditBackup, "utf8"), /my manual tweak/);
        assert.ok(!readFileSync(shellFilePath("zsh"), "utf8").includes("my manual tweak"), "regenerated file is clean");
    });
});

test("contentHash() is deterministic", () => {
    assert.equal(contentHash("abc"), contentHash("abc"));
    assert.notEqual(contentHash("abc"), contentHash("abd"));
});

// ─── hook.js ─────────────────────────────────────────────────────────

test("installEnvironmentHook()/isEnvironmentHookInstalled()/uninstallEnvironmentHook() round-trip on a real rc file", async () => {
    await withTempHome((tempHome) => {
        assert.equal(isEnvironmentHookInstalled("zsh"), false);
        const { rcFile, manualEditBackup } = installEnvironmentHook("zsh");
        assert.equal(rcFile, path.join(tempHome, ".zshrc"));
        assert.equal(manualEditBackup, null);
        assert.equal(isEnvironmentHookInstalled("zsh"), true);
        assert.match(readFileSync(rcFile, "utf8"), />>> DevForgeKit environment-hook >>>/);

        // idempotent - installing twice never accumulates a second block
        const second = installEnvironmentHook("zsh");
        assert.equal(second.manualEditBackup, null, "an untouched block re-install is not a manual edit");
        const occurrences = readFileSync(rcFile, "utf8").split("environment-hook >>>").length - 1;
        assert.equal(occurrences, 1);

        assert.equal(uninstallEnvironmentHook("zsh"), true);
        assert.equal(isEnvironmentHookInstalled("zsh"), false);
    });
});

test("installEnvironmentHook() backs up the rc file when the user edited INSIDE the managed block", async () => {
    await withTempHome((tempHome) => {
        installEnvironmentHook("zsh");
        const rcFile = path.join(tempHome, ".zshrc");
        const edited = readFileSync(rcFile, "utf8").replace("&& source", "&& echo tweaked && source");
        writeFileSync(rcFile, edited);

        const { manualEditBackup } = installEnvironmentHook("zsh");
        assert.ok(manualEditBackup, "an edited block must be backed up before replacement");
        assert.match(readFileSync(manualEditBackup, "utf8"), /echo tweaked/);
        assert.ok(!readFileSync(rcFile, "utf8").includes("echo tweaked"), "the block is restored to generated content");
    });
});

test("the environment hook never touches rc content outside its own block", async () => {
    await withTempHome((tempHome) => {
        const rcFile = path.join(tempHome, ".zshrc");
        writeFileSync(rcFile, "# user's own precious config\nalias ll='ls -la'\n");
        installEnvironmentHook("zsh");
        installEnvironmentHook("zsh");
        const content = readFileSync(rcFile, "utf8");
        assert.match(content, /user's own precious config/);
        assert.match(content, /alias ll='ls -la'/);
    });
});

test("the environment hook coexists with the workspace shell hook in the same rc file", async () => {
    await withTempHome((tempHome) => {
        installEnvironmentHook("zsh");
        installWorkspaceHook("zsh");
        const content = readFileSync(path.join(tempHome, ".zshrc"), "utf8");
        assert.match(content, /environment-hook >>>/);
        assert.match(content, /workspace-shell-hook >>>/);
        assert.equal(isEnvironmentHookInstalled("zsh"), true);
    });
});

// ─── validator.js ────────────────────────────────────────────────────

const EMPTY_MODEL_FIELDS = { pathOwners: {}, variables: {}, shell: [], collisions: [], missingPackages: [] };

test("validateEnvironment() attributes a missing PATH entry to its package and suggests component repair", async () => {
    await withTempHome((tempHome) => {
        const missing = `${tempHome}/opt/openjdk/bin`;
        const model = { ...EMPTY_MODEL_FIELDS, path: [missing], pathOwners: { [missing]: ["java"] } };
        return validateEnvironment(model).then((results) => {
            const warn = results.find((r) => r.status === "WARNING" && r.message.includes(missing));
            assert.ok(warn);
            assert.match(warn.message, /from java/);
            assert.match(warn.message, /devforgekit component repair java/);
        });
    });
});

test("validateEnvironment() checks a command-substitution PATH entry by resolving its binary, not the literal string", async () => {
    const model = { ...EMPTY_MODEL_FIELDS, path: ["$(echo)/bin"], pathOwners: { "$(echo)/bin": ["x"] } };
    const results = await validateEnvironment(model);
    assert.ok(results.some((r) => r.status === "PASS" && r.message.includes("$(echo)/bin")));
});

test("validateEnvironment() flags duplicate PATH entries that resolve to the same real directory", async () => {
    await withTempHome((tempHome) => {
        mkdirSync(path.join(tempHome, "bin"));
        const model = { ...EMPTY_MODEL_FIELDS, path: [`${tempHome}/bin`, `${tempHome}/./bin`] };
        return validateEnvironment(model).then((results) => {
            assert.ok(results.some((r) => r.status === "WARNING" && r.message.includes("Duplicate PATH entries")));
        });
    });
});

test("validateEnvironment() live-verifies tracked packages with observed version, and suggests repair for a vanished one", async () => {
    const state = {
        packages: { java: { declared: true }, gone: { declared: false } },
        files: {}, generatedAt: null, version: 2
    };
    const model = { ...EMPTY_MODEL_FIELDS, path: [] };
    const results = await validateEnvironment(model, {
        state,
        resolvePackage: (name) => ({ name, versionCommand: `${name} --version` }),
        capture: async (cmd) => (cmd.includes("java") ? { code: 0, stdout: "/fake/bin/java\n" } : { code: 1, stdout: "" }),
        detectVersion: async () => "21.0.2"
    });
    const javaPass = results.find((r) => r.message.startsWith("java"));
    assert.equal(javaPass.status, "PASS");
    assert.match(javaPass.message, /21\.0\.2/);
    assert.match(javaPass.message, /\/fake\/bin\/java/);
    const goneWarn = results.find((r) => r.message.startsWith("gone"));
    assert.equal(goneWarn.status, "WARNING");
    assert.match(goneWarn.message, /devforgekit component repair gone/);
});

test("validateEnvironment() reports a missing generated shell file as FAIL", async () => {
    await withTempHome(() => {
        const model = { ...EMPTY_MODEL_FIELDS, path: [] };
        return validateEnvironment(model, { shell: "zsh" }).then((results) => {
            assert.ok(results.some((r) => r.status === "FAIL" && r.message.includes("does not exist")));
        });
    });
});

// ─── snapshot.js ─────────────────────────────────────────────────────

test("createEnvironmentSnapshot()/listEnvironmentSnapshots()/restoreEnvironmentSnapshot() round-trip", async () => {
    await withTempHome(async () => {
        saveEnvironmentState(upsertPackage(loadEnvironmentState(), "java", { declared: true, verified: true }));
        const { id } = createEnvironmentSnapshot({ message: "before experiment" });

        const listed = listEnvironmentSnapshots();
        assert.equal(listed.length, 1);
        assert.equal(listed[0].id, id);
        assert.equal(listed[0].message, "before experiment");
        assert.equal(listed[0].packageCount, 1);

        // mutate, then restore
        saveEnvironmentState(removePackage(loadEnvironmentState(), "java"));
        assert.deepEqual(trackedNames(loadEnvironmentState()), []);

        const { state, safetySnapshotId } = restoreEnvironmentSnapshot(id);
        assert.deepEqual(trackedNames(state), ["java"]);
        assert.ok(safetySnapshotId, "restore takes an automatic safety snapshot first");
        assert.equal(listEnvironmentSnapshots().length, 2);
        assert.ok(existsSync(snapshotsDir()));
        assert.equal(readdirSync(snapshotsDir()).length, 2);
    });
});

test("restoreEnvironmentSnapshot() throws a clear error for an unknown id", async () => {
    await withTempHome(() => {
        assert.throws(() => restoreEnvironmentSnapshot("nope"), /Unknown environment snapshot/);
    });
});

// ─── index.js (public API, full pipeline) ───────────────────────────

test("registerPackageEnvironment() tracks ANY known package with observed facts - not only declared-environment ones", async () => {
    await withTempHome(async () => {
        const result = await registerPackageEnvironment("git", { discover: fakeDiscovery({ version: "2.55.0" }) });
        assert.ok(result, "git has no environment field but is still tracked as an installed tool");
        assert.equal(result.state.packages.git.version, "2.55.0");
        assert.equal(result.state.packages.git.declared, false);
        assert.equal(await registerPackageEnvironment("definitely-not-a-real-package"), null);
    });
});

test("registerPackageEnvironment() with unchanged facts is a no-op; unregisterPackageEnvironment() removes the contribution", async () => {
    await withTempHome(async () => {
        const discover = fakeDiscovery();
        const first = await registerPackageEnvironment("java", { discover });
        assert.ok(first);
        assert.match(readFileSync(shellFilePath("zsh"), "utf8"), /JAVA_HOME/);

        const second = await registerPackageEnvironment("java", { discover });
        assert.equal(second, null, "identical observed facts must not rewrite anything");

        const removed = unregisterPackageEnvironment("java");
        assert.ok(removed);
        assert.ok(!readFileSync(shellFilePath("zsh"), "utf8").includes("JAVA_HOME"), "uninstalling removes the package's lines");
        assert.equal(unregisterPackageEnvironment("java"), null);
    });
});

test("regenerateEnvironment() is deterministic - a second run is byte-for-byte identical and reports no manual edit", async () => {
    await withTempHome(async () => {
        await registerPackageEnvironment("java", { discover: fakeDiscovery() });
        await registerPackageEnvironment("go", { discover: fakeDiscovery() });

        const first = regenerateEnvironment();
        const zshFile = first.files.find((f) => f.shell === "zsh").file;
        const content = readFileSync(zshFile, "utf8");

        const second = regenerateEnvironment();
        assert.equal(readFileSync(zshFile, "utf8"), content);
        assert.equal(second.files.find((f) => f.shell === "zsh").manualEditBackup, null);
    });
});

test("restoreEnvironment() restores tracked state AND regenerates the shell files from it", async () => {
    await withTempHome(async () => {
        await registerPackageEnvironment("java", { discover: fakeDiscovery() });
        const { id } = createEnvironmentSnapshot({ message: "with java" });

        unregisterPackageEnvironment("java");
        assert.ok(!readFileSync(shellFilePath("zsh"), "utf8").includes("JAVA_HOME"));

        const { state } = restoreEnvironment(id);
        assert.deepEqual(trackedNames(state), ["java"]);
        assert.match(readFileSync(shellFilePath("zsh"), "utf8"), /JAVA_HOME/, "restore regenerates, not just rewrites state");
    });
});

test("reloadGuidance() reports literal PATH entries the current shell hasn't loaded, and stays silent when loaded", () => {
    const model = { path: ["$HOME/go/bin", "$(brew --prefix x)/bin"], variables: {}, shell: [] };
    const guidance = reloadGuidance(model, { envPath: "/usr/bin:/bin", home: "/Users/dev" });
    assert.deepEqual(guidance.missing, ["/Users/dev/go/bin"], "command-substitution entries can't be checked and are excluded");
    assert.match(guidance.message, /hasn't loaded the latest environment/);

    const loaded = reloadGuidance(model, { envPath: "/Users/dev/go/bin:/usr/bin", home: "/Users/dev" });
    assert.equal(loaded, null);
});

test("getEnvironmentReport() reports a healthy synchronized shell state right after regenerate", async () => {
    await withTempHome(async () => {
        await registerPackageEnvironment("go", { discover: fakeDiscovery() });
        const report = await getEnvironmentReport({ shell: "zsh", verify: false });
        assert.equal(report.results.find((r) => r.message.includes("Shell config synchronized")).status, "PASS");
        assert.equal(report.results.find((r) => r.message.includes("Shell hook installed")).status, "PASS");
    });
});

// ─── conflicts.js ────────────────────────────────────────────────────

test("findBinaryConflicts() reports multiple deduplicated locations with the first one active", async () => {
    const conflict = await findBinaryConflicts("flutter", {
        capture: async () => ({ code: 0, stdout: "/opt/homebrew/bin/flutter\n/opt/homebrew/bin/flutter\n/usr/local/bin/flutter\n" })
    });
    assert.equal(conflict.locations.length, 2, "PATH-duplicate lines are deduplicated");
    assert.equal(conflict.locations[0].location, "/opt/homebrew/bin/flutter");
    assert.equal(conflict.locations[0].active, true);
    assert.equal(conflict.locations[0].source, "Homebrew");
    assert.equal(conflict.locations[1].source, "manual (/usr/local)");
    assert.equal(conflict.locations[1].active, false);

    const message = describeConflict("flutter", conflict);
    assert.match(message, /Multiple flutter installations detected/);
    assert.match(message, /currently used/);
    assert.match(message, /Recommendation/);
});

test("findBinaryConflicts() is null for a single or missing installation", async () => {
    assert.equal(await findBinaryConflicts("x", { capture: async () => ({ code: 0, stdout: "/usr/bin/x\n" }) }), null);
    assert.equal(await findBinaryConflicts("x", { capture: async () => ({ code: 1, stdout: "" }) }), null);
});

test("classifyLocation() labels the common sources", () => {
    assert.equal(classifyLocation("/opt/homebrew/bin/go"), "Homebrew");
    assert.equal(classifyLocation("/Users/dev/.local/share/mise/shims/java"), "mise");
    assert.equal(classifyLocation("/usr/bin/python3"), "system");
    assert.equal(classifyLocation("/usr/local/bin/terraform"), "manual (/usr/local)");
    assert.equal(classifyLocation("/Users/dev/.cargo/bin/rg"), "cargo");
});

// ─── versioned-path migration (validator.js) ────────────────────────

test("findVersionedReplacement() finds the upgraded sibling after a version bump", async () => {
    await withTempHome((tempHome) => {
        mkdirSync(path.join(tempHome, "opt", "openjdk@22", "bin"), { recursive: true });
        const missing = path.join(tempHome, "opt", "openjdk@21", "bin");
        assert.equal(findVersionedReplacement(missing), path.join(tempHome, "opt", "openjdk@22", "bin"));
    });
});

test("findVersionedReplacement() returns null when no versioned sibling exists", async () => {
    await withTempHome((tempHome) => {
        mkdirSync(path.join(tempHome, "opt", "unrelated"), { recursive: true });
        assert.equal(findVersionedReplacement(path.join(tempHome, "opt", "openjdk@21", "bin")), null);
    });
});

test("validateEnvironment() reports the found replacement for a vanished versioned PATH entry", async () => {
    await withTempHome(async (tempHome) => {
        mkdirSync(path.join(tempHome, "opt", "node-20", "bin"), { recursive: true });
        const missing = `${tempHome}/opt/node-18/bin`;
        const model = { ...EMPTY_MODEL_FIELDS, path: [missing], pathOwners: { [missing]: ["node"] } };
        const results = await validateEnvironment(model);
        const warn = results.find((r) => r.status === "WARNING" && r.message.includes(missing));
        assert.match(warn.message, /replacement found/);
        assert.match(warn.message, /node-20/);
    });
});

// ─── changelog.js (transaction log) ──────────────────────────────────

test("diffModels() reports path/variable additions, removals, and changes; null when identical", () => {
    const before = { sourcePackages: ["a"], path: ["$HOME/a"], variables: { X: { value: "1", sourcePackage: "a" } }, shell: [] };
    const after = { sourcePackages: ["a", "b"], path: ["$HOME/a", "$HOME/b"], variables: { X: { value: "2", sourcePackage: "a" }, Y: { value: "3", sourcePackage: "b" } }, shell: [] };
    const changes = diffModels(before, after);
    assert.deepEqual(changes.packagesAdded, ["b"]);
    assert.deepEqual(changes.pathAdded, ["$HOME/b"]);
    assert.deepEqual(changes.variablesAdded, ["Y"]);
    assert.deepEqual(changes.variablesChanged, ["X"]);
    assert.equal(diffModels(after, after), null);
});

test("recordTransaction()/readTransactions()/listTransactionDays() round-trip per-day logs", async () => {
    await withTempHome(() => {
        const now = new Date("2026-07-10T12:00:00.000Z");
        recordTransaction({ pathAdded: ["$HOME/x"] }, { action: "register:x", now });
        recordTransaction({ pathRemoved: ["$HOME/x"] }, { action: "unregister:x", now });
        assert.deepEqual(listTransactionDays(), ["2026-07-10"]);
        const transactions = readTransactions("2026-07-10");
        assert.equal(transactions.length, 2);
        assert.equal(transactions[0].action, "register:x");
        assert.deepEqual(transactions[1].changes.pathRemoved, ["$HOME/x"]);
        assert.deepEqual(readTransactions("1999-01-01"), []);
    });
});

test("applyState logs a transaction on register and unregister, including metadata-less packages", async () => {
    await withTempHome(async () => {
        await registerPackageEnvironment("git", { discover: fakeDiscovery() });
        const days = listTransactionDays();
        assert.equal(days.length, 1);
        const transactions = readTransactions(days[0]);
        assert.equal(transactions.length, 1);
        assert.deepEqual(transactions[0].changes.trackedAdded, ["git"], "tracking a no-metadata package is still a logged change");

        unregisterPackageEnvironment("git");
        assert.equal(readTransactions(days[0]).length, 2);
        assert.deepEqual(readTransactions(days[0])[1].changes.trackedRemoved, ["git"]);
    });
});

// ─── graph.js ────────────────────────────────────────────────────────

const GRAPH_PACKAGES = [
    { name: "flutter", dependencies: ["dart", "java"] },
    { name: "dart", dependencies: [] },
    { name: "java", dependencies: [] },
    { name: "android-sdk", dependencies: ["java"] }
];

test("dependentsOf() reports transitively-affected tracked packages", () => {
    const state = stateWith(["flutter", "android-sdk", "java", "dart"]);
    assert.deepEqual(dependentsOf("java", state, { packages: GRAPH_PACKAGES }), ["android-sdk", "flutter"]);
    assert.deepEqual(dependentsOf("flutter", state, { packages: GRAPH_PACKAGES }), []);
});

test("renderEnvironmentTree() renders roots with their dependency children", () => {
    const state = stateWith(["flutter", "android-sdk"]);
    const lines = renderEnvironmentTree(state, { packages: GRAPH_PACKAGES });
    const text = lines.join("\n");
    assert.match(text, /flutter/);
    assert.match(text, /dart/);
    assert.match(text, /android-sdk/);
    assert.ok(!lines[0].startsWith("├──"), "roots render at column 0");
});

// ─── shell capabilities ──────────────────────────────────────────────

test("shellCapabilities() exposes the full honest matrix including unimplemented shells", () => {
    const matrix = shellCapabilities();
    assert.equal(matrix.zsh.implemented, true);
    assert.equal(matrix.zsh.capabilities.path, "supported");
    assert.equal(matrix.zsh.capabilities.aliases, "planned");
    assert.equal(matrix.fish.capabilities.shell, "partial");
    assert.equal(matrix.powershell.implemented, false);
    assert.equal(matrix.powershell.capabilities.path, "planned");
});

// ─── diff.js ─────────────────────────────────────────────────────────

test("diffEnvironment() reports packages, versions, and model deltas since a snapshot", async () => {
    await withTempHome(async () => {
        await registerPackageEnvironment("java", { discover: fakeDiscovery({ version: "21" }) });
        const { id } = createEnvironmentSnapshot({ message: "before" });

        await registerPackageEnvironment("go", { discover: fakeDiscovery() });
        unregisterPackageEnvironment("java");

        const diff = diffEnvironment({ snapshotId: id });
        assert.deepEqual(diff.packagesAdded, ["go"]);
        assert.deepEqual(diff.packagesRemoved, ["java"]);
        assert.ok(diff.model.pathAdded.some((p) => p.includes("go/bin")));
        assert.ok(diff.model.variablesRemoved.includes("JAVA_HOME"));
    });
});

test("diffEnvironment() throws a clear error when no snapshots exist", async () => {
    await withTempHome(() => {
        assert.throws(() => diffEnvironment(), /No environment snapshots/);
    });
});

// ─── watch.js ────────────────────────────────────────────────────────

test("scanOnce() reports only newly-appeared known binaries, once", async () => {
    await withTempHome((tempHome) => {
        const dir = path.join(tempHome, "bin");
        mkdirSync(dir);
        writeFileSync(path.join(dir, "existing-tool"), "");

        const binaryMap = new Map([["terraform", "terraform"], ["existing-tool", "existing"]]);
        const known = new Set();

        // Baseline scan: existing binaries are not "news"...
        const primed = scanOnce({ dirs: [dir], binaryMap, known });
        assert.equal(primed.length, 1, "priming scan sees what's already there (caller discards it)");

        // ...nothing new -> nothing reported
        assert.deepEqual(scanOnce({ dirs: [dir], binaryMap, known }), []);

        // a new known binary appears
        writeFileSync(path.join(dir, "terraform"), "");
        writeFileSync(path.join(dir, "unknown-binary"), "");
        const found = scanOnce({ dirs: [dir], binaryMap, known });
        assert.equal(found.length, 1, "unknown binaries are ignored");
        assert.equal(found[0].package, "terraform");

        // and is never re-reported
        assert.deepEqual(scanOnce({ dirs: [dir], binaryMap, known }), []);
    });
});

test("registryBinaryMap() maps registry binaries to package names", () => {
    const map = registryBinaryMap({ packages: [{ name: "terraform", versionCommand: "terraform version" }, { name: "java", validate: "java --version" }] });
    assert.equal(map.get("terraform"), "terraform");
    assert.equal(map.get("java"), "java");
});

// ─── editors.js ──────────────────────────────────────────────────────

test("detectRunningEditors()/editorReloadGuidance() report running editors honestly, silent when none", async () => {
    const running = await detectRunningEditors({
        capture: async (cmd) => ({ code: cmd.includes("Visual Studio Code") ? 0 : 1, stdout: "" })
    });
    assert.equal(running.length, 1);
    assert.equal(running[0].label, "VS Code");
    assert.match(editorReloadGuidance(running), /VS Code is running/);
    assert.match(editorReloadGuidance(running), /Reload Window/);
    assert.equal(editorReloadGuidance([]), null);
});

// ─── validator conflict + live-verification integration ─────────────

test("validateEnvironment() surfaces a multi-installation conflict for a tracked package", async () => {
    const state = { packages: { flutter: { declared: false } }, files: {}, generatedAt: null, version: 2 };
    const model = { ...EMPTY_MODEL_FIELDS, path: [] };
    const results = await validateEnvironment(model, {
        state,
        resolvePackage: (name) => ({ name, versionCommand: `${name} --version` }),
        capture: async (cmd) => {
            if (cmd.startsWith("command -v")) return { code: 0, stdout: "/opt/homebrew/bin/flutter\n" };
            if (cmd.startsWith("which -a")) return { code: 0, stdout: "/opt/homebrew/bin/flutter\n/usr/local/bin/flutter\n" };
            return { code: 1, stdout: "" };
        },
        detectVersion: async () => "3.44.4"
    });
    const conflict = results.find((r) => r.message.includes("Multiple flutter installations"));
    assert.equal(conflict.status, "WARNING");
    assert.equal(conflict.package, "flutter");
});
