// Reads the repo-root VERSION file - the single source of truth also used
// by scripts/release.sh. cli/package.json's version is kept in lockstep
// manually rather than read at runtime, so `npm` tooling still sees a
// normal semver field.
import { readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./core/paths.js";

export function getVersion() {
    try {
        return readFileSync(path.join(repoRoot(), "VERSION"), "utf8").trim();
    } catch {
        return "0.0.0";
    }
}
