// Shell integration for the active workspace, direnv/mise-style: a
// one-time marker-block hook installed into the user's shell rc file
// (`workspace shell-init`) sources a single, always-overwritten
// generated file that holds whichever workspace is currently active's
// exported env vars/aliases/functions/PATH additions. Honest scoping,
// stated up front because it's the one real constraint of this whole
// approach: a child process (this CLI) cannot mutate an *already
// running* parent shell's environment - no CLI can - so, exactly like
// scripts/common.sh's path_manager_fix, a switch takes effect in shells
// opened *after* it runs; an already-open shell needs `exec zsh` (or a
// new tab). `shell.prompt`/`shell.theme` are intentionally reference-only
// (not applied) - PS1/PROMPT syntax and prompt-framework config (oh-my-
// zsh, starship, powerlevel10k...) vary too much to safely rewrite, so
// pretending to apply them would be exactly the kind of fabricated
// behavior this codebase avoids elsewhere (see cloud.js).
import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { userConfigDir } from "../paths.js";
import { shellQuote } from "../shell.js";
import { getPlatform } from "../platform/index.js";
import { writeBlock, removeBlock, hasBlock } from "./markerBlock.js";

const HOOK_ID = "workspace-shell-hook";

function workspaceShellFile() {
    return path.join(userConfigDir(), "workspace-shell.sh");
}

// rcFileFor(shell) -> delegates to the current platform adapter (see
// core/platform/) instead of hardcoding .zshrc/.bashrc - macOS's default
// shell is zsh, but a workspace can still request "bash" explicitly, and
// on Linux/Windows the adapter resolves a different default/rc file
// entirely (see linux.js/windows.js).
function rcFileFor(shell) {
    return getPlatform().shellConfigFile(shell);
}

// buildShellLines(workspace, { resolvedEnv }) -> string[] of plain
// POSIX-shell statements (works unmodified under both bash and zsh).
// `resolvedEnv` is an optional flat { KEY: value } map of *already
// decrypted* secret values layered on top of `workspace.env.variables` -
// this module never touches encryption itself (see env.js); it only
// ever receives final strings to export.
export function buildShellLines(workspace, { resolvedEnv } = {}) {
    const shell = workspace.shell || {};
    const env = { ...(workspace.env?.variables || {}), ...(resolvedEnv || {}) };
    const lines = [];

    if (shell.pathAdditions?.length) {
        lines.push(`export PATH="${shell.pathAdditions.join(":")}:$PATH"`);
    }
    for (const [key, value] of Object.entries(env)) {
        lines.push(`export ${key}=${shellQuote(value)}`);
    }
    for (const [name, command] of Object.entries(shell.aliases || {})) {
        lines.push(`alias ${name}=${shellQuote(command)}`);
    }
    for (const [name, body] of Object.entries(shell.functions || {})) {
        lines.push(`${name}() {`, body, "}");
    }
    return lines;
}

// applyWorkspaceShell(workspace, { resolvedEnv }) -> the generated
// file's path. Completely overwrites workspace-shell.sh (unlike ssh.js's
// per-workspace marker blocks, shell export state is exclusive - only
// one workspace can be "active" in a given shell at a time, so
// regenerating the whole file from scratch is correct, not a
// limitation). Mode 0600: this file can legitimately contain decrypted
// secret values once env.js is layered on top, the same accepted
// tradeoff every plaintext `.env`/direnv `.envrc` already makes - there
// is no way to `export` a secret into a shell without it existing in
// plaintext somewhere the shell can read it.
export function applyWorkspaceShell(workspace, { resolvedEnv } = {}) {
    const lines = buildShellLines(workspace, { resolvedEnv });
    const file = workspaceShellFile();
    mkdirSync(path.dirname(file), { recursive: true });
    const header = [
        `# Generated for workspace '${workspace.name}' by 'devforgekit workspace switch'.`,
        "# Do not hand-edit - overwritten on every switch/save. Sourced by the shell-init",
        "# hook installed in your shell rc file (see 'devforgekit workspace shell-init')."
    ];
    writeFileSync(file, `${header.join("\n")}\n\n${lines.join("\n")}\n`);
    chmodSync(file, 0o600);
    return file;
}

// clearWorkspaceShell() - resets the generated file to empty when no
// workspace is active (e.g. after `workspace switch --none`/delete of
// the active workspace), so a new shell doesn't keep exporting a
// workspace's variables after it's no longer active.
export function clearWorkspaceShell() {
    const file = workspaceShellFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "# No active DevForgeKit workspace.\n");
    chmodSync(file, 0o600);
}

// shellInitScript() -> the one line the shell-init hook installs. Kept
// as its own export mainly for tests/inspection without touching a real
// rc file.
export function shellInitScript() {
    return `[ -f "${workspaceShellFile()}" ] && source "${workspaceShellFile()}"`;
}

// installShellHook(shell) -> the rc file path it was installed into.
export function installShellHook(shell = getPlatform().defaultShell()) {
    const rcFile = rcFileFor(shell);
    if (!existsSync(workspaceShellFile())) clearWorkspaceShell();
    writeBlock(rcFile, HOOK_ID, [shellInitScript()], {
        header: [
            "# Sources the active DevForgeKit workspace's exported env vars/aliases/",
            "# functions/PATH additions. Installed by 'devforgekit workspace shell-init' -",
            "# safe to delete; changes only take effect in shells started after they're made."
        ],
        backup: true
    });
    return rcFile;
}

export function uninstallShellHook(shell = getPlatform().defaultShell()) {
    return removeBlock(rcFileFor(shell), HOOK_ID);
}

export function isShellHookInstalled(shell = getPlatform().defaultShell()) {
    return hasBlock(rcFileFor(shell), HOOK_ID);
}
