// The Environment Snapshot & Restore engine (v1.3.2). Captures the user's
// entire development environment into a portable .dfk archive (tar.gz) and
// restores it on another machine. This is NOT a backup utility - it is an
// environment portability system.
//
// A .dfk archive contains:
//   snapshot.json       - main manifest (metadata + component inventory)
//   config/             - copy of ~/.config/devforgekit/ (no secrets)
//   workspaces/         - workspace bundles (metadata only, no source code)
//   profiles/           - user-created profile YAML files
//   recipes/            - user-created recipe YAML files
//   themes/             - custom theme YAML files
//   inventory/          - inventory report files (if present)
//   registry/           - installed component IDs + custom manifests
//   checksums/          - SHA256 checksums for each section
//   missing-secrets.md  - list of secret keys the user must provide on restore
//
// Every existing DevForgeKit subsystem is reused - nothing is duplicated:
//   - config.js for configuration capture/restore
//   - workspace/store.js + workspace/bundle.js for workspace export/import
//   - registry.js for profiles/recipes/collections/packages
//   - plugins.js for plugin discovery
//   - tui/theme.js for theme listing/export
//   - compatibility/engine.js for pre-restore compatibility checks
//   - installer.js for installed component detection
//   - health.js for health scoring
//   - ai/providers for AI-powered explanations
//   - stats.js for machine info gathering
//   - self-update.js for config backup/restore
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, cpSync, statSync } from "node:fs";
import { tmpdir, hostname, userInfo, arch } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
import { runShellCommand, captureShellCommand, shellQuote } from "./shell.js";
import { repoRoot, userConfigDir, userStateDir } from "./paths.js";
import { loadConfig, getConfigValue } from "./config.js";
import { loadPackages, loadProfiles, loadRecipes, loadCollections } from "./registry.js";
import { discoverPlugins } from "./plugins.js";
import { validate } from "./installer.js";
import { getVersion } from "../version.js";
import { logger } from "./logger.js";
import { DevForgeError } from "./errors.js";
import { listWorkspaces, workspacesRoot, getActiveWorkspaceName } from "./workspace/store.js";
import { exportWorkspaceBundle, importWorkspaceBundle } from "./workspace/bundle.js";
import { scoreResults } from "./health.js";
import { currentPlatform, currentArchitecture, scanCompatibility } from "./compatibility/engine.js";
import { listGenerators } from "../generators/index.js";
import { envVarForProvider } from "./ai/providers/index.js";

// ─── Constants ────────────────────────────────────────────────────────

export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_DIR = "snapshots";
export const SNAPSHOT_EXTENSION = ".dfk";

function snapshotsDir() {
    return path.join(userStateDir(), SNAPSHOT_DIR);
}

function tempDir(prefix) {
    return mkdtempSync(path.join(tmpdir(), prefix));
}

// ─── Machine info ─────────────────────────────────────────────────────

async function captureShell(label, cmd) {
    try {
        const { stdout } = await captureShellCommand(cmd);
        return stdout.trim();
    } catch {
        return "unknown";
    }
}

export async function gatherMachineInfo() {
    const osInfo = await captureShell("sw_vers", "sw_vers 2>/dev/null");
    const fields = {};
    for (const line of osInfo.split("\n")) {
        const m = /^([^:]+):\s*(.*)$/.exec(line.trim());
        if (m) fields[m[1].trim()] = m[2].trim();
    }

    const hwOut = await captureShell("system_profiler", "system_profiler SPHardwareDataType 2>/dev/null");
    const hwField = (label) => {
        const line = hwOut.split("\n").find((l) => l.includes(`${label}:`));
        return line ? line.split(`${label}:`)[1].trim() : "unknown";
    };

    const memOut = await captureShell("sysctl", "sysctl -n hw.memsize 2>/dev/null");
    const memBytes = Number(memOut.trim() || 0);
    const memoryGb = memBytes > 0 ? Math.round(memBytes / 1024 / 1024 / 1024) : 0;

    const diskOut = await captureShell("df", "df -Pk / 2>/dev/null");
    const diskLine = diskOut.trim().split("\n")[1] || "";
    const diskCols = diskLine.trim().split(/\s+/);
    const toGb = (kb) => Math.round(Number(kb || 0) / 1024 / 1024);

    return {
        name: hwField("Model Name") || "unknown",
        hostname: hostname(),
        os: `${fields.ProductName || "macOS"} ${fields.ProductVersion || "unknown"}`,
        osBuild: fields.BuildVersion || "unknown",
        arch: arch(),
        cpu: hwField("Chip") || hwField("Processor Name") || "unknown",
        cores: hwField("Total Number of Cores") || "unknown",
        memoryGb,
        disk: {
            totalGb: toGb(diskCols[1]),
            usedGb: toGb(diskCols[2]),
            freeGb: toGb(diskCols[3]),
            usedPercent: Number((diskCols[4] || "0").replace("%", "")) || 0
        }
    };
}

// ─── Component gathering ──────────────────────────────────────────────

// Batched with a timer yield between batches, the same pattern
// tui/data.js's installedStatuses() and devGraph.js's registry scan
// already use - a plain sequential await-chain over the full ~250
// -package registry (one `validate` shell probe each) is otherwise
// the slowest step in `snapshot create`, at tens of seconds.
export async function installedComponentNames() {
    const names = [];
    const probeable = loadPackages().filter((pkg) => pkg.validate);
    const BATCH = 8;
    for (let i = 0; i < probeable.length; i += BATCH) {
        await Promise.all(probeable.slice(i, i + BATCH).map(async (pkg) => {
            try {
                if ((await validate(pkg)) === 0) names.push(pkg.name);
            } catch {
                // Not installed
            }
        }));
        await new Promise((resolve) => setTimeout(resolve, 15));
    }
    return names;
}

