// The Benchmark Engine (v1.3.3). Measures the performance of the user's
// development environment using real developer workloads - not synthetic
// CPU benchmarks. Every benchmark runs in an isolated temporary directory
// that is cleaned up automatically; user projects are never touched.
//
// Three profiles:
//   quick    (~10-20s)  - CPU, disk, git, node startup, shell, memory
//   standard (~30-60s)  - quick + docker, flutter, python, databases, pkg managers
//   full     (~2-5min)  - everything including project generation
//
// Scoring: each category gets 0-100, overall is the average of available
// categories. Grades: A+ (95+), A (90+), B (80+), C (70+), D (60+), F (<60).
//
// Results stored in ~/.devforgekit/benchmarks/<id>.json with full metadata.
//
// Reuses: shell.js (runShellCommand/captureShellCommand), compatibility
// engine (scanCompatibility for known issues), registry (loadPackages for
// installed component detection), version.js, paths.js, logger.js, AI
// providers for explanations, project generator for project benchmarks.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { tmpdir, hostname, arch, cpus, totalmem, freemem } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
import { runShellCommand, captureShellCommand, commandExists, shellQuote } from "./shell.js";
import { userStateDir } from "./paths.js";
import { getVersion } from "../version.js";
import { logger } from "./logger.js";
import { DevForgeError } from "./errors.js";
import { scanCompatibility, currentPlatform, currentArchitecture } from "./compatibility/engine.js";
import { loadPackages } from "./registry.js";
import { validate } from "./installer.js";
import { scoreResults } from "./health.js";

// ─── Constants ────────────────────────────────────────────────────────

export const BENCHMARK_VERSION = 1;
export const BENCHMARK_DIR = "benchmarks";

const PROFILES = {
    quick: ["cpu", "memory", "disk", "git", "node", "shell"],
    standard: ["cpu", "memory", "disk", "git", "node", "shell", "docker", "flutter", "python", "databases", "packageManagers"],
    full: ["cpu", "memory", "disk", "git", "node", "shell", "docker", "flutter", "python", "databases", "packageManagers", "projectGeneration"]
};

// Expected times (ms) for scoring. Score = min(100, 100 * expected / actual).
// A result at the expected time scores 100; twice as slow scores 50.
const EXPECTED_TIMES = {
    cpu: { compression: 500, decompression: 200, jsonParse: 50, objectCreation: 100 },
    memory: { allocation: 100, largeArrays: 200, gc: 100 },
    disk: { sequentialWrite: 500, sequentialRead: 300, randomAccess: 1000, smallFiles: 2000 },
    git: { init: 200, status: 100, add: 200, commit: 500, branch: 100, diff: 100 },
    node: { startup: 100, moduleLoad: 200 },
    shell: { startup: 200, prompt: 300 },
    docker: { daemon: 1000, containerStart: 5000, imageInspect: 1000 },
    flutter: { doctor: 5000, pubGet: 10000 },
    python: { startup: 100, venv: 3000, pipInstall: 10000 },
    databases: { postgresPing: 500, mysqlPing: 500, redisPing: 200 },
    packageManagers: { brew: 2000, npm: 1000, pnpm: 500, bun: 300 },
    projectGeneration: { nextjs: 30000, express: 5000, fastapi: 5000, flutter: 30000 }
};

// ─── Helpers ──────────────────────────────────────────────────────────

function benchmarksDir() {
    return path.join(userStateDir(), BENCHMARK_DIR);
}

function tempDir(prefix) {
    return mkdtempSync(path.join(tmpdir(), prefix));
}

