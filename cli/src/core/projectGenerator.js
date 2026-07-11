// The Project Generator engine (v1.2.2, see docs/ProjectGenerator.md and
// docs/PlatformArchitecture.md's Project Generator section). Every stack
// under cli/src/generators/ implements the same small contract; this
// module is the one place that actually creates a directory, optionally
// shells out to an official scaffolding CLI (`flutter create`,
// `create-next-app`, ...), layers hand-written files on top, and runs
// `git init` - so no individual generator duplicates that sequence.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runShellCommand, commandExists } from "./shell.js";
import { scanCompatibility } from "./compatibility/engine.js";
import { confirm } from "../lib/prompts.js";
import { DevForgeError } from "./errors.js";
import { logger } from "./logger.js";
import { licenseText } from "../generators/shared.js";

// writeGeneratedFiles(baseDir, files) - files: [{ path, content, mode? }].
// `path` is relative to baseDir and may include new subdirectories
// (created on demand) - the same shape every generator's generate()
// returns.
export function writeGeneratedFiles(baseDir, files) {
    for (const file of files) {
        const fullPath = path.join(baseDir, file.path);
        mkdirSync(path.dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, file.content, file.mode ? { mode: file.mode } : undefined);
    }
}

// assertTargetIsFree(dir) - refuses to scaffold into an existing,
// non-empty directory (the same safety `plugin create` already applies
// to plugin directories) rather than silently overwriting someone's
// files.
function assertTargetIsFree(dir) {
    if (existsSync(dir) && readdirSync(dir).length > 0) {
        throw new DevForgeError(`Directory already exists and is not empty: ${dir}`);
    }
}

// RESERVED_NAMES (Project Generator Excellence, v2.1.2 Phase 8
// validation): Windows' reserved device names are the one genuinely
// cross-platform landmine here - a project named "con" or "nul" creates
// files that can never be checked out or opened on Windows at all
// (not "won't build," literally cannot exist on the filesystem), which
// would otherwise surface as a baffling error only once someone clones
// the repo on Windows, far removed from the moment the name was chosen.
const RESERVED_NAMES = new Set([
    "con", "prn", "aux", "nul",
    "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    "node_modules", ".git"
]);

// validateProjectName(name) -> throws a DevForgeError with a clear
// reason, or returns normally. Enforced unconditionally at the top of
// runProjectGenerator (below) - not just by the interactive `devforgekit
// new` command that originally owned this check - because `name` also
// reaches every generator's scaffold() shell-command interpolation
// (e.g. spring-boot.js's fully-unquoted curl params) from two other
// callers that never validated it themselves: `ai generate` (an AI
// provider's JSON response - untrusted network/model output) and the
// TUI's GeneratorPage (a raw, unvalidated TextField). Restricting to
// this character set closes that gap at the one place every caller
// already funnels through, rather than requiring each call site to
// remember to validate independently.
export function validateProjectName(name) {
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
        throw new DevForgeError(`Invalid project name '${name}' - use only letters, numbers, dots, dashes, and underscores.`, { exitCode: 2 });
    }
    if (RESERVED_NAMES.has(name.toLowerCase())) {
        throw new DevForgeError(`'${name}' is a reserved name (Windows device name or tooling directory) and would break on some platforms - choose a different name.`, { exitCode: 2 });
    }
    if (name.startsWith(".") || name.startsWith("-")) {
        throw new DevForgeError(`Invalid project name '${name}' - can't start with '.' or '-'.`, { exitCode: 2 });
    }
}

// ensureToolAvailable(generator) - checked once, right before a
// generator that needs an external scaffolding CLI runs it, so the
// error is "flutter is not installed - run: devforgekit component
// install flutter" instead of a raw, confusing "command not found"
// three levels down inside a spawned child process.
async function ensureToolAvailable(generator) {
    if (!generator.requiresTool) return;
    const ok = await commandExists(generator.requiresTool.command);
    if (!ok) {
        throw new DevForgeError(
            `'${generator.requiresTool.command}' is not installed or not on PATH - required to generate a ${generator.label} project.\n` +
            `  ${generator.requiresTool.hint}`
        );
    }
}