export async function gatherComponents() {
    const [installed, profiles, recipes, collections, plugins] = await Promise.all([
        installedComponentNames(),
        loadProfiles(),
        loadRecipes(),
        loadCollections(),
        discoverPlugins()
    ]);

    return {
        packages: installed,
        collections: collections.map((c) => c.name),
        profiles: profiles.map((p) => p.name),
        recipes: recipes.map((r) => r.name),
        plugins: plugins.filter((p) => p.valid).map((p) => p.name)
    };
}

// ─── Secrets detection ────────────────────────────────────────────────

export function detectMissingSecrets() {
    const secrets = new Set();

    // AI provider API key references
    const config = loadConfig();
    if (config.aiProvider && config.aiProvider !== "none") {
        const envVar = envVarForProvider(config.aiProvider);
        if (envVar) secrets.add(envVar);
    }

    // Workspace secret keys
    for (const ws of listWorkspaces()) {
        if (!ws.valid || !ws.doc) continue;
        for (const key of ws.doc.env?.secretKeys || []) {
            secrets.add(key);
        }
        if (ws.doc.ai?.apiKeyRef) {
            secrets.add(ws.doc.ai.apiKeyRef);
        }
    }

    return [...secrets].sort();
}

export function generateMissingSecretsMd(secrets) {
    if (secrets.length === 0) {
        return "# Missing Secrets\n\nNo secrets were detected in the source environment.\n";
    }
    const lines = [
        "# Missing Secrets\n",
        "The following secret keys were referenced in the source environment",
        "but their values are NOT included in this snapshot (secrets are never exported).",
        "You will need to provide them on the target machine.\n",
        "## Environment Variables\n",
        "```bash"
    ];
    for (const key of secrets) {
        lines.push(`export ${key}="your-value-here"`);
    }
    lines.push("```\n");
    lines.push("## Workspace Secrets\n");
    lines.push("For workspace-specific secrets, use:");
    lines.push("```bash");
    lines.push("devforgekit workspace env set <workspace> <key> <value> --secret");
    lines.push("```\n");
    return lines.join("\n");
}

// ─── Checksums ────────────────────────────────────────────────────────

export function sha256File(filePath) {
    const content = readFileSync(filePath);
    return crypto.createHash("sha256").update(content).digest("hex");
}

export function sha256Dir(dirPath) {
    const entries = [];
    function walk(dir) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else {
                const rel = path.relative(dirPath, fullPath);
                const hash = sha256File(fullPath);
                entries.push(`${hash}  ${rel}`);
            }
        }
    }
    if (existsSync(dirPath)) walk(dirPath);
    return entries.sort().join("\n");
}

export function dirSizeBytes(dirPath) {
    let total = 0;
    function walk(dir) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else {
                total += statSync(fullPath).size;
            }
        }
    }
    if (existsSync(dirPath)) walk(dirPath);
    return total;
}

export function writeChecksums(stagingDir, sections) {
    const checksumsDir = path.join(stagingDir, "checksums");
    mkdirSync(checksumsDir, { recursive: true });
    const results = {};
    for (const [name, content] of Object.entries(sections)) {
        const hash = crypto.createHash("sha256").update(content).digest("hex");
        writeFileSync(path.join(checksumsDir, `${name}.sha256`), `${hash}\n`);
        results[name] = hash;
    }
    return results;
}

// ─── Snapshot ID ──────────────────────────────────────────────────────

