// getPlatform() - the one entry point every shared system should use
// instead of checking `process.platform`/`os.platform()` directly (see
// base.js's file comment for the full rationale). Cached as a singleton
// per process since the running OS never changes mid-process; tests
// that need to exercise a different adapter use
// `setPlatformForTesting()`/`resetPlatformForTesting()` rather than
// mocking `os.platform()` globally.
import os from "node:os";
import { MacOSPlatform } from "./macos.js";
import { LinuxPlatform } from "./linux.js";
import { WindowsPlatform } from "./windows.js";

export { Platform } from "./base.js";
export { MacOSPlatform } from "./macos.js";
export { LinuxPlatform } from "./linux.js";
export { WindowsPlatform } from "./windows.js";
export { PlatformNotSupportedError } from "./errors.js";

let cached = null;
let override = null;

function detect() {
    const p = os.platform();
    if (p === "darwin") return new MacOSPlatform();
    if (p === "linux") return new LinuxPlatform();
    return new WindowsPlatform();
}

export function getPlatform() {
    if (override) return override;
    if (!cached) cached = detect();
    return cached;
}

// setPlatformForTesting(platform) - inject a specific adapter instance
// (e.g. `new LinuxPlatform()`) so a test can exercise cross-platform
// behavior without actually running on that OS.
export function setPlatformForTesting(platform) {
    override = platform;
}

export function resetPlatformForTesting() {
    override = null;
}
