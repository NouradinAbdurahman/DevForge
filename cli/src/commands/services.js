import { defineScriptCommand } from "../core/shell.js";

export function registerServicesCommand(program) {
    defineScriptCommand(program, {
        name: "services",
        description: "start|stop|restart|status for local services (PostgreSQL, MySQL, Redis)",
        script: "scripts/services.sh"
    });
}
