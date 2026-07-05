// Wraps bootstrap.sh for discoverability/direct-invocation of the Node
// CLI (`node cli/bin/devforgekit.js install`). The root `devforgekit`
// dispatcher itself never routes `install`/`bootstrap` through here - it
// always execs bootstrap.sh directly, since Node may not exist yet on a
// brand-new machine (see docs/PlatformArchitecture.md sections 1 and 15).
import { defineScriptCommand } from "../core/shell.js";

export function registerInstallCommand(program) {
    defineScriptCommand(program, {
        name: "install",
        aliases: ["bootstrap"],
        description: "Full provision: Homebrew, mise, dotfiles, editors, services",
        script: "bootstrap.sh"
    });
}
