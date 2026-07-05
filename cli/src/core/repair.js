// The Intelligent Repair Engine (v1.3.4). A multi-stage diagnostic and
// repair platform: Scan → Analyze → Plan → Repair → Verify.
//
// This is NOT just another doctor command. It is a comprehensive repair
// system that detects problems across every DevForgeKit subsystem,
// generates an ordered repair plan with dependency awareness, safely
// executes repairs with user confirmation and automatic rollback, and
// verifies results with benchmark + compatibility comparison.
//
// Reuses every existing subsystem - no duplicated logic:
//   - compatibility/engine.js (scanCompatibility) for compatibility issues
//   - compatibility/repair.js (planRepair/executeRepairPlan) for compat repairs
//   - installer.js (install/uninstall) for package management
//   - shell.js (runShellCommand/captureShellCommand/commandExists) for probes
//   - registry.js (loadPackages) for component detection
//   - snapshot.js (createSnapshot) for pre-repair rollback points
//   - benchmark.js (runBenchmark) for before/after performance comparison
//   - health.js (scoreResults) for health scoring
//   - ai/providers + ai/prompts/library.js for AI explanations
//   - config.js for configuration validation
//   - workspace/store.js for workspace validation
//   - plugins.js for plugin validation
//   - self-update.js for config backup/restore
//   - paths.js, version.js, logger.js, errors.js
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { runShellCommand, captureShellCommand, commandExists, shellQuote } from "./shell.js";
import { userStateDir, userConfigDir } from "./paths.js";
import { loadConfig, getConfigValue } from "./config.js";
import { loadPackages } from "./registry.js";
import { validate, install, uninstall } from "./installer.js";
import { getVersion } from "../version.js";
import { logger } from "./logger.js";
import { DevForgeError } from "./errors.js";
import { scanCompatibility, scoreCompatibility } from "./compatibility/engine.js";
import { planRepair as planCompatRepair, executeRepairPlan as executeCompatRepair } from "./compatibility/repair.js";
import { scoreResults } from "./health.js";
import { listWorkspaces } from "./workspace/store.js";
import { discoverPlugins } from "./plugins.js";
import { confirm } from "../lib/prompts.js";

// ─── Constants ────────────────────────────────────────────────────────

export const REPAIR_VERSION = 1;
export const REPAIR_DIR = "repairs";

const SEVERITY_ORDER = { FATAL: 0, CRITICAL: 1, WARNING: 2, INFO: 3 };
const SEVERITY_LABELS = { FATAL: "FATAL", CRITICAL: "CRITICAL", WARNING: "WARNING", INFO: "INFO" };

function repairsDir() {
    return path.join(userStateDir(), REPAIR_DIR);
}

function makeRepairId(isoTimestamp) {
    return `${isoTimestamp.replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
}

// ─── Issue shape ──────────────────────────────────────────────────────

function makeIssue({ id, severity, category, subsystem, description, impact, fix, estimatedTime, requiresRestart = false, rollbackAvailable = true, confidence = "high", dependencies = [] }) {
    return {
        id: id || crypto.randomUUID().slice(0, 8),
        severity,
        category,
        subsystem,
        confidence,
        description,
        impact,
        fix,
        estimatedTime: estimatedTime || "unknown",
        requiresRestart,
        rollbackAvailable,
        dependencies
    };
}

// ─── Scanners ─────────────────────────────────────────────────────────
// Each scanner returns an array of issues. Scanners reuse existing
// DevForgeKit subsystems for detection - they never reimplement probing
// logic.

// Scanner: Compatibility Engine
async function scanCompatibilityIssues() {
    const issues = [];
    const installed = [];
    for (const pkg of loadPackages()) {
        if (!pkg.validate) continue;
        try {
            if ((await validate(pkg)) === 0) installed.push(pkg.name);
        } catch {
            // Not installed
        }
    }

    let result;
    try {
        result = await scanCompatibility(installed);
    } catch {
        return issues;
    }

    for (const compatIssue of result.issues || []) {
        if (compatIssue.severity === "PASS" || compatIssue.severity === "RECOMMEND") continue;

        const severity = compatIssue.severity === "CRITICAL" ? "CRITICAL" :
            compatIssue.severity === "UNSUPPORTED" ? "CRITICAL" : "WARNING";

        issues.push(makeIssue({
            id: `compat-${compatIssue.tool}`,
            severity,
            category: "compatibility",
            subsystem: compatIssue.tool,
            description: compatIssue.message,
            impact: compatIssue.severity === "CRITICAL"
                ? "Component may not function correctly"
                : "Component may have reduced functionality or stability",
            fix: compatIssue.recommendation || "Review the compatibility report for manual steps",
            estimatedTime: compatIssue.recommendation?.startsWith("devforgekit component install") ? "1-2 min" : "5 min",
            rollbackAvailable: Boolean(compatIssue.recommendation),
            confidence: "high"
        }));
    }

    return issues;
}

// Scanner: PATH issues
async function scanPathIssues() {
    const issues = [];
    const pathDirs = (process.env.PATH || "").split(":").filter(Boolean);
    const seen = new Map();

    for (const dir of pathDirs) {
        if (!existsSync(dir)) {
            issues.push(makeIssue({
                id: "path-missing",
                severity: "WARNING",
                category: "path",
                subsystem: "shell",
                description: `PATH contains non-existent directory: ${dir}`,
                impact: "Commands in this directory cannot be found",
                fix: `Remove '${dir}' from your shell profile's PATH`,
                estimatedTime: "1 min",
                confidence: "high"
            }));
            continue;
        }
        if (seen.has(dir)) {
            issues.push(makeIssue({
                id: "path-duplicate",
                severity: "INFO",
                category: "path",
                subsystem: "shell",
                description: `Duplicate PATH entry: ${dir}`,
                impact: "Slower command resolution, potential confusion",
                fix: `Remove the duplicate '${dir}' from your PATH`,
                estimatedTime: "1 min",
                confidence: "high"
            }));
        }
        seen.set(dir, (seen.get(dir) || 0) + 1);
    }

    return issues;
}

