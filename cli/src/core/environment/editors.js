// Running-editor detection: after the environment regenerates, an
// already-open editor's integrated terminals keep the OLD environment
// until its window reloads. This detects which supported editors are
// running (a real `pgrep` observation) and returns the honest guidance
// for each - it does NOT offer to reload them: no CLI can reload
// another app's window reliably across editors/versions, and faking it
// with AppleScript-per-editor would be exactly the kind of fabricated
// behavior this codebase avoids (see shellIntegration.js's identical
// stance on reloading the parent shell).
import { captureShellCommand } from "../shell.js";

const EDITORS = [
    { id: "vscode", label: "VS Code", pattern: "Visual Studio Code", reload: "Cmd+Shift+P → Reload Window" },
    { id: "cursor", label: "Cursor", pattern: "Cursor.app", reload: "Cmd+Shift+P → Reload Window" },
    { id: "jetbrains", label: "JetBrains IDE", pattern: "JetBrains", reload: "restart the IDE or its terminal tab" }
];

// detectRunningEditors({ capture }) -> [{ id, label, reload }]
export async function detectRunningEditors({ capture = captureShellCommand } = {}) {
    const running = [];
    for (const editor of EDITORS) {
        try {
            const { code } = await capture(`pgrep -f "${editor.pattern}" >/dev/null 2>&1 && echo yes`);
            if (code === 0) running.push({ id: editor.id, label: editor.label, reload: editor.reload });
        } catch {
            // pgrep unavailable/errored - report nothing rather than guessing
        }
    }
    return running;
}

export function editorReloadGuidance(runningEditors) {
    if (runningEditors.length === 0) return null;
    const names = runningEditors.map((e) => e.label).join(", ");
    const hints = runningEditors.map((e) => `${e.label}: ${e.reload}`).join("; ");
    return `${names} ${runningEditors.length === 1 ? "is" : "are"} running - integrated terminals keep the old environment until reloaded (${hints}).`;
}
