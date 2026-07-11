// Pure pass-through to scripts/uninstall.sh (see docs/InstallationAudit.md
// and defineScriptCommand's own doc comment, core/shell.js) - a destructive
// command with its own tty/--force safety gate that this thin wrapper must
// not interfere with, so it forwards every flag verbatim rather than
// reimplementing any of the logic in JS.
import { defineScriptCommand } from "../core/shell.js";

export function registerUninstallCommand(program) {
    defineScriptCommand(program, {
        name: "uninstall",
        description: "Remove what DevForgeKit installed - packages, VS Code/Cursor extensions, configuration, services (see 'uninstall --help')",
        script: "scripts/uninstall.sh"
    });
}