// Scanner: Broken symlinks in common dev directories
async function scanBrokenSymlinks() {
    const issues = [];
    const checkDirs = [
        "/usr/local/bin",
        path.join(process.env.HOME || "", "bin"),
        path.join(process.env.HOME || "", ".local", "bin")
    ];

    for (const dir of checkDirs) {
        if (!existsSync(dir)) continue;
        try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isSymbolicLink()) continue;
                const linkPath = path.join(dir, entry.name);
                try {
                    statSync(linkPath);
                } catch {
                    issues.push(makeIssue({
                        id: `symlink-${dir}-${entry.name}`,
                        severity: "WARNING",
                        category: "symlink",
                        subsystem: "filesystem",
                        description: `Broken symlink: ${linkPath}`,
                        impact: "Command or tool referenced by this symlink is unavailable",
                        fix: `Remove broken symlink: rm ${shellQuote(linkPath)}`,
                        estimatedTime: "30 sec",
                        confidence: "high"
                    }));
                }
            }
        } catch {
            // Permission denied or other error
        }
    }

    return issues;
}

// Scanner: Docker daemon
async function scanDockerIssues() {
    const issues = [];

    if (!(await commandExists("docker"))) return issues;

    // Check if Docker daemon is running
    const { code } = await captureShellCommand("docker info 2>/dev/null");
    if (code !== 0) {
        issues.push(makeIssue({
            id: "docker-daemon",
            severity: "WARNING",
            category: "service",
            subsystem: "docker",
            description: "Docker daemon is not running",
            impact: "Docker containers and images cannot be built or run",
            fix: "Start Docker Desktop or run: open -a Docker",
            estimatedTime: "30 sec",
            requiresRestart: false,
            confidence: "high"
        }));
    }

    return issues;
}

// Scanner: Disk space
async function scanDiskIssues() {
    const issues = [];

    try {
        const { stdout } = await captureShellCommand("df -Pk / 2>/dev/null");
        const line = stdout.trim().split("\n")[1] || "";
        const usedPercent = Number((line.trim().split(/\s+/)[4] || "0").replace("%", "")) || 0;

        if (usedPercent > 90) {
            issues.push(makeIssue({
                id: "disk-space",
                severity: usedPercent > 95 ? "CRITICAL" : "WARNING",
                category: "disk",
                subsystem: "filesystem",
                description: `Disk usage at ${usedPercent}%`,
                impact: usedPercent > 95 ? "System may become unresponsive" : "Low disk space may cause failures",
                fix: "Run 'devforgekit clean' to reclaim disk space, or remove large files",
                estimatedTime: "5 min",
                confidence: "high"
            }));
        }
    } catch {
        // Non-critical
    }

    return issues;
}

// Scanner: Git configuration
async function scanGitIssues() {
    const issues = [];

    const { code: nameCode, stdout: nameOut } = await captureShellCommand("git config user.name 2>/dev/null");
    if (nameCode !== 0 || !nameOut.trim()) {
        issues.push(makeIssue({
            id: "git-name",
            severity: "WARNING",
            category: "configuration",
            subsystem: "git",
            description: "Git user.name is not set",
            impact: "Commits will fail or use a fallback identity",
            fix: "git config --global user.name 'Your Name'",
            estimatedTime: "30 sec",
            confidence: "high"
        }));
    }

    const { code: emailCode, stdout: emailOut } = await captureShellCommand("git config user.email 2>/dev/null");
    if (emailCode !== 0 || !emailOut.trim()) {
        issues.push(makeIssue({
            id: "git-email",
            severity: "WARNING",
            category: "configuration",
            subsystem: "git",
            description: "Git user.email is not set",
            impact: "Commits will fail or use a fallback identity",
            fix: "git config --global user.email 'you@example.com'",
            estimatedTime: "30 sec",
            confidence: "high"
        }));
    }

    return issues;
}

// Scanner: Workspace validation
async function scanWorkspaceIssues() {
    const issues = [];

    for (const ws of listWorkspaces()) {
        if (!ws.valid) {
            issues.push(makeIssue({
                id: `workspace-${ws.name}`,
                severity: "WARNING",
                category: "workspace",
                subsystem: "workspace-manager",
                description: `Workspace '${ws.name}' is invalid: ${ws.error || "unknown error"}`,
                impact: "Workspace cannot be activated or used",
                fix: `Review workspace '${ws.name}' configuration or remove it: devforgekit workspace delete ${ws.name}`,
                estimatedTime: "2 min",
                confidence: "high"
            }));
        }
    }

    return issues;
}