// checkStackCompatibility(generator, assumeYes) -> true to proceed, false to
// abort. Opt-in per generator via `compatibilityCheck: [componentNames]` -
// most generators don't declare it yet (see docs/CompatibilityEngine.md's
// scope note); scaffolding proceeds unchanged for those, exactly as before
// this existed.
async function checkStackCompatibility(generator, assumeYes) {
    if (!generator.compatibilityCheck?.length) return true;
    const result = await scanCompatibility(generator.compatibilityCheck);
    if (result.critical === 0 && result.unsupported === 0) return true;

    logger.section("Compatibility check");
    for (const issue of result.issues) {
        if (issue.severity !== "CRITICAL" && issue.severity !== "UNSUPPORTED") continue;
        logger.error(`[${issue.severity}] ${issue.tool}: ${issue.message}${issue.recommendation ? ` (${issue.recommendation})` : ""}`);
    }
    logger.warn(`Compatibility score: ${result.score}% - ${result.verdict}`);

    if (assumeYes || process.env.DEV_SETUP_ASSUME_YES === "1") return true;
    return confirm("Scaffold this project anyway?", false);
}

// runProjectGenerator(generator, { name, parentDir, options, assumeYes }) ->
// { dir, nextSteps }. The full sequence every stack shares:
//   1. refuse to clobber an existing non-empty directory
//   2. verify any required external CLI is actually on PATH
//   3. if the generator declares `compatibilityCheck`, scan it and confirm
//      past any critical/unsupported finding before scaffolding
//   4. scaffold (shell out to the official CLI) and/or generate
//      (hand-written files layered on top) - either or both, a
//      generator declares whichever it needs
//   5. `git init` (skippable per generator, e.g. one whose scaffold CLI
//      already initializes its own repo)
export async function runProjectGenerator(generator, { name, parentDir, options = {}, assumeYes = false }) {
    validateProjectName(name);
    const dir = path.join(parentDir, name);
    assertTargetIsFree(dir);

    if (!(await checkStackCompatibility(generator, assumeYes))) {
        throw new DevForgeError("Cancelled.");
    }
    await ensureToolAvailable(generator);

    if (generator.scaffold) {
        logger.step(`Scaffolding ${generator.label} project with the official CLI...`);
        const code = await generator.scaffold({ name, parentDir, dir, options });
        if (code !== 0) {
            throw new DevForgeError(`${generator.label} scaffold command failed (exit ${code})`);
        }
    } else {
        mkdirSync(dir, { recursive: true });
    }

    if (generator.generate) {
        const files = await generator.generate({ name, dir, options });
        writeGeneratedFiles(dir, files);
    }

    // postGenerate - for the rarer case where a layered file needs to
    // *modify* something the scaffold step already created (e.g. adding
    // dependencies to a package.json `create-next-app` generated) rather
    // than writing a brand new file - see generators/nextjs.js.
    if (generator.postGenerate) {
        await generator.postGenerate({ name, dir, options });
    }

    // Universal LICENSE (Project Generator Excellence, v2.1.2) - applied
    // here, once, for every stack, rather than each generator hardcoding
    // its own (5 of 17 used to hand-write an MIT LICENSE regardless of
    // what a user might actually want; the other 12 wrote none at all).
    // Defaults to MIT when unspecified (the same default those 5 already
    // had), skips entirely for "none", and never overwrites a LICENSE a
    // generator or its scaffolding CLI already wrote.
    const licensePath = path.join(dir, "LICENSE");
    if (!existsSync(licensePath)) {
        const content = licenseText(options.license ?? "mit", options.licenseAuthor);
        if (content) writeFileSync(licensePath, content);
    }

    if (!generator.skipGitInit) {
        await runShellCommand(`git init -q "${dir}"`, { silent: true });
    }

    const nextSteps = generator.nextSteps ? await generator.nextSteps({ name, dir, options }) : [`cd ${name}`];
    return { dir, nextSteps };
}
