// The dashboard's professional theme system (v1.2.x, see docs/TUI.md).
// A theme is a plain object of 30 named semantic color tokens consumed by
// every component through the store's `theme` field. Built-in themes are
// defined in themes/builtin.js; custom themes are loaded from
// ~/.config/devforgekit/themes/*.yaml. The `dark` theme is the default;
// as of the v1.4.0 redesign it carries a real hex palette like every
// other built-in theme, rather than the original undefined/named-ANSI
// placeholders.
//
// Colors are Ink <Text color=...> values: named ANSI colors or hex strings.
// Named colors degrade gracefully on 16-color terminals; hex gives precise
// control on true-color emulators. `undefined` means "don't set" (use the
// terminal's default background/foreground).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { BUILTIN_THEMES } from "./themes/builtin.js";

// The 28 semantic color tokens every theme must define.
export const THEME_TOKENS = [
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

// Backward-compatibility aliases: old token name → new token name.
// This lets the existing components (which use the old names like
// `theme.dim`, `theme.selectedBg`) work unchanged while we migrate
// them to the new semantic tokens.
const OLD_TOKEN_ALIASES = {
    dim: "textMuted",
    accentText: "selectionText",
    selectedBg: "selection",
    selectedText: "selectionText",
    headerBg: "header"
};

// Convert a hex color (#rgb, #rrggbb) to { r, g, b } for contrast math.
function hexToRgb(hex) {
    const m = /^#?([a-f0-9]{3}|[a-f0-9]{6})$/i.exec(hex);
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16)
    };
}

// Known ANSI named colors → approximate RGB for contrast calculation.
const NAMED_RGB = {
    black: { r: 0, g: 0, b: 0 },
    red: { r: 205, g: 0, b: 0 },
    green: { r: 0, g: 205, b: 0 },
    yellow: { r: 205, g: 205, b: 0 },
    blue: { r: 0, g: 0, b: 238 },
    magenta: { r: 205, g: 0, b: 205 },
    cyan: { r: 0, g: 205, b: 205 },
    white: { r: 229, g: 229, b: 229 },
    gray: { r: 128, g: 128, b: 128 },
    grey: { r: 128, g: 128, b: 128 },
    redBright: { r: 255, g: 85, b: 85 },
    greenBright: { r: 85, g: 255, b: 85 },
    yellowBright: { r: 255, g: 255, b: 85 },
    blueBright: { r: 85, g: 85, b: 255 },
    magentaBright: { r: 255, g: 85, b: 255 },
    cyanBright: { r: 85, g: 255, b: 255 },
    whiteBright: { r: 255, g: 255, b: 255 },
    blackBright: { r: 128, g: 128, b: 128 }
};

function colorToRgb(color) {
    if (!color || color === "transparent") return null;
    const named = NAMED_RGB[color];
    if (named) return named;
    return hexToRgb(color);
}