// Scanner: Plugin validation
async function scanPluginIssues() {
    const issues = [];

    let plugins;
    try {
        plugins = discoverPlugins();
    } catch {
        return issues;
    }

    for (const plugin of plugins) {
        if (!plugin.valid) {
            issues.push(makeIssue({
                id: `plugin-${plugin.name}`,
                severity: "WARNING",
                category: "plugin",
                subsystem: "plugins",
                description: `Plugin '${plugin.name}' failed validation: ${plugin.error || "unknown error"}`,
                impact: "Plugin commands and hooks will not be available",
                fix: `Review plugin '${plugin.name}' manifest or remove the plugin directory`,
                estimatedTime: "5 min",
                confidence: "high"
            }));
        }
    }

    return issues;
}

// Scanner: Configuration validation
async function scanConfigIssues() {
    const issues = [];
    const config = loadConfig();

    // Check for invalid AI provider
    if (config.aiProvider && config.aiProvider !== "none") {
        const knownProviders = ["openai", "anthropic", "gemini", "groq", "openrouter", "ollama", "lmstudio"];
        if (!knownProviders.includes(config.aiProvider)) {
            issues.push(makeIssue({
                id: "config-ai-provider",
                severity: "WARNING",
                category: "configuration",
                subsystem: "config",
                description: `Unknown AI provider '${config.aiProvider}' in configuration`,
                impact: "AI commands will fail to resolve a provider",
                fix: `devforgekit config set aiProvider <${knownProviders.join("|")}>`,
                estimatedTime: "1 min",
                confidence: "high"
            }));
        }
    }

    return issues;
}

// Scanner: Homebrew health
async function scanHomebrewIssues() {
    const issues = [];

    if (!(await commandExists("brew"))) return issues;

    // Check brew doctor
    const { code, stdout } = await captureShellCommand("brew doctor 2>/dev/null");
    if (code !== 0 && stdout.trim()) {
        const lines = stdout.trim().split("\n").filter((l) => l.trim());
        if (lines.length > 0) {
            issues.push(makeIssue({
                id: "brew-doctor",
                severity: "WARNING",
                category: "package-manager",
                subsystem: "homebrew",
                description: `Homebrew reports issues: ${lines[0].slice(0, 100)}`,
                impact: "Package installation or updates may fail",
                fix: "Run 'brew doctor' for details and follow the recommended fixes",
                estimatedTime: "10 min",
                confidence: "high"
            }));
        }
    }

    return issues;
}

// Scanner: SSH key check
async function scanSSHIssues() {
    const issues = [];
    const sshDir = path.join(process.env.HOME || "", ".ssh");

    if (!existsSync(sshDir)) {
        issues.push(makeIssue({
            id: "ssh-no-keys",
            severity: "INFO",
            category: "ssh",
            subsystem: "ssh",
            description: "No SSH directory found",
            impact: "Git over SSH and remote access will not work",
            fix: "Generate an SSH key: ssh-keygen -t ed25519 -C 'your_email@example.com'",
            estimatedTime: "2 min",
            confidence: "high"
        }));
        return issues;
    }

    const keys = readdirSync(sshDir).filter((f) => f.startsWith("id_") && !f.endsWith(".pub"));
    if (keys.length === 0) {
        issues.push(makeIssue({
            id: "ssh-no-keys",
            severity: "INFO",
            category: "ssh",
            subsystem: "ssh",
            description: "No SSH private keys found in ~/.ssh/",
            impact: "Git over SSH and remote access will not work",
            fix: "Generate an SSH key: ssh-keygen -t ed25519 -C 'your_email@example.com'",
            estimatedTime: "2 min",
            confidence: "high"
        }));
    }

    return issues;
}

// Scanner: Orphaned caches
async function scanCacheIssues() {
    const issues = [];
    const home = process.env.HOME || "";

    const cacheDirs = [
        { path: path.join(home, "Library", "Caches", "Homebrew"), label: "Homebrew cache", maxGb: 5 },
        { path: path.join(home, ".npm", "_cacache"), label: "npm cache", maxGb: 2 },
        { path: path.join(home, ".cache"), label: "General cache", maxGb: 5 }
    ];

    for (const { path: cachePath, label, maxGb } of cacheDirs) {
        if (!existsSync(cachePath)) continue;
        try {
            const { stdout } = await captureShellCommand(`du -sk ${shellQuote(cachePath)} 2>/dev/null`);
            const sizeKb = Number(stdout.trim().split(/\s+/)[0] || 0);
            const sizeGb = sizeKb / 1024 / 1024;
            if (sizeGb > maxGb) {
                issues.push(makeIssue({
                    id: `cache-${label.toLowerCase().replace(/\s/g, "-")}`,
                    severity: "INFO",
                    category: "cache",
                    subsystem: "filesystem",
                    description: `${label} is ${sizeGb.toFixed(1)} GB (>${maxGb} GB threshold)`,
                    impact: "Excessive disk usage from cached files",
                    fix: `Clear cache: rm -rf ${shellQuote(cachePath)}`,
                    estimatedTime: "1 min",
                    confidence: "high"
                }));
            }
        } catch {
            // Non-critical
        }
    }

    return issues;
}

// ─── Scanner Registry ─────────────────────────────────────────────────

