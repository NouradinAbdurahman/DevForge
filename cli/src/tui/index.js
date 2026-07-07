// Dashboard entry point (v1.2.3, docs/TUI.md). `devforgekit` with no
// command lands here (see bin/devforgekit.js). Owns the one piece of
// terminal choreography Ink can't do alone: suspend/resume - unmount
// the dashboard, hand the real terminal to an inherited-stdio process
// (scripts/doctor.sh, a scaffolding CLI, a plugin command), then render
// a fresh dashboard on the page the user left. React state doesn't
// survive the remount; the store re-reads config and the target page
// reloads its data, which is exactly the fresh view wanted after an
// external operation anyway.
//
// Alternate screen buffer: the dashboard renders in the terminal's alt
// screen (ESC[?1049h), not the main buffer. This is what every
// professional full-screen TUI (lazygit, k9s, btop, lazydocker) does,
// and it is the fix for stale frames during terminal shrink.
//
// Ink manages frames with log-update, which erases the previous frame
// by writing eraseLines(previousLineCount) — a count of *logical*
// (newline-separated) lines. When the terminal shrinks, lines from the
// previous frame wrap to occupy MORE physical lines than
// previousLineCount tracks. eraseLines(N) then only erases N physical
// lines, but the old frame occupies N+M physical lines. The un-erased
// remainder stays visible as stale borders and duplicated dashboards.
//
// The alt screen does NOT prevent this: most modern terminals (iTerm2,
// Terminal.app, Kitty, etc.) reflow/wrap content in the alt screen on
// resize — the alt screen only lacks scrollback, it doesn't prevent
// wrapping.
//
// RESIZE FLICKER ELIMINATION (professional resize behavior):
//
// The previous fix (clear on every resize event) eliminated stale frames
// but introduced flickering: each event in a drag burst flashed
// CLEAR → empty screen → render. During a continuous drag, 50+ events
// per second produced visible flashing.
//
// The fix: intercept 'resize' at the EventEmitter.emit level BEFORE any
// listener (ours, Ink's, or useTerminalSize's) sees it. We collect the
// burst, and only emit a single 'resize' after ~120ms of silence (the
// user stopped dragging). At that point we clear once and render once.
//
// This is exactly how lazygit/k9s/btop handle SIGWINCH: they batch resize
// signals and only redraw the final stable state. No intermediate
// layouts, no flashing, no duplicated frames.
//
// Crash-safe terminal restoration: regardless of how the process exits
// (SIGINT, SIGTERM, SIGHUP, uncaughtException, unhandledRejection,
// process.exit()), the terminal is restored to a usable state: cursor
// visible, alternate buffer exited, raw mode disabled.
import { createInterface } from "node:readline";
import { render } from "ink";
import { h } from "./components/ui.js";
import { App } from "./App.js";
import { resizeMetrics } from "./resizeMetrics.js";
import { getTheme } from "./theme.js";
import { registrySnapshot, plugins, workspaceList, activeWorkspaceName } from "./data.js";
import { loadConfig } from "../core/config.js";
import { loadCompatibilityRules } from "../core/compatibility/rules.js";
import { shouldShowAnimation, resolveAnimationSpeed, runStartupAnimation } from "./startup/startupAnimation.js";
import { validateAIConfig, autoRepairConfig } from "../core/ai/validation.js";

const ENTER_ALT_SCREEN = "\x1b[?1049h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";
const SHOW_CURSOR = "\x1b[?25h";
const RESET_MOUSE = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l";
const CLEAR_TERMINAL = "\x1b[2J\x1b[3J\x1b[H"; // clear screen + clear scrollback + cursor home

// How long after the last resize event before we consider the resize
// "settled" and redraw. 120ms matches what lazygit/k9s use: fast enough
// to feel responsive, slow enough to coalesce a full drag burst.
const RESIZE_SETTLE_MS = 120;

function waitForEnter(message) {
    return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.question(message, () => {
            rl.close();
            resolve();
        });
    });
}

// isTuiCapable() - the graceful-fallback gate: a dumb terminal, a
// non-TTY stdin/stdout (pipes, CI), or an explicit DEVFORGEKIT_NO_TUI=1
// all get the classic --help text instead of a broken interactive UI.
export function isTuiCapable() {
    if (process.env.DEVFORGEKIT_NO_TUI === "1") return false;
    if (!process.stdout.isTTY || !process.stdin.isTTY) return false;
    if (process.env.TERM === "dumb") return false;
    return true;
}

// Crash-safe terminal restoration. Called on every possible exit path
// to ensure the terminal is never left in a corrupted state:
// - Exit the alternate screen buffer
// - Show the cursor (Ink hides it during rendering)
// - Reset mouse tracking modes
// - Disable raw mode on stdin
function restoreTerminal() {
    process.stdout.write(EXIT_ALT_SCREEN + SHOW_CURSOR + RESET_MOUSE);
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
        try { process.stdin.setRawMode(false); } catch { /* already restored */ }
    }
}

