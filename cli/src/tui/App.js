// The dashboard's root: header / (nav | page) / status bar layout, the
// global key router, and the page registry. Pages are kept mounted
// (hidden when inactive) so their state survives resize and page
// switches - the same pattern React Router uses with keepalive. This
// means no page unmounts during resize, no component identity changes,
// and no data reloads on page re-entry.
import React, { useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { h, KeyHints } from "./components/ui.js";
import { ModalHost } from "./components/Modal.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { OnboardingWizard } from "./components/OnboardingWizard.js";
import { StoreProvider, useStore, PAGES } from "./store.js";
import { DashboardHeader } from "./components/DashboardHeader.js";
import { StatusBar } from "./components/StatusBar.js";
import { SelectList } from "./components/ui.js";
import { TooSmallScreen } from "./components/TooSmallScreen.js";
import { TerminalSizeProvider, useTerminalSize, getPageMinSize } from "./hooks/useTerminalSize.js";
import { ReducedMotionProvider } from "./hooks/useReducedMotion.js";
import { navWidth, shellLayout } from "./layout/responsive.js";
import { terminalDiagnostics } from "./terminal/detect.js";
import { refreshAll } from "./data.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { WorkspacePage } from "./pages/WorkspacePage.js";
import { ComponentsPage } from "./pages/ComponentsPage.js";
import { RegistryPage } from "./pages/RegistryPage.js";
import { ProfilesPage } from "./pages/ProfilesPage.js";
import { RecipesPage } from "./pages/RecipesPage.js";
import { GeneratorPage } from "./pages/GeneratorPage.js";
import { PluginsPage } from "./pages/PluginsPage.js";
import { DoctorPage } from "./pages/DoctorPage.js";
import { RepairPage } from "./pages/RepairPage.js";
import { BenchmarkPage } from "./pages/BenchmarkPage.js";
import { CompatibilityPage } from "./pages/CompatibilityPage.js";
import { GraphPage } from "./pages/GraphPage.js";
import { AIPage } from "./pages/AIPage.js";
import { AIOverviewPage } from "./pages/AIOverviewPage.js";
import { AIProvidersPage } from "./pages/AIProvidersPage.js";
import { AIModelsPage } from "./pages/AIModelsPage.js";
import { AICredentialsPage } from "./pages/AICredentialsPage.js";
import { AIDiagnosticsPage } from "./pages/AIDiagnosticsPage.js";
import { AICapabilitiesPage } from "./pages/AICapabilitiesPage.js";
import { AIHistoryPage } from "./pages/AIHistoryPage.js";
import { UpdatesPage } from "./pages/UpdatesPage.js";
import { InventoryPage } from "./pages/InventoryPage.js";
import { ConfigPage } from "./pages/ConfigPage.js";
import { LogsPage } from "./pages/LogsPage.js";
import { HelpPage } from "./pages/HelpPage.js";
import { AboutPage } from "./pages/AboutPage.js";
import { SearchPage } from "./pages/SearchPage.js";
import { CommandsPage } from "./pages/CommandsPage.js";
import { resizeMetrics } from "./resizeMetrics.js";

// Pages that own their own local "/" filter (via components/ui.js's
// useFilterField) must never also have "/" open the global search
// overlay. This can't be solved reactively by checking state.typing at
// keypress time: Ink's useInput dispatches every active handler for one
// keystroke synchronously off the *same* pre-keystroke render, and
// Shell's own handler (registered when Shell mounts, before any child
// page) always runs before a page's handler in that same pass - so a
// page dispatching setTyping(true) in reaction to "/" can never beat
// Shell's own check for that identical keystroke. Making the exclusion
// static (which pages have a local filter, decided once, not per
// keystroke) removes the race entirely instead of trying to win it.
const PAGES_WITH_LOCAL_FILTER = new Set(["components", "commands", "ai-models"]);

const PAGE_COMPONENTS = {
    dashboard: DashboardPage,
    workspaces: WorkspacePage,
    components: ComponentsPage,
    registry: RegistryPage,
    profiles: ProfilesPage,
    recipes: RecipesPage,
    generator: GeneratorPage,
    plugins: PluginsPage,
    doctor: DoctorPage,
    repair: RepairPage,
    benchmark: BenchmarkPage,
    compatibility: CompatibilityPage,
    graph: GraphPage,
    ai: AIPage,
    "ai-overview": AIOverviewPage,
    "ai-providers": AIProvidersPage,
    "ai-models": AIModelsPage,
    "ai-credentials": AICredentialsPage,
    "ai-diagnostics": AIDiagnosticsPage,
    "ai-capabilities": AICapabilitiesPage,
    "ai-history": AIHistoryPage,
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
        overflow: "hidden",
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
    // Same reasoning as `navigate` above: a stable reference (not
    // `actions.dismissToast`, which store.js rebuilds inside a
    // `useMemo(..., [state, suspend])` every single dispatch) so the
    // now-memoized StatusBar's `dismissToast` prop doesn't look "new"
    // on every render and defeat the memo it was just given.
    const dismissToast = useCallback((id) => dispatch({ type: "dismissToast", id }), [dispatch]);

    useInput((input, key) => {
        if (process.env.DEVFORGEKIT_TUI_DEBUG) {
            console.error(`[shell-input] input=${JSON.stringify(input)} tab=${key.tab} esc=${key.escape} typing=${state.typing} focus=${state.focus} page=${state.page}`);
        }
        // OnboardingWizard owns the keyboard exclusively while it's up -
        // no global shortcut (nav letters, /, :, R, q...) should act
        // silently underneath a first-run wizard the user hasn't even
        // dismissed yet (e.g. navigating pages or opening search behind
        // it, only to reveal the side effect the moment it closes).
        if (state.onboarding) return;
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
        if (ch === "/" && !state.typing && !state.searchOpen && !PAGES_WITH_LOCAL_FILTER.has(state.page)) {
            dispatch({ type: "openSearch" });
            return;
        }
        // Command Palette (v2.0.1): Ctrl+P (VS Code convention) or ':'
        // (vim/lazygit convention) - jump to any page or run a global
        // action, distinct from '/' search. Static exclusion (paletteOpen
        // check) rather than reacting to `typing`, same reasoning as the
        // '/' guard above - no same-tick race to win.
        if ((ch === ":" || (key.ctrl && ch === "p")) && !state.typing && !state.searchOpen && !state.paletteOpen) {
            dispatch({ type: "openPalette" });
            return;
        }
        if (key.escape && state.searchOpen) {
            dispatch({ type: "closeSearch" });
            return;
        }
        if (key.escape && state.paletteOpen) {
            dispatch({ type: "closePalette" });
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

    // First-run onboarding (v2.0.4) takes over the *whole* screen - not
    // just the content pane next to Nav - the same full-screen-swap
    // TooSmallScreen above already uses, and for the same reason: a
    // first-run wizard should be the only thing the user can interact
    // with, not a page sharing screen space with a still-clickable Nav
    // sidebar behind it.
    if (state.onboarding) {
        return h(Box, { flexDirection: "column", height: rows },
            layout.showHeader && h(DashboardHeader, { theme, columns, rows }),
            h(Box, { height: layout.contentHeight, overflow: "hidden" }, h(OnboardingWizard)));
    }

    const contentActive = state.focus === "content" && !state.searchOpen;

    // Shell chrome (header, status bar, nav hints) is fixed, sized region
    // by sized region, exactly per shellLayout()'s own math - and the
    // root Box gets an explicit `height: rows`, not just `minHeight`, so
    // Yoga treats the terminal's row count as a hard ceiling instead of
    // sizing to content. Without an explicit height, flexGrow on the
    // content row below is a no-op (flexGrow only distributes space
    // within a parent that itself has a resolved height) and a page
    // whose content is taller than its budget silently grows the whole
    // tree past `rows` - Ink still prints every one of those lines, so
    // the terminal's own scrollback takes over and drags previously
    // printed rows (the header) up off-screen. That was the actual bug:
    // `layout.contentHeight` already existed but nothing enforced it.
    // `overflow: "hidden"` on the content row is what makes the ceiling
    // real - it clips any page's overflow instead of letting it expand
    // its box, so the header/nav/status bar physically cannot move
    // regardless of how much a given page (or a given selected item
    // within a page) renders.
    return h(Box, { flexDirection: "column", height: rows },
        layout.showHeader && h(DashboardHeader, { theme, columns, rows }),
        h(Box, { height: layout.contentHeight, overflow: "hidden" },
            h(Nav, {
                isActive: state.focus === "nav" && !state.searchOpen,
                page: state.page,
                theme,
                columns,
                onNavigate: navigate
            }),
            h(Box, { flexDirection: "column", flexGrow: 1, overflow: "hidden" },
                state.modal
                    ? h(ModalHost, { theme })
                    : state.paletteOpen
                        ? h(CommandPalette)
                        : state.searchOpen
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
        layout.showStatusBar && h(StatusBar, {
            theme, page: state.page, busy: state.busy, toast: state.toasts[0], dismissToast
        }),
        layout.showNavHints && state.focus === "nav" && !state.searchOpen
            ? h(Box, { paddingX: 1 }, h(KeyHints, {
                theme, lead: "Menu focused",
                hints: [["Enter", "open"], ["Tab", "into page"], ["/", "search"], ["q", "quit"]]
            }))
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
        h(ReducedMotionProvider, null,
            h(StoreProvider, { initialPage, suspend }, h(Shell))));
}