const SCANNERS = [
    { name: "compatibility", run: scanCompatibilityIssues, label: "Compatibility Engine" },
    { name: "path", run: scanPathIssues, label: "PATH" },
    { name: "symlinks", run: scanBrokenSymlinks, label: "Broken Symlinks" },
    { name: "docker", run: scanDockerIssues, label: "Docker" },
    { name: "disk", run: scanDiskIssues, label: "Disk Space" },
    { name: "git", run: scanGitIssues, label: "Git Configuration" },
    { name: "workspaces", run: scanWorkspaceIssues, label: "Workspaces" },
    { name: "plugins", run: scanPluginIssues, label: "Plugins" },
    { name: "config", run: scanConfigIssues, label: "Configuration" },
    { name: "homebrew", run: scanHomebrewIssues, label: "Homebrew" },
    { name: "ssh", run: scanSSHIssues, label: "SSH" },
    { name: "cache", run: scanCacheIssues, label: "Caches" }
];

// ─── Scan ─────────────────────────────────────────────────────────────

export async function scanIssues({ onProgress } = {}) {
    logger.section("Repair Engine: Scan");
    logger.info(`Running ${SCANNERS.length} scanners...\n`);

    const allIssues = [];

    for (let i = 0; i < SCANNERS.length; i++) {
        const scanner = SCANNERS[i];
        if (onProgress) onProgress({ scanner: scanner.name, label: scanner.label, index: i, total: SCANNERS.length, status: "running" });

        try {
            const issues = await scanner.run();
            allIssues.push(...issues);
            const critical = issues.filter((i) => i.severity === "CRITICAL" || i.severity === "FATAL").length;
            const warnings = issues.filter((i) => i.severity === "WARNING").length;
            const info = issues.filter((i) => i.severity === "INFO").length;

            if (issues.length === 0) {
                logger.success(`  ${scanner.label}: OK`);
            } else {
                logger.warn(`  ${scanner.label}: ${issues.length} issue(s) (${critical} critical, ${warnings} warning, ${info} info)`);
            }

            if (onProgress) onProgress({ scanner: scanner.name, label: scanner.label, index: i, total: SCANNERS.length, status: "done", count: issues.length });
        } catch (err) {
            logger.warn(`  ${scanner.label}: scanner error - ${err.message}`);
            if (onProgress) onProgress({ scanner: scanner.name, label: scanner.label, index: i, total: SCANNERS.length, status: "error", error: err.message });
        }
    }

    // Sort by severity
    allIssues.sort((a, b) => (SEVERITY_ORDER[a.severity] || 99) - (SEVERITY_ORDER[b.severity] || 99));

    logger.section("Scan Complete");
    const critical = allIssues.filter((i) => i.severity === "CRITICAL" || i.severity === "FATAL").length;
    const warnings = allIssues.filter((i) => i.severity === "WARNING").length;
    const info = allIssues.filter((i) => i.severity === "INFO").length;
    logger.info(`Found ${allIssues.length} issue(s): ${critical} critical, ${warnings} warning, ${info} info`);

    return allIssues;
}

// ─── Plan ─────────────────────────────────────────────────────────────

export function planRepairs(issues) {
    const repairable = issues.filter((i) => i.fix && i.severity !== "INFO");
    const informational = issues.filter((i) => i.severity === "INFO");

    // Build dependency graph and topologically sort
    const issueMap = new Map(repairable.map((i) => [i.id, i]));
    const visited = new Set();
    const ordered = [];

    function visit(issueId, stack = new Set()) {
        if (visited.has(issueId)) return;
        if (stack.has(issueId)) return; // Cycle protection
        const issue = issueMap.get(issueId);
        if (!issue) return;

        stack.add(issueId);
        for (const depId of issue.dependencies || []) {
            visit(depId, stack);
        }
        stack.delete(issueId);
        visited.add(issueId);
        ordered.push(issue);
    }

    // Sort by severity first, then visit
    repairable.sort((a, b) => (SEVERITY_ORDER[a.severity] || 99) - (SEVERITY_ORDER[b.severity] || 99));
    for (const issue of repairable) {
        visit(issue.id);
    }

    const totalEstimatedTime = ordered.reduce((acc, issue) => {
        const mins = parseInt(issue.estimatedTime, 10);
        return acc + (isNaN(mins) ? 0 : mins);
    }, 0);

    const requiresRestart = ordered.some((i) => i.requiresRestart);

    return {
        issues: ordered,
        informational,
        totalRepairs: ordered.length,
        totalInfo: informational.length,
        estimatedTime: `${totalEstimatedTime} min`,
        requiresRestart,
        rollbackAvailable: ordered.every((i) => i.rollbackAvailable)
    };
}

// ─── Execute ──────────────────────────────────────────────────────────