function makeBenchmarkId(isoTimestamp) {
    return `${isoTimestamp.replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
}

export function gradeForScore(score) {
    if (score >= 95) return "A+";
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 60) return "D";
    return "F";
}

function scoreTime(actualMs, expectedMs) {
    if (actualMs == null || expectedMs == null) return null;
    if (actualMs <= 0) return 100;
    return Math.min(100, Math.max(0, Math.round(100 * expectedMs / actualMs)));
}

function scoreCategory(measurements) {
    const scores = [];
    for (const [name, actualMs] of Object.entries(measurements)) {
        if (actualMs == null) continue;
        const expected = EXPECTED_TIMES[name] || actualMs;
        const s = scoreTime(actualMs, expected);
        if (s != null) scores.push(s);
    }
    if (scores.length === 0) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function computeOverall(categoryScores) {
    const valid = Object.values(categoryScores).filter((s) => s != null);
    if (valid.length === 0) return 0;
    return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

async function timeOperation(fn) {
    const start = performance.now();
    try {
        await fn();
    } catch {
        return null;
    }
    return Math.round(performance.now() - start);
}

async function timeShell(cmd, opts = {}) {
    return timeOperation(async () => {
        const code = await runShellCommand(cmd, { silent: true, ...opts });
        if (code !== 0) throw new Error(`Command failed: ${cmd}`);
    });
}

async function toolAvailable(name) {
    return commandExists(name);
}

// ─── CPU Benchmarks ───────────────────────────────────────────────────

async function benchmarkCPU() {
    const results = {};

    // Compression: create a large text file and gzip it
    results.compression = await timeOperation(async () => {
        const dir = tempDir("bench-cpu-");
        try {
            const filePath = path.join(dir, "large.txt");
            const chunk = "x".repeat(1024);
            writeFileSync(filePath, chunk.repeat(1024)); // 1MB
            await timeShell(`gzip -f ${shellQuote(filePath)}`);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    // Decompression
    results.decompression = await timeOperation(async () => {
        const dir = tempDir("bench-cpu-decomp-");
        try {
            const filePath = path.join(dir, "large.txt");
            writeFileSync(filePath, "x".repeat(1024 * 1024));
            await timeShell(`gzip -f ${shellQuote(filePath)}`);
            await timeShell(`gunzip -f ${shellQuote(filePath + ".gz")}`);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    // JSON parsing
    results.jsonParse = await timeOperation(async () => {
        const data = Array.from({ length: 10000 }, (_, i) => ({ id: i, name: `item-${i}`, value: Math.random() }));
        const json = JSON.stringify(data);
        JSON.parse(json);
    });

    // Large object creation
    results.objectCreation = await timeOperation(async () => {
        const arr = [];
        for (let i = 0; i < 100000; i++) {
            arr.push({ index: i, data: `item-${i}`, nested: { a: i, b: i * 2 } });
        }
        return arr.length;
    });

    return results;
}

// ─── Memory Benchmarks ────────────────────────────────────────────────

async function benchmarkMemory() {
    const results = {};

    // Allocation
    results.allocation = await timeOperation(() => {
        const buffers = [];
        for (let i = 0; i < 1000; i++) {
            buffers.push(Buffer.alloc(1024 * 100)); // 100KB each, 100MB total
        }
        return buffers.length;
    });

    // Large arrays
    results.largeArrays = await timeOperation(() => {
        const arrays = [];
        for (let i = 0; i < 10; i++) {
            arrays.push(new Array(1000000).fill(i));
        }
        return arrays.length;
    });

    // GC
    results.gc = await timeOperation(() => {
        if (global.gc) {
            global.gc();
        } else {
            // Force GC pressure
            for (let i = 0; i < 5; i++) {
                const arr = new Array(1000000).fill(null);
                arr.length = 0;
            }
        }
    });

    return results;
}

// ─── Disk Benchmarks ──────────────────────────────────────────────────

async function benchmarkDisk() {
    const results = {};
    const dir = tempDir("bench-disk-");

    try {
        // Sequential write
        results.sequentialWrite = await timeOperation(() => {
            const filePath = path.join(dir, "seq-write.bin");
            const buf = Buffer.alloc(1024 * 1024 * 10); // 10MB
            writeFileSync(filePath, buf);
        });

        // Sequential read
        results.sequentialRead = await timeOperation(() => {
            const filePath = path.join(dir, "seq-write.bin");
            readFileSync(filePath);
        });

        // Random access
        results.randomAccess = await timeOperation(() => {
            const filePath = path.join(dir, "random.bin");
            writeFileSync(filePath, Buffer.alloc(1024 * 1024));
            const fd = openSync(filePath, "r");
            try {
                for (let i = 0; i < 100; i++) {
                    const offset = Math.floor(Math.random() * (1024 * 1024 - 4096));
                    const buf = Buffer.alloc(4096);
                    readSync(fd, buf, 0, 4096, offset);
                }
            } finally {
                closeSync(fd);
            }
        });

        // Small files
        results.smallFiles = await timeOperation(() => {
            const subDir = path.join(dir, "small");
            mkdirSync(subDir, { recursive: true });
            for (let i = 0; i < 100; i++) {
                writeFileSync(path.join(subDir, `file-${i}.txt`), `content ${i}`);
            }
        });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    return results;
}

// ─── Git Benchmarks ───────────────────────────────────────────────────

async function benchmarkGit() {
    const results = {};
    const dir = tempDir("bench-git-");

    try {
        // Init
        results.init = await timeShell(`git init ${shellQuote(dir)}`);

        // Create a file and add
        const filePath = path.join(dir, "test.txt");
        writeFileSync(filePath, "initial content\n");

        results.add = await timeShell(`git -C ${shellQuote(dir)} add test.txt`);

        // Commit
        results.commit = await timeShell(
            `git -C ${shellQuote(dir)} -c user.name="Bench" -c user.email="bench@test" commit -m "initial"`
        );

        // Status
        results.status = await timeShell(`git -C ${shellQuote(dir)} status --porcelain`);

        // Branch creation
        results.branch = await timeShell(`git -C ${shellQuote(dir)} branch test-branch`);

        // Diff
        writeFileSync(filePath, "modified content\n");
        results.diff = await timeShell(`git -C ${shellQuote(dir)} diff`);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    return results;
}

// ─── Node.js Benchmarks ───────────────────────────────────────────────

async function benchmarkNode() {
    const results = {};

    // Startup
    results.startup = await timeShell("node -e 'process.exit(0)'");

    // Module load
    results.moduleLoad = await timeShell("node -e 'require(\"fs\"); require(\"path\"); require(\"crypto\")'");

    return results;
}

// ─── Shell Benchmarks ─────────────────────────────────────────────────

async function benchmarkShell() {
    const results = {};

    // Shell startup
    results.startup = await timeShell("echo ok");

    // Prompt rendering (simulated - time to source a basic profile)
    results.prompt = await timeShell("source /etc/profile 2>/dev/null; echo ok");

    return results;
}

// ─── Docker Benchmarks ────────────────────────────────────────────────

async function benchmarkDocker() {
    const results = {};

    if (!(await toolAvailable("docker"))) {
        return { skipped: "docker not installed" };
    }

    // Daemon responsiveness
    results.daemon = await timeShell("docker info --format '{{.ServerVersion}}' 2>/dev/null");

    // Image inspect (use hello-world if available, pull if needed)
    results.imageInspect = await timeShell("docker image inspect hello-world --format '{{.Id}}' 2>/dev/null || docker pull hello-world 2>/dev/null && docker image inspect hello-world --format '{{.Id}}' 2>/dev/null");

    // Container startup
    results.containerStart = await timeShell("docker run --rm hello-world 2>/dev/null");

    return results;
}

// ─── Flutter Benchmarks ───────────────────────────────────────────────

async function benchmarkFlutter() {
    const results = {};

    if (!(await toolAvailable("flutter"))) {
        return { skipped: "flutter not installed" };
    }

    // Flutter doctor
    results.doctor = await timeShell("flutter doctor 2>/dev/null");

    // Pub get on a temp project
    const dir = tempDir("bench-flutter-");
    try {
        await timeShell(`flutter create temp_project --project-name bench 2>/dev/null`, { cwd: dir });
        results.pubGet = await timeShell(`flutter pub get 2>/dev/null`, { cwd: path.join(dir, "temp_project") });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    return results;
}

// ─── Python Benchmarks ────────────────────────────────────────────────

async function benchmarkPython() {
    const results = {};

    if (!(await toolAvailable("python3"))) {
        return { skipped: "python3 not installed" };
    }

    // Startup
    results.startup = await timeShell("python3 -c 'pass'");

    // Venv creation
    const dir = tempDir("bench-python-");
    try {
        results.venv = await timeShell(`python3 -m venv ${shellQuote(path.join(dir, "venv"))}`);

        // Pip install (small package)
        results.pipInstall = await timeShell(
            `${shellQuote(path.join(dir, "venv", "bin", "pip"))} install --quiet six 2>/dev/null`
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    return results;
}

// ─── Database Benchmarks ──────────────────────────────────────────────

async function benchmarkDatabases() {
    const results = {};

    // PostgreSQL
    if (await toolAvailable("psql")) {
        results.postgresPing = await timeShell("psql -lqt 2>/dev/null | head -1");
    }

    // MySQL
    if (await toolAvailable("mysql")) {
        results.mysqlPing = await timeShell("mysql -e 'SELECT 1' 2>/dev/null");
    }

    // Redis
    if (await toolAvailable("redis-cli")) {
        results.redisPing = await timeShell("redis-cli ping 2>/dev/null");
    }

    return results;
}

// ─── Package Manager Benchmarks ───────────────────────────────────────

async function benchmarkPackageManagers() {
    const results = {};

    // Homebrew
    if (await toolAvailable("brew")) {
        results.brew = await timeShell("brew --version 2>/dev/null");
    }

    // npm
    if (await toolAvailable("npm")) {
        results.npm = await timeShell("npm --version 2>/dev/null");
    }

    // pnpm
    if (await toolAvailable("pnpm")) {
        results.pnpm = await timeShell("pnpm --version 2>/dev/null");
    }

    // bun
    if (await toolAvailable("bun")) {
        results.bun = await timeShell("bun --version 2>/dev/null");
    }

    return results;
}

// ─── Project Generation Benchmarks ────────────────────────────────────

async function benchmarkProjectGeneration() {
    const results = {};
    const dir = tempDir("bench-projgen-");

    try {
        // Express (fast, always available via Node)
        if (await toolAvailable("node")) {
            results.express = await timeOperation(async () => {
                const { getGenerator } = await import("../generators/index.js");
                const { runProjectGenerator } = await import("./projectGenerator.js");
                const gen = getGenerator("express");
                if (gen) {
                    await runProjectGenerator(gen, {
                        name: "bench-express",
                        parentDir: dir,
                        assumeYes: true
                    });
                }
            });
        }

        // FastAPI (if python available)
        if (await toolAvailable("python3")) {
            results.fastapi = await timeOperation(async () => {
                const { getGenerator } = await import("../generators/index.js");
                const { runProjectGenerator } = await import("./projectGenerator.js");
                const gen = getGenerator("fastapi");
                if (gen) {
                    await runProjectGenerator(gen, {
                        name: "bench-fastapi",
                        parentDir: dir,
                        assumeYes: true
                    });
                }
            });
        }

        // Next.js (if npx available)
        if (await toolAvailable("npx")) {
            results.nextjs = await timeOperation(async () => {
                const { getGenerator } = await import("../generators/index.js");
                const { runProjectGenerator } = await import("./projectGenerator.js");
                const gen = getGenerator("nextjs");
                if (gen) {
                    await runProjectGenerator(gen, {
                        name: "bench-nextjs",
                        parentDir: dir,
                        assumeYes: true
                    });
                }
            });
        }

        // Flutter (if flutter available)
        if (await toolAvailable("flutter")) {
            results.flutter = await timeOperation(async () => {
                const { getGenerator } = await import("../generators/index.js");
                const { runProjectGenerator } = await import("./projectGenerator.js");
                const gen = getGenerator("flutter");
                if (gen) {
                    await runProjectGenerator(gen, {
                        name: "bench_flutter",
                        parentDir: dir,
                        assumeYes: true
                    });
                }
            });
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    return results;
}

// ─── Benchmark Registry ───────────────────────────────────────────────

const BENCHMARKS = {
    cpu: { run: benchmarkCPU, label: "CPU" },
    memory: { run: benchmarkMemory, label: "Memory" },
    disk: { run: benchmarkDisk, label: "Disk" },
    git: { run: benchmarkGit, label: "Git" },
    node: { run: benchmarkNode, label: "Node.js" },
    shell: { run: benchmarkShell, label: "Terminal" },
    docker: { run: benchmarkDocker, label: "Docker" },
    flutter: { run: benchmarkFlutter, label: "Flutter" },
    python: { run: benchmarkPython, label: "Python" },
    databases: { run: benchmarkDatabases, label: "Databases" },
    packageManagers: { run: benchmarkPackageManagers, label: "Package Managers" },
    projectGeneration: { run: benchmarkProjectGeneration, label: "Project Generation" }
};

// ─── Machine Info ─────────────────────────────────────────────────────

async function gatherMachineInfo() {
    const cpuInfo = cpus();
    const cpuModel = cpuInfo.length > 0 ? cpuInfo[0].model : "unknown";
    const cpuCount = cpuInfo.length;
    const totalMemGb = Math.round(totalmem() / 1024 / 1024 / 1024);
    const freeMemGb = Math.round(freemem() / 1024 / 1024 / 1024);

    let osName = "unknown";
    let osVersion = "unknown";
    try {
        const { stdout } = await captureShellCommand("sw_vers 2>/dev/null");
        for (const line of stdout.split("\n")) {
            const m = /^([^:]+):\s*(.*)$/.exec(line.trim());
            if (m) {
                if (m[1].trim() === "ProductName") osName = m[2].trim();
                if (m[1].trim() === "ProductVersion") osVersion = m[2].trim();
            }
        }
    } catch {
        // Non-macOS
    }

    let machineModel = "unknown";
    try {
        const { stdout } = await captureShellCommand("system_profiler SPHardwareDataType 2>/dev/null");
        const line = stdout.split("\n").find((l) => l.includes("Model Name:"));
        if (line) machineModel = line.split("Model Name:")[1].trim();
    } catch {
        // Non-macOS
    }

    return {
        hostname: hostname(),
        os: `${osName} ${osVersion}`,
        arch: arch(),
        cpuModel,
        cpuCount,
        totalMemoryGb: totalMemGb,
        freeMemoryGb: freeMemGb,
        machineModel
    };
}

// ─── Run Benchmark ────────────────────────────────────────────────────

export async function runBenchmark({ profile = "quick", onProgress, signal } = {}) {
    const categories = PROFILES[profile];
    if (!categories) {
        throw new DevForgeError(`Unknown benchmark profile '${profile}'. Available: ${Object.keys(PROFILES).join(", ")}`);
    }

    const startTime = Date.now();
    const createdAt = new Date().toISOString();
    const id = makeBenchmarkId(createdAt);

    logger.section(`Benchmark: ${profile.toUpperCase()}`);
    logger.info(`Running ${categories.length} category benchmarks...\n`);

    const machine = await gatherMachineInfo();
    const categoryResults = {};
    const categoryScores = {};
    const skipped = [];

    for (let i = 0; i < categories.length; i++) {
        const catKey = categories[i];
        const bench = BENCHMARKS[catKey];
        if (!bench) continue;

        if (signal?.aborted) {
            logger.warn("Benchmark cancelled");
            break;
        }

        if (onProgress) onProgress({ category: catKey, label: bench.label, index: i, total: categories.length, status: "running" });

        try {
            const measurements = await bench.run();

            // Check if skipped
            if (measurements.skipped) {
                skipped.push({ category: catKey, reason: measurements.skipped });
                if (onProgress) onProgress({ category: catKey, label: bench.label, index: i, total: categories.length, status: "skipped" });
                logger.warn(`  ${bench.label}: skipped (${measurements.skipped})`);
                continue;
            }

            categoryResults[catKey] = measurements;
            const score = scoreCategory(measurements);
            if (score != null) {
                categoryScores[catKey] = score;
                const grade = gradeForScore(score);
                logger.success(`  ${bench.label}: ${score}/100 (${grade})`);
            } else {
                logger.warn(`  ${bench.label}: no valid measurements`);
            }

            if (onProgress) onProgress({ category: catKey, label: bench.label, index: i, total: categories.length, status: "done", score });
        } catch (err) {
            skipped.push({ category: catKey, reason: err.message });
            if (onProgress) onProgress({ category: catKey, label: bench.label, index: i, total: categories.length, status: "error", error: err.message });
            logger.warn(`  ${bench.label}: error - ${err.message}`);
        }
    }

    const overallScore = computeOverall(categoryScores);
    const overallGrade = gradeForScore(overallScore);
    const durationMs = Date.now() - startTime;

    logger.section("Benchmark Complete");
    logger.success(`Overall Score: ${overallScore}/100 (${overallGrade})`);
    logger.info(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
    if (skipped.length > 0) {
        logger.warn(`Skipped: ${skipped.length} category(ies)`);
    }

    // Find slowest and fastest categories
    const scoredEntries = Object.entries(categoryScores).filter(([, s]) => s != null);
    let slowest = null;
    let fastest = null;
    if (scoredEntries.length > 0) {
        scoredEntries.sort((a, b) => a[1] - b[1]);
        slowest = { category: scoredEntries[0][0], score: scoredEntries[0][1] };
        fastest = { category: scoredEntries[scoredEntries.length - 1][0], score: scoredEntries[scoredEntries.length - 1][1] };
    }

    // Compatibility check
    let compatibilityIssues = [];
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
        compatibilityIssues = (compatResult.issues || []).filter((i) => i.severity === "FAIL" || i.severity === "WARNING");
    } catch {
        // Non-critical
    }

    const result = {
        benchmarkVersion: BENCHMARK_VERSION,
        id,
        createdAt,
        profile,
        durationMs,
        devforgekitVersion: getVersion(),
        machine,
        categoryResults,
        categoryScores,
        overallScore,
        overallGrade,
        slowest,
        fastest,
        skipped,
        compatibilityIssues
    };

    return result;
}

// ─── Save Result ──────────────────────────────────────────────────────

export function saveResult(result) {
    const dir = benchmarksDir();
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${result.id}.json`);
    writeFileSync(filePath, `${JSON.stringify(result, null, 2)}\n`);
    return filePath;
}

