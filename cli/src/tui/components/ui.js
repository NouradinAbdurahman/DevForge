// Shared TUI building blocks. The whole dashboard is written with plain
// React.createElement (aliased `h`) instead of JSX, deliberately: this
// CLI has no build/transpile step anywhere (`node bin/devforgekit.js`
// runs the source directly), and adding one just for JSX sugar would
// break that property - see docs/TUI.md's architecture section.
import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { useTerminalSize } from "../hooks/useTerminalSize.js";

export const h = React.createElement;

// SelectList - the one keyboard-navigable list every page reuses
// (components, profiles, recipes, nav, config fields...). Controlled
// externally only by `isActive`; manages its own cursor, clamps it to
// the item count, scrolls a `height`-row window, and reports
// enter/space via callbacks. j/k work alongside the arrow keys - same
// muscle memory k9s/lazygit users expect.
function SelectListImpl({
    items,
    isActive,
    height = 12,
    onSelect,
    onSpace,
    onHighlight,
    renderItem,
    theme,
    emptyText = "Nothing here yet."
}) {
    const [cursor, setCursor] = useState(0);
    const clamped = Math.min(cursor, Math.max(0, items.length - 1));

    useEffect(() => {
        if (cursor !== clamped) setCursor(clamped);
    }, [cursor, clamped]);

    useInput((input, key) => {
        if (items.length === 0) return;
        if (key.upArrow || input === "k") {
            const next = clamped > 0 ? clamped - 1 : items.length - 1;
            setCursor(next);
            if (onHighlight) onHighlight(items[next], next);
        } else if (key.downArrow || input === "j") {
            const next = clamped < items.length - 1 ? clamped + 1 : 0;
            setCursor(next);
            if (onHighlight) onHighlight(items[next], next);
        } else if (key.return && onSelect) {
            onSelect(items[clamped], clamped);
        } else if (input === " " && onSpace) {
            onSpace(items[clamped], clamped);
        }
    }, { isActive: Boolean(isActive) });

    if (items.length === 0) {
        return h(Text, { color: theme.textMuted }, emptyText);
    }

    // Scroll window: keep the cursor visible inside `height` rows.
    const start = Math.max(0, Math.min(clamped - Math.floor(height / 2), items.length - height));
    const visible = items.slice(start, start + height);

    return h(Box, { flexDirection: "column" },
        start > 0 ? h(Text, { color: theme.textMuted }, `  ↑ ${start} more`) : null,
        ...visible.map((item, i) => {
            const index = start + i;
            const selected = index === clamped;
            if (renderItem) return renderItem(item, selected, index);
            const label = typeof item === "string" ? item : item.label;
            return h(Text, {
                key: label + index,
                backgroundColor: selected && isActive ? theme.selection : undefined,
                color: selected && isActive ? theme.selectionText : theme.text
            }, `${selected ? "❯ " : "  "}${label}`);
        }),
        start + height < items.length ? h(Text, { color: theme.textMuted }, `  ↓ ${items.length - (start + height)} more`) : null
    );
}

export const SelectList = React.memo(SelectListImpl);

// Panel - a titled, bordered box; the visual unit every page is composed
// of. Supports flex constraints (minWidth, maxWidth, grow, shrink) for
// the layout engine's distributeWidth() system. `isActive` marks the
// one panel on a page that currently holds keyboard focus (the panel
// wrapping the visible SelectList/TextField, per page) - it gets the
// theme's focused border color instead of the default, so focus is
// visible at the panel level, not just row-by-row inside a list
// (docs/TUI.md's theme redesign notes). There's no background fill
// here even though themes define surface/surfaceAlt colors: Ink's
// <Box> has no backgroundColor support at all (only <Text> does - see
// ink/build/components/Text.js vs. Box.js) - a real Ink limitation,
// not an oversight.
export function Panel({ title, theme, children, isActive, flexGrow, flexShrink, width, minWidth, maxWidth, minHeight }) {
    return h(Box, {
        borderStyle: "round",
        borderColor: isActive ? theme.borderActive : theme.border,
        flexDirection: "column",
        paddingX: 1,
        flexGrow,
        flexShrink,
        width,
        minWidth,
        maxWidth,
        minHeight
    },
    title ? h(Text, { color: theme.panelTitle || theme.accent, bold: true }, title) : null,
    children);
}

// KeyValue - aligned "label: value" rows for detail/overview panes.
// Each row is nested <Text> spans (not a <Box> of sibling <Text>
// elements) - Ink treats nested Text as one reflowable text run; a Box
// of siblings instead gives each child its own flex-shrink share of
// the width, truncating mid-word ("checking..." -> "checkin") the
// moment a row doesn't fit in a narrow panel.
export function KeyValue({ pairs, theme, labelWidth = 22 }) {
    return h(Box, { flexDirection: "column" },
        ...pairs.map(([label, value, color]) =>
            h(Text, { key: label },
                h(Text, { color: theme.textMuted }, `${label.padEnd(labelWidth)} `),
                h(Text, { color: color || theme.text }, String(value))
            ))
    );
}