export async function launchDashboard({ initialPage } = {}) {
    let page = initialPage || "dashboard";

    if (process.env.DEVFORGEKIT_TUI_DEBUG) {
        const t0 = Date.now();
        process.stdin.on("data", (chunk) => {
            console.error(`[stdin-data] ${JSON.stringify(chunk.toString())} @${Date.now() - t0}ms`);
        });
    }

    // Safety net: restore the terminal no matter how the process
    // exits. Ink's own signalExit handles Ctrl-C via unmount →
    // waitUntilExit → our EXIT write below; this covers everything
    // else: SIGTERM, SIGHUP, uncaughtException, unhandledRejection,
    // and process.exit() from any code path.
    const restoreScreen = () => restoreTerminal();
    process.on("exit", restoreScreen);
    process.on("SIGTERM", () => { restoreTerminal(); process.exit(0); });
    process.on("SIGHUP", () => { restoreTerminal(); process.exit(0); });
    process.on("uncaughtException", (err) => {
        restoreTerminal();
        console.error(`\nFatal: ${err.message}`);
        process.exit(1);
    });
    process.on("unhandledRejection", (reason) => {
        restoreTerminal();
        console.error(`\nUnhandled rejection: ${reason}`);
        process.exit(1);
    });

    // Startup animation (v1.2.6, docs/TUI.md): plays once, before the
    // dashboard's first real frame - never on suspend/resume, since
    // those re-enter the loop below directly without coming back
    // through here. Everything under tui/startup/ only knows how to
    // paint raw frames; it has no idea a dashboard exists. The tasks
    // below are real initialization work (the same cached calls the
    // dashboard's own pages make through data.js), so the checklist
    // reflects actual progress and doubles as a cache warm-up - by the
    // time the dashboard mounts, this data is already loaded.
    const config = loadConfig();
    if (shouldShowAnimation({ config, isTTY: Boolean(process.stdout.isTTY && process.stdin.isTTY) })) {
        const theme = getTheme(config.tuiTheme || "dark");
        const tasks = [
            { label: "Loading registry", run: () => registrySnapshot() },
            { label: "Loading plugins", run: () => plugins() },
            { label: "Loading profiles", run: () => registrySnapshot() },
            { label: "Loading recipes", run: () => registrySnapshot() },
            { label: "Loading compatibility engine", run: () => loadCompatibilityRules() },
            { label: "Initializing workspace manager", run: () => { workspaceList(); activeWorkspaceName(); } },
            { label: "Validating AI configuration", run: () => {
                const repair = autoRepairConfig();
                void repair;
                const report = validateAIConfig();
                void report;
            } },
            { label: "Preparing dashboard", run: () => loadConfig() }
        ];
        process.stdout.write(ENTER_ALT_SCREEN);
        await runStartupAnimation({ theme, tasks, speed: resolveAnimationSpeed(config) });
    }

    // The relaunch loop: each suspend request unmounts, runs its
    // function with the real terminal, then loops around to render a
    // fresh dashboard. `pendingSuspend` is how the running app hands us
    // the function across the unmount boundary.
    for (;;) {
        let pendingSuspend = null;
        let resolveExit;
        const exited = new Promise((resolve) => { resolveExit = resolve; });

        const suspend = (fn, fromPage) => new Promise((resolveSuspend) => {
            if (fromPage) page = fromPage;
            pendingSuspend = { fn, done: resolveSuspend };
            instance.unmount();
        });

        // Enter the alternate screen buffer for the dashboard. On
        // suspend, we exit it so the subprocess owns the main buffer;
        // on resume, the next loop iteration re-enters a fresh alt
        // screen. On quit, we exit and return to the main buffer.
        process.stdout.write(ENTER_ALT_SCREEN);

        // ── Resize debounce gate ─────────────────────────────────────
        // Intercept 'resize' at the emit level so NO listener (Ink's,
        // useTerminalSize's, or ours) sees intermediate events during a
        // drag burst. Only the final settled size gets through.
        const realEmit = process.stdout.emit.bind(process.stdout);
        let resizeTimer = null;
        resizeMetrics.reset();
        process.stdout.emit = function (type, ...args) {
            if (type !== "resize") return realEmit(type, ...args);
            resizeMetrics.events++;
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                resizeTimer = null;
                resizeMetrics.commits++;
                // Clear once on the settled resize, then emit so Ink
                // and useTerminalSize render the final layout.
                process.stdout.write(CLEAR_TERMINAL);
                realEmit("resize");
            }, RESIZE_SETTLE_MS);
        };

        const instance = render(h(App, { initialPage: page, suspend }), { exitOnCtrlC: true });
        instance.waitUntilExit().then(resolveExit);
        await exited;

        // Restore the original emit and clean up any pending timer.
        if (resizeTimer) clearTimeout(resizeTimer);
        process.stdout.emit = realEmit;
        restoreTerminal();

        if (!pendingSuspend) {
            process.off("exit", restoreScreen);
            return; // normal quit (q / Ctrl-C)
        }

        instance.clear();
        try {
            await pendingSuspend.fn();
        } catch (err) {
            console.error(`\n${err.message}`);
        }
        await waitForEnter("\nPress Enter to return to the dashboard...");
        pendingSuspend.done();
        // Loop: re-enter alt screen and re-render.
    }
}
