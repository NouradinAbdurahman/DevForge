// Global dashboard state: one React context + reducer (Bubble Tea's
// single-model/update pattern, expressed in React) - no state library,
// the shape is small enough that one reducer stays readable. Pages get
// { state, dispatch, actions } from useStore().
import React, { useReducer, useContext, createContext, useMemo, useRef } from "react";
import { getTheme } from "./theme.js";
import { loadConfig, setConfigValue } from "../core/config.js";

const h = React.createElement;

export const PAGES = [
    { id: "dashboard", label: "Dashboard", shortcut: "1" },
    { id: "workspaces", label: "Workspaces", shortcut: "w" },
    { id: "components", label: "Components", shortcut: "c" },
    { id: "registry", label: "Registry", shortcut: "y" },
    { id: "profiles", label: "Profiles", shortcut: "p" },
    { id: "recipes", label: "Recipes", shortcut: "r" },
    { id: "generator", label: "Project Generator", shortcut: "g" },
    { id: "plugins", label: "Plugins", shortcut: "n" },
    { id: "doctor", label: "Doctor", shortcut: "d" },
    { id: "repair", label: "Repair Engine", shortcut: "R" },
    { id: "benchmark", label: "Benchmark", shortcut: "B" },
    { id: "compatibility", label: "Compatibility", shortcut: "m" },
    { id: "graph", label: "Environment Graph", shortcut: "G" },
    { id: "ai", label: "AI Assistant", shortcut: "e" },
    { id: "ai-overview", label: "AI Overview", shortcut: "E" },
    { id: "ai-providers", label: "AI Providers", shortcut: "P" },
    { id: "ai-models", label: "AI Models", shortcut: "M" },
    { id: "ai-credentials", label: "AI Credentials", shortcut: "K" },
    { id: "ai-diagnostics", label: "AI Diagnostics", shortcut: "D" },
    { id: "ai-capabilities", label: "AI Capabilities", shortcut: "C" },
    { id: "ai-history", label: "AI History", shortcut: "H" },
    { id: "updates", label: "Updates", shortcut: "u" },
    { id: "inventory", label: "Inventory", shortcut: "i" },
    { id: "commands", label: "Commands", shortcut: "k" },
    { id: "config", label: "Configuration", shortcut: "o" },
    { id: "logs", label: "Logs", shortcut: "l" },
    { id: "help", label: "Help", shortcut: "?" },
    { id: "about", label: "About", shortcut: "a" }
];

export function initialState({ initialPage } = {}) {
    // Theme preference persists through the existing configuration
    // system (~/.config/devforgekit/config.yaml, `tuiTheme` key) - the
    // TUI reads it at launch and `config set`-style writes happen on the
    // Configuration page.
    let themeName = "dark";
    let onboarding;
    try {
        const config = loadConfig();
        if (config.tuiTheme) themeName = config.tuiTheme;
        onboarding = config.onboardingSeen !== true;
    } catch {
        // An unreadable config file must not stop the dashboard from
        // launching - fall back to the default theme, and skip
        // onboarding rather than risk trapping the user in a wizard an
        // unreadable config can't ever mark as seen.
        onboarding = false;
    }

    return {
        page: initialPage || "dashboard",
        focus: "nav",              // "nav" | "content" - Tab toggles
        themeName,
        searchOpen: false,
        searchQuery: "",
        paletteOpen: false,        // Command Palette (Ctrl+P / ':') - v2.0.1
        onboarding,                // first-run wizard (v2.0.4) - true until dismissed once, ever
        typing: false,             // true while a TextField owns the keyboard
        busy: null,                // { label } while a long operation runs
        notifications: [],         // newest first, capped - full history (Logs page)
        logs: [],                  // session action log, newest last, capped
        toasts: [],                // active auto-dismissing toasts, oldest first
        toastSeq: 0,               // monotonic id source for toasts
        modal: null                // { id, kind: "confirm"|"text", message, initial } | null
    };
}