function makeSnapshotId(isoTimestamp) {
    return `${isoTimestamp.replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
}

// ─── Create ───────────────────────────────────────────────────────────

export async function createSnapshot({ output, compression = "normal", skipInventory = false, name = null, description = null } = {}) {
    logger.section("Environment Snapshot: Create");

    const startedAt = Date.now();
    const createdAt = new Date().toISOString();
    const id = makeSnapshotId(createdAt);
    const staging = tempDir("devforgekit-snapshot-");

    try {
        // Step 1: Gather machine info
        logger.info("Gathering machine information...");
        const machine = await gatherMachineInfo();
        logger.success(`Machine: ${machine.name} (${machine.hostname})`);

        // Step 2: Gather components
        logger.info("Gathering installed components...");
        const components = await gatherComponents();
        logger.success(`Found ${components.packages.length} installed packages, ${components.profiles.length} profiles, ${components.recipes.length} recipes`);

        // Step 3: Gather config (strip secrets)
        logger.info("Capturing configuration...");
        const config = loadConfig();
        const configCopy = { ...config };
        // Never include actual secret values - they're not in config anyway,
        // but be explicit about it
        delete configCopy._secrets;
        logger.success("Configuration captured");

        // Step 4: Detect missing secrets
        const missingSecrets = detectMissingSecrets();
        if (missingSecrets.length > 0) {
            logger.warn(`Detected ${missingSecrets.length} secret reference(s) - values will NOT be included`);
        }

        // Step 5: Gather themes
        let themes = { current: getConfigValue("tuiTheme") || "dark", custom: [] };
        const themesDir = path.join(userConfigDir(), "themes");
        if (existsSync(themesDir)) {
            themes.custom = readdirSync(themesDir)
                .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
                .map((f) => path.basename(f, path.extname(f)));
        }

        // Step 6: Gather workspace list + which one is active
        const workspaces = listWorkspaces().filter((w) => w.valid).map((w) => w.name);
        const activeWorkspace = getActiveWorkspaceName();
        logger.success(`Found ${workspaces.length} workspace(s)`);

        // Step 6b: Gather Project Generator stacks - the real, static list
        // this DevForgeKit version ships (not "which projects were
        // generated," which isn't tracked anywhere DevForgeKit could
        // capture safely - see docs/Snapshot.md).
        const generators = listGenerators().map((g) => g.id);

        // Step 7: Health score
        let health = null;
        try {
            const stats = await import("../commands/stats.js");
            const installResults = await stats.componentInstallStats();
            health = scoreResults(installResults);
        } catch {
            // Non-critical
        }

        // Step 8: Compatibility score
        let compatibility = null;
        try {
            const result = await scanCompatibility(components.packages);
            compatibility = { score: result.score, verdict: result.verdict };
        } catch {
            // Non-critical
        }

        // Step 9: Git commit - the DevForgeKit repo's OWN commit (via
        // repoRoot(), not process.cwd()). Before this fix, this ran
        // against whatever the current directory happened to be when
        // `snapshot create` was invoked - almost always meaningless (not
        // tied to any workspace, and not necessarily the DevForgeKit repo
        // at all). Scoped explicitly, this answers a real question:
        // "which DevForgeKit source commit produced this snapshot,"
        // useful when debugging a snapshot created from a local
        // clone/branch rather than a released version.
        let gitCommit = "unknown";
        try {
            const { stdout } = await captureShellCommand(`git -C ${shellQuote(repoRoot())} rev-parse HEAD 2>/dev/null`);
            gitCommit = stdout.trim() || "unknown";
        } catch {
            // Not a git repo (e.g. installed via a release tarball, not a clone)
        }

        // Step 9b: how many workspaces have a git identity configured -
        // a real, derivable count (unlike "number of git repos on this
        // machine," which DevForgeKit has no way to enumerate safely).
        const gitWorkspaceCount = listWorkspaces().filter((w) => w.valid && w.doc?.git?.name).length;

        // Step 10: Build snapshot.json
        const snapshotMeta = {
            snapshotVersion: SNAPSHOT_VERSION,
            id,
            name,
            description,
            createdAt,
            creator: userInfo().username || "unknown",
            devforgekitVersion: getVersion(),
            gitCommit,
            gitWorkspaceCount,
            machine,
            components,
            generators,
            config: configCopy,
            workspaces,
            activeWorkspace,
            themes,
            health,
            compatibility,
            missingSecrets
        };

        writeFileSync(path.join(staging, "snapshot.json"), `${JSON.stringify(snapshotMeta, null, 2)}\n`);

        // Step 11: Copy config directory (excluding secrets)
        const configDir = userConfigDir();
        if (existsSync(configDir)) {
            const destConfig = path.join(staging, "config");
            cpSync(configDir, destConfig, {
                recursive: true,
                filter: (src) => {
                    const rel = path.relative(configDir, src);
                    // Exclude workspace secret files
                    if (rel.startsWith("workspaces/") && (rel.endsWith("secret.key") || rel.endsWith("secrets.enc.json"))) {
                        return false;
                    }
                    return true;
                }
            });
            logger.success("Configuration files copied");
        }

        // Step 12: Export workspaces
        if (workspaces.length > 0) {
            logger.info("Exporting workspaces...");
            const wsDir = path.join(staging, "workspaces");
            mkdirSync(wsDir, { recursive: true });
            for (const wsName of workspaces) {
                try {
                    await exportWorkspaceBundle(wsName, wsDir);
                    logger.success(`  Exported workspace '${wsName}'`);
                } catch (err) {
                    logger.warn(`  Failed to export workspace '${wsName}': ${err.message}`);
                }
            }
        }

        // Step 13: Copy user profiles
        const userProfilesDir = path.join(userConfigDir(), "profiles");
        if (existsSync(userProfilesDir)) {
            const destProfiles = path.join(staging, "profiles");
            cpSync(userProfilesDir, destProfiles, { recursive: true });
            logger.success("User profiles copied");
        }

        // Step 14: Copy user recipes
        const userRecipesDir = path.join(userConfigDir(), "recipes");
        if (existsSync(userRecipesDir)) {
            const destRecipes = path.join(staging, "recipes");
            cpSync(userRecipesDir, destRecipes, { recursive: true });
            logger.success("User recipes copied");
        }

        // Step 15: Copy custom themes
        if (existsSync(themesDir)) {
            const destThemes = path.join(staging, "themes");
            cpSync(themesDir, destThemes, { recursive: true });
            logger.success("Custom themes copied");
        }

        // Step 16: Copy inventory reports (if they exist)
        if (!skipInventory) {
            const reportsDir = path.join(repoRoot(), "reports");
            if (existsSync(reportsDir)) {
                const destInventory = path.join(staging, "inventory");
                cpSync(reportsDir, destInventory, { recursive: true });
                logger.success("Inventory reports copied");
            }
        }

        // Step 17: Copy user plugin manifests
        const userPluginsDir = path.join(userStateDir(), "plugins");
        if (existsSync(userPluginsDir)) {
            const destPlugins = path.join(staging, "registry", "plugins");
            for (const entry of readdirSync(userPluginsDir, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const pluginDir = path.join(userPluginsDir, entry.name);
                const manifestPath = path.join(pluginDir, "plugin.yml");
                if (existsSync(manifestPath)) {
                    mkdirSync(destPlugins, { recursive: true });
                    cpSync(pluginDir, path.join(destPlugins, entry.name), { recursive: true });
                }
            }
            logger.success("Plugin manifests copied");
        }

        // Step 18: Generate missing-secrets.md
        writeFileSync(path.join(staging, "missing-secrets.md"), generateMissingSecretsMd(missingSecrets));

        // Step 18b: duration + uncompressed size - computed and folded
        // into snapshot.json BEFORE checksums (Step 19) so the persisted,
        // checksummed manifest already reflects them, rather than
        // rewriting (and re-hashing) it a second time afterward.
        // `durationMs` covers gathering + staging, not the final tar/gzip
        // pass below (typically fast relative to the ~15-20s package
        // scan, and not worth a second full staging pass to include).
        snapshotMeta.durationMs = Date.now() - startedAt;
        snapshotMeta.uncompressedSize = dirSizeBytes(staging);
        writeFileSync(path.join(staging, "snapshot.json"), `${JSON.stringify(snapshotMeta, null, 2)}\n`);

        // Step 19: Generate checksums. `registry` (plugin manifests, Step
        // 17) is now included - a real gap the v2.1.4 audit found: plugin
        // manifest content was copied into every archive but silently
        // excluded from the checksum set entirely.
        const snapshotJson = readFileSync(path.join(staging, "snapshot.json"), "utf8");
        const checksums = writeChecksums(staging, {
            snapshot: snapshotJson,
            config: sha256Dir(path.join(staging, "config")),
            workspaces: sha256Dir(path.join(staging, "workspaces")),
            profiles: sha256Dir(path.join(staging, "profiles")),
            recipes: sha256Dir(path.join(staging, "recipes")),
            themes: sha256Dir(path.join(staging, "themes")),
            inventory: sha256Dir(path.join(staging, "inventory")),
            registry: sha256Dir(path.join(staging, "registry"))
        });

        // Add checksums to snapshot.json
        snapshotMeta.checksums = checksums;
        writeFileSync(path.join(staging, "snapshot.json"), `${JSON.stringify(snapshotMeta, null, 2)}\n`);

        // Step 20: Create tar.gz archive. Real, distinct gzip levels via a
        // `tar | gzip -N` pipe rather than tar's own `-z` flag (which has
        // no per-level control) - v2.1.4 audit found the previous version
        // of this line passed `-czf --rsyncable` to tar's `-f`, which
        // consumes the NEXT token as the archive filename, so `max`
        // silently tried to create an archive literally named
        // `--rsyncable` in the current directory and always failed with a
        // nonzero exit. `fast`/`normal` were also functionally identical
        // (both plain `-czf`, no level flag at all). All three are now
        // real: 1 (fastest/largest) / 6 (gzip's own default) / 9
        // (slowest/smallest).
        const gzipLevel = compression === "fast" ? "1" : compression === "max" ? "9" : "6";
        const outDir = output || snapshotsDir();
        mkdirSync(outDir, { recursive: true });
        const archivePath = path.join(outDir, `${id}${SNAPSHOT_EXTENSION}`);

        const code = await runShellCommand(
            `tar -cf - -C ${shellQuote(staging)} . | gzip -${gzipLevel} > ${shellQuote(archivePath)}`,
            { silent: true }
        );
        if (code !== 0) {
            throw new DevForgeError(`Failed to create archive (tar/gzip exit ${code})`);
        }

        const archiveSize = statSync(archivePath).size;
        const uncompressedSize = snapshotMeta.uncompressedSize;
        const compressionRatio = uncompressedSize > 0 ? Number((1 - archiveSize / uncompressedSize).toFixed(3)) : 0;
        logger.section("Snapshot Created");
        logger.success(`Archive: ${archivePath}`);
        logger.info(`ID: ${id}`);
        logger.info(`Size: ${formatBytes(archiveSize)} (from ${formatBytes(uncompressedSize)} uncompressed, ${Math.round(compressionRatio * 100)}% smaller)`);
        logger.info(`Duration: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
        logger.info(`Components: ${components.packages.length} packages, ${components.profiles.length} profiles, ${components.recipes.length} recipes`);
        logger.info(`Workspaces: ${workspaces.length}`);
        if (missingSecrets.length > 0) {
            logger.warn(`Missing secrets: ${missingSecrets.length} key(s) listed in missing-secrets.md`);
        }

        return { id, archivePath, size: archiveSize, uncompressedSize, compressionRatio, meta: snapshotMeta };
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }
}

