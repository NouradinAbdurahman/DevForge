// Shared TUI building blocks. The whole dashboard is written with plain
// React.createElement (aliased `h`) instead of JSX, deliberately: this
// CLI has no build/transpile step anywhere (`node bin/devforgekit.js`
// runs the source directly), and adding one just for JSX sugar would
// break that property - see docs/TUI.md's architecture section.
import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useReducedMotion } from "../hooks/useReducedMotion.js";

export const h = React.createElement;

// computeWindowStart - shared "keep this position visible inside a
// `height`-row viewport" math, used by both SelectList (cursor-centered)
// and ScrollList (direct offset). Pure function, no state of its own.
export function computeWindowStart(position, itemCount, height) {
    return Math.max(0, Math.min(position, Math.max(0, itemCount - height)));
}

// SelectList - the one keyboard-navigable list every page reuses
// (components, profiles, recipes, nav, config fields...). Controlled
// externally only by `isActive`; manages its own cursor, clamps it to
// the item count, scrolls a `height`-row window, and reports
// enter/space via callbacks. j/k work alongside the arrow keys, PageUp/
// PageDown jump a full window, and g/G jump to the first/last item -
// same muscle memory k9s/lazygit users expect (raw Home/End key codes
// aren't reliably reported across terminals, so g/G is the portable
// choice for "jump to top/bottom").
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
        const move = (next) => {
            setCursor(next);
            if (onHighlight) onHighlight(items[next], next);
        };
        if (key.upArrow || input === "k") {
            move(clamped > 0 ? clamped - 1 : items.length - 1);
        } else if (key.downArrow || input === "j") {
            move(clamped < items.length - 1 ? clamped + 1 : 0);
        } else if (key.pageUp) {
            move(Math.max(0, clamped - height));
        } else if (key.pageDown) {
            move(Math.min(items.length - 1, clamped + height));
        } else if (input === "g") {
            move(0);
        } else if (input === "G") {
            move(items.length - 1);
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
    const start = computeWindowStart(clamped - Math.floor(height / 2), items.length, height);
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

// ScrollList - the read-only counterpart to SelectList: no selection,
// no cursor, just a scrollable window over long content (session logs,
// recent-actions history, command output). Same key bindings and the
// same "↑ N more" / "↓ N more" indicators as SelectList, so scrolling
// feels identical everywhere instead of some pages truncating silently
// (the old LogsPage behavior: always the last N entries, no way back).
function ScrollListImpl({ items, isActive, height = 12, renderItem, theme, emptyText = "Nothing here yet.", startAtEnd = false }) {
    // startAtEnd: mount already scrolled to the newest entries (session
    // logs, recent activity) instead of the oldest - a one-time initial
    // position, not a live "stick to bottom as new items arrive" - the
    // user's own scroll position always wins once they've moved.
    const [offset, setOffset] = useState(() => (startAtEnd ? Math.max(0, items.length - height) : 0));
    const clampedOffset = computeWindowStart(offset, items.length, height);

    useEffect(() => {
        if (offset !== clampedOffset) setOffset(clampedOffset);
    }, [offset, clampedOffset]);

    useInput((input, key) => {
        if (items.length === 0) return;
        if (key.upArrow || input === "k") setOffset(clampedOffset - 1);
        else if (key.downArrow || input === "j") setOffset(clampedOffset + 1);
        else if (key.pageUp) setOffset(clampedOffset - height);
        else if (key.pageDown) setOffset(clampedOffset + height);
        else if (input === "g") setOffset(0);
        else if (input === "G") setOffset(items.length);
    }, { isActive: Boolean(isActive) });

    if (items.length === 0) {
        return h(Text, { color: theme.textMuted }, emptyText);
    }

    const visible = items.slice(clampedOffset, clampedOffset + height);

    return h(Box, { flexDirection: "column" },
        clampedOffset > 0 ? h(Text, { color: theme.textMuted }, `  ↑ ${clampedOffset} more`) : null,
        ...visible.map((item, i) => renderItem(item, clampedOffset + i)),
        clampedOffset + height < items.length ? h(Text, { color: theme.textMuted }, `  ↓ ${items.length - (clampedOffset + height)} more`) : null
    );
}

export const ScrollList = React.memo(ScrollListImpl);

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

// InstallProgress - the one "something is running" panel every install/
// scan flow (ComponentsPage, ProfilesPage, RecipesPage, DoctorPage) uses
// instead of each hand-building its own Box+label+ProgressBar+output-
// lines combination. Before this, some pages showed a bold "what's
// running" header above the bar and some didn't - same operation shape,
// different feel depending on which page you were on. `lines` (recent
// streamed output, already capped/sliced by the caller) is optional -
// DoctorPage's scan has no streamed output at all, just the bar.
export function InstallProgress({ label, unit = "", value, total, lines, theme, extra }) {
    return h(Box, { flexDirection: "column", marginTop: 1 },
        label ? h(Text, { color: theme.accent, bold: true }, label) : null,
        h(ProgressBar, { value, total, theme, label: unit }),
        ...(lines || []).map((line, i) => h(Text, { key: i, color: theme.textMuted, wrap: "truncate-end" }, line)),
        extra || null
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
    const reducedMotion = useReducedMotion();
    useEffect(() => {
        if (reducedMotion) return undefined; // static glyph below, no interval at all
        const timer = setInterval(() => {
            setFrame((f) => (resizing ? f : (f + 1) % SPINNER_FRAMES.length));
        }, 200);
        return () => clearInterval(timer);
    }, [resizing, reducedMotion]);
    // Reduced motion: a fixed glyph (still communicates "busy" via
    // presence + accent color), never animates - the actual v2.0.5 gap
    // (a real reducedMotion preference, threaded into the React tree,
    // that nothing previously read).
    return h(Text, { color: theme.accent }, reducedMotion ? SPINNER_FRAMES[0] : SPINNER_FRAMES[frame]);
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

// StatusDot - PASS/WARNING/FAIL et al as a colored glyph + text. Also
// accepts the app's other canonical severity vocabulary directly - the
// lowercase "success"/"warning"/"error"/"info" toast/log levels
// store.js's notify()/actions.log() use everywhere - so a page coloring
// a log entry or toast-level indicator doesn't need its own copy of this
// mapping (LogsPage used to hand-roll one that only handled "error"/
// "warning"/"success", silently leaving "info" as its own branch).
export function statusColor(status, theme) {
    if (status === "PASS" || status === "installed" || status === "ok" || status === "success") return theme.success;
    if (status === "WARNING" || status === "skipped" || status === "warning") return theme.warning;
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

// Badge - a small bracketed, colored pill for a short status word
// (stable/beta/deprecated, configured/missing, PASS/WARN/FAIL...).
// Built on the same tone palette as statusColor()/StatusIndicator so a
// given word always maps to the same color everywhere it appears.
const TONE_COLOR = {
    success: (theme) => theme.success,
    warning: (theme) => theme.warning,
    error: (theme) => theme.error,
    info: (theme) => theme.info,
    accent: (theme) => theme.accent,
    muted: (theme) => theme.textMuted
};

export function Badge({ text, tone = "muted", theme }) {
    const color = (TONE_COLOR[tone] || TONE_COLOR.muted)(theme);
    return h(Text, { color, bold: tone !== "muted" }, `[ ${text} ]`);
}

// StatusIndicator - icon + color for a status value, formalizing the
// ✓/✗/⚠ + statusColor() pairing that DashboardPage/AIProvidersPage/
// CompatibilityPage each hand-rolled independently. `status` accepts
// the same vocabulary as statusColor() (PASS/WARNING/FAIL/installed/
// ok/skipped/failed/error, or an explicit "ready"/"not-configured").
const STATUS_ICON = {
    PASS: "✓", ok: "✓", installed: "✓", ready: "✓",
    WARNING: "⚠", skipped: "⚠",
    FAIL: "✗", failed: "✗", error: "✗", "not-configured": "✗"
};

export function StatusIndicator({ status, theme, label }) {
    const icon = STATUS_ICON[status] || "•";
    const color = statusColor(status, theme);
    return h(Text, { color }, `${icon}${label ? ` ${label}` : ""}`);
}

// Card - a titled stat-tile: Panel + KeyValue, for compact summary
// panels (DashboardPage's Machine/Registry/Device/Platform/AI tiles).
export function Card({ title, theme, pairs, width, flexGrow, labelWidth }) {
    return h(Panel, { title, theme, width, flexGrow },
        h(KeyValue, { theme, pairs, labelWidth }));
}

// EmptyState - the consistent "nothing here" screen: what this screen
// shows, and (optionally) what to do next. Replaces every page's ad hoc
// single-line "No X found." text so a page never has two different
// empty messages for the same condition (ProfilesPage/RecipesPage each
// used to say something different in their list vs. their detail pane).
export function EmptyState({ title = "Nothing here yet.", description, hint, theme }) {
    return h(Box, { flexDirection: "column", paddingX: 1 },
        h(Text, { color: theme.textMuted, bold: true }, title),
        description ? h(Text, { color: theme.textMuted }, description) : null,
        hint ? h(Box, { marginTop: 1 }, h(Text, { color: theme.accent }, hint)) : null
    );
}

// ErrorState - a page-level blocking error (data failed to load, a
// command failed) - distinct from a transient Toast, which is for
// non-blocking feedback that auto-dismisses.
export function ErrorState({ message, hint, theme }) {
    return h(Box, { flexDirection: "column", paddingX: 1 },
        h(Text, { color: theme.error, bold: true }, "Something went wrong"),
        h(Text, { color: theme.text }, message),
        hint ? h(Box, { marginTop: 1 }, h(Text, { color: theme.textMuted }, hint)) : null
    );
}

// LoadingState - Spinner + label, for the "still fetching" moment every
// page hits (registry/machine stats/model lists resolving in the
// background).
export function LoadingState({ label = "Loading...", theme }) {
    return h(Box, null, h(Spinner, { theme }), h(Text, { color: theme.textMuted }, ` ${label}`));
}

// Table - header row + aligned, truncated columns. `columns` is
// [{ key, label, width }], `rows` is an array of plain objects keyed by
// column `key`. For the pages that render multi-column data by hand
// today; unlike KeyValue (label: value pairs) this is for row-per-item,
// column-per-field data.
export function Table({ columns, rows, theme, selectedIndex = -1 }) {
    return h(Box, { flexDirection: "column" },
        h(Text, null,
            ...columns.map((col, i) =>
                h(Text, { key: col.key, color: theme.tableHeader, bold: true },
                    `${(i > 0 ? " " : "")}${String(col.label).padEnd(col.width)}`))),
        ...rows.map((row, rowIndex) =>
            h(Text, { key: row.id ?? rowIndex },
                ...columns.map((col, i) => {
                    const raw = row[col.key];
                    const cell = String(raw === undefined || raw === null ? "" : raw).slice(0, col.width).padEnd(col.width);
                    return h(Text, {
                        key: col.key,
                        backgroundColor: rowIndex === selectedIndex ? theme.selection : undefined,
                        color: rowIndex === selectedIndex ? theme.selectionText : theme.text
                    }, `${(i > 0 ? " " : "")}${cell}`);
                })))
    );
}

// useFilterField - one contract for "press / to filter this list" used
// by every page instead of each reinventing its own state names and
// wiring (ComponentsPage's filterText/typingFilter, CommandsPage's
// searchText/typingSearch, AIModelsPage's search/searching all did this
// differently, and AIModelsPage's version never told the store it was
// typing - so pressing / there also opened the *global* search overlay
// at the same time). `onTypingChange` should be wired to the store's
// setTyping action so App.js's global "/" handler knows not to also
// open the global search overlay while a page-local filter is open.
export function useFilterField({ isActive, onTypingChange } = {}) {
    const [query, setQuery] = useState("");
    const [isOpen, setIsOpen] = useState(false);

    const close = () => {
        setIsOpen(false);
        setQuery("");
        if (onTypingChange) onTypingChange(false);
    };

    useInput((input, key) => {
        if (!isOpen && input === "/") {
            setIsOpen(true);
            if (onTypingChange) onTypingChange(true);
        } else if (isOpen && (key.escape || key.return)) {
            if (key.escape) { close(); } else { setIsOpen(false); if (onTypingChange) onTypingChange(false); }
        }
    }, { isActive: Boolean(isActive) });

    return { query, setQuery, isOpen, close };
}

// FilterBar - the visible input for useFilterField's state. Renders
// nothing when closed, so a page can call it unconditionally.
export function FilterBar({ query, onChange, isOpen, isActive, theme, placeholder = "Type to filter, Enter/Esc to close" }) {
    if (!isOpen) return null;
    return h(Box, null,
        h(Text, { color: theme.accent }, "/ "),
        h(TextField, { value: query, onChange, isActive: Boolean(isActive), placeholder, theme }));
}

// DetailPanel - the standard "selected item" side panel: a Panel
// wrapping one or more KeyValue sections plus a trailing KeyHints row
// for actions. `sections` is [{ title?, pairs }]; pass a single-element
// array for the common case of one unsectioned KeyValue block.
export function DetailPanel({ title, theme, isActive, width, minWidth, maxWidth, flexGrow, sections, body, hints, emptyText, footer }) {
    // `body` is an escape hatch for content that isn't label/value pairs
    // (an ErrorState for an invalid item, custom formatting) - most
    // callers just pass `sections`.
    if (body) {
        return h(Panel, { title, theme, isActive, width, minWidth, maxWidth, flexGrow },
            body,
            hints ? h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints })) : null,
            footer || null);
    }
    if (!sections || sections.length === 0) {
        return h(Panel, { title, theme, isActive, width, minWidth, maxWidth, flexGrow },
            h(EmptyState, { title: emptyText || "Nothing selected.", theme }),
            hints ? h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints })) : null,
            footer || null);
    }
    return h(Panel, { title, theme, isActive, width, minWidth, maxWidth, flexGrow },
        h(Box, { flexDirection: "column" },
            ...sections.map((section, i) => h(Box, { key: section.title || i, flexDirection: "column", marginTop: i > 0 ? 1 : 0 },
                section.title ? h(Text, { color: theme.textMuted, bold: true }, section.title) : null,
                h(KeyValue, { theme, pairs: section.pairs, labelWidth: section.labelWidth }))),
        ),
        hints ? h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints })) : null,
        footer || null
    );
}

// PageShell - the one page-layout wrapper: a flex column that grows to
// fill the content area, with a consistent bottom KeyHints row. Pages
// still compose their own Panel(s) as children (this doesn't add its
// own border/title - doubling up on Panel's border would waste rows in
// an already-tight terminal) - it exists so every page's footer hints
// are rendered identically instead of some pages hand-rolling their own
// `Box{marginTop:1}` + raw Text.
export function PageShell({ theme, hints, hintsLead, children }) {
    return h(Box, { flexDirection: "column", flexGrow: 1 },
        h(Box, { flexDirection: "column", flexGrow: 1 }, children),
        hints ? h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints, lead: hintsLead })) : null
    );
}