// ─── List History ─────────────────────────────────────────────────────

export function listHistory() {
    const dir = benchmarksDir();
    if (!existsSync(dir)) return [];

    const results = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const filePath = path.join(dir, entry.name);
        try {
            const data = JSON.parse(readFileSync(filePath, "utf8"));
            results.push({
                id: data.id,
                createdAt: data.createdAt,
                profile: data.profile,
                overallScore: data.overallScore,
                overallGrade: data.overallGrade,
                durationMs: data.durationMs,
                machine: data.machine?.hostname || "unknown",
                path: filePath
            });
        } catch {
            // Corrupt file - skip
        }
    }

    return results.sort((a, b) => {
        const aKey = a.createdAt || "";
        const bKey = b.createdAt || "";
        return aKey < bKey ? 1 : aKey > bKey ? -1 : 0;
    });
}

// ─── Get Result ───────────────────────────────────────────────────────

export function getResult(id) {
    const filePath = path.join(benchmarksDir(), `${id}.json`);
    if (!existsSync(filePath)) {
        throw new DevForgeError(`Benchmark result '${id}' not found`);
    }
    return JSON.parse(readFileSync(filePath, "utf8"));
}

// ─── Delete Result ────────────────────────────────────────────────────

export function deleteResult(id) {
    const filePath = path.join(benchmarksDir(), `${id}.json`);
    if (!existsSync(filePath)) {
        throw new DevForgeError(`Benchmark result '${id}' not found`);
    }
    rmSync(filePath, { force: true });
    return filePath;
}

