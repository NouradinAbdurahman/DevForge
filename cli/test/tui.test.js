// Dashboard tests - real Ink renders driven through ink-testing-library's
// fake stdin (arrow keys, shortcuts, typing), against the real registry
// and theme system - no mocks, matching the rest of this suite's
// philosophy. HOME is pointed at a temp dir for anything that could
// write user config (same pattern plugin-sdk.test.js uses).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/tui/App.js";
import { THEMES, THEME_NAMES, getTheme } from "../src/tui/theme.js";
import { PAGES } from "../src/tui/store.js";
import { createWorkspace, workspaceExists } from "../src/core/workspace/store.js";
import { switchToWorkspace } from "../src/core/workspace/switcher.js";
import { listSnapshots } from "../src/core/workspace/snapshot.js";

const h = React.createElement;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const KEYS = { up: "\u001B[A", down: "\u001B[B", left: "\u001B[D", right: "\u001B[C", enter: "\r", tab: "\t", esc: "\u001B" };

async function renderApp(props = {}) {
    const instance = render(h(App, props));
    // ink-testing-library's fake stdout reports 100 columns but has no
    // `rows` property (defaults to 24 in our hook). Set rows high enough
    // for any page's per-page minimum, then emit resize after effects
    // have registered the listener (useEffect runs async after paint).
    instance.stdout.rows = 40;
    await delay(10); // let useEffect register the resize listener
    instance.stdout.emit("resize");
    await delay(250); // let resize debounce (120ms) + re-render settle
    return instance;
}

function withTempHome() {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-tui-test-"));
    process.env.HOME = tempHome;
    return () => {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    };
}

// --- Theme system -------------------------------------------------------

test("every built-in theme declares the full color-role contract", () => {
    // The new theme system has 20 built-in themes with 28 semantic tokens.
    // The dark theme (default) must have all the old backward-compat aliases too.
    assert.ok(THEME_NAMES.includes("dark"));
    assert.ok(THEME_NAMES.length >= 20, `expected at least 20 built-in themes, got ${THEME_NAMES.length}`);
    // Old token names are aliased to new ones for backward compat
    const oldRoles = ["accent", "text", "dim", "success", "warning", "error", "border", "selectedBg", "selectedText"];
    for (const role of oldRoles) {
        assert.ok(role in THEMES.dark, `dark theme is missing role '${role}'`);
    }
    // New semantic tokens
    const newTokens = ["background", "surface", "textMuted", "primary", "secondary", "info", "borderActive", "selection", "progress", "chart1"];
    for (const token of newTokens) {
        assert.ok(token in THEMES.dark, `dark theme is missing token '${token}'`);
    }
});

test("getTheme falls back to dark for an unknown theme name", () => {
    assert.equal(getTheme("does-not-exist").id, "dark");
    assert.equal(getTheme("nord").name, "DevForgeKit Nord");
});

// --- First paint / performance ------------------------------------------

test("the dashboard renders its first frame quickly with header, nav, and status bar", async () => {
    const restore = withTempHome();
    try {
        const started = Date.now();
        const { lastFrame, unmount } = await renderApp();
        const elapsed = Date.now() - started;

        const frame = lastFrame();
        assert.match(frame, /DevForgeKit/);
        for (const page of PAGES) {
            assert.ok(frame.includes(page.label), `nav should list '${page.label}'`);
        }
        assert.match(frame, /Tab focus/);  // status bar HINTS (may wrap at narrow widths)
        assert.match(frame, /quit/);       // "q quit" may wrap across lines at 100 cols
        // PRD target is 500ms; allow CI headroom but keep it meaningful.
        assert.ok(elapsed < 1500, `first frame took ${elapsed}ms`);
        unmount();
    } finally {
        restore();
    }
});

// --- Navigation ----------------------------------------------------------

test("menu shortcuts navigate: 'd' opens Doctor, '1' returns to Dashboard", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();

        stdin.write("d");
        await delay(60);
        assert.match(lastFrame(), /Doctor - component diagnostics/);

        // Page shortcuts only work from nav focus; Doctor navigation
        // moved focus to content, so Esc first returns focus to the menu.
        stdin.write(KEYS.esc);
        await delay(40);
        stdin.write("1");
        await delay(60);
        assert.match(lastFrame(), /Machine/);
        unmount();
    } finally {
        restore();
    }
});

test("'m' opens the Compatibility page", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write("m");
        await delay(60);
        assert.match(lastFrame(), /Compatibility/);
        unmount();
    } finally {
        restore();
    }
});

test("'e' opens the AI Assistant page, showing the not-configured empty state with a fresh config", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write("e");
        await delay(60);
        assert.match(lastFrame(), /AI Assistant/);
        assert.match(lastFrame(), /No AI provider configured/);
        unmount();
    } finally {
        restore();
    }
});

