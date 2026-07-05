// Consistent error handling for every command action: a DevForgeError
// carries a user-facing message and an intended process exit code; any
// other thrown error is treated as a bug (full stack shown, exit code 1).
// Usage errors (bad args) use exit code 2, matching common CLI convention.
import { logger } from "./logger.js";

export class DevForgeError extends Error {
    constructor(message, { exitCode = 1 } = {}) {
        super(message);
        this.name = "DevForgeError";
        this.exitCode = exitCode;
    }
}

export function usageError(message) {
    return new DevForgeError(message, { exitCode: 2 });
}

// withErrorHandling(actionFn) -> wrapped action for commander's .action().
// Commander actions may be async; this awaits and funnels any rejection
// through one consistent reporter instead of an unhandled rejection.
// Deliberately a regular `function`, not an arrow function: commander
// invokes the action with `this` bound to the Command instance, and some
// command modules rely on `this.opts()` inside a regular-function action
// (per commander's documented `this`-binding convention) - an arrow
// function here would silently break that by capturing module scope
// instead of forwarding the call-site `this`.
export function withErrorHandling(actionFn) {
    return async function (...args) {
        try {
            await actionFn.apply(this, args);
        } catch (err) {
            if (err instanceof DevForgeError) {
                logger.error(err.message);
                process.exitCode = err.exitCode;
                return;
            }
            logger.error(err.message || String(err));
            if (process.env.DEVFORGEKIT_DEBUG === "1" && err.stack) {
                console.error(err.stack);
            } else {
                logger.info("Run with --debug for a full stack trace.");
            }
            process.exitCode = 1;
        }
    };
}