// ─── Extract helper ───────────────────────────────────────────────────

export async function extractArchive(archivePath) {
    if (!existsSync(archivePath)) {
        throw new DevForgeError(`No such file: ${archivePath}`);
    }
    const extractDir = tempDir("devforgekit-snapshot-extract-");
    const code = await runShellCommand(
        `tar -xzf ${shellQuote(archivePath)} -C ${shellQuote(extractDir)}`,
        { silent: true }
    );
    if (code !== 0) {
        rmSync(extractDir, { recursive: true, force: true });
        throw new DevForgeError(`Failed to extract archive (tar exit ${code})`);
    }
    return extractDir;
}

export function readSnapshotMeta(dir) {
    const metaPath = path.join(dir, "snapshot.json");
    if (!existsSync(metaPath)) {
        throw new DevForgeError("Archive has no snapshot.json - not a valid .dfk file");
    }
    return JSON.parse(readFileSync(metaPath, "utf8"));
}

// ─── Verify ───────────────────────────────────────────────────────────

export async function verifySnapshot(archivePath) {
    logger.section("Snapshot Verification");
    const extractDir = await extractArchive(archivePath);

    try {
        const meta = readSnapshotMeta(extractDir);
        const results = [];

        // Check snapshot.json exists and is valid
        results.push({ check: "snapshot.json present", status: "PASS" });

        // Check schema version
        if (meta.snapshotVersion > SNAPSHOT_VERSION) {
            results.push({
                check: `schema version (archive: v${meta.snapshotVersion}, supported: v${SNAPSHOT_VERSION})`,
                status: "FAIL",
                detail: "Archive was created by a newer DevForgeKit version"
            });
        } else {
            results.push({
                check: `schema version (v${meta.snapshotVersion})`,
                status: "PASS"
            });
        }

        // Verify checksums. Recomputed against the ACTUAL extracted
        // directory content, not just cross-checked against the
        // checksums/*.sha256 files - the v2.1.5 audit found the previous
        // version of this loop only compared meta.checksums[name]
        // against checksums/<name>.sha256, and both of those values
        // originated from the exact same writeChecksums() call at create
        // time. That never caught anything: it verified the archive
        // agreed with itself, not that the extracted files still match
        // what was originally hashed (tar corruption, a bad write, or
        // tampering that touches config/ but not checksums/ would all
        // sail through as PASS).
        const checksumsDir = path.join(extractDir, "checksums");
        if (existsSync(checksumsDir)) {
            const dirSections = { config: 1, workspaces: 1, profiles: 1, recipes: 1, themes: 1, inventory: 1, registry: 1 };
            for (const [name, expectedHash] of Object.entries(meta.checksums || {})) {
                let actualHash;
                if (name === "snapshot") {
                    const metaCopy = { ...meta };
                    delete metaCopy.checksums;
                    actualHash = crypto.createHash("sha256").update(`${JSON.stringify(metaCopy, null, 2)}\n`).digest("hex");
                } else if (dirSections[name]) {
                    actualHash = crypto.createHash("sha256").update(sha256Dir(path.join(extractDir, name))).digest("hex");
                } else {
                    results.push({ check: `checksum: ${name}`, status: "WARNING", detail: "unknown checksum section" });
                    continue;
                }
                if (actualHash === expectedHash) {
                    results.push({ check: `checksum: ${name}`, status: "PASS" });
                } else {
                    results.push({ check: `checksum: ${name}`, status: "FAIL", detail: "checksum mismatch - archive content does not match recorded hash" });
                }
            }
        } else {
            results.push({ check: "checksums directory", status: "WARNING", detail: "no checksums directory in archive" });
        }

        // Check for required directories
        const requiredDirs = ["config", "workspaces", "profiles", "recipes"];
        for (const dir of requiredDirs) {
            const dirPath = path.join(extractDir, dir);
            if (existsSync(dirPath)) {
                results.push({ check: `directory: ${dir}/`, status: "PASS" });
            } else {
                results.push({ check: `directory: ${dir}/`, status: "WARNING", detail: "not present in archive" });
            }
        }

        // Check missing-secrets.md
        const secretsPath = path.join(extractDir, "missing-secrets.md");
        if (existsSync(secretsPath)) {
            results.push({ check: "missing-secrets.md", status: "PASS" });
        } else {
            results.push({ check: "missing-secrets.md", status: "WARNING", detail: "not present" });
        }

        // Check DevForgeKit version compatibility
        const currentVersion = getVersion();
        if (meta.devforgekitVersion) {
            results.push({
                check: `DevForgeKit version (archive: ${meta.devforgekitVersion}, current: ${currentVersion})`,
                status: "PASS"
            });
        }

        // Check platform compatibility
        const currentArch = currentArchitecture();
        const currentPlatformName = currentPlatform();
        if (meta.machine?.arch && meta.machine.arch !== arch()) {
            results.push({
                check: `architecture (archive: ${meta.machine.arch}, current: ${arch()})`,
                status: "WARNING",
                detail: "Architecture mismatch - some packages may not be available"
            });
        } else {
            results.push({ check: "architecture", status: "PASS" });
        }

        // Report
        const health = scoreResults(results);
        logger.section("Verification Results");
        for (const r of results) {
            const symbol = r.status === "PASS" ? "✓" : r.status === "WARNING" ? "!" : "✗";
            const detail = r.detail ? ` - ${r.detail}` : "";
            console.log(`  ${symbol} ${r.check}${detail}`);
        }
        console.log(`\n  Score: ${health.score}% - ${health.verdict}`);

        return { results, health };
    } finally {
        rmSync(extractDir, { recursive: true, force: true });
    }
}

