import { defineScriptCommand } from "../core/shell.js";

export function registerCleanCommand(program) {
    defineScriptCommand(program, {
        name: "clean",
        aliases: ["cleanup"],
        description: "Reclaim disk space across every cache",
        script: "scripts/cleanup.sh"
    });
}
