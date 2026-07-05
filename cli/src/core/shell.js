// The only bridge from Layer 2 (Node) back into Layer 1 (bash). Every
// command that already has a battle-tested scripts/*.sh implementation
// wraps it here rather than reimplementing it - see
// docs/PlatformArchitecture.md section 1.
import { spawn } from "node:child_process";
import { scriptPath } from "./paths.js";

// runScript("scripts/doctor.sh", ["--fix"]) -> Promise<exitCode>
// Inherits stdio so colored bash output, `confirm()` prompts, and
// interactive behavior all pass through unchanged.
export function runScript(relativePath, args = []) {
    return new Promise((resolve, reject) => {
        const child = spawn(scriptPath(relativePath), args, { stdio: "inherit" });
        child.on("error", reject);
        child.on("close", (code) => resolve(code ?? 0));
    });
}

// runShellCommand("docker info") -> Promise<exitCode>
// Used by the component installer to execute a manifest's free-form
// validate/repair/install/uninstall command strings. `timeoutMs` is
// optional and defaults to unset (no timeout) for every existing caller
// - only plugin command/event hook execution passes one (see
// core/plugins.js), where it's the "sandbox": real resource/time
// isolation that kills a runaway hook process, *not* a security sandbox
// restricting filesystem/network access (that would need containers/VMs
// - see docs/PlatformArchitecture.md's Plugin API section).
// `onOutput(text, stream)` is a third, optional stdio mode added for the
// TUI (v1.2.3): when provided, the child's stdout/stderr are piped into
// the callback instead of inherited or ignored - the dashboard renders
// them inside an Ink log panel, because a child writing straight to the
// real terminal would interleave with (and corrupt) Ink's own React
// render loop. Callers that don't pass it get the exact same
// silent/inherit behavior as before.
export function runShellCommand(command, { silent = false, timeoutMs, env, cwd, onOutput } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, {
            shell: true,
            stdio: onOutput ? ["ignore", "pipe", "pipe"] : (silent ? "ignore" : "inherit"),
            env: env ? { ...process.env, ...env } : process.env,
            cwd
        });

        if (onOutput) {
            child.stdout.on("data", (chunk) => onOutput(chunk.toString(), "stdout"));
            child.stderr.on("data", (chunk) => onOutput(chunk.toString(), "stderr"));
        }

        let timer;
        if (timeoutMs) {
            timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
        }

        child.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve(code ?? 0);
        });
    });
}

// captureShellCommand("brew outdated") -> Promise<{ code, stdout }>
// Unlike runShellCommand, does not inherit stdio - used when a caller
// needs to parse the output (e.g. `devforgekit stats` counting outdated
// packages or reading free disk space), not just show it to the user.
export function captureShellCommand(command) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, { shell: true });
        let stdout = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? 0, stdout }));
    });
}

// captureShellCommandWithDetails("brew install foo") -> Promise<{
//   code, stdout, stderr, command, elapsedMs, timedOut
// }>
// The structured-error counterpart to runShellCommand: captures both
// stdout and stderr separately, measures elapsed time, and supports an
// optional timeout. Used by the Install Audit Engine (installAudit.js)
// and the enhanced installer (installer.js) so every install failure
// returns a precise reason instead of a bare exit code.
export function captureShellCommandWithDetails(command, { timeoutMs, env, cwd, onOutput } = {}) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const child = spawn(command, {
            shell: true,
            stdio: onOutput ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
            env: env ? { ...process.env, ...env } : process.env,
            cwd
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            const text = chunk.toString();
            stdout += text;
            if (onOutput) onOutput(text, "stdout");
        });
        child.stderr.on("data", (chunk) => {
            const text = chunk.toString();
            stderr += text;
            if (onOutput) onOutput(text, "stderr");
        });

        let timedOut = false;
        let timer;
        if (timeoutMs) {
            timer = setTimeout(() => {
                timedOut = true;
                child.kill("SIGTERM");
            }, timeoutMs);
        }

        child.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({
                code: code ?? 0,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                command,
                elapsedMs: Date.now() - start,
                timedOut
            });
        });
    });
}

// shellQuote(value) -> a single-quoted, shell-safe literal (any embedded
// single quote is escaped as '\''), for building the free-form command
// strings runShellCommand/captureShellCommand hand to `sh -c` from data
// that can contain arbitrary characters (git identity values, SSH host
// names, cloud profile names, etc.) - see core/workspace/*.js. Not a
// security boundary (this whole module already trusts its caller, same
// as installer.js's manifest-defined commands), just correctness for
// values containing spaces/quotes.
export function shellQuote(value) {
    return `'${String(value).replace(/'/g, "'\\''")}'`;
}

// commandExists(bin) -> Promise<boolean>. The Node counterpart of
// common.sh's command_exists - used by the project generator (see
// core/generators/*.js) to give a clear, actionable error before
// shelling out to an external scaffolding CLI (flutter, npx, dotnet,
// composer, cargo, go) that might not be installed, rather than letting
// the raw "command not found" from the shell be the only signal.
export async function commandExists(bin) {
    const { code } = await captureShellCommand(`command -v ${bin}`);
    return code === 0;
}

// defineScriptCommand(program, { name, aliases, description, script }) -
// registers a commander command that is a pure pass-through to a Layer 1
// script, forwarding every trailing argument/flag verbatim. Used by every
// cli/src/commands/*.js file that wraps an existing scripts/*.sh instead
// of reimplementing it (see docs/PlatformArchitecture.md section 1).
export function defineScriptCommand(program, { name, aliases = [], description, script }) {
    const command = program
        .command(`${name} [args...]`)
        .description(description)
        .allowUnknownOption(true)
        .action(async (args) => {
            const code = await runScript(script, args);
            process.exitCode = code;
        });
    if (aliases.length > 0) command.aliases(aliases);
    return command;
}
