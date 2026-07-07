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
