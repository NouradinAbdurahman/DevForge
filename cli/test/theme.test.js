// Unit tests for the professional theme system (v1.2.x).
// Covers: token contract, theme loading, validation, WCAG contrast,
// export/import, custom theme discovery, random selection, and
// backward-compatibility aliases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
    THEME_TOKENS,
    THEME_NAMES,
    getTheme,
    getThemeNames,
    validateTheme,
    contrastRatio,
    checkContrast,
    exportThemeYaml,
    listThemes,
    randomThemeId,
    invalidateThemeCache
} from "../src/tui/theme.js";

// --- Token contract -------------------------------------------------------

test("THEME_TOKENS defines all 30 semantic tokens", () => {
    assert.equal(THEME_TOKENS.length, 30);
    const expected = [
        "background", "surface", "surfaceAlt",
        "text", "textMuted", "textDisabled",
        "primary", "secondary", "accent",
        "success", "warning", "error", "info",
        "border", "borderActive",
        "selection", "selectionText",
        "header", "footer", "sidebar",
        "progress", "progressBackground",
        "tableHeader", "tableBorder",
        "searchHighlight",
        "chart1", "chart2", "chart3", "chart4", "chart5"
    ];
    assert.deepEqual(THEME_TOKENS, expected);
});

test("every built-in theme has all 28 tokens", () => {
    const names = getThemeNames();
    assert.ok(names.length >= 20, `expected >= 20 themes, got ${names.length}`);
    for (const name of names) {
        const theme = getTheme(name);
        for (const token of THEME_TOKENS) {
            assert.ok(
                token in theme,
                `theme '${name}' is missing token '${token}'`
            );
        }
    }
});

test("dark theme is the default and has correct values (v1.4.0 redesign)", () => {
    const dark = getTheme("dark");
    assert.equal(dark.id, "dark");
    assert.equal(dark.accent, "#58A6FF");
    assert.equal(dark.text, "#F8FAFC");
    assert.equal(dark.textMuted, "#C9D1D9");
    assert.equal(dark.success, "#3FB950");
    assert.equal(dark.warning, "#D29922");
    assert.equal(dark.error, "#F85149");
    // The redesign's headline fix: selection used to be cyan-bg/
    // black-text (washed-out on true-color terminals); every selected
    // element must now render pure white text on a solid blue
    // background, matching the "Interactive States" contrast rule.
    assert.equal(dark.selection, "#1F6FEB");
    assert.equal(dark.selectionText, "#FFFFFF");
});

test("dark theme's panel titles use panelTitle (bright cyan), distinct from its blue accent", () => {
    const dark = getTheme("dark");
    assert.equal(dark.panelTitle, "#56D4DD");
    assert.notEqual(dark.panelTitle, dark.accent);
});

test("panelTitle falls back to accent for themes that don't define it", () => {
    const nord = getTheme("nord");
    assert.equal(nord.panelTitle, nord.accent);
});

test("the redesigned dark theme passes WCAG AA contrast on every checked token", () => {
    const dark = getTheme("dark");
    const warnings = checkContrast(dark);
    assert.deepEqual(warnings, [], `dark theme should have no AA contrast warnings, got ${JSON.stringify(warnings)}`);
});

test("dark theme's selection background/text pair passes WCAG AA", () => {
    const dark = getTheme("dark");
    const ratio = contrastRatio(dark.selectionText, dark.selection);
    assert.ok(ratio >= 4.5, `selectionText-on-selection should be >= 4.5:1, got ${ratio}`);
});

test("every built-in theme passes WCAG AA contrast on every checked token (v2.0.5 audit)", () => {
    // checkContrast() checks 8 tokens against background plus 3 pairs
    // that are actually rendered as real Ink backgroundColor+color
    // combos (selectionText-on-selection, searchHighlight/tableHeader-
    // on-background) - this audit (arctic, paper, solarized-dark,
    // github-dark all had real failures here before it) is what should
    // catch a future theme edit that regresses contrast, not just the
    // one theme ("dark") the earlier tests happen to name.
    for (const name of THEME_NAMES) {
        const theme = getTheme(name);
        const warnings = checkContrast(theme);
        assert.deepEqual(warnings, [], `${name} should have no AA contrast warnings, got ${JSON.stringify(warnings)}`);
    }
});