export async function executeRepairs(plan, { assumeYes = false, onProgress, rollbackSnapshot } = {}) {
    logger.section("Repair Engine: Execute");
    logger.info(`Executing ${plan.totalRepairs} repair(s)...\n`);

    const results = [];

    for (let i = 0; i < plan.issues.length; i++) {
        const issue = plan.issues[i];
        if (onProgress) onProgress({ issue, index: i, total: plan.issues.length, status: "starting" });

        // Confirm
        if (!assumeYes) {
            const shouldFix = await confirm(
                `Repair: ${issue.description}\n  Fix: ${issue.fix}\n  Proceed?`,
                false
            );
            if (!shouldFix) {
                logger.info(`  Skipped: ${issue.description}`);
                results.push({ issue, ok: false, skipped: true });
                if (onProgress) onProgress({ issue, index: i, total: plan.issues.length, status: "skipped" });
                continue;
            }
        }

        logger.info(`  Repairing: ${issue.description}`);
        if (onProgress) onProgress({ issue, index: i, total: plan.issues.length, status: "repairing" });

        try {
            // Determine repair action based on issue category/subsystem
            const repairResult = await executeRepairAction(issue);
            results.push({ issue, ...repairResult });

            if (repairResult.ok) {
                logger.success(`  Fixed: ${issue.description}`);
                if (onProgress) onProgress({ issue, index: i, total: plan.issues.length, status: "done", ok: true });
            } else {
                logger.warn(`  Could not fix: ${issue.description} - ${repairResult.error || "unknown"}`);
                if (onProgress) onProgress({ issue, index: i, total: plan.issues.length, status: "done", ok: false, error: repairResult.error });
            }
        } catch (err) {
            results.push({ issue, ok: false, error: err.message });
            logger.error(`  Failed: ${issue.description} - ${err.message}`);
            if (onProgress) onProgress({ issue, index: i, total: plan.issues.length, status: "error", error: err.message });
        }
    }

    logger.section("Repairs Complete");
    const fixed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok && !r.skipped).length;
    const skipped = results.filter((r) => r.skipped).length;
    logger.info(`Results: ${fixed} fixed, ${failed} failed, ${skipped} skipped`);

    return { results, fixed, failed, skipped, rollbackSnapshot };
}