function relativeLuminance({ r, g, b }) {
    const f = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// WCAG contrast ratio between two colors (1:1 to 21:1).
export function contrastRatio(fg, bg) {
    const fgRgb = colorToRgb(fg);
    const bgRgb = colorToRgb(bg);
    if (!fgRgb || !bgRgb) return null;
    const l1 = relativeLuminance(fgRgb);
    const l2 = relativeLuminance(bgRgb);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
}

// Check text-vs-background contrast for a theme, returning warnings
// for any pair that falls below WCAG AA (4.5:1 for normal text).
export function checkContrast(themeColors) {
    const warnings = [];
    const bg = themeColors.background || "#000000";
    const pairs = [
        ["text", bg],
        ["textMuted", bg],
        ["primary", bg],
        ["accent", bg],
        ["success", bg],
        ["warning", bg],
        ["error", bg],
        ["info", bg],
        // Pairs actually rendered as real Ink backgroundColor+color (not
        // just checked against the page background) - every selected
        // list row across the whole dashboard (SelectList, Nav, Command
        // Palette...) renders selectionText-on-selection, and matched
        // search/filter text renders in searchHighlight - both were
        // previously unchecked, so a theme could ship an unreadable
        // selected row and this function would report it as clean.
        ["selectionText", themeColors.selection || bg, "selectionText-on-selection"],
        ["searchHighlight", bg, "searchHighlight-on-background"],
        ["tableHeader", bg, "tableHeader-on-background"]
    ];
    for (const [token, bgColor, label] of pairs) {
        const fg = themeColors[token];
        if (!fg) continue;
        const ratio = contrastRatio(fg, bgColor);
        if (ratio !== null && ratio < 4.5) {
            warnings.push({
                token: label || token,
                ratio: Math.round(ratio * 100) / 100,
                level: ratio < 3 ? "AA-fail" : "AA-large-only"
            });
        }
    }
    return warnings;
}

// Validate that a theme object has all required tokens.
// Returns { valid, missing, warnings }.
export function validateTheme(themeObj) {
    const colors = themeObj.colors || themeObj;
    const missing = THEME_TOKENS.filter((t) => !(t in colors));
    const warnings = checkContrast(colors);
    return {
        valid: missing.length === 0,
        missing,
        warnings
    };
}

// Load custom themes from ~/.config/devforgekit/themes/*.yaml
// Returns an array of theme objects in the same format as BUILTIN_THEMES.
function loadCustomThemes() {
    const dir = path.join(os.homedir(), ".config", "devforgekit", "themes");
    if (!existsSync(dir)) return [];
    const themes = [];
    for (const file of readdirSync(dir)) {
        if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
        try {
            const content = readFileSync(path.join(dir, file), "utf8");
            themes.push(parseYamlTheme(content, file));
        } catch {
            // Skip unreadable/invalid custom themes silently — the
            // built-in themes always work.
        }
    }
    return themes;
}

// Minimal YAML parser for theme files. Theme YAML is simple enough
// (flat key: value under `colors:` and top-level metadata) that we
// don't need a full YAML parser — just enough to handle:
//   name: "My Theme"
//   colors:
//     text: "#ff0000"
//     border: "gray"
function parseYamlTheme(content, filename) {
    const lines = content.split("\n");
    const theme = { colors: {} };
    let inColors = false;
    for (const line of lines) {
        const trimmed = line.trimEnd();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const indent = line.length - line.trimStart().length;
        if (indent === 0) {
            inColors = false;
            const m = /^(\w+):\s*(.*)$/.exec(trimmed);
            if (!m) continue;
            if (m[1] === "colors") {
                inColors = true;
            } else {
                theme[m[1]] = stripQuotes(m[2]);
            }
        } else if (inColors) {
            const m = /^\s+(\w+):\s*(.*)$/.exec(trimmed);
            if (!m) continue;
            const val = stripQuotes(m[2]);
            theme.colors[m[1]] = val === "undefined" ? undefined : val;
        }
    }
    if (!theme.id) {
        theme.id = path.basename(filename, path.extname(filename));
    }
    return theme;
}

function stripQuotes(s) {
    if (!s) return s;
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
    }
    return s;
}

// Build the merged themes map: built-in + custom, with backward-compat
// aliases added so old component code (theme.dim, theme.selectedBg, etc.)
// works unchanged.
function buildThemesMap() {
    const map = {};
    const all = [...BUILTIN_THEMES, ...loadCustomThemes()];
    for (const t of all) {
        const colors = { ...t.colors };
        // Add backward-compat aliases
        for (const [oldName, newName] of Object.entries(OLD_TOKEN_ALIASES)) {
            if (colors[oldName] === undefined && colors[newName] !== undefined) {
                colors[oldName] = colors[newName];
            }
        }
        // panelTitle is an optional, extended token (not in THEME_TOKENS,
        // so no theme is required to define it): a theme can give panel
        // titles their own color distinct from the general accent (the
        // v1.4.0 redesign's "dark" theme uses a bright cyan here, apart
        // from its blue accent/border-focus color); anything that
        // doesn't define it just keeps using accent, unchanged.
        if (colors.panelTitle === undefined) colors.panelTitle = colors.accent;
        // Include metadata on the theme object for listing/preview
        colors.name = t.name || t.id;
        colors.id = t.id;
        colors._meta = {
            name: t.name || t.id,
            author: t.author || "unknown",
            version: t.version || "1.0.0",
            description: t.description || "",
            homepage: t.homepage || "",
            license: t.license || "MIT"
        };
        map[t.id] = colors;
    }
    return map;
}