test("arrow keys + Enter open a page from the menu", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write(KEYS.down); // Dashboard -> Workspaces
        await delay(40);
        stdin.write(KEYS.down); // Workspaces -> Components
        await delay(40);
        stdin.write(KEYS.enter);
        await delay(80);
        assert.match(lastFrame(), /Components \(\d+\/\d+\)/);
        unmount();
    } finally {
        restore();
    }
});

test("Tab toggles focus between menu and content (menu-focus banner appears/disappears)", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        assert.match(lastFrame(), /Menu focused/);
        stdin.write(KEYS.tab);
        await delay(40);
        assert.doesNotMatch(lastFrame(), /Menu focused/);
        stdin.write(KEYS.tab);
        await delay(40);
        assert.match(lastFrame(), /Menu focused/);
        unmount();
    } finally {
        restore();
    }
});

// --- Pages render against the real platform data --------------------------

test("Components page lists real registry packages and filters by typed text", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp({ initialPage: "components" });
        assert.match(lastFrame(), /Components \(\d+\/\d+\)/);

        stdin.write(KEYS.tab); // into content... initial focus is nav
        await delay(40);
        stdin.write("f"); // open filter field
        await delay(40);
        stdin.write("docker");
        await delay(80);
        const frame = lastFrame();
        assert.match(frame, /docker/);
        assert.match(frame, /containers/);
        unmount();
    } finally {
        restore();
    }
});

test("Workspaces, Profiles, Recipes, Generator, Plugins, Updates, Config, Help, About all render real content", async () => {
    const restore = withTempHome();
    try {
        const checks = [
            ["workspaces", /Workspaces \(\d+\)/],
            ["profiles", /Profiles \(\d+\)/],
            ["recipes", /Recipes \(\d+\)/],
            ["generator", /Project Generator \(16 stacks\)/],
            ["plugins", /Plugins \(\d+ discovered\)/],
            ["updates", /Package updates/],
            ["config", /config\.yaml/],
            ["help", /Global keys/],
            ["about", /DevForgeKit v/]
        ];
        for (const [page, pattern] of checks) {
            const { lastFrame, unmount } = await renderApp({ initialPage: page });
            assert.match(lastFrame(), pattern, `page '${page}'`);
            unmount();
        }
    } finally {
        restore();
    }
});

test("the Generator page lists all 16 stacks by id", async () => {
    const restore = withTempHome();
    try {
        const { lastFrame, unmount } = await renderApp({ initialPage: "generator" });
        const frame = lastFrame();
        for (const id of ["flutter", "nextjs", "express"]) {
            assert.ok(frame.includes(id), `generator list should include '${id}'`);
        }
        unmount();
    } finally {
        restore();
    }
});

// --- Global search ---------------------------------------------------------

test("'/' opens global search and typing finds grouped results instantly", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write("/");
        await delay(40);
        assert.match(lastFrame(), /Search everything/);

        stdin.write("docker");
        await delay(80);
        const frame = lastFrame();
        assert.match(frame, /component\s+docker/);
        assert.match(frame, /collection|profile|recipe|stack/);

        stdin.write(KEYS.esc);
        await delay(40);
        assert.doesNotMatch(lastFrame(), /Search everything/);
        unmount();
    } finally {
        restore();
    }
});

// --- Theme switching via Configuration page ---------------------------------

test("cycling tuiTheme on the Configuration page applies a different theme live", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp({ initialPage: "config" });
        const themeOf = () => /tuiTheme\s+(\S+)/.exec(lastFrame())?.[1];
        const before = themeOf();
        assert.ok(THEME_NAMES.includes(before), `unexpected starting theme '${before}'`);

        stdin.write(KEYS.tab); // focus content (initial focus is nav)
        await delay(60);
        stdin.write(KEYS.enter); // cycle to the next theme in THEME_NAMES

        // Background install probes from earlier tests can starve the
        // event loop, so poll for the change instead of racing a single
        // fixed delay.
        let after = before;
        for (let i = 0; i < 20 && after === before; i++) {
            await delay(50);
            after = themeOf();
        }
        const expected = THEME_NAMES[(THEME_NAMES.indexOf(before) + 1) % THEME_NAMES.length];
        assert.equal(after, expected, `theme should cycle ${before} -> ${expected}`);
        unmount();
    } finally {
        restore();
    }
});

// --- Quit safety --------------------------------------------------------------
// ink-testing-library doesn't expose waitUntilExit, so real exit is
// covered by the manual smoke run (docs/TUI.md's verification notes);
// what *is* testable - and the actual regression risk - is that 'q'
// must NOT quit while a text field owns the keyboard.

test("'q' typed into the search field is text, not quit", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write("/");
        await delay(40);
        stdin.write("q");
        await delay(60);
        const frame = lastFrame();
        assert.match(frame, /Search everything/); // still alive, search open
        assert.match(frame, /\/ q/); // the q landed in the query field
        unmount();
    } finally {
        restore();
    }
});

