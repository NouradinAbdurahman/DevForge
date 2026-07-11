// Auto-discovery: after an install, don't just trust the registry
// manifest - inspect reality. `brew install terraform` should leave the
// engine knowing `terraform` resolves to /opt/homebrew/bin/terraform,
// what version answered, and which provider installed it. The registry
// provides the hints (binary name via versionCommand/validate, provider
// via the install step); the engine verifies what actually happened.
// Every fact recorded here was observed (`command -v`, a real version
// command) - a tool that can't be found is recorded as unverified with
// null location, never guessed.
import { captureShellCommand } from "../shell.js";
import { detectInstalledVersion } from "../compatibility/versions.js";
import { getPlatform } from "../platform/index.js";

// SHELL_BUILTIN_WORDS - never a real package binary, just the shape a
// validate/versionCommand takes for something that isn't probed via a
// simple `<binary> --version` invocation (a cask GUI app checked via
// `test -d '/Applications/Foo.app'`, a font checked via `find ... -iname`,
// a directory listing piped through `grep`). Registry Completion (v3.0)
// caught a real bug here: ~30 packages' versionCommand starts with `ls`
// (e.g. "ls /Applications | grep Firefox") and the old binaryNameFor()
// happily returned "ls" as "the binary to probe" - since `ls` is always
// on PATH, discoverPackage() below reported every one of those packages
// as permanently "verified" with location pointing at /bin/ls, whether
// or not the real software was actually installed. Skipping these words
// and falling through to the next candidate (then finally pkg.name)
// means a package with no real CLI binary honestly reports unverified
// instead of lying via a coincidentally-always-present shell utility.
const SHELL_BUILTIN_WORDS = new Set(["ls", "test", "find", "cat", "echo", "grep", "stat", "true", "false", "[", "sh", "bash", "open", "defaults"]);

// binaryNameFor(pkg) -> the executable name to probe for. Priority: an
// explicit `binary` field (for the rare case none of the below infer
// correctly), then the first non-shell-builtin word of versionCommand
// ("flutter --version" -> "flutter"), then of validate, then the
// package name itself. `env` and variable-assignment prefixes are
// skipped so "env FOO=1 tool -v" still resolves to "tool".
export function binaryNameFor(pkg) {
    if (pkg.binary) return pkg.binary;
    for (const command of [pkg.versionCommand, pkg.validate]) {
        if (!command) continue;
        const words = command.trim().split(/\s+/);
        const first = words.find((w) => w !== "env" && !w.includes("="));
        // The first real word of THIS command decides whether the whole
        // command is binary-shaped ("<bin> --version") or not ("ls ... |
        // grep ..."). A builtin word means "not binary-shaped" - move on
        // to the next candidate rather than scanning further into the
        // same pipeline for something that merely isn't a builtin.
        if (first && !SHELL_BUILTIN_WORDS.has(first)) return first;
    }
    return pkg.name;
}

// methodOf(entry) -> the `method` string out of a platformInstall entry,
// which (Registry Completion, v3.0) can be a single installStep, an
// explicit { unsupported, reason } declaration, or an array of
// installSteps (one per package manager - apt+dnf+pacman, winget+choco+
// scoop). For display purposes (this function only reports "which
// provider," never executes anything) the first array entry is a
// reasonable representative; picking the one matching the actually-
// detected package manager is installer.js's resolveInstallStep()'s job
// for real execution.
function methodOf(entry) {
    if (!entry) return null;
    if (Array.isArray(entry)) return entry[0]?.method || null;
    if (entry.unsupported) return null;
    return entry.method || null;
}

// providerForPackage(pkg) -> the install method that applies on the
// current platform ("brew-formula", "mise", "npm", ...), straight from
// the manifest's platformInstall/install step - the same resolution
// order core/installer.js uses. Null when the manifest has no install
// step for this platform (variants-only packages fall back to the first
// variant's step, matching installer.js's default-variant behavior). A
// platformInstall[platformId] key that's explicitly PRESENT is always
// authoritative once resolved - including an explicit { unsupported }
// declaration correctly reporting null - and never falls through to a
// different platform's install step just because methodOf() returned
// null for it (an easy trap: null-for-absent and null-for-explicitly-
// unsupported look the same to a bare `||` chain, but only the former
// should fall through).
export function providerForPackage(pkg, { platformId = getPlatform().id } = {}) {
    const entry = pkg.platformInstall?.[platformId];
    if (entry) return methodOf(entry);
    if (pkg.install) return pkg.install.method || null;
    const variantEntry = pkg.variants?.[0]?.platformInstall?.[platformId];
    if (variantEntry) return methodOf(variantEntry);
    return pkg.variants?.[0]?.install?.method || null;
}

// discoverPackage(pkg, { capture }) -> observed facts:
//   { binary, location, version, provider, verified, lastVerified }
// `capture` is injectable (same fetchImpl-style convention core/ai's
// provider clients use) so tests never probe the host machine's real
// PATH. `location` is `command -v`'s answer for the CURRENT process's
// PATH - a binary only reachable via the generated-but-not-yet-sourced
// shell file honestly reports as not-yet-verified rather than pretending.
export async function discoverPackage(pkg, { capture = captureShellCommand, detectVersion = detectInstalledVersion, platformId } = {}) {
    const binary = binaryNameFor(pkg);
    const provider = providerForPackage(pkg, platformId ? { platformId } : {});

    let location = null;
    try {
        const { code, stdout } = await capture(`command -v ${binary}`);
        if (code === 0) location = stdout.trim().split("\n")[0] || null;
    } catch {
        location = null;
    }

    let version = null;
    if (location) {
        try {
            version = await detectVersion(pkg);
        } catch {
            version = null;
        }
    }

    return {
        binary,
        location,
        version,
        provider,
        declared: Boolean(pkg.environment),
        verified: location !== null,
        lastVerified: new Date().toISOString()
    };
}
