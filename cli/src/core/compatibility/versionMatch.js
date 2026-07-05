// Version range matching for the Compatibility Engine. Builds entirely on
// `semver` (already a CLI dependency - see core/registry.js's package.json),
// rather than hand-rolling comparison logic: exact/minimum/maximum/range/
// wildcard/pre-release are all things `semver.satisfies` already does
// correctly once a loose version string ("27", "3.44", "3.44.0-beta.1") is
// coerced into a real semver.
import semver from "semver";

// coerceVersion(raw) -> a semver.SemVer, or null if it can't be coerced at
// all (e.g. empty/garbage output). `semver.coerce` already handles bare
// majors ("27" -> "27.0.0") and major.minor ("3.44" -> "3.44.0"), which is
// exactly the loose versioning most CLI tools (Xcode, Flutter, Android
// Studio) report.
export function coerceVersion(raw) {
    if (!raw) return null;
    const coerced = semver.coerce(String(raw), { includePrerelease: true });
    return coerced;
}

// matchesVersion(installed, range) -> true | false | null.
//   - null/"*"/"" range -> always true (wildcard).
//   - a range semver can parse -> semver.satisfies (covers exact "=1.2.3",
//     minimum ">=1.2", maximum "<=1.2", ranges ">=1.2 <2.0", and
//     pre-release via includePrerelease).
//   - installed version that can't be coerced to anything -> null
//     ("unverifiable" - reported as such, never guessed as pass or fail).
export function matchesVersion(installed, range) {
    if (range === undefined || range === null || range === "" || range === "*") {
        return true;
    }
    const installedVersion = coerceVersion(installed);
    if (!installedVersion) return null;

    try {
        return semver.satisfies(installedVersion, range, { includePrerelease: true });
    } catch {
        // `range` isn't a valid semver range (e.g. a bare "27" instead of
        // ">=27") - fall back to coercing it too and comparing directly,
        // which is the common shape this registry's own rule files use.
        const rangeVersion = coerceVersion(range);
        if (!rangeVersion) return null;
        return installedVersion.compare(rangeVersion) === 0;
    }
}

// versionKeySpecificity(key) -> how many dot-separated segments a rule key
// declares ("22" -> 1, "3.44" -> 2) - used by findVersionRule to prefer the
// most specific matching key.
function versionKeySpecificity(key) {
    return String(key).split(".").length;
}

// keyMatchesInstalled(key, installedVersion) -> true if every segment the
// key declares (major, and minor if present) equals the installed version's
// corresponding segment. This is deliberately a prefix match, not an exact
// string match: a rule keyed "22" should match an installed "22.5.1", and a
// rule keyed "3.44" should match an installed "3.44.2" but not "3.45.0".
function keyMatchesInstalled(key, installedVersion) {
    const keyVersion = coerceVersion(key);
    if (!keyVersion) return false;
    const specificity = versionKeySpecificity(key);
    if (keyVersion.major !== installedVersion.major) return false;
    if (specificity >= 2 && keyVersion.minor !== installedVersion.minor) return false;
    if (specificity >= 3 && keyVersion.patch !== installedVersion.patch) return false;
    return true;
}

// findVersionRule(versions, installed) -> { key, rule } | null. `versions`
// is a rule file's `versions` map (version string -> rule object). Picks
// the most specific matching key (patch > minor > major) so a rule set that
// declares both "3" and "3.44" resolves "3.44.2" to the "3.44" entry.
export function findVersionRule(versions, installed) {
    if (!versions) return null;
    const installedVersion = coerceVersion(installed);
    if (!installedVersion) return null;

    let best = null;
    for (const [key, rule] of Object.entries(versions)) {
        if (!keyMatchesInstalled(key, installedVersion)) continue;
        const specificity = versionKeySpecificity(key);
        if (!best || specificity > best.specificity) {
            best = { key, rule, specificity };
        }
    }
    return best ? { key: best.key, rule: best.rule } : null;
}
