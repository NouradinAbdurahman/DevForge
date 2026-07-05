// The dashboard's root: header / (nav | page) / status bar layout, the
// global key router, and the page registry. Pages are kept mounted
// (hidden when inactive) so their state survives resize and page
// switches - the same pattern React Router uses with keepalive. This
// means no page unmounts during resize, no component identity changes,
// and no data reloads on page re-entry.
import React, { useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { h } from "./components/ui.js";
import { StoreProvider, useStore, PAGES } from "./store.js";
import { DashboardHeader } from "./components/DashboardHeader.js";
import { StatusBar } from "./components/StatusBar.js";
import { SelectList } from "./components/ui.js";
import { TooSmallScreen } from "./components/TooSmallScreen.js";
import { TerminalSizeProvider, useTerminalSize, getPageMinSize } from "./hooks/useTerminalSize.js";
import { navWidth, shellLayout } from "./layout/responsive.js";
import { terminalDiagnostics } from "./terminal/detect.js";
import { refreshAll } from "./data.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { WorkspacePage } from "./pages/WorkspacePage.js";
import { ComponentsPage } from "./pages/ComponentsPage.js";
import { ProfilesPage } from "./pages/ProfilesPage.js";
import { RecipesPage } from "./pages/RecipesPage.js";
import { GeneratorPage } from "./pages/GeneratorPage.js";
import { PluginsPage } from "./pages/PluginsPage.js";
import { DoctorPage } from "./pages/DoctorPage.js";
import { CompatibilityPage } from "./pages/CompatibilityPage.js";
import { AIPage } from "./pages/AIPage.js";
import { UpdatesPage } from "./pages/UpdatesPage.js";
import { InventoryPage } from "./pages/InventoryPage.js";
import { ConfigPage } from "./pages/ConfigPage.js";
import { LogsPage } from "./pages/LogsPage.js";
import { HelpPage } from "./pages/HelpPage.js";
import { AboutPage } from "./pages/AboutPage.js";
import { SearchPage } from "./pages/SearchPage.js";
import { CommandsPage } from "./pages/CommandsPage.js";
import { resizeMetrics } from "./resizeMetrics.js";

const PAGE_COMPONENTS = {
    dashboard: DashboardPage,
    workspaces: WorkspacePage,
    components: ComponentsPage,
    profiles: ProfilesPage,
    recipes: RecipesPage,
    generator: GeneratorPage,
    plugins: PluginsPage,
    doctor: DoctorPage,
    compatibility: CompatibilityPage,
    ai: AIPage,
    updates: UpdatesPage,
    inventory: InventoryPage,
    config: ConfigPage,
    logs: LogsPage,
    commands: CommandsPage,
    help: HelpPage,
    about: AboutPage
};

// Takes only the explicit props its own output depends on (not
// `useStore()`) and is wrapped in `React.memo`, for the same reason as
// Header above: Shell re-renders on every dispatch (busy/notify/log
// fire repeatedly during a live install on a completely different
// page), but Nav's rendered output only actually changes when the
// active page, focus, search state, theme, or terminal width change -
// pulling those from a shared context would re-render it regardless of
// whether they changed, since React re-renders every context consumer
// on any Provider value change. `columns` picks the sidebar's width
// (layout/responsive.js's navWidth) instead of a hardcoded constant.
function NavImpl({ isActive, page, theme, columns, onNavigate }) {
    return h(Box, {
        borderStyle: "round",
        borderColor: isActive ? theme.borderActive : theme.border,
        flexDirection: "column",
        paddingX: 1,
        width: navWidth(columns),
        flexShrink: 0
    },
        h(SelectList, {
            items: PAGES.map((p) => ({ ...p, label: p.label })),
            isActive,
            height: PAGES.length,
            theme,
            onSelect: (p) => onNavigate(p.id),
            // A bracketed shortcut badge ("[1]", "[w]", "[c]"...) up
            // front, in its own accent color, reads at a glance far
            // better than a bare letter trailing off the end of the
            // row. Nested <Text> spans (not a <Box> of sibling <Text>
            // elements) - Ink treats nested Text as one reflowable
            // text run and truncates the row as a whole, rather than
            // truncating each span independently mid-word.
            renderItem: (p, selected) => {
                const isCurrent = p.id === page;
                const rowSelected = selected && isActive;
                const bg = rowSelected ? theme.selection : undefined;
                const labelColor = isCurrent ? theme.accent : (rowSelected ? theme.selectionText : theme.text);
                const badgeColor = rowSelected ? theme.selectionText : theme.accent;
                const cursor = `${rowSelected ? "❯" : " "}${isCurrent ? "▸" : " "}`;
                return h(Text, { key: p.id, wrap: "truncate-end" },
                    h(Text, { backgroundColor: bg, color: labelColor }, cursor),
                    h(Text, { backgroundColor: bg, color: badgeColor, bold: true }, `[${p.shortcut}]`),
                    h(Text, { backgroundColor: bg, color: labelColor, bold: isCurrent }, ` ${p.label}`)
                );
            }
        })
    );
}

const Nav = React.memo(NavImpl);

// PageContainer wraps each page in a Box that is hidden (display: none
// equivalent) when not the active page. This keeps the page mounted so
// its state survives, but prevents it from rendering to the screen.
// Ink's Box with `display: "none"` removes the element from the layout
// without unmounting it.
function PageContainer({ pageId, isActive, children }) {
    return h(Box, {
        key: pageId,
        flexDirection: "column",
        flexGrow: 1,
        display: isActive ? "flex" : "none"
    }, children);
}

function Shell() {
    const { state, dispatch, actions, theme } = useStore();
    const { exit } = useApp();
    const { columns, rows, breakpoint, resizeCount, resizing } = useTerminalSize();
    const pageMin = getPageMinSize(state.page);
    const pageTooSmall = columns < pageMin.columns || rows < pageMin.rows;
    const debug = Boolean(process.env.DEVFORGEKIT_TUI_DEBUG);
    const layout = shellLayout(columns, rows);
    // `dispatch` (from useReducer) has a stable identity across renders,
    // unlike `actions.navigate` (recreated inside store.js's useMemo
    // every time `state` changes) - wrapping it this way is what lets
    // the memoized Nav below actually skip re-rendering on unrelated
    // dispatches instead of seeing a "new" onNavigate prop every time.
    const navigate = useCallback((page) => dispatch({ type: "navigate", page }), [dispatch]);

    useInput((input, key) => {
        if (process.env.DEVFORGEKIT_TUI_DEBUG) {
            console.error(`[shell-input] input=${JSON.stringify(input)} tab=${key.tab} esc=${key.escape} typing=${state.typing} focus=${state.focus} page=${state.page}`);
        }
        // Under load, terminal input can coalesce several keypresses into
        // one chunk (e.g. "cq"); the last character is the user's latest
        // intent, so shortcuts match on that instead of the whole chunk
        // (data.js's batched probes make this rare; this makes it safe).
        const ch = input.length > 1 ? input[input.length - 1] : input;
        // Keys that always work (unless a text field owns the keyboard).
        if (!state.typing) {
            if (ch === "q") { exit(); return; }
            if (ch === "?") { actions.navigate("help"); return; }
            if (ch === "R") {
                refreshAll();
                actions.notify("Caches refreshed - data reloads as pages re-open", "info");
                return;
            }
        }
        if (ch === "/" && !state.typing && !state.searchOpen) {
            dispatch({ type: "openSearch" });
            return;
        }
        if (key.escape && state.searchOpen) {
            dispatch({ type: "closeSearch" });
            return;
        }
        if (key.tab && !state.searchOpen) {
            dispatch({ type: "toggleFocus" });
            return;
        }
        if (key.escape && !state.searchOpen && state.focus === "content" && !state.typing) {
            dispatch({ type: "focus", focus: "nav" });
            return;
        }
        // Single-letter page shortcuts only while the menu has focus, so
        // page-level keys (a/u/r/f...) never collide with navigation.
        if (state.focus === "nav" && !state.typing && !state.searchOpen) {
            const target = PAGES.find((p) => p.shortcut === ch);
            if (target) actions.navigate(target.id);
        }
    });

    if (pageTooSmall) {
        const pageLabel = (PAGES.find((p) => p.id === state.page) || {}).label || state.page;
        return h(TooSmallScreen, { columns, rows, minColumns: pageMin.columns, minRows: pageMin.rows, pageLabel, theme });
    }

    const contentActive = state.focus === "content" && !state.searchOpen;

    // All pages are kept mounted in a PageContainer. Only the active
    // page is visible; inactive pages have display:none so they don't
    // render to screen but their state (scroll position, loaded data,
    // form input) survives page switches and resize transactions.
    // SearchPage overlays on top when active.
    return h(Box, { flexDirection: "column", minHeight: 24 },
        layout.showHeader && h(DashboardHeader, { theme, columns, rows }),
        h(Box, { flexGrow: 1 },
            h(Nav, {
                isActive: state.focus === "nav" && !state.searchOpen,
                page: state.page,
                theme,
                columns,
                onNavigate: navigate
            }),
            h(Box, { flexDirection: "column", flexGrow: 1 },
                state.searchOpen
                    ? h(SearchPage)
                    : Object.keys(PAGE_COMPONENTS).map((pageId) => {
                        const PageComp = PAGE_COMPONENTS[pageId];
                        const isActive = pageId === state.page;
                        return h(PageContainer, {
                            key: pageId,
                            pageId,
                            isActive
                        }, h(PageComp, { isActive: isActive && contentActive }));
                    })
            )
        ),
        layout.showStatusBar && h(StatusBar),
        layout.showNavHints && state.focus === "nav" && !state.searchOpen
            ? h(Text, { color: theme.textMuted }, "  Menu focused - Enter opens a page, Tab moves into it, / searches, q quits")
            : null,
        // DEVFORGEKIT_TUI_DEBUG=1 diagnostics strip (PRD "development
        // mode"): terminal dimensions, breakpoint, resize count, and
        // terminal emulator info - enough to confirm resize handling
        // is debounced/coalesced correctly without instrumenting every
        // panel.
        debug
            ? h(Text, { color: theme.textMuted },
                `  [debug] ${columns}x${rows} · ${breakpoint} · resizes=${resizeCount}${resizing ? " · resizing" : ""} · resizeEvents=${resizeMetrics.events}→${resizeMetrics.commits} commits · ${terminalDiagnostics()}`)
            : null
    );
}

export function App({ initialPage, suspend }) {
    // TerminalSizeProvider outside StoreProvider: resize state and
    // application state are two different concerns updated by two
    // different triggers (a 'resize' event vs. a user action/dispatch) -
    // nesting them as siblings-in-spirit here (one wraps the other, but
    // neither reads from the other) keeps that boundary real rather than
    // folding resize tracking into the app reducer where every resize
    // would also have to thread through `reducer()`'s switch statement.
    return h(TerminalSizeProvider, null,
        h(StoreProvider, { initialPage, suspend }, h(Shell)));
}
