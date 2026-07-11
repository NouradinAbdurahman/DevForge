// Multi-installation detection: the same binary reachable from more
// than one place on PATH is one of the biggest real-world sources of
// developer confusion ("flutter doctor says X but I upgraded flutter
// yesterday" - because Homebrew's flutter shadows the manually-installed
// one, or vice versa). `which -a <binary>` lists every match in PATH
// order - the FIRST one is what actually runs; the rest are shadowed.
//
// Provider classification is a path heuristic, labeled as exactly that:
// it says where a location LOOKS like it came from (Homebrew prefix,
// mise shims, system dirs, manual/user dirs) - it does not claim to
// know how the file got there.
import { captureShellCommand } from "../shell.js";

// classifyLocation(location) -> a human-readable source label.
export function classifyLocation(location) {
    if (location.includes("/mise/")) return "mise";
    if (location.startsWith("/opt/homebrew/") || location.startsWith("/usr/local/Cellar/") || location.startsWith("/home/linuxbrew/")) return "Homebrew";
    if (location.startsWith("/usr/local/")) return "manual (/usr/local)";
    if (location.startsWith("/usr/bin/") || location.startsWith("/bin/") || location.startsWith("/usr/sbin/") || location.startsWith("/sbin/")) return "system";
    if (location.includes("/.local/bin/")) return "manual (~/.local/bin)";
    if (location.includes("/node_modules/")) return "npm";
    if (location.includes("/.cargo/bin/")) return "cargo";
    return "unknown source";
}

// findBinaryConflicts(binary, { capture }) -> null when the binary
// resolves zero or one way, else:
//   { binary, locations: [{ location, source, active }] }
// Locations are deduplicated (PATH itself can contain the same directory
// twice - observed for real on the machine this was developed on); the
// first remaining one is the active one.
export async function findBinaryConflicts(binary, { capture = captureShellCommand } = {}) {
    let stdout;
    try {
        const result = await capture(`which -a ${binary}`);
        if (result.code !== 0) return null;
        stdout = result.stdout;
    } catch {
        return null;
    }

    const seen = new Set();
    const locations = [];
    for (const line of stdout.split("\n")) {
        const location = line.trim();
        if (!location || seen.has(location)) continue;
        seen.add(location);
        locations.push({ location, source: classifyLocation(location), active: locations.length === 0 });
    }

    if (locations.length <= 1) return null;
    return { binary, locations };
}

// describeConflict(name, conflict) -> the doctor-facing message lines.
export function describeConflict(name, conflict) {
    const lines = [`Multiple ${name} installations detected:`];
    for (const [i, loc] of conflict.locations.entries()) {
        lines.push(`  ${i + 1}. ${loc.source}: ${loc.location}${loc.active ? "  (currently used)" : ""}`);
    }
    const shadowed = conflict.locations.filter((l) => !l.active);
    if (shadowed.length > 0) {
        lines.push(`  Recommendation: keep one installation - the ${shadowed.map((l) => l.source).join(", ")} cop${shadowed.length === 1 ? "y is" : "ies are"} shadowed and can drift out of date unnoticed.`);
    }
    return lines.join("\n");
}
