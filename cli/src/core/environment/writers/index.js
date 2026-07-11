// Per-shell writer registry - the Environment Configuration Engine's
// equivalent of core/platform/'s per-OS adapter map, and the bottom of
// the EnvironmentEngine -> Platform -> Shell -> Writer chain: the
// platform adapter says WHICH shells matter on this OS (Platform.shells(),
// core/platform/base.js), this registry says HOW each one is written.
//
// Every writer implements one contract:
//   extension    - generated file's extension (shell.<ext>)
//   implemented  - false for a shell whose writer doesn't exist yet;
//                  the engine skips it with a warning instead of
//                  guessing syntax (PlatformNotSupportedError precedent)
//   render(model)   - the full generated file content
//   hookLine(file)  - the one-line source hook in THIS shell's syntax
//                     (POSIX `[ -f x ] && source x` is a syntax error in
//                     fish; PowerShell needs dot-sourcing)
import { DevForgeError } from "../../errors.js";
import { renderPosixShellFile } from "./posix.js";
import { renderFishShellFile } from "./fish.js";

export class EnvironmentUnsupportedShellError extends DevForgeError {}

const posixHookLine = (file) => `[ -f "${file}" ] && source "${file}"`;

// Capability values: "supported" (works today), "partial" (works with a
// documented limitation), "planned" (metadata field/translation exists
// conceptually but this writer doesn't emit it yet). aliases/functions/
// completions are "planned" everywhere because the metadata schema
// itself doesn't carry them yet - the writer column will flip per shell
// as each lands.
const POSIX_CAPABILITIES = {
    path: "supported",
    variables: "supported",
    shell: "supported",
    aliases: "planned",
    functions: "planned",
    completions: "planned"
};

const WRITERS = {
    zsh: {
        extension: "zsh",
        implemented: true,
        render: (model) => renderPosixShellFile(model, { shellName: "zsh" }),
        hookLine: posixHookLine,
        capabilities: POSIX_CAPABILITIES
    },
    bash: {
        extension: "sh",
        implemented: true,
        render: (model) => renderPosixShellFile(model, { shellName: "bash" }),
        hookLine: posixHookLine,
        capabilities: POSIX_CAPABILITIES
    },
    fish: {
        extension: "fish",
        implemented: true,
        render: renderFishShellFile,
        hookLine: (file) => `test -f "${file}"; and source "${file}"`,
        capabilities: {
            ...POSIX_CAPABILITIES,
            shell: "partial" // POSIX-authored raw lines are commented out with attribution, not translated
        }
    },
    // Declared so the architecture already accounts for it (Windows'
    // platform adapter names it in shells(), and shellConfigFile()
    // already resolves a real profile.ps1 path) - but no writer exists
    // yet: PowerShell needs $env:VAR assignments, ';' PATH separators,
    // and has no mechanical translation for POSIX $(...)-based values.
    // Requesting it throws instead of emitting broken syntax.
    powershell: {
        extension: "ps1",
        implemented: false,
        capabilities: {
            path: "planned",
            variables: "planned",
            shell: "planned",
            aliases: "planned",
            functions: "planned",
            completions: "planned"
        }
    }
};

export const ALL_SHELLS = Object.keys(WRITERS);
export const SUPPORTED_SHELLS = ALL_SHELLS.filter((shell) => WRITERS[shell].implemented);

export function getWriter(shell) {
    const writer = WRITERS[shell];
    if (!writer) {
        throw new EnvironmentUnsupportedShellError(`Unknown shell '${shell}' - known: ${ALL_SHELLS.join(", ")}.`);
    }
    if (!writer.implemented) {
        throw new EnvironmentUnsupportedShellError(
            `The Environment Configuration Engine does not yet have a '${shell}' writer - implemented: ${SUPPORTED_SHELLS.join(", ")}. See docs/EnvironmentEngine.md.`
        );
    }
    return writer;
}

export function isShellImplemented(shell) {
    return Boolean(WRITERS[shell]?.implemented);
}

// shellCapabilities() -> { shell: { implemented, capabilities } } for
// every known shell - `env shells`' capability matrix. Reads the
// registry directly (not getWriter, which throws for unimplemented
// shells - the whole point here is showing those honestly).
export function shellCapabilities() {
    const matrix = {};
    for (const [shell, writer] of Object.entries(WRITERS)) {
        matrix[shell] = { implemented: writer.implemented, capabilities: { ...writer.capabilities } };
    }
    return matrix;
}

export function renderShellFile(shell, model) {
    return getWriter(shell).render(model);
}

export function shellFileExtension(shell) {
    return getWriter(shell).extension;
}

export function shellHookLine(shell, file) {
    return getWriter(shell).hookLine(file);
}