// ─── Inspect ──────────────────────────────────────────────────────────

export async function inspectSnapshot(archivePath) {
    const extractDir = await extractArchive(archivePath);

    try {
        const meta = readSnapshotMeta(extractDir);
        const archiveSize = statSync(archivePath).size;

        return {
            meta,
            archiveSize,
            archivePath
        };
    } finally {
        rmSync(extractDir, { recursive: true, force: true });
    }
}

// ─── List ─────────────────────────────────────────────────────────────

// Reads snapshot.json from a .dfk archive synchronously by extracting just
// that one file to a temp directory.
function readSnapshotMetaFromArchive(filePath) {
    try {
        const staging = tempDir("devforgekit-snapshot-meta-");
        spawnSync("sh", ["-c", `tar -xzf ${shellQuote(filePath)} -C ${shellQuote(staging)} ./snapshot.json 2>/dev/null`], { encoding: "utf8" });
        const metaPath = path.join(staging, "snapshot.json");
        if (!existsSync(metaPath)) {
            rmSync(staging, { recursive: true, force: true });
            return null;
        }
        const meta = JSON.parse(readFileSync(metaPath, "utf8"));
        rmSync(staging, { recursive: true, force: true });
        return meta;
    } catch {
        return null;
    }
}

export function listSnapshots() {
    const dir = snapshotsDir();
    if (!existsSync(dir)) return [];

    const snapshots = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(SNAPSHOT_EXTENSION)) continue;
        const filePath = path.join(dir, entry.name);
        const meta = readSnapshotMetaFromArchive(filePath);
        const size = statSync(filePath).size;

        if (meta) {
            snapshots.push({
                id: meta.id || entry.name.replace(SNAPSHOT_EXTENSION, ""),
                path: filePath,
                size,
                createdAt: meta.createdAt,
                machine: meta.machine?.name || "unknown",
                hostname: meta.machine?.hostname || "unknown",
                devforgekitVersion: meta.devforgekitVersion || "unknown",
                components: meta.components?.packages?.length || 0,
                workspaces: meta.workspaces?.length || 0
            });
        } else {
            snapshots.push({
                id: entry.name.replace(SNAPSHOT_EXTENSION, ""),
                path: filePath,
                size,
                createdAt: null,
                machine: "(corrupt or unreadable)",
                hostname: "",
                devforgekitVersion: "unknown",
                components: 0,
                workspaces: 0
            });
        }
    }

    return snapshots.sort((a, b) => {
        const aKey = a.createdAt || "";
        const bKey = b.createdAt || "";
        return aKey < bKey ? 1 : aKey > bKey ? -1 : 0;
    });
}

