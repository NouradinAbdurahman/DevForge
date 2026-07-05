// Pure layout-calculation helpers - no rendering, no hooks, just numbers
// derived from the current terminal size (`useTerminalSize()`'s
// `columns`/`breakpoint`). Kept separate from `components/` on purpose:
// a layout decision ("how wide should the sidebar be at 95 columns")
// shouldn't be buried inside the component that happens to use it, and
// is trivially unit-testable without rendering anything.
//
// This is a true responsive layout engine, not a collection of width
// checks. It supports:
// - Six breakpoints (XS/SM/MD/LG/XL/UltraWide)
// - Panel constraints (min/preferred/max width, grow, shrink)
// - Progressive collapse (panels disappear in priority order as space
//   decreases, never overlap, never clip)

import { getBreakpoint } from "../hooks/useTerminalSize.js";

// navWidth(columns) - the left menu's width. Deliberately NOT a step
// function that hides/collapses the menu at the dashboard's own
// documented "small" breakpoint (80-109) - ink-testing-library's fake
// stdout (and this app's own tests) default to 100 columns, which is
// already the every-day, fully-supported width this dashboard has
// shipped at since v1.2.3; collapsing navigation there would regress a
// real, tested, working feature to satisfy a breakpoint label. Instead
// the width itself scales smoothly: narrower on a cramped terminal,
// unchanged across the whole existing "normal" range, and a little
// roomier on very wide terminals instead of leaving the extra space
// unused. 28 (was 26) since the nav items grew a "[shortcut]" badge
// prefix - without the +2, the longest label ("Project Generator")
// loses its last character to truncation at this tier.
export function navWidth(columns) {
    if (columns < 90) return 20;
    if (columns < 130) return 28;
    return Math.min(32, Math.floor(columns * 0.16));
}

// Panel constraint system: each panel declares minimum, preferred,
// maximum width, and flex grow/shrink. The layout engine distributes
// available space using these constraints, exactly like CSS Flexbox.
//
// Example:
//   { minWidth: 30, preferredWidth: 40, maxWidth: 60, grow: 1, shrink: 1 }
//
// The engine:
// 1. Starts with preferred widths
// 2. If total > available, shrinks panels (respecting minWidth + shrink)
// 3. If total < available, grows panels (respecting maxWidth + grow)
export function distributeWidth(available, panels) {
    // Phase 1: start with preferred widths
    let widths = panels.map((p) => p.preferredWidth || p.minWidth || 0);
    const total = widths.reduce((a, b) => a + b, 0);

    if (total === available) return widths;

    if (total > available) {
        // Phase 2: shrink - reduce panels proportionally, respecting minWidth
        let deficit = total - available;
        const shrinkable = panels.map((p, i) => ({
            index: i,
            canShrink: p.shrink !== 0 && widths[i] > (p.minWidth || 0),
            shrinkAmount: widths[i] - (p.minWidth || 0)
        })).filter((s) => s.canShrink);
        const totalShrinkable = shrinkable.reduce((a, s) => a + s.shrinkAmount, 0);
        if (totalShrinkable >= deficit) {
            for (const s of shrinkable) {
                const ratio = s.shrinkAmount / totalShrinkable;
                const reduction = Math.min(s.shrinkAmount, Math.round(deficit * ratio));
                widths[s.index] -= reduction;
                deficit -= reduction;
            }
        } else {
            // Can't shrink enough - clamp to minimums
            for (const s of shrinkable) {
                widths[s.index] = panels[s.index].minWidth || 0;
            }
        }
    } else {
        // Phase 3: grow - expand panels proportionally, respecting maxWidth
        let surplus = available - total;
        const growable = panels.map((p, i) => ({
            index: i,
            canGrow: p.grow !== 0 && (!p.maxWidth || widths[i] < p.maxWidth),
            growAmount: p.maxWidth ? p.maxWidth - widths[i] : Infinity
        })).filter((g) => g.canGrow);
        const totalGrowable = growable.reduce((a, g) => a + g.growAmount, 0);
        if (totalGrowable > 0) {
            for (const g of growable) {
                const ratio = g.growAmount / totalGrowable;
                const increase = Math.min(g.growAmount, Math.round(surplus * ratio));
                widths[g.index] += increase;
                surplus -= increase;
            }
        }
    }

    return widths;
}

