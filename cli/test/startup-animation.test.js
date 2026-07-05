// Tests for the startup animation (v1.2.6, docs/TUI.md): the gating
// logic (shouldShowAnimation/resolveAnimationSpeed), the pure building
// blocks (asciiLogo, particleRenderer, loadingRenderer), and the
// orchestrator's timing/safety guarantees (fast mode is near-instant,
// cursor/terminal state is restored even when a task throws).
//
// Frames are captured via the injectable `io`/`write` overrides
// (startupAnimation.js's `io` param, particleRenderer's/
// loadingRenderer's `write` param) rather than by stubbing the global
// process.stdout.write - Node's test runner executes tests in the
// same file concurrently by default, so a global stub would race with
// unrelated tests' own output and silently swallow their results.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowAnimation, resolveAnimationSpeed, runStartupAnimation } from "../src/tui/startup/startupAnimation.js";
import { buildLogoLines, pickTagline, logoWidth, TAGLINES, WORDMARK, SESSION_TAGLINE } from "../src/tui/startup/asciiLogo.js";
import { buildParticleFrame, renderParticles } from "../src/tui/startup/particleRenderer.js";
import { formatLoadingLine, runLoadingSequence } from "../src/tui/startup/loadingRenderer.js";
import { getTheme } from "../src/tui/theme.js";

function fakeIo() {
    const frames = [];
    let hidden = false;
    let shown = false;
    return {
        frames,
        io: {
            write: (lines) => { frames.push(lines.join("\n")); },
            clear: () => { frames.push("<clear>"); },
            hide: () => { hidden = true; },
            show: () => { shown = true; }
        },
        get hidden() { return hidden; },
        get shown() { return shown; }
    };
}

// --- shouldShowAnimation / resolveAnimationSpeed ------------------------

test("shouldShowAnimation is on by default on a capable TTY", () => {
    assert.equal(shouldShowAnimation({ config: {}, env: {}, isTTY: true }), true);
});

test("shouldShowAnimation is off for a non-TTY (pipes, CI)", () => {
    assert.equal(shouldShowAnimation({ config: {}, env: {}, isTTY: false }), false);
});

test("shouldShowAnimation is off for TERM=dumb", () => {
    assert.equal(shouldShowAnimation({ config: {}, env: { TERM: "dumb" }, isTTY: true }), false);
});

test("shouldShowAnimation is off for DEVFORGEKIT_NO_ANIMATION=1", () => {
    assert.equal(shouldShowAnimation({ config: {}, env: { DEVFORGEKIT_NO_ANIMATION: "1" }, isTTY: true }), false);
});

test("shouldShowAnimation is off when config.startupAnimation is false or \"off\"", () => {
    assert.equal(shouldShowAnimation({ config: { startupAnimation: false }, env: {}, isTTY: true }), false);
    assert.equal(shouldShowAnimation({ config: { startupAnimation: "off" }, env: {}, isTTY: true }), false);
});

test("shouldShowAnimation is off when config.startupAnimationSpeed is \"off\"", () => {
    assert.equal(shouldShowAnimation({ config: { startupAnimationSpeed: "off" }, env: {}, isTTY: true }), false);
});

test("resolveAnimationSpeed reads startupAnimationSpeed, defaulting to normal", () => {
    assert.equal(resolveAnimationSpeed({}), "normal");
    assert.equal(resolveAnimationSpeed({ startupAnimationSpeed: "fast" }), "fast");
    assert.equal(resolveAnimationSpeed({ startupAnimationSpeed: "normal" }), "normal");
    assert.equal(resolveAnimationSpeed({ startupAnimationSpeed: "bogus" }), "normal");
});

// --- asciiLogo -----------------------------------------------------------

test("the logo is a fixed 8-row ASCII art block, uniform width, every row the same length", () => {
    const lines = buildLogoLines();
    assert.equal(lines.length, 8);
    const width = logoWidth();
    assert.equal(width, 53);
    for (const line of lines) assert.equal(line.length, width);
});

test("buildLogoLines returns the exact same array every call (a fixed asset, not regenerated)", () => {
    assert.deepEqual(buildLogoLines(), buildLogoLines());
});

test("pickTagline is deterministic given a seed and always returns a known tagline", () => {
    assert.equal(pickTagline(0), TAGLINES[0]);
    for (const seed of [0, 0.25, 0.5, 0.75, 0.99]) {
        assert.ok(TAGLINES.includes(pickTagline(seed)));
    }
});

test("WORDMARK is the platform name", () => {
    assert.equal(WORDMARK, "DevForgeKit");
});

// --- particleRenderer ------------------------------------------------------

test("buildParticleFrame returns the requested dimensions with only glyphs or spaces", () => {
    const rng = (() => { let i = 0; const seq = [0.01, 0.5, 0.01, 0.9, 0.01, 0.5]; return () => seq[i++ % seq.length]; })();
    const frame = buildParticleFrame(6, 3, 0.5, rng);
    assert.equal(frame.length, 3);
    for (const line of frame) {
        assert.equal(line.length, 6);
        assert.match(line, /^[ .·∙•]+$/);
    }
});

test("buildParticleFrame with density 0 renders an all-blank frame", () => {
    const frame = buildParticleFrame(10, 2, 0, () => 0.99);
    for (const line of frame) assert.equal(line, " ".repeat(10));
});

