// Single source of truth for terminal size, resize state, and layout
// calculations. Implements the PRD's resize stability requirements:
//
// - Resize transaction: during a resize burst, `resizing` is true so
//   consumers can freeze rendering of dynamic content and avoid
//   intermediate layouts. Only the final settled size triggers a
//   re-render.
// - Debounce: resize events are debounced at the emit level in
//   index.js (RESIZE_SETTLE_MS = 120ms). This hook only sees the
//   final settled event, so it commits immediately — no throttle,
//   no intermediate renders, no flicker.
// - No render storms: 100 resize events during a drag → 1 commit.
//
// TerminalSizeProvider mounts exactly ONE `resize` listener (via Ink's
// own `useStdout()`, so it targets whatever stdout Ink is actually
// rendering to - the real one, or a test's injected fake, never
// `process.stdout` directly, which would read the wrong stream under
// ink-testing-library/injected-stdout tests). Every component that
// needs terminal size reads it from here instead of polling
// `process.stdout.columns` ad hoc - one listener, one coalesced
// re-render per resize burst, one place resize state lives.
import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from "react";
import { useStdout } from "ink";

const h = React.createElement;

// Breakpoint thresholds (columns), per the PRD's six-band system.
// XS   < 80    (below usable floor - TooSmallScreen)
// SM   80-109
// MD   110-159
// LG   160-219
// XL   220-299
// UltraWide >= 300
export const BREAKPOINTS = {
    xs: 80,
    sm: 110,
    md: 160,
    lg: 220,
    xl: 300
};

// The floor this dashboard has always documented (docs/TUI.md: "the
// layout is responsive down to 80x24") - below this, individual panels
// have no realistic chance of laying out correctly, so the whole
// dashboard is replaced with one explicit message instead of a
// corrupted attempt (see TooSmall in App.js).
export const MIN_COLUMNS = 80;
export const MIN_ROWS = 24;

// Per-page minimum terminal sizes. Every page shares the shell chrome
// (DashboardHeader + StatusBar ≈ 6 rows at these sizes - the header
// itself stays in its 3-row "minimal" tier here, see
// layout/responsive.js's headerMode - plus ≈ 26 cols of nav), so the
// global floor (80×24) applies to all. Pages with side-by-side list +
// detail panels need more width/height to avoid clipping. The
// TooSmallScreen shows the current page's minimum so the user knows
// exactly what size to grow to.
export const PAGE_MIN_SIZE = {
    dashboard:     { columns: 80, rows: 24 },
    workspaces:    { columns: 100, rows: 28 },
    components:    { columns: 100, rows: 28 },
    registry:      { columns: 80, rows: 24 },
    profiles:      { columns: 90, rows: 26 },
    recipes:       { columns: 90, rows: 26 },
    generator:     { columns: 90, rows: 26 },
    plugins:       { columns: 90, rows: 26 },
    doctor:        { columns: 90, rows: 26 },
    compatibility: { columns: 90, rows: 26 },
    graph:         { columns: 90, rows: 26 },
    // rows bumped 24 -> 34 (v2.1.3.2): the Context panel's permanent
    // Quick Actions list (7 rows + label, added so the shortcuts don't
    // visually disappear after the first message) pushed real content
    // past the old floor - verified empirically corrupt at 30 rows,
    // clean from 32 up (see docs/TUI.md's v2.1.1 row-budget note for why
    // this is checked by rendering, not estimated).
    ai:            { columns: 80, rows: 34 },
    "ai-overview":   { columns: 90, rows: 26 },
    "ai-providers":  { columns: 90, rows: 26 },
    "ai-models":     { columns: 90, rows: 26 },
    "ai-credentials":{ columns: 90, rows: 26 },
    "ai-diagnostics":{ columns: 90, rows: 26 },
    "ai-history":    { columns: 80, rows: 24 },
    updates:       { columns: 90, rows: 26 },
    inventory:     { columns: 90, rows: 26 },
    config:        { columns: 90, rows: 26 },
    logs:          { columns: 80, rows: 24 },
    commands:      { columns: 100, rows: 28 },
    help:          { columns: 80, rows: 24 },
    about:         { columns: 80, rows: 24 }
};

export function getPageMinSize(page) {
    const pageMin = PAGE_MIN_SIZE[page] || { columns: MIN_COLUMNS, rows: MIN_ROWS };
    return {
        columns: Math.max(MIN_COLUMNS, pageMin.columns),
        rows: Math.max(MIN_ROWS, pageMin.rows)
    };
}

// Resize timing: the emit-level debounce in index.js (RESIZE_SETTLE_MS
// = 120ms) ensures this hook only sees the final settled event. We keep
// a safety-net debounce here for test environments where the emit
// interception isn't active (e.g. ink-testing-library's fake stdout).
const RESIZE_DEBOUNCE_MS = 120;

export function getBreakpoint(columns) {
    if (columns < BREAKPOINTS.xs) return "xs";
    if (columns < BREAKPOINTS.sm) return "sm";
    if (columns < BREAKPOINTS.md) return "md";
    if (columns < BREAKPOINTS.lg) return "lg";
    if (columns < BREAKPOINTS.xl) return "xl";
    return "ultraWide";
}

const TerminalSizeContext = createContext(null);

export function TerminalSizeProvider({ children }) {
    const { stdout } = useStdout();
    const [size, setSize] = useState(() => ({
        columns: stdout.columns || 80,
        rows: stdout.rows || 24,
        resizeCount: 0,
        resizing: false
    }));
    const debounceTimerRef = useRef(null);

    useEffect(() => {
        function commit() {
            debounceTimerRef.current = null;
            setSize((prev) => {
                const columns = stdout.columns || 80;
                const rows = stdout.rows || 24;
                if (prev.columns === columns && prev.rows === rows) {
                    // Same dimensions: just clear the resizing flag if set.
                    // Don't increment resizeCount — nothing actually changed.
                    return prev.resizing ? { ...prev, resizing: false } : prev;
                }
                return { columns, rows, resizeCount: prev.resizeCount + 1, resizing: false };
            });
        }
        function onResize() {
            // Mark resizing immediately so consumers can freeze.
            setSize((prev) => prev.resizing ? prev : { ...prev, resizing: true });
            // Safety-net debounce: in production, index.js already
            // debounced the event, so this fires immediately. In tests
            // with fake stdouts, this coalesces bursts.
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = setTimeout(commit, RESIZE_DEBOUNCE_MS);
        }
        stdout.on("resize", onResize);
        return () => {
            stdout.off("resize", onResize);
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        };
    }, [stdout]);

    const value = useMemo(() => ({
        columns: size.columns,
        rows: size.rows,
        resizeCount: size.resizeCount,
        resizing: size.resizing,
        breakpoint: getBreakpoint(size.columns),
        tooSmall: size.columns < MIN_COLUMNS || size.rows < MIN_ROWS
    }), [size]);

    return h(TerminalSizeContext.Provider, { value }, children);
}

export function useTerminalSize() {
    const ctx = useContext(TerminalSizeContext);
    if (!ctx) throw new Error("useTerminalSize must be used inside <TerminalSizeProvider>");
    return ctx;
}
