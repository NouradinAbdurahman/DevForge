// The Plugin SDK lifecycle: create -> test -> build -> package ->
// publish -> install (see docs/PlatformArchitecture.md's Plugin API
// section). Kept separate from cli/src/commands/plugin.js so each step
// is independently testable without going through commander.
import {
    existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
    writeFileSync, copyFileSync, rmSync, renameSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import yaml from "js-yaml";
import semver from "semver";
import { runShellCommand } from "./shell.js";
import { signFile, isSignatureTrusted } from "./signing.js";
import { validatePluginManifest, discoverPlugins } from "./plugins.js";
import { scoreResults } from "./health.js";
import { getVersion } from "../version.js";
import { userStateDir } from "./paths.js";
import { confirm } from "../lib/prompts.js";
import { logger } from "./logger.js";
import { DevForgeError } from "./errors.js";

const EXAMPLE_COMMAND_SCRIPT = (name) => `#!/usr/bin/env bash
set -Eeuo pipefail
echo "Hello from the ${name} plugin!"
`;

const EXAMPLE_EVENT_SCRIPT = (name) => `#!/usr/bin/env bash
set -Eeuo pipefail
echo "[${name}] install.afterInstall fired: \${DEVFORGEKIT_EVENT_PAYLOAD:-{}}"
`;

// Deliberately avoids bash's \${BASH_SOURCE[0]} (this is a JS template
// literal - any \${...} left unescaped here would be evaluated as a JS
// expression at module-load time, not left as literal bash). `dirname
// "$0"` is a plain, portable, bash-3.2-safe way to find this script's
// own directory without that hazard.
const EXAMPLE_TEST_SCRIPT = `#!/usr/bin/env bash
set -Eeuo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
test -f "$here/../plugin.yml"
`;

// generateReadme(manifest) -> Markdown string - the "plugin documentation
// generator": static generation from data already on disk, the same
// pattern devforgekit registry generate already uses for
// docs/Registry.md.
export function generateReadme(manifest) {
    const lines = [
        `# ${manifest.name}`,
        "",
        manifest.description,
        "",
        `**Version:** ${manifest.version}`,
        manifest.author ? `**Author:** ${manifest.author}` : null,
        manifest.license ? `**License:** ${manifest.license}` : null,
        manifest.homepage ? `**Homepage:** ${manifest.homepage}` : null,
        manifest.repository ? `**Repository:** ${manifest.repository}` : null,
        `**Requires DevForgeKit:** ${manifest.engine}`,
        ""
    ].filter((line) => line !== null);

    if (manifest.keywords?.length) {
        lines.push(`**Keywords:** ${manifest.keywords.join(", ")}`, "");
    }
    if (manifest.capabilities?.length) {
        lines.push(`**Capabilities:** ${manifest.capabilities.join(", ")}`, "");
    }
    if (manifest.permissions?.length) {
        lines.push(`**Permissions:** ${manifest.permissions.join(", ")}`, "");
    }
    if (manifest.compatibility) {
        const parts = [];
        if (manifest.compatibility.platforms?.length) parts.push(`Platforms: ${manifest.compatibility.platforms.join(", ")}`);
        if (manifest.compatibility.architectures?.length) parts.push(`Architectures: ${manifest.compatibility.architectures.join(", ")}`);
        if (parts.length) lines.push(`**Compatibility:** ${parts.join(" | ")}`, "");
    }

    if (manifest.commands?.length) {
        lines.push("## Commands", "");
        for (const c of manifest.commands) {
            lines.push(`- \`devforgekit ${c.name}\` - ${c.description || "(no description)"}`);
        }
        lines.push("");
    }

    if (manifest.events?.length) {
        lines.push("## Event hooks", "");
        for (const e of manifest.events) {
            lines.push(`- \`${e.event}\` - ${e.description || "(no description)"}`);
        }
        lines.push("");
    }

    if (manifest.dependencies?.length) {
        lines.push("## Dependencies", "");
        for (const dep of manifest.dependencies) lines.push(`- ${dep}`);
        lines.push("");
    }

    lines.push(
        "---",
        "",
        "_This README is generated from `plugin.yml` by `devforgekit plugin build` - edits here are overwritten on the next build. Edit `plugin.yml`'s `description`/`author`/`license`/`homepage` and each command/event's `description` instead._"
    );

    return lines.join("\n");
}

// createPlugin(name, destDir, { template }) -> the created plugin's
// directory path. Scaffolds a real, runnable plugin from one of several
// templates. Default template is "simple-command" (the original behavior).
export function createPlugin(name, destDir = process.cwd(), { template = "simple-command" } = {}) {
    const tpl = TEMPLATES[template];
    if (!tpl) {
        throw new DevForgeError(`Unknown template '${template}'. Available: ${Object.keys(TEMPLATES).join(", ")}`);
    }

    const pluginDir = path.join(destDir, name);
    if (existsSync(pluginDir)) {
        throw new DevForgeError(`Directory already exists: ${pluginDir}`);
    }

    mkdirSync(path.join(pluginDir, "commands"), { recursive: true });
    mkdirSync(path.join(pluginDir, "hooks"), { recursive: true });
    mkdirSync(path.join(pluginDir, "tests"), { recursive: true });

    const manifest = tpl.manifest(name, getVersion());
    writeFileSync(path.join(pluginDir, "plugin.yml"), yaml.dump(manifest));

    for (const [relPath, content] of Object.entries(tpl.files(name))) {
        const fullPath = path.join(pluginDir, relPath);
        mkdirSync(path.dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content, { mode: 0o755 });
    }

    writeFileSync(path.join(pluginDir, "README.md"), generateReadme(manifest));

    return pluginDir;
}

// Template definitions. Each template has:
// - manifest(name, version) -> manifest object
// - files(name) -> { [relPath]: content } of scripts to scaffold
const TEMPLATES = {
    "simple-command": {
        manifest: (name, ver) => ({
            schemaVersion: 2, name, version: "0.1.0",
            description: `${name} - a DevForgeKit plugin`,
            author: "", license: "MIT", homepage: "", repository: "",
            keywords: [], engine: `>=${ver}`, dependencies: [],
            capabilities: ["command"], permissions: ["shell"],
            compatibility: { platforms: ["darwin", "linux", "win32"], architectures: ["x64", "arm64"] },
            commands: [{ name: "hello", description: `Example command from ${name}`, run: "./commands/hello.sh" }],
            events: [{ event: "install.afterInstall", description: "Example: reacts after any component install", run: "./hooks/after-install.sh" }]
        }),
        files: (name) => ({
            "commands/hello.sh": EXAMPLE_COMMAND_SCRIPT(name),
            "hooks/after-install.sh": EXAMPLE_EVENT_SCRIPT(name),
            "tests/manifest.test.sh": EXAMPLE_TEST_SCRIPT,
        })
    },
    "tui-page": {
        manifest: (name, ver) => ({
            schemaVersion: 2, name, version: "0.1.0",
            description: `${name} - a TUI page plugin for DevForgeKit`,
            author: "", license: "MIT", homepage: "", repository: "",
            keywords: ["tui", "page"], engine: `>=${ver}`, dependencies: [],
            capabilities: ["tui-page"], permissions: ["shell"],
            compatibility: { platforms: ["darwin", "linux"], architectures: ["x64", "arm64"] },
            commands: [{ name: "open-page", description: `Open the ${name} TUI page`, run: "./commands/open-page.sh" }],
        }),
        files: (name) => ({
            "commands/open-page.sh": `#!/usr/bin/env bash\nset -Eeuo pipefail\necho "Opening ${name} TUI page..."\necho "TUI page plugins render inside the DevForgeKit dashboard."\n`,
            "tests/manifest.test.sh": EXAMPLE_TEST_SCRIPT,
        })
    },
    "generator": {
        manifest: (name, ver) => ({
            schemaVersion: 2, name, version: "0.1.0",
            description: `${name} - a project generator plugin for DevForgeKit`,
            author: "", license: "MIT", homepage: "", repository: "",
            keywords: ["generator", "scaffold"], engine: `>=${ver}`, dependencies: [],
            capabilities: ["generator"], permissions: ["shell", "filesystem"],
            compatibility: { platforms: ["darwin", "linux", "win32"], architectures: ["x64", "arm64"] },
            commands: [{ name: "generate", description: `Generate a project with ${name}`, run: "./commands/generate.sh" }],
        }),
        files: (name) => ({
            "commands/generate.sh": `#!/usr/bin/env bash\nset -Eeuo pipefail\necho "Generating project with ${name}..."\necho "Generator plugins scaffold new projects from custom templates."\n`,
            "tests/manifest.test.sh": EXAMPLE_TEST_SCRIPT,
        })
    },
    "benchmark": {
        manifest: (name, ver) => ({
            schemaVersion: 2, name, version: "0.1.0",
            description: `${name} - a benchmark plugin for DevForgeKit`,
            author: "", license: "MIT", homepage: "", repository: "",
            keywords: ["benchmark", "performance"], engine: `>=${ver}`, dependencies: [],
            capabilities: ["benchmark"], permissions: ["shell", "subprocess"],
            compatibility: { platforms: ["darwin", "linux", "win32"], architectures: ["x64", "arm64"] },
            commands: [{ name: "bench", description: `Run ${name} benchmark`, run: "./commands/bench.sh" }],
        }),
        files: (name) => ({
            "commands/bench.sh": `#!/usr/bin/env bash\nset -Eeuo pipefail\nstart=$(date +%s%N)\nsleep 0.1\nend=$(date +%s%N)\necho "${name} benchmark: $(( (end - start) / 1000000 ))ms"\n`,
            "tests/manifest.test.sh": EXAMPLE_TEST_SCRIPT,
        })
    },
    "repair": {
        manifest: (name, ver) => ({
            schemaVersion: 2, name, version: "0.1.0",
            description: `${name} - a repair plugin for DevForgeKit`,
            author: "", license: "MIT", homepage: "", repository: "",
            keywords: ["repair", "fix"], engine: `>=${ver}`, dependencies: [],
            capabilities: ["repair"], permissions: ["shell", "filesystem"],
            compatibility: { platforms: ["darwin", "linux", "win32"], architectures: ["x64", "arm64"] },
            commands: [{ name: "repair", description: `Run ${name} repair`, run: "./commands/repair.sh" }],
        }),
        files: (name) => ({
            "commands/repair.sh": `#!/usr/bin/env bash\nset -Eeuo pipefail\necho "Running ${name} repair..."\necho "Repair plugins diagnose and fix environment issues."\n`,
            "tests/manifest.test.sh": EXAMPLE_TEST_SCRIPT,
        })
    },
    "graph-extension": {
        manifest: (name, ver) => ({
            schemaVersion: 2, name, version: "0.1.0",
            description: `${name} - a DEV Graph extension plugin for DevForgeKit`,
            author: "", license: "MIT", homepage: "", repository: "",
            keywords: ["graph", "dependency"], engine: `>=${ver}`, dependencies: [],
            capabilities: ["graph"], permissions: ["shell"],
            compatibility: { platforms: ["darwin", "linux", "win32"], architectures: ["x64", "arm64"] },
            commands: [{ name: "graph-query", description: `Query the DEV Graph via ${name}`, run: "./commands/graph-query.sh" }],
        }),
        files: (name) => ({
            "commands/graph-query.sh": `#!/usr/bin/env bash\nset -Eeuo pipefail\necho "Querying DEV Graph via ${name}..."\necho "Graph extension plugins add custom nodes and edges to the DEV Graph."\n`,
            "tests/manifest.test.sh": EXAMPLE_TEST_SCRIPT,
        })
    },
    "ai-provider": {
        manifest: (name, ver) => ({
            schemaVersion: 2, name, version: "0.1.0",
            description: `${name} - an AI provider plugin for DevForgeKit`,
            author: "", license: "MIT", homepage: "", repository: "",
            keywords: ["ai", "provider", "llm"], engine: `>=${ver}`, dependencies: [],
            capabilities: ["ai-provider"], permissions: ["network", "env"],
            compatibility: { platforms: ["darwin", "linux", "win32"], architectures: ["x64", "arm64"] },
            commands: [{ name: "ask", description: `Ask ${name} AI provider`, run: "./commands/ask.sh" }],
        }),
        files: (name) => ({
            "commands/ask.sh": `#!/usr/bin/env bash\nset -Eeuo pipefail\necho "Asking ${name} AI provider..."\necho "AI provider plugins integrate custom LLM endpoints into DevForgeKit."\n`,
            "tests/manifest.test.sh": EXAMPLE_TEST_SCRIPT,
        })
    },
    "compatibility-rule": {
        manifest: (name, ver) => ({
            schemaVersion: 2, name, version: "0.1.0",
            description: `${name} - a compatibility rule plugin for DevForgeKit`,
            author: "", license: "MIT", homepage: "", repository: "",
            keywords: ["compatibility", "rules"], engine: `>=${ver}`, dependencies: [],
            capabilities: ["compatibility-rule"], permissions: [],
            compatibility: { platforms: ["darwin", "linux", "win32"], architectures: ["x64", "arm64"] },
            rules: { requires: {}, conflicts: [], recommends: {} },
            commands: [{ name: "check-compat", description: `Check compatibility rules from ${name}`, run: "./commands/check-compat.sh" }],
        }),
        files: (name) => ({
            "commands/check-compat.sh": `#!/usr/bin/env bash\nset -Eeuo pipefail\necho "Checking compatibility rules from ${name}..."\necho "Compatibility rule plugins add version constraints to the Compatibility Engine."\n`,
            "tests/manifest.test.sh": EXAMPLE_TEST_SCRIPT,
        })
    },
};

// testPlugin(dir) -> { manifest, results, score, verdict } - schema
// validation, engine semver-range sanity, "every referenced script
// exists" checks, then runs every tests/*.sh as a real subprocess.
// Reuses core/health.js's scoreResults() rather than inventing a second
// PASS/FAIL scoring function.
export async function testPlugin(dir) {
    const manifestPath = path.join(dir, "plugin.yml");
    if (!existsSync(manifestPath)) {
        throw new DevForgeError(`No plugin.yml found in ${dir}`);
    }

    const manifest = yaml.load(readFileSync(manifestPath, "utf8"));
    const results = [];

    const validation = validatePluginManifest(manifest);
    results.push({ status: validation.valid ? "PASS" : "FAIL", description: validation.valid ? "plugin.yml schema valid" : `plugin.yml: ${validation.reason}` });

    if (validation.valid) {
        results.push({
            status: semver.validRange(manifest.engine) ? "PASS" : "FAIL",
            description: `engine '${manifest.engine}' is a valid semver range`
        });

        for (const cmd of manifest.commands || []) {
            results.push({
                status: existsSync(path.join(dir, cmd.run)) ? "PASS" : "FAIL",
                description: `command '${cmd.name}' script exists (${cmd.run})`
            });
        }
        for (const evt of manifest.events || []) {
            results.push({
                status: existsSync(path.join(dir, evt.run)) ? "PASS" : "FAIL",
                description: `event '${evt.event}' script exists (${evt.run})`
            });
        }
    }

    const testsDir = path.join(dir, "tests");
    let testFiles = [];
    try {
        testFiles = readdirSync(testsDir).filter((f) => f.endsWith(".sh"));
    } catch {
        // No tests/ directory - fine, just nothing further to run.
    }
    for (const file of testFiles) {
        const code = await runShellCommand(path.join(testsDir, file), { silent: true, timeoutMs: 30000 });
        results.push({ status: code === 0 ? "PASS" : "FAIL", description: `test: ${file}` });
    }

    return { manifest, results, ...scoreResults(results) };
}

function listPluginFiles(dir, base = dir) {
    let files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files = files.concat(listPluginFiles(full, base));
        } else if (entry.isFile()) {
            const rel = path.relative(base, full);
            if (rel !== "plugin.lock.json") files.push(rel);
        }
    }
    return files.sort();
}

