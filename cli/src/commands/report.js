import { defineScriptCommand } from "../core/shell.js";

export function registerReportCommand(program) {
    defineScriptCommand(program, {
        name: "report",
        description: "Generate a system report at reports/system-report.txt",
        script: "scripts/report.sh"
    });
}