async function executeRepairAction(issue) {
    // Route repair based on category and fix content
    const fix = issue.fix || "";

    // Compatibility repairs - reuse compatibility/repair.js
    if (issue.category === "compatibility" && issue.subsystem) {
        const installed = [];
        for (const pkg of loadPackages()) {
            if (!pkg.validate) continue;
            try {
                if ((await validate(pkg)) === 0) installed.push(pkg.name);
            } catch {
                // Not installed
            }
        }
        const scanResult = await scanCompatibility(installed);
        const actions = planCompatRepair(scanResult);
        const relevantActions = actions.filter((a) => a.tool === issue.subsystem || a.name === issue.subsystem);
        if (relevantActions.length > 0) {
            const repairResults = await executeCompatRepair(relevantActions, { assumeYes: true });
            const allOk = repairResults.every((r) => r.ok);
            return { ok: allOk, details: repairResults };
        }
    }

    // Shell command repairs (fix starts with a known command)
    if (fix.startsWith("git config") || fix.startsWith("rm ") || fix.startsWith("open -a")) {
        const code = await runShellCommand(fix, { silent: true });
        return { ok: code === 0, exitCode: code };
    }

    // Package install repairs
    if (fix.startsWith("devforgekit component install ")) {
        const pkgName = fix.replace("devforgekit component install ", "").trim();
        try {
            const pkg = loadPackages().find((p) => p.name === pkgName);
            if (pkg) {
                const code = await install(pkg, undefined, { silent: true });
                return { ok: code === 0, exitCode: code };
            }
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    // For repairs we can't automate, return as manual
    return { ok: false, manual: true, error: "Manual intervention required" };
}

// ─── Verify ───────────────────────────────────────────────────────────

export async function verifyRepairs({ runBenchmark: runBench = false } = {}) {
    logger.section("Repair Engine: Verify");

    const results = [];

    // 1. Compatibility check
    logger.info("Running compatibility scan...");
    try {
        const installed = [];
        for (const pkg of loadPackages()) {
            if (!pkg.validate) continue;
            try {
                if ((await validate(pkg)) === 0) installed.push(pkg.name);
            } catch {
                // Not installed
            }
        }
        const compatResult = await scanCompatibility(installed);
        results.push({
            check: "Compatibility",
            status: compatResult.critical === 0 ? "PASS" : "FAIL",
            score: compatResult.score,
            verdict: compatResult.verdict,
            critical: compatResult.critical,
            warnings: compatResult.warn
        });
        logger.success(`  Compatibility: ${compatResult.score}% - ${compatResult.verdict}`);
    } catch (err) {
        results.push({ check: "Compatibility", status: "WARNING", error: err.message });
        logger.warn(`  Compatibility: could not run - ${err.message}`);
    }

    // 2. Health score
    logger.info("Calculating health score...");
    try {
        const installResults = [];
        for (const pkg of loadPackages()) {
            if (!pkg.validate) continue;
            try {
                installResults.push({ status: (await validate(pkg)) === 0 ? "PASS" : "WARNING", name: pkg.name });
            } catch {
                installResults.push({ status: "WARNING", name: pkg.name });
            }
        }
        const health = scoreResults(installResults);
        results.push({
            check: "Health Score",
            status: health.score >= 70 ? "PASS" : "FAIL",
            score: health.score,
            verdict: health.verdict
        });
        logger.success(`  Health: ${health.score}% - ${health.verdict}`);
    } catch (err) {
        results.push({ check: "Health Score", status: "WARNING", error: err.message });
        logger.warn(`  Health: could not calculate - ${err.message}`);
    }

    // 3. Workspace validation
    logger.info("Validating workspaces...");
    try {
        const workspaces = listWorkspaces();
        const invalid = workspaces.filter((w) => !w.valid);
        results.push({
            check: "Workspaces",
            status: invalid.length === 0 ? "PASS" : "WARNING",
            total: workspaces.length,
            invalid: invalid.length
        });
        logger.success(`  Workspaces: ${workspaces.length - invalid.length}/${workspaces.length} valid`);
    } catch (err) {
        results.push({ check: "Workspaces", status: "WARNING", error: err.message });
        logger.warn(`  Workspaces: could not validate - ${err.message}`);
    }

    // 4. Plugin validation
    logger.info("Validating plugins...");
    try {
        const plugins = discoverPlugins();
        const invalid = plugins.filter((p) => !p.valid);
        results.push({
            check: "Plugins",
            status: invalid.length === 0 ? "PASS" : "WARNING",
            total: plugins.length,
            invalid: invalid.length
        });
        logger.success(`  Plugins: ${plugins.length - invalid.length}/${plugins.length} valid`);
    } catch (err) {
        results.push({ check: "Plugins", status: "WARNING", error: err.message });
        logger.warn(`  Plugins: could not validate - ${err.message}`);
    }

    // 5. Config validation
    logger.info("Validating configuration...");
    try {
        const config = loadConfig();
        const knownProviders = ["none", "openai", "anthropic", "gemini", "groq", "openrouter", "ollama", "lmstudio"];
        const configOk = !config.aiProvider || knownProviders.includes(config.aiProvider);
        results.push({
            check: "Configuration",
            status: configOk ? "PASS" : "WARNING"
        });
        logger.success(`  Configuration: ${configOk ? "valid" : "issues found"}`);
    } catch (err) {
        results.push({ check: "Configuration", status: "WARNING", error: err.message });
        logger.warn(`  Configuration: could not validate - ${err.message}`);
    }

    // 6. Benchmark (optional)
    if (runBench) {
        logger.info("Running quick benchmark...");
        try {
            const { runBenchmark: benchRun } = await import("./benchmark.js");
            const benchResult = await benchRun({ profile: "quick" });
            results.push({
                check: "Benchmark",
                status: "PASS",
                score: benchResult.overallScore,
                grade: benchResult.overallGrade
            });
            logger.success(`  Benchmark: ${benchResult.overallScore}/100 (${benchResult.overallGrade})`);
        } catch (err) {
            results.push({ check: "Benchmark", status: "WARNING", error: err.message });
            logger.warn(`  Benchmark: could not run - ${err.message}`);
        }
    }

    // Summary
    const healthResults = results.map((r) => ({ status: r.status }));
    const health = scoreResults(healthResults);
    logger.section("Verification Complete");
    logger.success(`Overall: ${health.score}% - ${health.verdict}`);

    return { results, health };
}

// ─── Rollback ─────────────────────────────────────────────────────────

export async function createRollbackPoint() {
    logger.info("Creating rollback snapshot...");
    try {
        const { createSnapshot } = await import("./snapshot.js");
        const snapshot = await createSnapshot({ skipInventory: true });
        logger.success(`Rollback snapshot created: ${snapshot.id}`);
        return snapshot;
    } catch (err) {
        logger.warn(`Could not create rollback snapshot: ${err.message}`);
        return null;
    }
}

export async function rollback(rollbackSnapshotId) {
    if (!rollbackSnapshotId) {
        throw new DevForgeError("No rollback snapshot ID provided");
    }

    logger.section("Repair Engine: Rollback");
    logger.info(`Rolling back to snapshot ${rollbackSnapshotId}...`);

    try {
        const { restoreSnapshot } = await import("./snapshot.js");
        const { snapshotsDir } = await import("./snapshot.js");
        const snapshotPath = path.join(snapshotsDir(), `${rollbackSnapshotId}.dfk`);

        if (!existsSync(snapshotPath)) {
            throw new DevForgeError(`Rollback snapshot '${rollbackSnapshotId}' not found at ${snapshotPath}`);
        }

        const result = await restoreSnapshot(snapshotPath, { skipPackages: true, force: true });

        if (result.ok) {
            logger.success("Rollback complete");
        } else {
            logger.error(`Rollback failed: ${result.error}`);
        }

        return result;
    } catch (err) {
        logger.error(`Rollback failed: ${err.message}`);
        throw err;
    }
}

// ─── History ──────────────────────────────────────────────────────────

export function saveRepairRecord(record) {
    const dir = repairsDir();
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${record.id}.json`);
    writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`);
    return filePath;
}

export function listHistory() {
    const dir = repairsDir();
    if (!existsSync(dir)) return [];

    const records = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const filePath = path.join(dir, entry.name);
        try {
            const data = JSON.parse(readFileSync(filePath, "utf8"));
            records.push({
                id: data.id,
                createdAt: data.createdAt,
                issueCount: data.issues?.length || 0,
                fixed: data.fixed || 0,
                failed: data.failed || 0,
                skipped: data.skipped || 0,
                durationMs: data.durationMs || 0,
                machine: data.machine?.hostname || "unknown",
                path: filePath
            });
        } catch {
            // Corrupt file
        }
    }

    return records.sort((a, b) => {
        const aKey = a.createdAt || "";
        const bKey = b.createdAt || "";
        return aKey < bKey ? 1 : aKey > bKey ? -1 : 0;
    });
}