test("renderParticles paints roughly one frame per frameMs over its duration", async () => {
    const theme = getTheme("dark");
    const { frames, io } = fakeIo();
    await renderParticles({ theme, width: 10, height: 2, durationMs: 40, frameMs: 20, rng: () => 0.01, write: io.write });
    assert.ok(frames.length >= 1, "should have painted at least one frame");
    assert.ok(frames.length <= 4, `expected ~2 frames for 40ms/20ms, got ${frames.length}`);
});

// --- loadingRenderer ---------------------------------------------------

test("formatLoadingLine shows a pending marker and a checkmark when done", () => {
    const theme = getTheme("dark");
    assert.match(formatLoadingLine("Loading registry", false, theme), /Loading registry/);
    assert.match(formatLoadingLine("Loading registry", false, theme), /…/);
    assert.match(formatLoadingLine("Loading registry", true, theme), /✓/);
});

test("runLoadingSequence resolves once every task settles and reports each as done", async () => {
    const theme = getTheme("dark");
    let writes = 0;
    const tasks = [
        { label: "A", run: () => new Promise((r) => setTimeout(r, 10)) },
        { label: "B", run: () => undefined }, // resolves instantly
        { label: "C", run: () => new Promise((r) => setTimeout(r, 20)) }
    ];
    const state = await runLoadingSequence({ tasks, theme, pollMs: 5, write: () => { writes++; } });
    assert.equal(state.length, 3);
    for (const s of state) assert.equal(s.done, true);
    assert.ok(writes >= 1);
});

test("a failing task is recorded but does not hang the rest of the checklist", async () => {
    const theme = getTheme("dark");
    const tasks = [
        { label: "ok", run: () => undefined },
        { label: "boom", run: () => { throw new Error("nope"); } }
    ];
    const state = await runLoadingSequence({ tasks, theme, pollMs: 5, write: () => {} });
    assert.equal(state[0].done, true);
    assert.equal(state[0].error, null);
    assert.equal(state[1].done, true);
    assert.ok(state[1].error instanceof Error);
});

test("already-resolved tasks render checked without an artificial wait", async () => {
    const theme = getTheme("dark");
    const tasks = [{ label: "instant", run: () => undefined }];
    const started = Date.now();
    await runLoadingSequence({ tasks, theme, pollMs: 30, write: () => {} });
    assert.ok(Date.now() - started < 60, "should not wait a full poll cycle for already-done work");
});

// --- runStartupAnimation (orchestrator) ---------------------------------

test("fast mode completes in well under a second and shows every task checked", async () => {
    const theme = getTheme("dark");
    const tasks = [
        { label: "Loading registry", run: () => undefined },
        { label: "Loading plugins", run: () => undefined }
    ];
    const { frames, io } = fakeIo();
    const started = Date.now();
    await runStartupAnimation({ theme, tasks, speed: "fast", columns: 80, rows: 24, io });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 500, `fast mode took ${elapsed}ms`);
    assert.ok(frames.some((f) => f.includes("✓")), "should render a checked task at some point");
});

test("normal mode never exceeds the PRD's one-second budget", async () => {
    const theme = getTheme("dark");
    const tasks = [{ label: "Loading registry", run: () => undefined }];
    const { io } = fakeIo();
    const started = Date.now();
    await runStartupAnimation({ theme, tasks, speed: "normal", columns: 80, rows: 24, io });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1000, `normal mode took ${elapsed}ms`);
    assert.ok(elapsed >= 400, `normal mode should include its brand-moment pacing, took ${elapsed}ms`);
});

test("cursor is hidden then restored even if a task throws (no terminal corruption)", async () => {
    const theme = getTheme("dark");
    const tasks = [{ label: "boom", run: () => { throw new Error("init failed"); } }];
    const fake = fakeIo();
    await runStartupAnimation({ theme, tasks, speed: "fast", columns: 80, rows: 24, io: fake.io });
    assert.equal(fake.hidden, true, "should hide the cursor on entry");
    assert.equal(fake.shown, true, "should restore the cursor even after a failing task");
});

test("runStartupAnimation never throws when a task rejects", async () => {
    const theme = getTheme("dark");
    const tasks = [{ label: "boom", run: () => Promise.reject(new Error("nope")) }];
    const { io } = fakeIo();
    await runStartupAnimation({ theme, tasks, speed: "fast", columns: 80, rows: 24, io });
});

test("step 7 hands off without an extra clear - the logo/wordmark stay on screen for the header to inherit", async () => {
    const theme = getTheme("dark");
    const tasks = [{ label: "Loading registry", run: () => undefined }];
    const { frames, io } = fakeIo();
    await runStartupAnimation({ theme, tasks, speed: "fast", columns: 80, rows: 24, io });
    // Exactly one clear (step 1's blank screen) - none added at the end.
    assert.equal(frames.filter((f) => f === "<clear>").length, 1);
    assert.notEqual(frames[frames.length - 1], "<clear>");
    assert.ok(frames[frames.length - 1].includes("DevForgeKit"));
});

test("the startup animation's tagline matches SESSION_TAGLINE (continuity with the persistent header)", async () => {
    const theme = getTheme("dark");
    const tasks = [{ label: "Loading registry", run: () => undefined }];
    const { frames, io } = fakeIo();
    await runStartupAnimation({ theme, tasks, speed: "fast", columns: 80, rows: 24, io });
    assert.ok(frames.some((f) => f.includes(SESSION_TAGLINE)));
});