// ─── Compare Results ──────────────────────────────────────────────────

export function compareResults(oldResult, newResult) {
    const allCategories = new Set([
        ...Object.keys(oldResult.categoryScores || {}),
        ...Object.keys(newResult.categoryScores || {})
    ]);

    const categories = [];
    for (const cat of allCategories) {
        const oldScore = oldResult.categoryScores?.[cat] ?? null;
        const newScore = newResult.categoryScores?.[cat] ?? null;
        const delta = (oldScore != null && newScore != null) ? newScore - oldScore : null;
        const status = delta == null ? "N/A" : delta > 0 ? "improved" : delta < 0 ? "regressed" : "unchanged";
        categories.push({ category: cat, oldScore, newScore, delta, status });
    }

    const overallDelta = (oldResult.overallScore != null && newResult.overallScore != null)
        ? newResult.overallScore - oldResult.overallScore
        : null;

    return {
        old: {
            id: oldResult.id,
            createdAt: oldResult.createdAt,
            overallScore: oldResult.overallScore,
            overallGrade: oldResult.overallGrade,
            machine: oldResult.machine?.hostname
        },
        new: {
            id: newResult.id,
            createdAt: newResult.createdAt,
            overallScore: newResult.overallScore,
            overallGrade: newResult.overallGrade,
            machine: newResult.machine?.hostname
        },
        overallDelta,
        categories: categories.sort((a, b) => {
            if (a.delta == null && b.delta == null) return 0;
            if (a.delta == null) return 1;
            if (b.delta == null) return -1;
            return b.delta - a.delta;
        })
    };
}

