// Live watch mode (`devforgekit env watch`): polls the platform's bin
// directories for newly-appeared executables whose names match a known
// registry package's binary, and registers them the moment they land -
// `brew install terraform` in another terminal gets picked up, tracked,
// and the environment regenerated without the user running anything.
//
// Polling (not fs.watch): macOS FSEvents through fs.watch is
// per-directory-unreliable for the handful of dirs involved, and a
// 2-second readdir over 4-5 bin directories is cheap; honest and boring
// beats clever and flaky here.
import { readdirSync } from "node:fs";
import { getPlatform } from "../platform/index.js";
import { loadPackages } from "../registry.js";
import { binaryNameFor } from "./discovery.js";
import { loadEnvironmentState } from "./state.js";
import { registerPackageEnvironment } from "./index.js";

// registryBinaryMap() -> Map<binaryName, packageName> for every
// registry package (first claim wins - duplicate binary claims across
// packages are already surfaced by registry stats).
export function registryBinaryMap({ packages = loadPackages() } = {}) {
    const map = new Map();
    for (const pkg of packages) {
        const binary = binaryNameFor(pkg);
        if (!map.has(binary)) map.set(binary, pkg.name);
    }
    return map;
}

function listDir(dir) {
    try {
        return readdirSync(dir);
    } catch {
        return [];
    }
}

// scanOnce({ dirs, binaryMap, known }) -> [{ binary, package, dir }]
// newly-appeared known binaries. `known` (a Set of "dir/binary" keys)
// is the caller-held baseline, mutated as findings are consumed so the
// next scan doesn't re-report them. Pure-ish and injectable so tests
// never poll a real machine.
export function scanOnce({ dirs, binaryMap, known }) {
    const found = [];
    for (const dir of dirs) {
        for (const name of listDir(dir)) {
            const key = `${dir}/${name}`;
            if (known.has(key)) continue;
            known.add(key);
            if (binaryMap.has(name)) {
                found.push({ binary: name, package: binaryMap.get(name), dir });
            }
        }
    }
    return found;
}

// startEnvironmentWatch({ intervalMs, onEvent, register }) -> stop().
// First scan primes the baseline silently (everything already installed
// is not "news"); subsequent scans report and register genuinely new
// arrivals. Already-tracked packages are re-registered too - a
// reinstall/upgrade refreshes their observed facts.
export function startEnvironmentWatch({
    intervalMs = 2000,
    onEvent = () => {},
    dirs = getPlatform().binSearchDirs(),
    binaryMap = registryBinaryMap(),
    register = registerPackageEnvironment
} = {}) {
    const known = new Set();
    scanOnce({ dirs, binaryMap, known }); // prime baseline

    const timer = setInterval(async () => {
        for (const finding of scanOnce({ dirs, binaryMap, known })) {
            try {
                const result = await register(finding.package);
                const state = loadEnvironmentState();
                const entry = state.packages[finding.package];
                onEvent({
                    ...finding,
                    registered: result !== null,
                    version: entry?.version || null,
                    // "no shell restart required" is only claimed when
                    // it's true: the binary landed in a directory the
                    // current PATH already contains.
                    reachableNow: (process.env.PATH || "").split(":").includes(finding.dir)
                });
            } catch (err) {
                onEvent({ ...finding, registered: false, error: err.message });
            }
        }
    }, intervalMs);

    return () => clearInterval(timer);
}
