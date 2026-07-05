import { defineScriptCommand } from "../core/shell.js";

export function registerBackupCommand(program) {
    defineScriptCommand(program, {
        name: "backup",
        description: "Capture live config into the repo, commit+push if changed",
        script: "scripts/backup.sh"
    });
}