let _themesCache = null;
function getThemesMap() {
    if (!_themesCache) _themesCache = buildThemesMap();
    return _themesCache;
}

// Invalidate the cache — used by tests and after theme import.
export function invalidateThemeCache() {
    _themesCache = null;
}

// THEMES — backward-compat export (the old name the store and tests use).
// This is a getter so that custom themes loaded after first import are
// still visible.
export function getThemes() {
    return getThemesMap();
}

// THEME_NAMES — backward-compat export.
export function getThemeNames() {
    return Object.keys(getThemesMap());
}

// For tests that import THEME_NAMES directly, we provide a proxy
// that delegates array methods to the live names array.
// Most code should use getThemeNames() / getThemes() instead.
export const THEME_NAMES = new Proxy([], {
    get(_, prop) {
        const names = getThemeNames();
        if (prop === "length") return names.length;
        if (typeof prop === "string" && /^\d+$/.test(prop)) return names[Number(prop)];
        if (prop === Symbol.iterator) return function* () { yield* names; };
        // Delegate array methods (includes, indexOf, sort, find, etc.)
        if (typeof names[prop] === "function") {
            return names[prop].bind(names);
        }
        return names[prop];
    },
    has(_, prop) {
        return getThemeNames().includes(prop);
    }
});

// THEMES proxy for direct import compatibility
export const THEMES = new Proxy({}, {
    get(_, prop) {
        return getThemesMap()[prop];
    },
    ownKeys() {
        return Reflect.ownKeys(getThemesMap());
    },
    has(_, prop) {
        return prop in getThemesMap();
    },
    getOwnPropertyDescriptor(_, prop) {
        const map = getThemesMap();
        if (prop in map) return { enumerable: true, configurable: true, value: map[prop] };
        return undefined;
    }
});

// getTheme — returns the full color-token object for a theme name.
// Falls back to `dark` (the default) if the name is not found.
export function getTheme(name) {
    const themes = getThemesMap();
    return themes[name] || themes.dark;
}

// Export a theme's colors + metadata as YAML for `devforgekit theme export`.
export function exportThemeYaml(name) {
    const theme = getTheme(name);
    if (!theme) return null;
    const meta = theme._meta || {};
    const lines = [
        `name: "${meta.name || name}"`,
        `author: "${meta.author || "unknown"}"`,
        `version: "${meta.version || "1.0.0"}"`,
        `description: "${meta.description || ""}"`,
        `homepage: "${meta.homepage || ""}"`,
        `license: "${meta.license || "MIT"}"`,
        "colors:"
    ];
    for (const token of THEME_TOKENS) {
        const val = theme[token];
        lines.push(`  ${token}: ${val === undefined ? "undefined" : `"${val}"`}`);
    }
    return lines.join("\n");
}

// Get all themes (built-in + custom) as an array with metadata.
export function listThemes() {
    const themes = getThemesMap();
    return Object.entries(themes).map(([id, colors]) => ({
        id,
        name: colors._meta?.name || id,
        author: colors._meta?.author || "unknown",
        version: colors._meta?.version || "1.0.0",
        description: colors._meta?.description || "",
        isCustom: !BUILTIN_THEMES.some((t) => t.id === id),
        validation: validateTheme(colors)
    }));
}

// Pick a random theme ID.
export function randomThemeId(exclude) {
    const names = getThemeNames().filter((n) => n !== exclude);
    return names[Math.floor(Math.random() * names.length)];
}
