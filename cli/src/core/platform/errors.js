// A dedicated subclass (rather than a plain DevForgeError) so callers
// that already treat platform-unsupported as a soft/skippable condition
// (e.g. "this package manager isn't available here") can catch it
// specifically instead of pattern-matching on message text.
import { DevForgeError } from "../errors.js";

export class PlatformNotSupportedError extends DevForgeError {
    constructor(message) {
        super(message, { exitCode: 1 });
        this.name = "PlatformNotSupportedError";
    }
}

// A real package-manager identifier (npm/pip/cargo/go/brew/apt/dnf/
// pacman/winget/choco/scoop) is always a short, constrained token -
// letters, digits, and a handful of separator characters real ids
// actually use (`@angular/cli`, `openssl@3`, `cockroachdb/tap/cockroach`,
// `huggingface_hub[cli]`'s pip extras syntax, `golang.org/x/tools/...@latest`).
// It never legitimately contains whitespace, quotes, or shell
// metacharacters. Every platform adapter's installCommand()/
// upgradeCommand() interpolates step.id/name into a shell string (see
// core/shell.js's runShellCommand, which always shells out) - rather
// than trying to perfectly escape a value for both POSIX shells and
// cmd.exe (two different, both famously error-prone quoting grammars),
// this refuses anything that doesn't look like a real package
// identifier before it ever reaches a spawned shell, matching this
// codebase's existing "never fabricate, degrade honestly" stance.
// Packages are currently loaded only from the trusted in-repo registry
// (see core/registry.js), so this is defense-in-depth today - it closes
// the class of bug outright rather than depending on that trust
// boundary never changing (a plugin-contributed package, a future
// less-trusted registry root, etc.).
const SAFE_PACKAGE_ID = /^[A-Za-z0-9@][A-Za-z0-9._@/:+~[\]-]*$/;

export function assertSafePackageId(id, context = "package id") {
    if (typeof id !== "string" || !SAFE_PACKAGE_ID.test(id)) {
        throw new DevForgeError(`Refusing to run a shell command with an unexpected ${context}: ${JSON.stringify(id)}`);
    }
}