// ─── Delete ───────────────────────────────────────────────────────────

export function deleteSnapshot(idOrPath) {
    let filePath;
    if (existsSync(idOrPath) && statSync(idOrPath).isFile()) {
        filePath = idOrPath;
    } else {
        filePath = path.join(snapshotsDir(), `${idOrPath}${SNAPSHOT_EXTENSION}`);
        if (!existsSync(filePath)) {
            // Try as-is (maybe includes extension)
            filePath = path.join(snapshotsDir(), idOrPath);
        }
    }

    if (!existsSync(filePath)) {
        throw new DevForgeError(`Snapshot '${idOrPath}' not found`);
    }

    rmSync(filePath, { force: true });
    return filePath;
}

// ─── Export (copy to a different location) ────────────────────────────

export function exportSnapshot(idOrPath, destDir) {
    let srcPath;
    if (existsSync(idOrPath) && statSync(idOrPath).isFile()) {
        srcPath = idOrPath;
    } else {
        srcPath = path.join(snapshotsDir(), `${idOrPath}${SNAPSHOT_EXTENSION}`);
        if (!existsSync(srcPath)) {
            srcPath = path.join(snapshotsDir(), idOrPath);
        }
    }

    if (!existsSync(srcPath)) {
        throw new DevForgeError(`Snapshot '${idOrPath}' not found`);
    }

    mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, path.basename(srcPath));
    cpSync(srcPath, destPath);
    return destPath;
}

// ─── Diff ─────────────────────────────────────────────────────────────

export async function diffSnapshots(oldPath, newPath) {
    const [oldDir, newDir] = await Promise.all([
        extractArchive(oldPath),
        extractArchive(newPath)
    ]);

    try {
        const oldMeta = readSnapshotMeta(oldDir);
        const newMeta = readSnapshotMeta(newDir);

        const diff = {
            packages: diffArrays(oldMeta.components?.packages || [], newMeta.components?.packages || []),
            collections: diffArrays(oldMeta.components?.collections || [], newMeta.components?.collections || []),
            profiles: diffArrays(oldMeta.components?.profiles || [], newMeta.components?.profiles || []),
            recipes: diffArrays(oldMeta.components?.recipes || [], newMeta.components?.recipes || []),
            plugins: diffArrays(oldMeta.components?.plugins || [], newMeta.components?.plugins || []),
            workspaces: diffArrays(oldMeta.workspaces || [], newMeta.workspaces || []),
            themes: {
                current: oldMeta.themes?.current !== newMeta.themes?.current
                    ? `${oldMeta.themes?.current || "default"} → ${newMeta.themes?.current || "default"}`
                    : null,
                custom: diffArrays(oldMeta.themes?.custom || [], newMeta.themes?.custom || [])
            },
            config: diffConfig(oldMeta.config || {}, newMeta.config || {}),
            health: {
                old: oldMeta.health?.score ?? null,
                new: newMeta.health?.score ?? null,
                delta: (oldMeta.health?.score != null && newMeta.health?.score != null)
                    ? newMeta.health.score - oldMeta.health.score
                    : null
            },
            compatibility: {
                old: oldMeta.compatibility?.score ?? null,
                new: newMeta.compatibility?.score ?? null,
                delta: (oldMeta.compatibility?.score != null && newMeta.compatibility?.score != null)
                    ? newMeta.compatibility.score - oldMeta.compatibility.score
                    : null
            },
            machine: {
                old: oldMeta.machine,
                new: newMeta.machine,
                sameMachine: oldMeta.machine?.hostname === newMeta.machine?.hostname
            },
            devforgekitVersion: {
                old: oldMeta.devforgekitVersion,
                new: newMeta.devforgekitVersion
            },
            createdAt: {
                old: oldMeta.createdAt,
                new: newMeta.createdAt
            }
        };

        return diff;
    } finally {
        rmSync(oldDir, { recursive: true, force: true });
        rmSync(newDir, { recursive: true, force: true });
    }
}