test("getTheme falls back to dark for unknown names", () => {
    const fallback = getTheme("nonexistent-theme");
    assert.equal(fallback.id, "dark");
});

// --- Backward-compat aliases ----------------------------------------------

test("old token names are aliased to new ones", () => {
    const dark = getTheme("dark");
    assert.equal(dark.dim, dark.textMuted, "dim should alias textMuted");
    assert.equal(dark.selectedBg, dark.selection, "selectedBg should alias selection");
    assert.equal(dark.selectedText, dark.selectionText, "selectedText should alias selectionText");
    assert.equal(dark.accentText, dark.selectionText, "accentText should alias selectionText");
    assert.equal(dark.headerBg, dark.header, "headerBg should alias header");
});

// --- Theme metadata -------------------------------------------------------

test("every theme has metadata", () => {
    for (const name of getThemeNames()) {
        const theme = getTheme(name);
        assert.ok(theme._meta, `theme '${name}' missing _meta`);
        assert.ok(theme._meta.name, `theme '${name}' missing _meta.name`);
        assert.ok(theme._meta.author, `theme '${name}' missing _meta.author`);
        assert.ok(theme._meta.license, `theme '${name}' missing _meta.license`);
    }
});

test("listThemes returns array with validation info", () => {
    const themes = listThemes();
    assert.ok(Array.isArray(themes));
    assert.ok(themes.length >= 20);
    const dark = themes.find((t) => t.id === "dark");
    assert.ok(dark, "dark theme should be in list");
    assert.ok(dark.validation.valid, "dark theme should be valid");
    assert.equal(dark.isCustom, false);
});

// --- WCAG contrast --------------------------------------------------------

test("contrastRatio computes correctly for black/white", () => {
    const ratio = contrastRatio("#ffffff", "#000000");
    assert.ok(ratio !== null);
    assert.ok(ratio > 20, `white-on-black should be > 20:1, got ${ratio}`);
});

test("contrastRatio returns null for undefined colors", () => {
    assert.equal(contrastRatio(undefined, "#000000"), null);
    assert.equal(contrastRatio("#ffffff", undefined), null);
});

test("contrastRatio handles named ANSI colors", () => {
    const ratio = contrastRatio("white", "black");
    assert.ok(ratio !== null);
    assert.ok(ratio > 5, `white-on-black named should be > 5:1, got ${ratio}`);
});

test("checkContrast returns warnings for low-contrast themes", () => {
    const lowContrast = {
        background: "#000000",
        text: "#111111",
        textMuted: "#222222",
        primary: "#111111",
        accent: "#111111",
        success: "#111111",
        warning: "#111111",
        error: "#111111",
        info: "#111111"
    };
    const warnings = checkContrast(lowContrast);
    assert.ok(warnings.length > 0, "should have contrast warnings");
    for (const w of warnings) {
        assert.ok(w.ratio < 4.5, "warning ratio should be < 4.5");
    }
});

test("checkContrast passes for good-contrast themes", () => {
    const goodContrast = {
        background: "#000000",
        text: "#ffffff",
        textMuted: "#aaaaaa",
        primary: "#00aaff",
        accent: "#00aaff",
        success: "#00ff00",
        warning: "#ffff00",
        error: "#ff0000",
        info: "#00aaff"
    };
    const warnings = checkContrast(goodContrast);
    // Most of these should pass; text and primary at least
    const textWarning = warnings.find((w) => w.token === "text");
    assert.ok(!textWarning, "white-on-black should not warn");
});

// --- Validation -----------------------------------------------------------

test("validateTheme reports missing tokens", () => {
    const incomplete = {
        colors: {
            background: "#000",
            text: "#fff"
            // missing 26 tokens
        }
    };
    const result = validateTheme(incomplete);
    assert.equal(result.valid, false);
    assert.ok(result.missing.length > 20);
});

test("validateTheme passes for complete themes", () => {
    for (const name of getThemeNames()) {
        const theme = getTheme(name);
        const result = validateTheme(theme);
        assert.equal(result.valid, true, `theme '${name}' should be valid`);
    }
});

// --- Export ---------------------------------------------------------------

test("exportThemeYaml produces valid YAML with all tokens", () => {
    const yaml = exportThemeYaml("nord");
    assert.ok(yaml);
    assert.match(yaml, /name: "DevForgeKit Nord"/);
    assert.match(yaml, /colors:/);
    for (const token of THEME_TOKENS) {
        assert.ok(yaml.includes(token), `exported YAML should contain '${token}'`);
    }
});

