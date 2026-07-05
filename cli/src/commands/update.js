import { defineScriptCommand } from "../core/shell.js";

export function registerUpdateCommand(program) {
    defineScriptCommand(program, {
        name: "update",
        description: "Upgrade every managed toolchain, restart services",
        script: "scripts/update.sh"
    });
}
