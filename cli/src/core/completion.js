// Shell completion install/uninstall/status for `devforgekit completion`
// (npm-install users - Homebrew's formula already wires completions via
// its own bash_completion.install/zsh_completion.install/
// fish_completion.install, unaffected by anything here). Reuses the
// exact idempotent marker-block primitive (core/workspace/markerBlock.js)
// the Environment Configuration Engine's own shell hook (core/
// environment/hook.js) already established, rather than building a
// second installer - see that file's own header for why writeBlock/
// removeBlock structurally can't accumulate duplicates or touch
// anything outside their own block.
//
// zsh and bash both work the same way here: copy the packaged
// completions/devforgekit.<ext> file into
// ~/.config/devforgekit/completions/, then add one marker-block line to
// the shell's rc file that sources it. zsh's copy additionally needs
// compdef to be available (only true after compinit has run at least
// once) - completions/devforgekit.zsh's own generated self-registration
// idiom (scripts/generate-completions.mjs) handles the actual
// registration, this module only guarantees compdef exists first by
// calling compinit itself if the user's own rc hasn't already.
//
// fish is structurally different and simpler: fish auto-loads *any*
// file placed in ~/.config/fish/completions/ - no rc-file edit, no
// marker block, nothing to source. Its "install" is just placing the
// file at that exact path; "uninstall" is deleting it.
import { existsSync, mkdirSync, copyFileSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { getPlatform } from "./platform/index.js";
import { commandExists } from "./shell.js";
import { repoRoot, userConfigDir, homeDir } from "./paths.js";
import { writeBlock, removeBlock, hasBlock, readBlock } from "./workspace/markerBlock.js";

export const SUPPORTED_SHELLS = ["zsh", "bash", "fish"];

const COMPLETION_ID = "completions";

const SHELL_EXT = { zsh: "zsh", bash: "bash", fish: "fish" };

// packagedCompletionFile(shell) -> the source file this repo/package
// ships (completions/devforgekit.<ext> - generated, never hand-edited,
// see scripts/generate-completions.mjs).
export function packagedCompletionFile(shell) {
    return path.join(repoRoot(), "completions", `devforgekit.${SHELL_EXT[shell]}`);
}

// detectCurrentShell() -> the user's actual interactive shell, from
// $SHELL (the standard, portable signal every major shell sets) - never
// guessed from the platform's own default, which is a static fallback
// (macos.js hardcodes "zsh") rather than what this specific user
// actually runs. Falls back to the platform default only when $SHELL is
// unset or names something this command doesn't support.
export function detectCurrentShell() {
    const fromEnv = path.basename(process.env.SHELL || "");
    if (SUPPORTED_SHELLS.includes(fromEnv)) return fromEnv;
    const platformDefault = getPlatform().defaultShell();
    return SUPPORTED_SHELLS.includes(platformDefault) ? platformDefault : "bash";
}

// detectAvailableShells() -> SUPPORTED_SHELLS actually installed on this
// machine (their binary is on PATH) - used by `--all` and `status` so
// neither installs for, nor reports on, a shell that doesn't exist here.
export async function detectAvailableShells() {
    const results = await Promise.all(SUPPORTED_SHELLS.map(async (shell) => [shell, await commandExists(shell)]));
    return results.filter(([, exists]) => exists).map(([shell]) => shell);
}

function rcFileFor(shell) {
    return getPlatform().shellConfigFile(shell);
}

// installedCompletionPath(shell) -> where this module puts its own copy
// of the packaged completion file. fish gets its own real, dedicated
// auto-load directory (no rc file involved at all); zsh/bash get a
// DevForgeKit-owned location under userConfigDir(), sourced via the
// marker block below.
export function installedCompletionPath(shell) {
    if (shell === "fish") return path.join(homeDir(), ".config", "fish", "completions", "devforgekit.fish");
    return path.join(userConfigDir(), "completions", `devforgekit.${SHELL_EXT[shell]}`);
}

const ZSH_COMPDEF_GUARD = [
    "if ! command -v compdef >/dev/null 2>&1; then",
    "    autoload -Uz compinit && compinit -C",
    "fi"
];

function sourceLine(shell) {
    return `source ${installedCompletionPath(shell)}`;
}

function blockHeader(shell) {
    const base = [
        "# Sources DevForgeKit's shell completion script. Installed by",
        "# 'devforgekit completion install' - safe to remove with",
        "# 'devforgekit completion uninstall'."
    ];
    return shell === "zsh" ? [...base, ...ZSH_COMPDEF_GUARD] : base;
}

// installShellCompletion(shell) -> { shell, installedPath, rcFile }.
// rcFile is null for fish (no rc edit needed). Idempotent: re-running
// over an already-installed completion just refreshes the copied file
// and rewrites the same marker block (writeBlock's own guarantee - see
// markerBlock.js), never accumulating a second entry.
export function installShellCompletion(shell) {
    if (!SUPPORTED_SHELLS.includes(shell)) {
        throw new Error(`Unsupported shell '${shell}' - expected one of: ${SUPPORTED_SHELLS.join(", ")}`);
    }
    const source = packagedCompletionFile(shell);
    if (!existsSync(source)) {
        throw new Error(`Packaged completion file not found: ${source}`);
    }
    const dest = installedCompletionPath(shell);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(source, dest);

    if (shell === "fish") {
        return { shell, installedPath: dest, rcFile: null };
    }

    const rcFile = rcFileFor(shell);
    writeBlock(rcFile, COMPLETION_ID, [sourceLine(shell)], { header: blockHeader(shell), backup: true });
    return { shell, installedPath: dest, rcFile };
}

// uninstallShellCompletion(shell) -> true if anything was actually
// removed (file and/or rc block), false if it wasn't installed.
export function uninstallShellCompletion(shell) {
    const dest = installedCompletionPath(shell);
    const fileExisted = existsSync(dest);
    if (fileExisted) rmSync(dest, { force: true });

    if (shell === "fish") return fileExisted;

    const blockRemoved = removeBlock(rcFileFor(shell), COMPLETION_ID);
    return fileExisted || blockRemoved;
}

// isShellCompletionInstalled(shell) -> boolean. fish only needs the
// file to exist (fish has no rc block to check); zsh/bash need both the
// copied file AND the rc block, since either alone is an incomplete,
// non-functional install (e.g. the file was manually deleted but the rc
// line remains, or vice versa).
export function isShellCompletionInstalled(shell) {
    const dest = installedCompletionPath(shell);
    if (!existsSync(dest)) return false;
    if (shell === "fish") return true;
    return hasBlock(rcFileFor(shell), COMPLETION_ID);
}

// completionStatus(shell) -> a structured status object status/doctor
// both build on: whether the shell itself is available, whether it's
// installed, and (zsh/bash only) whether the installed rc block still
// matches what installShellCompletion would write today - a manually
// edited or stale block is reported, never silently treated as fine.
export async function completionStatus(shell) {
    const available = await commandExists(shell);
    const dest = installedCompletionPath(shell);
    const fileInstalled = existsSync(dest);
    const rcFile = shell === "fish" ? null : rcFileFor(shell);
    const blockInstalled = shell === "fish" ? null : hasBlock(rcFile, COMPLETION_ID);

    let upToDate = null;
    if (fileInstalled) {
        try {
            upToDate = readFileSync(dest, "utf8") === readFileSync(packagedCompletionFile(shell), "utf8");
        } catch {
            upToDate = false;
        }
    }

    let blockCurrent = null;
    if (shell !== "fish" && blockInstalled) {
        const expected = [...blockHeader(shell), sourceLine(shell)].join("\n");
        blockCurrent = readBlock(rcFile, COMPLETION_ID) === expected;
    }

    return {
        shell,
        available,
        installed: isShellCompletionInstalled(shell),
        installedPath: dest,
        rcFile,
        upToDate,
        blockCurrent
    };
}

// isCurrentInstallStale(shell) -> true when a file is installed but its
// content no longer matches the packaged source AND the packaged
// source's mtime is newer - i.e. the CLI itself was updated (npm
// update/self-update) since completions were last installed. Purely a
// convenience signal for `completion doctor`'s recommendation, never
// acted on automatically.
export function isCurrentInstallStale(shell) {
    const dest = installedCompletionPath(shell);
    const source = packagedCompletionFile(shell);
    if (!existsSync(dest) || !existsSync(source)) return false;
    try {
        return statSync(source).mtimeMs > statSync(dest).mtimeMs
            && readFileSync(dest, "utf8") !== readFileSync(source, "utf8");
    } catch {
        return false;
    }
}