// Exported (alongside initialState below) purely so the reducer's pure
// logic - toast dedup, navigate resetting searchOpen/paletteOpen, etc. -
// can be unit-tested directly instead of only indirectly through a full
// Ink render.
export function reducer(state, action) {
    switch (action.type) {
        case "navigate":
            return { ...state, page: action.page, focus: "content", searchOpen: false, paletteOpen: false };
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
        case "openPalette":
            return { ...state, paletteOpen: true, typing: true };
        case "closePalette":
            return { ...state, paletteOpen: false, typing: false };
        case "dismissOnboarding":
            return { ...state, onboarding: false };
        case "setSearchQuery":
            return { ...state, searchQuery: action.query };
        case "setTyping":
            return { ...state, typing: action.typing };
        case "setBusy":
            return { ...state, busy: action.busy };
        case "notify": {
            const entry = { level: action.level || "info", message: action.message, time: new Date() };
            // History (notifications/logs) always records every event,
            // even a repeat - Logs page is the honest record of what
            // happened. The *toast* queue is display-only real estate
            // (one status-bar line), so a message identical to whatever
            // is already the newest queued toast doesn't queue a second
            // copy - a fast repeat (e.g. a polling loop reporting the
            // same "still waiting" message) would otherwise just make
            // the user wait through duplicate toasts saying nothing new.
            const lastToast = state.toasts[state.toasts.length - 1];
            const isRepeat = lastToast && lastToast.message === entry.message && lastToast.level === entry.level;
            const toastId = state.toastSeq + 1;
            return {
                ...state,
                notifications: [entry, ...state.notifications].slice(0, 50),
                logs: [...state.logs, entry].slice(-500),
                toasts: isRepeat ? state.toasts : [...state.toasts, { id: toastId, level: entry.level, message: entry.message }],
                toastSeq: isRepeat ? state.toastSeq : toastId
            };
        }
        case "log": {
            const entry = { level: action.level || "info", message: action.message, time: new Date() };
            return { ...state, logs: [...state.logs, entry].slice(-500) };
        }
        case "dismissToast":
            return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
        case "openModal":
            // typing:true while the modal owns the keyboard, so App.js's
            // global shortcuts (q/?/R and single-letter page shortcuts)
            // don't fire while the user is answering a confirm/text
            // prompt - the same flag TextField-owning pages already rely
            // on, just triggered by the modal instead of a page-local field.
            return { ...state, modal: action.modal, typing: true };
        case "closeModal":
            return { ...state, modal: null, typing: false };
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

    // Modal promise resolvers live outside reducer state (in a ref, keyed
    // by modal id) rather than as a state field - a reducer describes
    // "what happened", not "who's waiting for the answer", and a resolver
    // function isn't state anyone should render from.
    const modalResolvers = useRef(new Map());
    const modalIdRef = useRef(0);

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
            setBusy: (busy) => dispatch({ type: "setBusy", busy }),
            dismissToast: (id) => dispatch({ type: "dismissToast", id }),
            // Persists immediately (setConfigValue is synchronous - see
            // core/config.js) so the wizard truly never shows again,
            // same "write straight to config.yaml, no separate flag to
            // forget to flush" contract every other persisted TUI
            // preference (tuiTheme, aiProvider...) already uses.
            dismissOnboarding: () => {
                setConfigValue("onboardingSeen", true);
                dispatch({ type: "dismissOnboarding" });
            },
            // In-Ink replacements for lib/prompts.js's suspend-based
            // text()/confirm() - for a one-line confirm or text prompt,
            // suspending Ink (unmounting, handing over the real TTY) is
            // overkill and visibly flickers; these render ModalHost in
            // place instead and resolve the same way `await text(...)`
            // did, so call sites barely change.
            confirmAsync: (message) => new Promise((resolve) => {
                const id = ++modalIdRef.current;
                modalResolvers.current.set(id, resolve);
                dispatch({ type: "openModal", modal: { id, kind: "confirm", message } });
            }),
            promptTextAsync: (message, initial = "") => new Promise((resolve) => {
                const id = ++modalIdRef.current;
                modalResolvers.current.set(id, resolve);
                dispatch({ type: "openModal", modal: { id, kind: "text", message, initial } });
            }),
            resolveModal: (value) => {
                const modal = state.modal;
                if (!modal) return;
                const resolve = modalResolvers.current.get(modal.id);
                modalResolvers.current.delete(modal.id);
                dispatch({ type: "closeModal" });
                if (resolve) resolve(value);
            }
        }
    }), [state, suspend]);

    return h(StoreContext.Provider, { value }, children);
}

export function useStore() {
    const store = useContext(StoreContext);
    if (!store) throw new Error("useStore must be used inside <StoreProvider>");
    return store;
}
