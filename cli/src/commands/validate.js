import { defineScriptCommand } from "../core/shell.js";

export function registerValidateCommand(program) {
    defineScriptCommand(program, {
        name: "validate",
        description: "Validate this repo's own scripts/configs",
        script: "scripts/validate.sh"
    });
}
