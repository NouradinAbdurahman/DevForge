import { defineScriptCommand } from "../core/shell.js";

export function registerPreferencesCommand(program) {
    defineScriptCommand(program, {
        name: "preferences",
        aliases: ["prefs"],
        description: "backup|restore|status for macOS UI preferences",
        script: "scripts/preferences.sh"
    });
}
