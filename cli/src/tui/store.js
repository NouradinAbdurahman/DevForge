// Global dashboard state: one React context + reducer (Bubble Tea's
// single-model/update pattern, expressed in React) - no state library,
// the shape is small enough that one reducer stays readable. Pages get
// { state, dispatch, actions } from useStore().
import React, { useReducer, useContext, createContext, useMemo } from "react";
import { getTheme } from "./theme.js";
import { loadConfig } from "../core/config.js";

const h = React.createElement;

export const PAGES = [
    { id: "dashboard", label: "Dashboard", shortcut: "1" },
    { id: "workspaces", label: "Workspaces", shortcut: "w" },
    { id: "components", label: "Components", shortcut: "c" },
    { id: "profiles", label: "Profiles", shortcut: "p" },
    { id: "recipes", label: "Recipes", shortcut: "r" },
    { id: "generator", label: "Project Generator", shortcut: "g" },
    { id: "plugins", label: "Plugins", shortcut: "n" },
    { id: "doctor", label: "Doctor", shortcut: "d" },
    { id: "compatibility", label: "Compatibility", shortcut: "m" },
    { id: "ai", label: "AI Assistant", shortcut: "e" },
    { id: "updates", label: "Updates", shortcut: "u" },
    { id: "inventory", label: "Inventory", shortcut: "i" },
    { id: "commands", label: "Commands", shortcut: "k" },
    { id: "config", label: "Configuration", shortcut: "o" },
    { id: "logs", label: "Logs", shortcut: "l" },
    { id: "help", label: "Help", shortcut: "?" },
    { id: "about", label: "About", shortcut: "a" }
];

function initialState({ initialPage } = {}) {
    // Theme preference persists through the existing configuration
    // system (~/.config/devforgekit/config.yaml, `tuiTheme` key) - the
    // TUI reads it at launch and `config set`-style writes happen on the
    // Configuration page.
    let themeName = "dark";
    try {
        const config = loadConfig();
        if (config.tuiTheme) themeName = config.tuiTheme;
    } catch {
        // An unreadable config file must not stop the dashboard from
        // launching - fall back to the default theme.
    }

    return {
        page: initialPage || "dashboard",
        focus: "nav",              // "nav" | "content" - Tab toggles
        themeName,
        searchOpen: false,
        searchQuery: "",
        typing: false,             // true while a TextField owns the keyboard
        busy: null,                // { label } while a long operation runs
        notifications: [],         // newest first, capped
        logs: []                   // session action log, newest last, capped
    };
}

function reducer(state, action) {
    switch (action.type) {
        case "navigate":
            return { ...state, page: action.page, focus: "content", searchOpen: false };
        case "focus":
            return { ...state, focus: action.focus };
        case "toggleFocus":
            return { ...state, focus: state.focus === "nav" ? "content" : "nav" };
        case "setTheme":
            return { ...state, themeName: action.name };
        case "openSearch":
            return { ...state, searchOpen: true, searchQuery: "", typing: true };
        case "closeSearch":
            return { ...state, searchOpen: false, typing: false };
        case "setSearchQuery":
            return { ...state, searchQuery: action.query };
        case "setTyping":
            return { ...state, typing: action.typing };
        case "setBusy":
            return { ...state, busy: action.busy };
        case "notify": {
            const entry = { level: action.level || "info", message: action.message, time: new Date() };
            return {
                ...state,
                notifications: [entry, ...state.notifications].slice(0, 50),
                logs: [...state.logs, entry].slice(-500)
            };
        }
        case "log": {
            const entry = { level: action.level || "info", message: action.message, time: new Date() };
            return { ...state, logs: [...state.logs, entry].slice(-500) };
        }
        default:
            return state;
    }
}

const StoreContext = createContext(null);

// `suspend` comes from tui/index.js's launchDashboard: an async (fn) =>
// that unmounts Ink, hands the real terminal to fn (scaffolding CLIs,
// scripts/doctor.sh...), then re-renders the dashboard - the same
// pattern lazygit uses for $EDITOR. Tests pass a no-op.
export function StoreProvider({ children, initialPage, suspend }) {
    const [state, dispatch] = useReducer(reducer, { initialPage }, initialState);

    const value = useMemo(() => ({
        state,
        dispatch,
        theme: getTheme(state.themeName),
        // Carry the current page across the suspend/remount boundary so
        // the relaunched dashboard reopens where the user left.
        suspend: (fn) => (suspend || (async (f) => f()))(fn, state.page),
        actions: {
            navigate: (page) => dispatch({ type: "navigate", page }),
            notify: (message, level = "info") => dispatch({ type: "notify", message, level }),
            log: (message, level = "info") => dispatch({ type: "log", message, level }),
            setBusy: (busy) => dispatch({ type: "setBusy", busy })
        }
    }), [state, suspend]);

    return h(StoreContext.Provider, { value }, children);
}

export function useStore() {
    const store = useContext(StoreContext);
    if (!store) throw new Error("useStore must be used inside <StoreProvider>");
    return store;
}