export function getRepairRecord(id) {
    const filePath = path.join(repairsDir(), `${id}.json`);
    if (!existsSync(filePath)) {
        throw new DevForgeError(`Repair record '${id}' not found`);
    }
    return JSON.parse(readFileSync(filePath, "utf8"));
}

export function deleteRepairRecord(id) {
    const filePath = path.join(repairsDir(), `${id}.json`);
    if (!existsSync(filePath)) {
        throw new DevForgeError(`Repair record '${id}' not found`);
    }
    rmSync(filePath, { force: true });
    return filePath;
}

// ─── Clean ────────────────────────────────────────────────────────────

export function cleanHistory() {
    const dir = repairsDir();
    if (!existsSync(dir)) return { deleted: 0 };

    let deleted = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        rmSync(path.join(dir, entry.name), { force: true });
        deleted++;
    }
    return { deleted };
}

// ─── Export ───────────────────────────────────────────────────────────

export function exportRecord(record, format) {
    switch (format) {
        case "json":
            return `${JSON.stringify(record, null, 2)}\n`;
        case "markdown":
        case "md":
            return exportMarkdown(record);
        case "html":
            return exportHTML(record);
        case "csv":
            return exportCSV(record);
        default:
            throw new DevForgeError(`Unknown export format '${format}'. Available: json, markdown, html, csv`);
    }
}

function exportMarkdown(record) {
    const lines = [
        `# Repair Report`,
        ``,
        `**Date:** ${record.createdAt}`,
        `**Machine:** ${record.machine?.hostname || "unknown"}`,
        `**DevForgeKit:** ${record.devforgekitVersion}`,
        `**Duration:** ${((record.durationMs || 0) / 1000).toFixed(1)}s`,
        ``,
        `## Summary`,
        ``,
        `- Issues detected: ${record.issues?.length || 0}`,
        `- Repairs fixed: ${record.fixed || 0}`,
        `- Repairs failed: ${record.failed || 0}`,
        `- Repairs skipped: ${record.skipped || 0}`,
        ``,
        `## Issues`,
        ``,
        `| ID | Severity | Category | Subsystem | Description | Fix |`,
        `|-----|----------|----------|-----------|-------------|-----|`
    ];

    for (const issue of record.issues || []) {
        lines.push(`| ${issue.id} | ${issue.severity} | ${issue.category} | ${issue.subsystem} | ${issue.description} | ${issue.fix} |`);
    }

    if (record.repairResults?.length > 0) {
        lines.push(``, `## Repair Results`, ``);
        lines.push(`| Issue | Status | Error |`, `|-------|--------|-------|`);
        for (const r of record.repairResults) {
            const status = r.ok ? "Fixed" : r.skipped ? "Skipped" : r.manual ? "Manual" : "Failed";
            const error = r.error || "";
            lines.push(`| ${r.issue?.description || ""} | ${status} | ${error} |`);
        }
    }

    if (record.verification) {
        lines.push(``, `## Verification`, ``);
        lines.push(`| Check | Status | Score |`, `|-------|--------|-------|`);
        for (const v of record.verification.results || []) {
            lines.push(`| ${v.check} | ${v.status} | ${v.score || ""} |`);
        }
        lines.push(``, `**Overall: ${record.verification.health?.score}% - ${record.verification.health?.verdict}**`);
    }

    if (record.benchmarkBefore && record.benchmarkAfter) {
        lines.push(``, `## Benchmark Comparison`, ``);
        lines.push(`| Metric | Before | After | Delta |`, `|--------|--------|-------|-------|`);
        lines.push(`| Overall Score | ${record.benchmarkBefore.overallScore} | ${record.benchmarkAfter.overallScore} | ${record.benchmarkAfter.overallScore - record.benchmarkBefore.overallScore} |`);
    }

    return lines.join("\n") + "\n";
}