// ─── Export Result ────────────────────────────────────────────────────

export function exportResult(result, format) {
    switch (format) {
        case "json":
            return exportJSON(result);
        case "markdown":
        case "md":
            return exportMarkdown(result);
        case "html":
            return exportHTML(result);
        case "csv":
            return exportCSV(result);
        default:
            throw new DevForgeError(`Unknown export format '${format}'. Available: json, markdown, html, csv`);
    }
}

function exportJSON(result) {
    return `${JSON.stringify(result, null, 2)}\n`;
}

function exportMarkdown(result) {
    const lines = [
        `# Benchmark Report`,
        ``,
        `**Date:** ${result.createdAt}`,
        `**Profile:** ${result.profile}`,
        `**Machine:** ${result.machine?.hostname || "unknown"} (${result.machine?.os || "unknown"})`,
        `**DevForgeKit:** ${result.devforgekitVersion}`,
        `**Duration:** ${(result.durationMs / 1000).toFixed(1)}s`,
        ``,
        `## Overall Score`,
        ``,
        `**${result.overallScore}/100** (Grade: ${result.overallGrade})`,
        ``,
        `## Category Scores`,
        ``,
        `| Category | Score | Grade |`,
        `|----------|-------|-------|`
    ];

    for (const [cat, score] of Object.entries(result.categoryScores || {})) {
        if (score == null) continue;
        const label = BENCHMARKS[cat]?.label || cat;
        const grade = gradeForScore(score);
        lines.push(`| ${label} | ${score} | ${grade} |`);
    }

    if (result.slowest) {
        lines.push(``, `**Slowest:** ${BENCHMARKS[result.slowest.category]?.label || result.slowest.category} (${result.slowest.score})`);
    }
    if (result.fastest) {
        lines.push(`**Fastest:** ${BENCHMARKS[result.fastest.category]?.label || result.fastest.category} (${result.fastest.score})`);
    }

    if (result.skipped?.length > 0) {
        lines.push(``, `## Skipped Categories`, ``);
        for (const s of result.skipped) {
            lines.push(`- **${BENCHMARKS[s.category]?.label || s.category}**: ${s.reason}`);
        }
    }

    if (result.compatibilityIssues?.length > 0) {
        lines.push(``, `## Compatibility Issues`, ``);
        for (const issue of result.compatibilityIssues) {
            lines.push(`- **[${issue.severity}]** ${issue.tool}: ${issue.message}`);
        }
    }

    lines.push(``, `## Detailed Measurements`, ``);
    for (const [cat, measurements] of Object.entries(result.categoryResults || {})) {
        const label = BENCHMARKS[cat]?.label || cat;
        lines.push(`### ${label}`, ``);
        for (const [name, ms] of Object.entries(measurements)) {
            if (ms == null) continue;
            lines.push(`- ${name}: ${ms}ms`);
        }
        lines.push(``);
    }

    return lines.join("\n");
}