// buildPlugin(dir) -> { manifest, lock, testScore }. Requires testPlugin()
// to report zero failures first. Regenerates README.md and writes
// plugin.lock.json (a SHA-256 per file + a build timestamp) - the file
// manifest packagePlugin() tars up.
export async function buildPlugin(dir) {
    const { manifest, results, score } = await testPlugin(dir);
    const failed = results.filter((r) => r.status === "FAIL");
    if (failed.length > 0) {
        throw new DevForgeError(`Cannot build - ${failed.length} check(s) failed:\n${failed.map((f) => `  - ${f.description}`).join("\n")}`);
    }

    writeFileSync(path.join(dir, "README.md"), generateReadme(manifest));

    const files = listPluginFiles(dir);
    const checksums = {};
    for (const file of files) {
        checksums[file] = crypto.createHash("sha256").update(readFileSync(path.join(dir, file))).digest("hex");
    }

    const lock = {
        schemaVersion: 1,
        name: manifest.name,
        version: manifest.version,
        builtAt: new Date().toISOString(),
        files: checksums
    };
    writeFileSync(path.join(dir, "plugin.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);

    return { manifest, lock, testScore: score };
}

// packagePlugin(dir, outDir) -> { archivePath, checksum, signaturePath,
// manifest, lock }. Builds (if the lock file is missing) then shells
// out to `tar -czf` (reusing the existing shell bridge rather than
// adding a tar/zip npm dependency) and signs the resulting archive with
// this machine's local key (core/signing.js - auto-generated on first
// use). `outDir` defaults to the plugin's *parent* directory, not the
// plugin directory itself - writing the archive inside the very
// directory being archived makes tar (at least BSD tar, macOS's default)
// fail with "file changed as we read it" since the output file appears
// mid-read.
export async function packagePlugin(dir, outDir = path.dirname(dir)) {
    let lock;
    if (!existsSync(path.join(dir, "plugin.lock.json"))) {
        const buildResult = await buildPlugin(dir);
        lock = buildResult.lock;
    } else {
        lock = JSON.parse(readFileSync(path.join(dir, "plugin.lock.json"), "utf8"));
    }
    const manifest = yaml.load(readFileSync(path.join(dir, "plugin.yml"), "utf8"));

    const archiveName = `${manifest.name}-${manifest.version}.tar.gz`;
    mkdirSync(outDir, { recursive: true });
    const archivePath = path.join(outDir, archiveName);
    const parentDir = path.dirname(dir);
    const dirName = path.basename(dir);

    const code = await runShellCommand(`tar -czf "${archivePath}" -C "${parentDir}" "${dirName}"`, { silent: true });
    if (code !== 0) {
        throw new DevForgeError(`tar failed while packaging ${dir} (exit ${code})`);
    }

    const checksum = crypto.createHash("sha256").update(readFileSync(archivePath)).digest("hex");
    writeFileSync(`${archivePath}.sha256`, `${checksum}  ${archiveName}\n`);

    const signature = signFile(archivePath);
    const signaturePath = `${archivePath}.sig`;
    writeFileSync(signaturePath, `${signature}\n`);

    return { archivePath, checksum, signaturePath, manifest, lock };
}

// publishPlugin(archivePath, destDir) -> { destArchive, indexPath}.
// "Publish" today means package + stage a signed, checksummed artifact
// locally with an index - genuinely useful for self-hosting (rsync/copy
// destDir anywhere), but there is no hosted discovery/search service;
// that remains the documented, still design-only Plugin/Profile
// Marketplace Architecture.
export function publishPlugin(archivePath, destDir = path.join(userStateDir(), "published-plugins")) {
    mkdirSync(destDir, { recursive: true });
    const archiveName = path.basename(archivePath);
    const destArchive = path.join(destDir, archiveName);

    copyFileSync(archivePath, destArchive);
    for (const ext of [".sha256", ".sig"]) {
        const sibling = `${archivePath}${ext}`;
        if (existsSync(sibling)) copyFileSync(sibling, `${destArchive}${ext}`);
    }

    const checksumFile = `${archivePath}.sha256`;
    const checksum = existsSync(checksumFile) ? readFileSync(checksumFile, "utf8").trim().split(/\s+/)[0] : null;
    const match = archiveName.match(/^(.+)-(\d+\.\d+\.\d+.*)\.tar\.gz$/);
    const name = match ? match[1] : archiveName;
    const version = match ? match[2] : "unknown";

    const indexPath = path.join(destDir, "index.json");
    const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : [];
    const filtered = index.filter((e) => !(e.name === name && e.version === version));
    filtered.push({ name, version, file: archiveName, checksum, publishedAt: new Date().toISOString() });
    writeFileSync(indexPath, `${JSON.stringify(filtered, null, 2)}\n`);

    return { destArchive, indexPath };
}

async function downloadFile(url, destPath) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new DevForgeError(`HTTP ${response.status} fetching ${url}`);
    }
    writeFileSync(destPath, Buffer.from(await response.arrayBuffer()));
}

