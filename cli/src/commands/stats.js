// Native command: machine/registry statistics (see
// docs/PlatformArchitecture.md's Profiles & Configuration section).
// Reuses the same techniques already proven elsewhere in this repo:
// disk-free via `df -Pk` (bootstrap.sh's preflight check),
// `brew outdated` (scripts/doctor.sh), and the health-score formula
// (core/health.js, a JS port of print_health_score in common.sh) - all
// real, live data, no fabricated numbers.
import { spawn } from "node:child_process";
import { loadPackages } from "../core/registry.js";
import { validate } from "../core/installer.js";
import { captureShellCommand } from "../core/shell.js";
import { scoreResults } from "../core/health.js";
import { logger } from "../core/logger.js";
import { withErrorHandling } from "../core/errors.js";

export async function componentInstallStats() {
    const results = [];
    for (const pkg of loadPackages()) {
        if (!pkg.validate) continue;
        try {
            results.push({ status: (await validate(pkg)) === 0 ? "PASS" : "WARNING", name: pkg.name });
        } catch {
            results.push({ status: "WARNING", name: pkg.name });
        }
    }
    return results;
}

export async function diskFreeGb() {
    const { stdout } = await captureShellCommand("df -Pk \"$HOME\"");
    const line = stdout.trim().split("\n")[1] || "";
    const freeKb = Number(line.trim().split(/\s+/)[3] || 0);
    return Math.round(freeKb / 1024 / 1024);
}

