// Orchestrates the DevForgeKit startup sequence (v1.2.6, docs/TUI.md):
// blank -> particles -> logo draws itself -> subtitle fades in -> real
// boot checklist -> pause -> hand off to the dashboard. Isolated from
// App.js and the dashboard on purpose - this module only ever writes
// raw frames to the terminal and knows nothing about Ink, React, or
// dashboard pages; tui/index.js calls it once, before the dashboard's
// own render() ever mounts.
//
// v1.4.1 (docs/TUI.md's "Persistent dashboard header"): the logo this
// module draws is no longer a splash that gets wiped - it's the exact
// same monogram/wordmark/tagline (down to the shared SESSION_TAGLINE
// constant) that DashboardHeader renders as the dashboard's permanent
// banner, so what's on screen when this function resolves already
// *is* what the header looks like. This function intentionally does
// NOT clear the screen at the end - see the note on the last step.
import process from "node:process";
import { buildLogoLines, WORDMARK, SESSION_TAGLINE, LOGO_LEFT_MARGIN } from "./asciiLogo.js";
import { renderParticles } from "./particleRenderer.js";
import { runLoadingSequence } from "./loadingRenderer.js";
import { writeFrame, clearFrame, hideCursor, showCursor, paint, bold, sleep } from "./transition.js";

// Step durations in ms. "fast" (reduced motion) collapses every
// artificial pause to 0 - the real boot checklist still only checks
// off as tasks actually finish, it's just not preceded/followed by any
// brand-moment padding.
const SPEEDS = {
    normal: { blank: 100, particles: 80, logoDraw: 250, subtitleFade: 80, pause: 100 },
    fast: { blank: 0, particles: 0, logoDraw: 0, subtitleFade: 0, pause: 0 }
};

export function resolveAnimationSpeed(config = {}) {
    return config.startupAnimationSpeed === "fast" ? "fast" : "normal";
}

// shouldShowAnimation({ config, env, isTTY }) -> boolean. Every disable
// path the PRD lists (non-TTY, CI, TERM=dumb, DEVFORGEKIT_NO_ANIMATION,
// startupAnimation: off) funnels through here, so index.js and tests
// share one source of truth instead of re-deriving the same checks.
export function shouldShowAnimation({ config = {}, env = process.env, isTTY = true } = {}) {
    if (!isTTY) return false;
    if (env.TERM === "dumb") return false;
    if (env.DEVFORGEKIT_NO_ANIMATION === "1") return false;
    if (config.startupAnimation === false || config.startupAnimation === "off") return false;
    if (config.startupAnimationSpeed === "off") return false;
    return true;
}

function indent(lines, left) {
    const pad = " ".repeat(Math.max(0, left));
    return lines.map((line) => pad + line);
}

// runStartupAnimation({ theme, tasks, speed, columns, rows, io }) -> Promise
// `tasks` is [{ label, run() }], the exact same shape loadingRenderer
// expects - each `run` is real initialization work (see tui/index.js),
// kicked off immediately and in parallel with the visual steps. `io`
// is an injectable bundle of the raw terminal primitives (defaults to
// the real ones in transition.js) - the same `fetchImpl`-style
// dependency-injection convention core/ai's provider clients use -
// so tests can capture frames deterministically instead of mutating
// the global process.stdout, which would race with Node's test runner
// executing other tests concurrently.
export async function runStartupAnimation({
    theme,
    tasks = [],
    speed = "normal",
    columns = process.stdout.columns || 80,
    rows = process.stdout.rows || 24,
    io = {}
} = {}) {
    const write = io.write || writeFrame;
    const clear = io.clear || clearFrame;
    const hide = io.hide || hideCursor;
    const show = io.show || showCursor;

    const timing = SPEEDS[speed] || SPEEDS.normal;
    const left = LOGO_LEFT_MARGIN;

    hide();
    try {
        // Step 1 - blank screen.
        clear();
        if (timing.blank) await sleep(timing.blank);

        // Step 2 - a brief scatter of particles (fast mode skips this
        // entirely rather than just shortening it, per the PRD).
        if (timing.particles) {
            await renderParticles({
                theme,
                width: Math.min(columns, 70),
                height: Math.max(1, Math.min(rows - 10, 8)),
                write
            });
        }

        // Step 3 - the full "DevForgeKit" logo draws itself, one row at
        // a time. Always theme.accent - the same token DashboardHeader
        // uses for the logo, so the color never shifts at handoff.
        const logo = buildLogoLines();
        const perLine = timing.logoDraw ? Math.round(timing.logoDraw / logo.length) : 0;
        const revealed = [];
        for (const line of logo) {
            revealed.push(paint(theme?.accent, line));
            write(indent(revealed, left));
            if (perLine) await sleep(perLine);
        }
        const logoLines = logo.map((line) => paint(theme?.accent, line));

        // Step 4 - subtitle fades in (wordmark, then wordmark + tagline).
        // SESSION_TAGLINE (not a fresh pickTagline() call) so this is
        // the exact same tagline DashboardHeader shows a moment later.
        const tagline = SESSION_TAGLINE;
        const wordmarkLine = bold(paint(theme?.text, WORDMARK));
        const taglineLine = paint(theme?.textMuted, tagline);
        if (timing.subtitleFade) {
            write(indent([...logoLines, "", paint(theme?.textDisabled, WORDMARK)], left));
            await sleep(timing.subtitleFade / 2);
        }
        write(indent([...logoLines, "", wordmarkLine, taglineLine], left));
        if (timing.subtitleFade) await sleep(timing.subtitleFade / 2);

        // Step 5 - the real boot checklist. Tasks already started
        // running the instant this function was called (tui/index.js
        // builds `tasks` and passes them in up front), so if they've
        // already settled by now every line renders checked immediately.
        const header = [...logoLines, "", wordmarkLine, taglineLine, ""];
        await runLoadingSequence({
            theme,
            tasks,
            write: (loadingLines) => write(indent([...header, ...loadingLines], left))
        });

        // Step 6 - a short pause so the final checkmark is readable.
        if (timing.pause) await sleep(timing.pause);

        // Step 7 - hand off to the dashboard. Deliberately no clear()
        // here: the PRD calls for the logo to become the header, not
        // to flash to blank first. Ink's own first render still repaints
        // the whole screen the instant it mounts (any full-screen Ink
        // app does this on mount - it's Ink's own behavior, not
        // something this module controls), but we don't add a second,
        // purely decorative blank-then-redraw on top of that - what's
        // left on screen when this resolves is already the same
        // logo/wordmark/tagline DashboardHeader is about to render.
    } finally {
        show();
    }
}