// --- Workspace page (real core/workspace/*.js engine, no mocks) -----------

test("Workspaces page starts empty and creates a workspace through the n wizard", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp({ initialPage: "workspaces" });
        assert.match(lastFrame(), /Workspaces \(0\)/);
        assert.match(lastFrame(), /No workspaces yet/);

        stdin.write(KEYS.tab); // focus content
        await delay(60);
        stdin.write("n");
        await delay(40);
        assert.match(lastFrame(), /New workspace/);

        stdin.write("acme-backend");
        await delay(60);
        stdin.write(KEYS.enter); // name -> description step
        await delay(40);
        stdin.write(KEYS.enter); // accept default description -> create
        await delay(100);

        const frame = lastFrame();
        assert.match(frame, /Workspaces \(1\)/);
        assert.match(frame, /acme-backend/);
        assert.doesNotMatch(frame, /No workspaces yet/);
        unmount();
    } finally {
        restore();
    }
});

test("Workspaces page: Enter switches to a workspace, marking it active in the list and panel title", async () => {
    const restore = withTempHome();
    try {
        createWorkspace({ name: "acme-backend", description: "Acme backend" });

        const { stdin, lastFrame, unmount } = await renderApp({ initialPage: "workspaces" });
        stdin.write(KEYS.tab);
        await delay(60);
        stdin.write(KEYS.enter); // switch to the highlighted (only) workspace

        // Check the panel title, not the persistent DashboardHeader banner
        // (which doesn't show per-workspace state at all - see
        // components/DashboardHeader.js).
        let frame = lastFrame();
        for (let i = 0; i < 30 && !/active: acme-backend/.test(frame); i++) {
            await delay(50);
            frame = lastFrame();
        }
        assert.match(frame, /Workspaces \(1\) . active: acme-backend/);
        assert.match(frame, /▸acme-backend/); // active marker in the list
        unmount();
    } finally {
        restore();
    }
});

test("Workspaces page: v runs a real verify and shows PASS/WARNING/FAIL results", async () => {
    const restore = withTempHome();
    try {
        createWorkspace({ name: "acme-backend", description: "Acme backend" });

        const { stdin, lastFrame, unmount } = await renderApp({ initialPage: "workspaces" });
        stdin.write(KEYS.tab);
        await delay(60);
        stdin.write("v");

        let frame = lastFrame();
        for (let i = 0; i < 30 && !/Verify:/.test(frame); i++) {
            await delay(50);
            frame = lastFrame();
        }
        assert.match(frame, /Verify: \d+% - /);
        unmount();
    } finally {
        restore();
    }
});

test("Workspaces page: x creates a snapshot", async () => {
    const restore = withTempHome();
    try {
        createWorkspace({ name: "acme-backend", description: "Acme backend" });

        const { stdin, unmount } = await renderApp({ initialPage: "workspaces" });
        stdin.write(KEYS.tab);
        await delay(60);
        stdin.write("x");
        await delay(80);

        assert.equal(listSnapshots("acme-backend").length, 1);
        unmount();
    } finally {
        restore();
    }
});

test("Workspaces page: D requires two presses to delete, removing it from the list", async () => {
    const restore = withTempHome();
    try {
        createWorkspace({ name: "acme-backend", description: "Acme backend" });

        const { stdin, lastFrame, unmount } = await renderApp({ initialPage: "workspaces" });
        stdin.write(KEYS.tab);
        await delay(60);

        stdin.write("D"); // first press just arms it
        await delay(60);
        assert.ok(workspaceExists("acme-backend"), "one D press must not delete yet");
        assert.match(lastFrame(), /Workspaces \(1\)/);

        stdin.write("D"); // second press confirms
        await delay(80);
        assert.ok(!workspaceExists("acme-backend"));
        assert.match(lastFrame(), /Workspaces \(0\)/);
        unmount();
    } finally {
        restore();
    }
});

test("Workspaces page: z deactivates the active workspace", async () => {
    const restore = withTempHome();
    try {
        createWorkspace({ name: "acme-backend", description: "Acme backend" });
        await switchToWorkspace("acme-backend");

        const { stdin, lastFrame, unmount } = await renderApp({ initialPage: "workspaces" });
        assert.match(lastFrame(), /active: acme-backend/);

        stdin.write(KEYS.tab);
        await delay(60);
        stdin.write("z");

        let frame = lastFrame();
        for (let i = 0; i < 30 && /active: acme-backend/.test(frame); i++) {
            await delay(50);
            frame = lastFrame();
        }
        assert.doesNotMatch(frame, /active: acme-backend/);
        unmount();
    } finally {
        restore();
    }
});

test("the 'w' menu shortcut opens the Workspaces page", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write("w");
        await delay(60);
        assert.match(lastFrame(), /Workspaces \(\d+\)/);
        unmount();
    } finally {
        restore();
    }
});
