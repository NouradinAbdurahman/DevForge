import { defineScriptCommand } from "../core/shell.js";

export function registerRestoreCommand(program) {
    defineScriptCommand(program, {
        name: "restore",
        description: "Restore dotfiles/editors from the repo (no packages/services)",
        script: "scripts/restore.sh"
    });
}
