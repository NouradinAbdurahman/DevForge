// v2.0.5: reduced-motion preference - a dedicated context (mirroring
// useTerminalSize.js's pattern), read once at launch from config.yaml,
// and Spinner's response to it (static glyph, no animation interval).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { render } from "ink-testing-library";
import { h, Spinner } from "../src/tui/components/ui.js";
import { ReducedMotionProvider, useReducedMotion } from "../src/tui/hooks/useReducedMotion.js";
import { TerminalSizeProvider } from "../src/tui/hooks/useTerminalSize.js";
import { getTheme } from "../src/tui/theme.js";
import { setConfigValue } from "../src/core/config.js";

const theme = getTheme("dark");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTempHome() {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-reduced-motion-test-"));
    process.env.HOME = tempHome;
    return () => {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    };
}

test("useReducedMotion defaults to false when config has no reducedMotion field", () => {
    const restore = withTempHome();
    try {
        let captured;
        function Probe() {
            captured = useReducedMotion();
            return null;
        }
        const { unmount } = render(h(ReducedMotionProvider, null, h(Probe)));
        assert.equal(captured, false);
        unmount();
    } finally {
        restore();
    }
});

test("useReducedMotion reflects config.reducedMotion:true", () => {
    const restore = withTempHome();
    try {
        setConfigValue("reducedMotion", true);
        let captured;
        function Probe() {
            captured = useReducedMotion();
            return null;
        }
        const { unmount } = render(h(ReducedMotionProvider, null, h(Probe)));
        assert.equal(captured, true);
        unmount();
    } finally {
        restore();
    }
});

test("Spinner animates across frames by default (motion not reduced)", async () => {
    const restore = withTempHome();
    try {
        const { lastFrame, unmount } = render(
            h(TerminalSizeProvider, null, h(ReducedMotionProvider, null, h(Spinner, { theme }))));
        const first = lastFrame();
        await delay(250);
        const second = lastFrame();
        assert.notEqual(first, second, "spinner glyph should change after a frame interval by default");
        unmount();
    } finally {
        restore();
    }
});

test("Spinner shows a static glyph and never changes when reducedMotion is true", async () => {
    const restore = withTempHome();
    try {
        setConfigValue("reducedMotion", true);
        const { lastFrame, unmount } = render(
            h(TerminalSizeProvider, null, h(ReducedMotionProvider, null, h(Spinner, { theme }))));
        const first = lastFrame();
        await delay(250);
        const second = lastFrame();
        assert.equal(first, second, "spinner glyph must stay fixed when reducedMotion is true");
        unmount();
    } finally {
        restore();
    }
});