export async function outdatedPackages() {
    const { stdout } = await captureShellCommand("brew outdated 2>/dev/null");
    return stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

// osInfo() -> { name, version, build } straight from `sw_vers` (one call,
// parses its "Label:\tValue" lines) - the same source
// scripts/inventory.sh's system.md report uses, so the dashboard and the
// Layer 1 report never disagree about what macOS this is.
export async function osInfo() {
    const { stdout } = await captureShellCommand("sw_vers 2>/dev/null");
    const fields = {};
    for (const line of stdout.split("\n")) {
        const m = /^([^:]+):\s*(.*)$/.exec(line.trim());
        if (m) fields[m[1].trim()] = m[2].trim();
    }
    return {
        name: fields.ProductName || "macOS",
        version: fields.ProductVersion || "unknown",
        build: fields.BuildVersion || "unknown"
    };
}

// hardwareInfo() -> { model, chip } from `system_profiler
// SPHardwareDataType` - the same field-lookup approach
// scripts/inventory.sh's `_sp_field` helper uses (fixed-string match, not
// a regex, since some labels contain parentheses). Apple Silicon reports
// "Chip:"; Intel Macs report "Processor Name:" instead - whichever is
// present is the real one, never guessed.
export async function hardwareInfo() {
    const { stdout } = await captureShellCommand("system_profiler SPHardwareDataType 2>/dev/null");
    const field = (label) => {
        const line = stdout.split("\n").find((l) => l.includes(`${label}:`));
        return line ? line.split(`${label}:`)[1].trim() : null;
    };
    return {
        model: field("Model Name") || "unknown",
        chip: field("Chip") || field("Processor Name") || "unknown"
    };
}

// memoryGb() -> total installed RAM, from `sysctl -n hw.memsize` (bytes).
export async function memoryGb() {
    const { stdout } = await captureShellCommand("sysctl -n hw.memsize 2>/dev/null");
    const bytes = Number(stdout.trim() || 0);
    return Math.round(bytes / 1024 / 1024 / 1024);
}

// diskUsage() -> { totalGb, usedGb, freeGb, usedPercent } for the root
// volume, via `df -Pk /` (POSIX single-line output, 1024-byte blocks -
// the same flags CLAUDE.md documents for BSD/GNU-userland-agnostic disk
// checks). Distinct from diskFreeGb() above, which reports $HOME's free
// space only; this is the whole-device storage picture.
export async function diskUsage() {
    const { stdout } = await captureShellCommand("df -Pk / 2>/dev/null");
    const line = stdout.trim().split("\n")[1] || "";
    const cols = line.trim().split(/\s+/);
    const totalKb = Number(cols[1] || 0);
    const usedKb = Number(cols[2] || 0);
    const freeKb = Number(cols[3] || 0);
    const toGb = (kb) => Math.round(kb / 1024 / 1024);
    return {
        totalGb: toGb(totalKb),
        usedGb: toGb(usedKb),
        freeGb: toGb(freeKb),
        // df's own Capacity column (e.g. "21%"), not a recomputed
        // used/total ratio - df excludes reserved filesystem blocks
        // from its percentage base, so recomputing it here would
        // silently disagree with what `df` itself (and Finder/About
        // This Mac) report for the same volume.
        usedPercent: Number((cols[4] || "0").replace("%", "")) || 0
    };
}

// uptimeString() -> the real, unparsed `uptime` output (trimmed). Not
// reformatted into a custom "Xd Yh" shape - `uptime`'s own wording
// already varies by macOS version, and re-parsing it risks silently
// showing a wrong number if the format ever shifts; the raw line is
// always correct because it's never transformed.
export async function uptimeString() {
    const { stdout } = await captureShellCommand("uptime 2>/dev/null");
    return stdout.trim();
}

// softwareUpdateStatus() -> { checked, upToDate, updates, error }.
// `softwareupdate -l` contacts Apple's update servers and can occasionally
// hang or take a long time, so this spawns it directly (not via
// captureShellCommand) to enforce a real timeout that SIGTERMs the
// process rather than just abandoning it. On any failure/timeout this
// reports `checked: false` honestly instead of guessing "up to date".
const SOFTWARE_UPDATE_TIMEOUT_MS = 20000;

export function softwareUpdateStatus() {
    return new Promise((resolve) => {
        const child = spawn("softwareupdate", ["-l"], { stdio: ["ignore", "pipe", "pipe"] });
        let output = "";
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => {
            child.kill("SIGTERM");
            finish({ checked: false, upToDate: null, updates: [], error: "timed out" });
        }, SOFTWARE_UPDATE_TIMEOUT_MS);
        child.stdout.on("data", (chunk) => { output += chunk; });
        child.stderr.on("data", (chunk) => { output += chunk; });
        child.on("error", (err) => finish({ checked: false, upToDate: null, updates: [], error: err.message }));
        child.on("close", () => {
            if (/No new software available/i.test(output)) {
                finish({ checked: true, upToDate: true, updates: [], error: null });
                return;
            }
            const updates = [...output.matchAll(/^\s*\*\s*Label:\s*(.+)$/gm)].map((m) => m[1].trim());
            if (updates.length > 0) {
                finish({ checked: true, upToDate: false, updates, error: null });
            } else {
                // Output didn't match either known shape - report honestly
                // rather than assuming up-to-date or fabricating a count.
                finish({ checked: false, upToDate: null, updates: [], error: "unrecognized output" });
            }
        });
    });
}

export function registerStatsCommand(program) {
    program
        .command("stats")
        .description("Show installed components, disk usage, outdated packages, and a health score")
        .option("--json", "emit as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();

            const results = await componentInstallStats();
            const installed = results.filter((r) => r.status === "PASS");
            const { score, verdict } = scoreResults(results);
            const freeGb = await diskFreeGb();
            const outdated = await outdatedPackages();

            const stats = {
                installedComponents: installed.length,
                totalComponents: results.length,
                freeDiskGb: freeGb,
                outdatedPackageCount: outdated.length,
                outdatedPackages: outdated,
                healthScore: score,
                healthVerdict: verdict
            };

            if (opts.json) {
                console.log(JSON.stringify(stats, null, 2));
                return;
            }

            logger.section("DevForgeKit Stats");
            console.log(`  Installed components: ${stats.installedComponents} / ${stats.totalComponents}`);
            console.log(`  Free disk space: ${stats.freeDiskGb}GB`);
            console.log(`  Outdated Homebrew packages: ${stats.outdatedPackageCount}`);
            if (outdated.length > 0) {
                console.log(`    ${outdated.join(", ")}`);
            }
            console.log(`  Health score: ${stats.healthScore}% - ${stats.healthVerdict}`);
        }));
}
