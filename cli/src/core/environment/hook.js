// Installs the one-line hook that sources the generated environment
// shell file from the user's real shell rc file - the same idempotent
// marker-block pattern core/workspace/shellIntegration.js already
// established for the per-workspace shell hook (core/workspace/
// markerBlock.js is fully generic - reused here as-is with a distinct
// HOOK_ID, no changes needed to markerBlock.js itself).
//
// The engine never touches anything OUTSIDE its own delimited block -
// markerBlock.js guarantees that structurally. For edits INSIDE the
// block: before replacing a block whose content no longer matches what
// the engine would write, the whole rc file is backed up with a
// timestamp so the user's change is recoverable, and the caller is told.
//
// Coexistence with the workspace hook: both hooks can live in the same
// rc file safely, since markerBlock.js's writeBlock only ever touches
// its own delimited block. This one should be installed first (it
// existed - or should run - before any workspace is ever switched to),
// so the workspace hook's block ends up lower in the file and sources
// later, meaning a workspace's per-project variables correctly override
// this subsystem's package-level ones for the same key. No merging of
// the two systems is needed.
import { copyFileSync, existsSync } from "node:fs";
import { getPlatform } from "../platform/index.js";
import { writeBlock, removeBlock, hasBlock, readBlock } from "../workspace/markerBlock.js";
import { shellFilePath } from "./shellFile.js";
import { shellHookLine } from "./writers/index.js";

const HOOK_ID = "environment-hook";

function rcFileFor(shell) {
    return getPlatform().shellConfigFile(shell);
}

// environmentHookScript(shell) -> the source line in THIS shell's own
// syntax (writers/index.js's hookLine - POSIX `[ -f x ] && source x` is
// a syntax error in fish).
export function environmentHookScript(shell) {
    return shellHookLine(shell, shellFilePath(shell));
}

const HOOK_HEADER = [
    "# Sources DevForgeKit's generated environment file (PATH/variables/shell",
    "# hooks contributed by installed packages). Installed by the Environment",
    "# Configuration Engine - safe to delete; changes only take effect in shells",
    "# started after they're made."
];

// installEnvironmentHook(shell) -> { rcFile, manualEditBackup }.
// Idempotent; a re-run over an untouched block is a no-op content-wise.
export function installEnvironmentHook(shell = getPlatform().defaultShell()) {
    const rcFile = rcFileFor(shell);
    const expected = [...HOOK_HEADER, environmentHookScript(shell)].join("\n");

    let manualEditBackup = null;
    if (existsSync(rcFile)) {
        const currentBlock = readBlock(rcFile, HOOK_ID);
        if (currentBlock !== null && currentBlock !== expected) {
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            manualEditBackup = `${rcFile}.devforgekit-backup-${stamp}`;
            copyFileSync(rcFile, manualEditBackup);
        }
    }

    writeBlock(rcFile, HOOK_ID, [environmentHookScript(shell)], {
        header: HOOK_HEADER,
        backup: true
    });
    return { rcFile, manualEditBackup };
}

export function uninstallEnvironmentHook(shell = getPlatform().defaultShell()) {
    return removeBlock(rcFileFor(shell), HOOK_ID);
}

export function isEnvironmentHookInstalled(shell = getPlatform().defaultShell()) {
    const rcFile = rcFileFor(shell);
    return existsSync(rcFile) && hasBlock(rcFile, HOOK_ID);
}
