// Installed-version detection: honest and narrow rather than guessed. A
// package only gets a real version reading if it declares `versionCommand`
// (registry/schema/package.schema.json), or if its existing `validate`
// command's output happens to contain a parseable version token (many
// already do - `node --version`, `dart --version` - since that's the
// natural way to check a tool is present at all). Anything else reports
// `null` ("unknown"), which callers must treat as "skip version-specific
// rules for this tool", never as a guessed pass or fail.
import { captureShellCommand } from "../shell.js";

// The first semver-like token in arbitrary CLI output: 1-3 dot-separated
// numeric segments, optionally followed by a pre-release/build suffix.
// Documented as a heuristic - real-world version strings ("Docker version
// 27.3.1, build abc1234", "postgres (PostgreSQL) 17.2", "Xcode 16.2") all
// have exactly one such token, but nothing here claims certainty beyond
// "the first thing that looks like a version number."
const VERSION_TOKEN = /\b(\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.]+)?)\b/;

function extractVersion(output) {
    const match = VERSION_TOKEN.exec(output || "");
    return match ? match[1] : null;
}

// detectInstalledVersion(pkg) -> Promise<string|null>
export async function detectInstalledVersion(pkg) {
    if (pkg.versionCommand) {
        const { stdout } = await captureShellCommand(pkg.versionCommand);
        const version = extractVersion(stdout);
        if (version) return version;
    }
    if (pkg.validate) {
        try {
            const { stdout } = await captureShellCommand(pkg.validate);
            const version = extractVersion(stdout);
            if (version) return version;
        } catch {
            // validate erroring (e.g. the tool isn't installed) just means
            // no version to report, not an error worth surfacing here -
            // the engine already reports "not installed" separately.
        }
    }
    return null;
}
