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

    if (!generator.skipGitInit) {
        await runShellCommand(`git init -q "${dir}"`, { silent: true });
    }

    const nextSteps = generator.nextSteps ? await generator.nextSteps({ name, dir, options }) : [`cd ${name}`];
    return { dir, nextSteps };
}
