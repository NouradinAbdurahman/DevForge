import { defineScriptCommand } from "../core/shell.js";

export function registerReleaseCommand(program) {
    defineScriptCommand(program, {
        name: "release",
        description: "patch|minor|major version release (bump VERSION, draft CHANGELOG, tag, push)",
        script: "scripts/release.sh"
    });
}