function exportHTML(result) {
    const rows = Object.entries(result.categoryScores || {})
        .filter(([, s]) => s != null)
        .map(([cat, score]) => {
            const label = BENCHMARKS[cat]?.label || cat;
            const grade = gradeForScore(score);
            const color = score >= 80 ? "#4caf50" : score >= 60 ? "#ff9800" : "#f44336";
            return `    <tr><td>${label}</td><td style="color:${color}">${score}</td><td>${grade}</td></tr>`;
        })
        .join("\n");

    const measurements = Object.entries(result.categoryResults || {})
        .map(([cat, measurements]) => {
            const label = BENCHMARKS[cat]?.label || cat;
            const items = Object.entries(measurements)
                .filter(([, ms]) => ms != null)
                .map(([name, ms]) => `<li>${name}: ${ms}ms</li>`)
                .join("");
            return `    <h3>${label}</h3>\n    <ul>${items}</ul>`;
        })
        .join("\n");

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Benchmark Report - ${result.id}</title>
  <style>
    body { font-family: -apple-system, sans-serif; margin: 40px; color: #333; }
    h1 { color: #1a1a1a; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f5f5f5; }
    .score { font-size: 2em; font-weight: bold; }
    .grade { font-size: 1.5em; }
  </style>
</head>
<body>
  <h1>Benchmark Report</h1>
  <p><strong>Date:</strong> ${result.createdAt}<br>
  <strong>Profile:</strong> ${result.profile}<br>
  <strong>Machine:</strong> ${result.machine?.hostname || "unknown"} (${result.machine?.os || "unknown"})<br>
  <strong>DevForgeKit:</strong> ${result.devforgekitVersion}<br>
  <strong>Duration:</strong> ${(result.durationMs / 1000).toFixed(1)}s</p>

  <h2>Overall Score</h2>
  <p class="score">${result.overallScore}/100</p>
  <p class="grade">Grade: ${result.overallGrade}</p>

  <h2>Category Scores</h2>
  <table>
    <tr><th>Category</th><th>Score</th><th>Grade</th></tr>
${rows}
  </table>

  <h2>Detailed Measurements</h2>
${measurements}
</body>
</html>
`;
}

function exportCSV(result) {
    const lines = ["category,measurement,duration_ms,score"];
    for (const [cat, measurements] of Object.entries(result.categoryResults || {})) {
        const score = result.categoryScores?.[cat] ?? "";
        for (const [name, ms] of Object.entries(measurements)) {
            if (ms == null) continue;
            lines.push(`${cat},${name},${ms},${score}`);
        }
    }
    lines.push(`,overall,${result.durationMs},${result.overallScore}`);
    return lines.join("\n") + "\n";
}

// ─── Explain (AI) ─────────────────────────────────────────────────────

export async function explainResult(result, { provider, model, endpoint } = {}) {
    const { loadConfig } = await import("./config.js");
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

    // Build context from benchmark data
    const context = {
        machine: result.machine,
        overallScore: result.overallScore,
        overallGrade: result.overallGrade,
        categoryScores: result.categoryScores,
        categoryResults: result.categoryResults,
        slowest: result.slowest,
        fastest: result.fastest,
        skipped: result.skipped,
        compatibilityIssues: result.compatibilityIssues,
        profile: result.profile,
        durationMs: result.durationMs
    };

    const prompt = buildPrompt("explain", context, `Explain this DevForgeKit benchmark result. Identify slow categories, performance bottlenecks, and recommend concrete upgrades, configuration improvements, and toolchain optimizations. Only use the measured benchmark data in the context - never invent recommendations. The benchmark was run on ${result.machine?.hostname} with profile ${result.profile}.`);

    const response = await aiProvider.chat(prompt);
    return { ok: true, explanation: response.content };
}

// ─── Benchmark Summary for Snapshots ──────────────────────────────────

export function benchmarkSummary(result) {
    return {
        id: result.id,
        createdAt: result.createdAt,
        profile: result.profile,
        overallScore: result.overallScore,
        overallGrade: result.overallGrade,
        categoryScores: result.categoryScores,
        slowest: result.slowest,
        fastest: result.fastest
    };
}