// KeyHints - the small "what can I press here" line every page shows
// at the bottom of its detail/action panel: `hints` is [[key,
// description], ...], rendered as a bold accent key + muted
// description, separated by a dim " · " - the same treatment
// StatusBar's global hint row uses, so every page's own page-specific
// hints read consistently with the always-visible global ones.
// Nested <Text> spans (not a <Box> of sibling <Text> elements) - Ink
// treats nested Text as one reflowable text run and wraps/truncates
// the whole line as a unit, rather than truncating each span
// independently mid-word the moment the row doesn't fit.
export function KeyHints({ hints, theme, lead }) {
    const children = [];
    if (lead) children.push(h(Text, { key: "lead", color: theme.textMuted }, lead));
    hints.forEach(([key, label], i) => {
        if (i > 0 || lead) children.push(h(Text, { key: `sep-${i}`, color: theme.border }, " · "));
        children.push(h(Text, { key: `key-${i}`, color: theme.accent, bold: true }, key));
        children.push(h(Text, { key: `label-${i}`, color: theme.textMuted }, ` ${label}`));
    });
    return h(Text, null, ...children);
}

// ProgressBar - pure text, no dependency on cli-progress (that library
// writes straight to stdout, which would fight Ink's renderer - same
// reason core/shell.js grew the onOutput mode).
export function ProgressBar({ value, total, width = 30, theme, label = "" }) {
    const ratio = total > 0 ? Math.min(1, value / total) : 0;
    const filled = Math.round(ratio * width);
    return h(Box, null,
        h(Text, { color: theme.progress }, "█".repeat(filled)),
        h(Text, { color: theme.progressBackground }, "░".repeat(width - filled)),
        h(Text, { color: theme.textMuted }, ` ${value}/${total} ${label}`)
    );
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Spinner - hand-rolled (ink-spinner would be another dependency for 10
// characters of animation). 200ms frames, deliberately slower than the
// usual 80ms: every frame re-renders the whole Ink tree, and during the
// startup probe burst those renders can starve stdin processing enough
// to coalesce keypresses (see data.js's installedStatuses notes).
// During a resize burst, the spinner freezes on its current frame to
// avoid triggering unnecessary re-renders while the layout is unstable.
export function Spinner({ theme }) {
    const [frame, setFrame] = useState(0);
    const { resizing } = useTerminalSize();
    useEffect(() => {
        const timer = setInterval(() => {
            setFrame((f) => (resizing ? f : (f + 1) % SPINNER_FRAMES.length));
        }, 200);
        return () => clearInterval(timer);
    }, [resizing]);
    return h(Text, { color: theme.accent }, SPINNER_FRAMES[frame]);
}

// useDetailWidth - hook version of detailWidth that reads from the
// centralized useTerminalSize context instead of process.stdout.columns
// directly. Every page that places a detail panel should call this at
// the top of the component so the width is debounced and consistent
// across all panels during a resize burst.
export function useDetailWidth(max = 46, fraction = 0.42) {
    const { columns } = useTerminalSize();
    return Math.min(max, Math.max(28, Math.floor(columns * fraction)));
}

// detailWidth - legacy plain-function version kept for any non-hook call
// site that still reads process.stdout.columns directly. Prefer
// useDetailWidth in all React components.
export function detailWidth(max = 46, fraction = 0.42) {
    const cols = process.stdout.columns || 100;
    return Math.min(max, Math.max(28, Math.floor(cols * fraction)));
}

// StatusDot - PASS/WARNING/FAIL et al as a colored glyph + text.
export function statusColor(status, theme) {
    if (status === "PASS" || status === "installed" || status === "ok") return theme.success;
    if (status === "WARNING" || status === "skipped") return theme.warning;
    if (status === "FAIL" || status === "failed" || status === "error") return theme.error;
    return theme.textMuted;
}

// TextField - a minimal controlled text input (search boxes, config
// edits). Hand-rolled for the same no-extra-dependency reason as
// Spinner; handles printable characters, backspace/delete, and leaves
// everything else (arrows, enter, esc, tab) to the parent's handlers.
export function TextField({ value, onChange, isActive, placeholder = "", theme }) {
    useInput((input, key) => {
        if (key.backspace || key.delete) {
            onChange(value.slice(0, -1));
        } else if (input && !key.ctrl && !key.meta && !key.return && !key.tab && !key.escape
            && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
            onChange(value + input);
        }
    }, { isActive: Boolean(isActive) });

    // The cursor renders in the theme's accent color when focused - a
    // small but real "focus state obvious" cue (docs/TUI.md's theme
    // redesign notes), since these inline fields have no border of
    // their own to highlight the way Panel/Nav do.
    if (!value && placeholder) {
        return h(Box, null,
            h(Text, { color: theme.textMuted }, placeholder),
            isActive ? h(Text, { color: theme.accent }, "▏") : null);
    }
    return h(Box, null,
        h(Text, { color: theme.text }, value),
        isActive ? h(Text, { color: theme.accent }, "▏") : null);
}