export function diffArrays(oldArr, newArr) {
    const oldSet = new Set(oldArr);
    const newSet = new Set(newArr);
    return {
        added: newArr.filter((x) => !oldSet.has(x)),
        removed: oldArr.filter((x) => !newSet.has(x)),
        unchanged: newArr.filter((x) => oldSet.has(x))
    };
}

export function diffConfig(oldCfg, newCfg) {
    const keys = new Set([...Object.keys(oldCfg), ...Object.keys(newCfg)]);
    const changed = [];
    const added = [];
    const removed = [];
    for (const key of keys) {
        const inOld = Object.prototype.hasOwnProperty.call(oldCfg, key);
        const inNew = Object.prototype.hasOwnProperty.call(newCfg, key);
        if (!inOld && inNew) {
            added.push({ key, value: newCfg[key] });
        } else if (inOld && !inNew) {
            removed.push({ key, value: oldCfg[key] });
        } else if (JSON.stringify(oldCfg[key]) !== JSON.stringify(newCfg[key])) {
            changed.push({ key, oldValue: oldCfg[key], newValue: newCfg[key] });
        }
    }
    return { added, removed, changed };
}

// ─── Restore ──────────────────────────────────────────────────────────

export async function restoreSnapshot(archivePath, { skipPackages = false, skipWorkspaces = false, skipConfig = false, skipCompatibility = false, force = false } = {}) {
    logger.section("Environment Snapshot: Restore");

    const extractDir = await extractArchive(archivePath);

    try {
        const meta = readSnapshotMeta(extractDir);

        // Step 1: Compatibility check
        if (!skipCompatibility) {
            logger.section("Compatibility Check");
            if (meta.machine?.arch && meta.machine.arch !== arch()) {
                logger.warn(`Architecture mismatch: archive is ${meta.machine.arch}, this machine is ${arch()}`);
                if (!force) {
                    logger.error("Use --force to override");
                    return { ok: false, error: "architecture mismatch" };
                }
            }
            if (meta.snapshotVersion > SNAPSHOT_VERSION) {
                logger.error(`Archive schema v${meta.snapshotVersion} is newer than supported v${SNAPSHOT_VERSION}`);
                return { ok: false, error: "schema version mismatch" };
            }
            logger.success("Compatibility check passed");
        }

        // Step 2: Show restore plan
        logger.section("Restore Plan");
        const plan = [];
        if (!skipConfig && existsSync(path.join(extractDir, "config"))) {
            plan.push("Restore configuration (~/.config/devforgekit/)");
        }
        if (!skipWorkspaces && existsSync(path.join(extractDir, "workspaces"))) {
            const wsCount = readdirSync(path.join(extractDir, "workspaces")).filter((f) => f.endsWith(".tar.gz")).length;
            plan.push(`Import ${wsCount} workspace(s)`);
        }
        if (existsSync(path.join(extractDir, "profiles"))) {
            plan.push("Restore user profiles");
        }
        if (existsSync(path.join(extractDir, "recipes"))) {
            plan.push("Restore user recipes");
        }
        if (existsSync(path.join(extractDir, "themes"))) {
            plan.push("Restore custom themes");
        }
        if (!skipPackages && meta.components?.packages?.length > 0) {
            plan.push(`Install ${meta.components.packages.length} package(s)`);
        }
        for (const item of plan) {
            logger.info(`  • ${item}`);
        }

        // Show missing secrets
        if (meta.missingSecrets?.length > 0) {
            logger.section("Missing Secrets");
            logger.warn("The following secrets are NOT in the archive and must be provided manually:");
            for (const key of meta.missingSecrets) {
                console.log(`    ${key}`);
            }
            const secretsPath = path.join(extractDir, "missing-secrets.md");
            if (existsSync(secretsPath)) {
                logger.info(`See missing-secrets.md in the archive for instructions`);
            }
        }

        // Step 3: Restore config
        if (!skipConfig && existsSync(path.join(extractDir, "config"))) {
            logger.section("Restoring Configuration");
            const srcConfig = path.join(extractDir, "config");
            const destConfig = userConfigDir();

            // Backup current config first
            const { backupConfig, backupDir } = await import("./self-update.js");
            const backup = backupDir();
            backupConfig(backup);
            logger.info(`Current config backed up to ${backup}`);

            // Merge: copy config files, but don't overwrite existing workspaces
            // unless they don't exist yet
            mkdirSync(destConfig, { recursive: true });
            cpSync(srcConfig, destConfig, {
                recursive: true,
                filter: (src) => {
                    const rel = path.relative(srcConfig, src);
                    // Don't overwrite existing workspace directories
                    if (rel.startsWith("workspaces/") && !skipWorkspaces) {
                        const destPath = path.join(destConfig, rel);
                        if (existsSync(destPath)) return false;
                    }
                    return true;
                }
            });
            logger.success("Configuration restored");
        }

        // Step 4: Restore workspaces
        if (!skipWorkspaces && existsSync(path.join(extractDir, "workspaces"))) {
            logger.section("Restoring Workspaces");
            const wsDir = path.join(extractDir, "workspaces");
            for (const file of readdirSync(wsDir)) {
                if (!file.endsWith(".tar.gz")) continue;
                const archiveFile = path.join(wsDir, file);
                try {
                    const { workspace, repairs } = await importWorkspaceBundle(archiveFile, { overwrite: force });
                    logger.success(`  Imported workspace '${workspace.name}'`);
                    for (const r of repairs) logger.warn(`    ${r}`);
                } catch (err) {
                    if (err.message.includes("already exists") && !force) {
                        logger.warn(`  Skipped existing workspace (use --force to overwrite)`);
                    } else {
                        logger.warn(`  Failed: ${err.message}`);
                    }
                }
            }
        }

        // Step 5: Restore user profiles
        if (existsSync(path.join(extractDir, "profiles"))) {
            logger.section("Restoring Profiles");
            const srcProfiles = path.join(extractDir, "profiles");
            const destProfiles = path.join(userConfigDir(), "profiles");
            mkdirSync(destProfiles, { recursive: true });
            cpSync(srcProfiles, destProfiles, { recursive: true });
            logger.success("User profiles restored");
        }

        // Step 6: Restore user recipes
        if (existsSync(path.join(extractDir, "recipes"))) {
            logger.section("Restoring Recipes");
            const srcRecipes = path.join(extractDir, "recipes");
            const destRecipes = path.join(userConfigDir(), "recipes");
            mkdirSync(destRecipes, { recursive: true });
            cpSync(srcRecipes, destRecipes, { recursive: true });
            logger.success("User recipes restored");
        }

        // Step 7: Restore custom themes
        if (existsSync(path.join(extractDir, "themes"))) {
            logger.section("Restoring Themes");
            const srcThemes = path.join(extractDir, "themes");
            const destThemes = path.join(userConfigDir(), "themes");
            mkdirSync(destThemes, { recursive: true });
            cpSync(srcThemes, destThemes, { recursive: true });
            logger.success("Custom themes restored");
        }

        // Step 8: Install packages
        if (!skipPackages && meta.components?.packages?.length > 0) {
            logger.section("Installing Packages");
            const { runInstallPlan } = await import("../lib/installRunner.js");
            const { getPackage } = await import("./registry.js");

            const packagesToInstall = [];
            for (const name of meta.components.packages) {
                try {
                    const pkg = getPackage(name);
                    if (pkg) packagesToInstall.push(pkg);
                } catch {
                    logger.warn(`  Package '${name}' not found in registry - skipping`);
                }
            }

            if (packagesToInstall.length > 0) {
                logger.info(`Installing ${packagesToInstall.length} package(s)...`);
                try {
                    await runInstallPlan(packagesToInstall, { onOutput: (text) => process.stdout.write(text) });
                    logger.success("Packages installed");
                } catch (err) {
                    logger.warn(`Package installation had issues: ${err.message}`);
                }
            } else {
                logger.info("No registry packages to install");
            }
        }

        // Step 9: Post-restore validation
        if (!skipCompatibility) {
            logger.section("Post-Restore Validation");
            try {
                const installed = await installedComponentNames();
                const result = await scanCompatibility(installed);
                logger.success(`Compatibility score: ${result.score}% - ${result.verdict}`);
            } catch {
                logger.warn("Could not run compatibility scan");
            }
        }

        logger.section("Restore Complete");
        logger.success(`Environment restored from snapshot ${meta.id || path.basename(archivePath)}`);
        if (meta.missingSecrets?.length > 0) {
            logger.warn(`Remember to set ${meta.missingSecrets.length} missing secret(s) - see missing-secrets.md`);
        }

        return { ok: true, meta };
    } finally {
        rmSync(extractDir, { recursive: true, force: true });
    }
}

