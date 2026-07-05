// Resolves the repository root regardless of where this CLI is invoked
// from (a local `node cli/bin/devforgekit.js`, or a future globally-linked
// install) - the Node equivalent of DEV_SETUP_ROOT in scripts/common.sh.
import { fileURLToPath } from "node:url";
import path from "node:path";

// cli/src/core/paths.js -> repo root is three levels up.
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");

export function repoRoot() {
    return REPO_ROOT;
}

export function cliRoot() {
    return path.join(REPO_ROOT, "cli");
}

export function scriptPath(relativePath) {
    return path.join(REPO_ROOT, relativePath);
}

// homeDir() - exported (unlike userStateDir/userConfigDir's namespaced
// subdirectories) for the rare modules that must write to the user's
// actual home directory itself: core/workspace/ssh.js (~/.ssh/config,
// a location ssh/git already own and expect) and shellIntegration.js
// (~/.zshrc). Everything else should prefer userConfigDir()/userStateDir().
export function homeDir() {
    return process.env.HOME || process.env.USERPROFILE || "";
}

// userStateDir - where per-user CLI *state* lives (logs, future cache) -
// kept outside the repo so it isn't accidentally committed and survives
// across clones.
export function userStateDir() {
    return path.join(homeDir(), ".devforgekit");
}

// userConfigDir - where per-user *configuration and preference* data
// lives: config.yaml (core/config.js) and user-created profiles
// (registry.js's loadProfiles). Deliberately separate from
// userStateDir() and namespaced under XDG's conventional ~/.config, per
// the user-facing path this was explicitly asked for
// (~/.config/devforgekit/config.yaml).
export function userConfigDir() {
    return path.join(homeDir(), ".config", "devforgekit");
}