// installPlugin(pathOrUrl, opts) -> { installedDir, manifest }. Accepts a
// local .tar.gz path or an http(s) URL. Checksum verification is
// mandatory (a mismatch is a hard failure - integrity is
// non-negotiable); signature verification against the trusted-keys set
// is a warning + confirmation prompt when missing/untrusted, not a
// silent pass (see core/signing.js for the trust model).
export async function installPlugin(pathOrUrl, { assumeYes = false } = {}) {
    const isUrl = /^https?:\/\//.test(pathOrUrl);
    let localArchivePath = pathOrUrl;
    let tempDir = null;

    if (isUrl) {
        tempDir = mkdtempSync(path.join(tmpdir(), "devforgekit-plugin-install-"));
        localArchivePath = path.join(tempDir, path.basename(new URL(pathOrUrl).pathname));
        await downloadFile(pathOrUrl, localArchivePath);
        for (const ext of [".sha256", ".sig"]) {
            try {
                await downloadFile(`${pathOrUrl}${ext}`, `${localArchivePath}${ext}`);
            } catch {
                // Sibling not published - verification degrades gracefully below.
            }
        }
    }

    if (!existsSync(localArchivePath)) {
        throw new DevForgeError(`No such file: ${localArchivePath}`);
    }

    const actualChecksum = crypto.createHash("sha256").update(readFileSync(localArchivePath)).digest("hex");
    const checksumSidecar = `${localArchivePath}.sha256`;
    if (existsSync(checksumSidecar)) {
        const expected = readFileSync(checksumSidecar, "utf8").trim().split(/\s+/)[0];
        if (expected !== actualChecksum) {
            throw new DevForgeError(`Checksum mismatch for ${localArchivePath} - refusing to install a corrupted/tampered package`);
        }
        logger.success("Checksum verified");
    } else {
        logger.warn("No .sha256 sidecar found - integrity was not verified");
    }

    const sigSidecar = `${localArchivePath}.sig`;
    if (existsSync(sigSidecar)) {
        const signature = readFileSync(sigSidecar, "utf8").trim();
        if (isSignatureTrusted(localArchivePath, signature)) {
            logger.success("Signature verified against a trusted key");
        } else {
            logger.warn("Signature present but NOT from a trusted key (run 'devforgekit plugin trust <pubkey>' to add one)");
            if (!assumeYes && !(await confirm("Install this plugin anyway?", false))) {
                throw new DevForgeError("Installation cancelled - untrusted signature");
            }
        }
    } else {
        logger.warn("Package is unsigned");
        if (!assumeYes && !(await confirm("Install this unsigned plugin anyway?", false))) {
            throw new DevForgeError("Installation cancelled - unsigned package");
        }
    }

    const destRoot = path.join(userStateDir(), "plugins");
    mkdirSync(destRoot, { recursive: true });
    const extractTempDir = mkdtempSync(path.join(tmpdir(), "devforgekit-plugin-extract-"));

    const extractCode = await runShellCommand(`tar -xzf "${localArchivePath}" -C "${extractTempDir}"`, { silent: true });
    if (extractCode !== 0) {
        throw new DevForgeError(`Failed to extract ${localArchivePath} (tar exit ${extractCode})`);
    }

    const topLevel = readdirSync(extractTempDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (topLevel.length !== 1) {
        throw new DevForgeError(`Expected exactly one top-level directory in the package, found ${topLevel.length}`);
    }
    const extractedDir = path.join(extractTempDir, topLevel[0].name);
    const manifestPath = path.join(extractedDir, "plugin.yml");
    if (!existsSync(manifestPath)) {
        throw new DevForgeError(`Extracted package has no plugin.yml at ${manifestPath}`);
    }

    const manifest = yaml.load(readFileSync(manifestPath, "utf8"));
    const validation = validatePluginManifest(manifest);
    if (!validation.valid) {
        throw new DevForgeError(`Installed plugin.yml is invalid: ${validation.reason}`);
    }

    const finalDir = path.join(destRoot, manifest.name);
    rmSync(finalDir, { recursive: true, force: true });
    renameSync(extractedDir, finalDir);
    rmSync(extractTempDir, { recursive: true, force: true });
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });

    const discovered = discoverPlugins();
    const missingDeps = (manifest.dependencies || []).filter((dep) => !discovered.some((p) => p.name === dep && p.valid));
    if (missingDeps.length > 0) {
        logger.warn(`Plugin '${manifest.name}' declares dependencies not currently installed: ${missingDeps.join(", ")}`);
    }

    return { installedDir: finalDir, manifest };
}