// ─── Explain (AI) ─────────────────────────────────────────────────────

export async function explainSnapshot(archivePath, { provider, model, endpoint } = {}) {
    const extractDir = await extractArchive(archivePath);

    try {
        const meta = readSnapshotMeta(extractDir);

        // Build context for AI
        const context = {
            machine: meta.machine,
            components: meta.components,
            workspaces: meta.workspaces,
            themes: meta.themes,
            health: meta.health,
            compatibility: meta.compatibility,
            config: meta.config,
            missingSecrets: meta.missingSecrets,
            devforgekitVersion: meta.devforgekitVersion,
            createdAt: meta.createdAt
        };

        // Resolve provider
        const { getProvider, resolveApiKey, requiresApiKey } = await import("./ai/providers/index.js");
        const { getActiveWorkspace } = await import("./workspace/store.js");
        const { buildPrompt } = await import("./ai/prompts/library.js");

        const config = loadConfig();
        const providerId = provider || (config.aiProvider && config.aiProvider !== "none" ? config.aiProvider : null);

        if (!providerId) {
            return {
                ok: false,
                error: "No AI provider configured. Run 'devforgekit config set aiProvider <provider>' or pass --provider."
            };
        }

        const workspace = getActiveWorkspace();
        const opts = {
            apiKey: resolveApiKey(providerId, { workspace }),
            model: model || config.aiModel || undefined,
            endpoint: endpoint || config.aiEndpoint || undefined,
            workspace
        };

        const aiProvider = getProvider(providerId, opts);

        const prompt = buildPrompt("explain", context, `This is a DevForgeKit environment snapshot. Explain what this snapshot contains, the state of the environment, potential issues, migration advice, and any compatibility concerns. The snapshot was created on ${meta.createdAt} on machine ${meta.machine?.hostname} running ${meta.machine?.os}.`);

        const response = await aiProvider.chat(prompt);
        return { ok: true, explanation: response.content };
    } finally {
        rmSync(extractDir, { recursive: true, force: true });
    }
}

// ─── Utility ──────────────────────────────────────────────────────────

export function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