// Progressive collapse: given a set of panels with priorities, determine
// which panels should be visible at the current terminal width.
// Panels collapse in reverse priority order (lowest priority first).
//
// Example layout for a page with [sidebar, overview, registry, actions]:
//   160+ cols: all 4 panels visible
//   120 cols:  sidebar, overview, registry (actions collapsed)
//   100 cols:  sidebar, overview (registry collapsed)
//   80 cols:   sidebar only (overview collapsed)
//
// Each panel declares a `collapseBelow` breakpoint - the minimum
// breakpoint at which it should be visible.
export function visiblePanels(columns, panels) {
    const bp = getBreakpoint(columns);
    const bpOrder = ["xs", "sm", "md", "lg", "xl", "ultraWide"];
    const bpIndex = bpOrder.indexOf(bp);
    return panels.filter((p) => {
        if (!p.collapseBelow) return true;
        const panelBpIndex = bpOrder.indexOf(p.collapseBelow);
        return bpIndex >= panelBpIndex;
    });
}

// headerMode(columns, rows) - the persistent DashboardHeader banner's
// responsive tier (docs/TUI.md's "Persistent dashboard header"
// section). Deliberately conservative: "compact" and "full" only
// kick in well above every page's own PAGE_MIN_SIZE (max 28 rows,
// see hooks/useTerminalSize.js) and above the size this app's own
// tests render at (100x40), so growing the header on generously
// large terminals never eats into the vertical budget every existing
// page/test was already tuned against - "minimal" (3 rows) is exactly
// the row budget the pre-redesign header used.
//   full    - rows >= 53 && columns >= 110: logo + wordmark + subtitle + version/stats + separator
//   compact - rows >= 47 && columns >= 90:  logo + wordmark + separator (subtitle/stats hidden first)
//   minimal - otherwise:                    wordmark + subtitle + separator (logo hidden, branding never fully disappears)
export function headerMode(columns, rows) {
    if (rows >= 53 && columns >= 110) return "full";
    if (rows >= 47 && columns >= 90) return "compact";
    return "minimal";
}

// headerHeight(columns, rows) - the exact row count DashboardHeader
// renders at the given size for the mode above (8-row logo + blank +
// wordmark + subtitle + stats + separator = 13; logo + blank +
// wordmark + separator = 11; wordmark + subtitle + separator = 3).
export function headerHeight(columns, rows) {
    const mode = headerMode(columns, rows);
    if (mode === "full") return 13;
    if (mode === "compact") return 11;
    return 3;
}

// Layout configuration for the main dashboard shell.
// Returns the layout parameters for the current terminal size.
export function shellLayout(columns, rows) {
    const bp = getBreakpoint(columns);
    const nav = navWidth(columns);
    const contentWidth = columns - nav - 2; // -2 for border padding
    const showStatusBar = rows >= 24;
    const showHeader = rows >= 24;
    const showNavHints = rows >= 26;
    const contentHeight = rows - (showHeader ? headerHeight(columns, rows) : 0) - (showStatusBar ? 3 : 0) - (showNavHints ? 1 : 0);

    return {
        breakpoint: bp,
        columns,
        rows,
        navWidth: nav,
        contentWidth: Math.max(0, contentWidth),
        contentHeight: Math.max(0, contentHeight),
        showHeader,
        showStatusBar,
        showNavHints
    };
}

// Detail panel width calculation - used by pages with list+detail layout.
// Scales with terminal width but stays within sensible bounds.
export function detailPanelWidth(columns, { min = 28, max = 46, fraction = 0.42 } = {}) {
    return Math.min(max, Math.max(min, Math.floor(columns * fraction)));
}

// Main content width for a two-panel (list + detail) page layout.
export function listPanelWidth(columns, detailW) {
    return Math.max(0, columns - detailW - 3); // -3 for borders/gaps
}