function exportHTML(record) {
    const issueRows = (record.issues || [])
        .map((i) => `<tr><td>${i.id}</td><td>${i.severity}</td><td>${i.category}</td><td>${i.subsystem}</td><td>${i.description}</td><td>${i.fix}</td></tr>`)
        .join("\n");

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Repair Report - ${record.id}</title>
<style>
body { font-family: -apple-system, sans-serif; margin: 40px; color: #333; }
table { border-collapse: collapse; width: 100%; margin: 20px 0; }
th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
th { background: #f5f5f5; }
</style></head>
<body>
<h1>Repair Report</h1>
<p><strong>Date:</strong> ${record.createdAt}<br>
<strong>Machine:</strong> ${record.machine?.hostname || "unknown"}<br>
<strong>Duration:</strong> ${((record.durationMs || 0) / 1000).toFixed(1)}s</p>
<h2>Summary</h2>
<p>Issues: ${record.issues?.length || 0} | Fixed: ${record.fixed || 0} | Failed: ${record.failed || 0} | Skipped: ${record.skipped || 0}</p>
<h2>Issues</h2>
<table><tr><th>ID</th><th>Severity</th><th>Category</th><th>Subsystem</th><th>Description</th><th>Fix</th></tr>
${issueRows}
</table>
</body></html>
`;
}

function exportCSV(record) {
    const lines = ["id,severity,category,subsystem,description,fix,estimated_time"];
    for (const issue of record.issues || []) {
        const desc = (issue.description || "").replace(/,/g, ";");
        const fix = (issue.fix || "").replace(/,/g, ";");
        lines.push(`${issue.id},${issue.severity},${issue.category},${issue.subsystem},${desc},${fix},${issue.estimatedTime}`);
    }
    return lines.join("\n") + "\n";
}

// ─── Explain (AI) ─────────────────────────────────────────────────────

export async function explainIssues(issues, { provider, model, endpoint } = {}) {
    const { getProvider, resolveApiKey } = await import("./ai/providers/index.js");
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

    const context = {
        issues: issues.map((i) => ({
            severity: i.severity,
            category: i.category,
            subsystem: i.subsystem,
            description: i.description,
            impact: i.impact,
            fix: i.fix
        })),
        machine: { hostname: hostname() },
        totalIssues: issues.length
    };

    const prompt = buildPrompt("explain", context, `Explain these DevForgeKit repair scan results. For each issue, explain the root cause, why it happened, the potential impact, and the recommended solution. Never fabricate information - only use the measured scan results in the context. ${issues.length} issues were detected.`);

    const response = await aiProvider.chat(prompt);
    return { ok: true, explanation: response.content };
}

// ─── Full Repair Pipeline ─────────────────────────────────────────────

export async function runFullRepair({ assumeYes = false, skipBenchmark = true, onProgress } = {}) {
    const startTime = Date.now();
    const createdAt = new Date().toISOString();
    const id = makeRepairId(createdAt);

    // Stage 1: Scan
    const issues = await scanIssues({ onProgress });

    if (issues.length === 0) {
        logger.success("No issues detected - environment is healthy!");
        return { id, issues: [], fixed: 0, failed: 0, skipped: 0, durationMs: Date.now() - startTime };
    }

    // Stage 2: Plan
    const plan = planRepairs(issues);
    logger.section("Repair Plan");
    logger.info(`Repairs: ${plan.totalRepairs} (plus ${plan.totalInfo} informational)`);
    logger.info(`Estimated time: ${plan.estimatedTime}`);
    if (plan.requiresRestart) logger.warn("Some repairs require a restart");
    for (let i = 0; i < plan.issues.length; i++) {
        const issue = plan.issues[i];
        console.log(`  ${i + 1}. [${issue.severity}] ${issue.description}`);
        console.log(`     Fix: ${issue.fix}`);
    }

    // Stage 3: Create rollback point
    let rollbackSnapshot = null;
    if (!assumeYes) {
        const shouldContinue = await confirm("\nProceed with repairs? A rollback snapshot will be created first.", false);
        if (!shouldContinue) {
            logger.info("Repair cancelled by user");
            return { id, issues, fixed: 0, failed: 0, skipped: 0, cancelled: true, durationMs: Date.now() - startTime };
        }
    }

    rollbackSnapshot = await createRollbackPoint();

    // Stage 3.5: Pre-repair benchmark (optional)
    let benchmarkBefore = null;
    if (!skipBenchmark) {
        try {
            const { runBenchmark } = await import("./benchmark.js");
            logger.info("Running pre-repair benchmark...");
            benchmarkBefore = await runBenchmark({ profile: "quick" });
        } catch {
            // Non-critical
        }
    }

    // Stage 4: Execute
    const execution = await executeRepairs(plan, { assumeYes, onProgress, rollbackSnapshot: rollbackSnapshot?.id });

    // Stage 5: Verify
    const verification = await verifyRepairs({ runBenchmark: !skipBenchmark });

    // Post-repair benchmark
    let benchmarkAfter = null;
    if (!skipBenchmark) {
        try {
            const { runBenchmark } = await import("./benchmark.js");
            logger.info("Running post-repair benchmark...");
            benchmarkAfter = await runBenchmark({ profile: "quick" });
            if (benchmarkBefore && benchmarkAfter) {
                const delta = benchmarkAfter.overallScore - benchmarkBefore.overallScore;
                const sign = delta > 0 ? "+" : "";
                logger.section("Benchmark Comparison");
                logger.info(`Before: ${benchmarkBefore.overallScore}  After: ${benchmarkAfter.overallScore}  (${sign}${delta})`);
            }
        } catch {
            // Non-critical
        }
    }

    const durationMs = Date.now() - startTime;
    const machine = { hostname: hostname() };

    const record = {
        repairVersion: REPAIR_VERSION,
        id,
        createdAt,
        durationMs,
        devforgekitVersion: getVersion(),
        machine,
        issues,
        plan: { totalRepairs: plan.totalRepairs, estimatedTime: plan.estimatedTime, requiresRestart: plan.requiresRestart },
        repairResults: execution.results,
        fixed: execution.fixed,
        failed: execution.failed,
        skipped: execution.skipped,
        rollbackSnapshotId: rollbackSnapshot?.id || null,
        verification,
        benchmarkBefore: benchmarkBefore ? { overallScore: benchmarkBefore.overallScore, overallGrade: benchmarkBefore.overallGrade } : null,
        benchmarkAfter: benchmarkAfter ? { overallScore: benchmarkAfter.overallScore, overallGrade: benchmarkAfter.overallGrade } : null
    };

    // Save to history
    saveRepairRecord(record);

    logger.section("Repair Complete");
    logger.success(`ID: ${id}`);
    logger.info(`Fixed: ${execution.fixed}, Failed: ${execution.failed}, Skipped: ${execution.skipped}`);
    if (rollbackSnapshot) {
        logger.info(`Rollback snapshot: ${rollbackSnapshot.id}`);
    }

    return record;
}