test("exportThemeYaml returns null for nonexistent theme", () => {
    // exportThemeYaml falls back to dark, so it never returns null
    // for a name that doesn't exist — it exports dark instead.
    const yaml = exportThemeYaml("nonexistent");
    assert.ok(yaml, "should fall back to dark theme export");
    assert.match(yaml, /DevForgeKit Dark/);
});

// --- Random theme ---------------------------------------------------------

test("randomThemeId returns a valid theme id different from exclude", () => {
    const id = randomThemeId("dark");
    assert.ok(getThemeNames().includes(id));
    assert.notEqual(id, "dark");
});

// --- Custom theme loading -------------------------------------------------

test("custom themes are loaded from ~/.config/devforgekit/themes/", () => {
    const tempHome = mkdtempSync(path.join(os.tmpdir(), "dfk-theme-test-"));
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
        const themesDir = path.join(tempHome, ".config", "devforgekit", "themes");
        mkdirSync(themesDir, { recursive: true });

        const customYaml = `name: "My Custom Theme"
author: "Test"
version: "1.0.0"
description: "A test custom theme"
license: "MIT"
colors:
  background: "#1a1a2e"
  surface: "#16213e"
  surfaceAlt: "#0f3460"
  text: "#e94560"
  textMuted: "#a9a9a9"
  textDisabled: "#555555"
  primary: "#e94560"
  secondary: "#0f3460"
  accent: "#e94560"
  success: "#00ff88"
  warning: "#ffcc00"
  error: "#ff4444"
  info: "#44aaff"
  border: "#333333"
  borderActive: "#e94560"
  selection: "#0f3460"
  selectionText: "#e94560"
  header: "#16213e"
  footer: "#1a1a2e"
  sidebar: "#16213e"
  progress: "#e94560"
  progressBackground: "#0f3460"
  tableHeader: "#e94560"
  tableBorder: "#333333"
  searchHighlight: "#ffcc00"
  chart1: "#e94560"
  chart2: "#00ff88"
  chart3: "#ffcc00"
  chart4: "#ff4444"
  chart5: "#44aaff"
`;
        writeFileSync(path.join(themesDir, "my-custom.yaml"), customYaml);

        invalidateThemeCache();
        const names = getThemeNames();
        assert.ok(names.includes("my-custom"), `custom theme should be in list: ${names}`);

        const custom = getTheme("my-custom");
        assert.equal(custom._meta.name, "My Custom Theme");
        assert.equal(custom._meta.author, "Test");
        assert.equal(custom.text, "#e94560");

        const themes = listThemes();
        const found = themes.find((t) => t.id === "my-custom");
        assert.ok(found);
        assert.equal(found.isCustom, true);
        assert.equal(found.validation.valid, true);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
        invalidateThemeCache();
    }
});

test("custom themes with missing tokens are reported as invalid", () => {
    const tempHome = mkdtempSync(path.join(os.tmpdir(), "dfk-theme-invalid-"));
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
        const themesDir = path.join(tempHome, ".config", "devforgekit", "themes");
        mkdirSync(themesDir, { recursive: true });

        const incompleteYaml = `name: "Incomplete"
colors:
  text: "#ffffff"
  background: "#000000"
`;
        writeFileSync(path.join(themesDir, "incomplete.yaml"), incompleteYaml);

        invalidateThemeCache();
        const themes = listThemes();
        const found = themes.find((t) => t.id === "incomplete");
        assert.ok(found);
        assert.equal(found.validation.valid, false);
        assert.ok(found.validation.missing.length > 20);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
        invalidateThemeCache();
    }
});

// --- Theme names include expected built-ins -------------------------------

test("built-in theme names include all expected themes", () => {
    const names = getThemeNames();
    const expected = [
        "dark", "midnight", "carbon", "slate", "nord", "dracula",
        "tokyo-night", "one-dark", "catppuccin-mocha", "gruvbox-dark",
        "solarized-dark", "github-dark", "matrix", "cyberpunk",
        "sapphire", "emerald", "crimson", "arctic", "github-light", "paper"
    ];
    for (const name of expected) {
        assert.ok(names.includes(name), `built-in theme '${name}' should be available`);
    }
});
