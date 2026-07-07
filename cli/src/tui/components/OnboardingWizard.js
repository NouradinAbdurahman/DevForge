// First-run onboarding (v2.0.4): welcome, pick a theme, a shortcuts
// tour, a pages tour, a profile suggestion, and an AI-setup nudge - then
// never shown again (persisted via actions.dismissOnboarding, which
// writes config.yaml's onboardingSeen:true synchronously before this
// component even unmounts). Rendered by App.js's Shell in place of the
// active page's content, the same full-swap pattern every other
// content-area overlay (ModalHost, CommandPalette, SearchPage) uses -
// Ink has no floating overlay to place this "above" the dashboard
// instead.
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, KeyHints } from "./ui.js";
import { useStore } from "../store.js";
import { getThemeNames, getTheme } from "../theme.js";
import { registrySnapshot } from "../data.js";

const STEPS = ["welcome", "theme", "shortcuts", "pages", "profile", "ai"];

// A small, curated subset (not all ~50) - onboarding is a first
// impression, not a registry browser; ProfilesPage (p) is where the
// full list lives.
const SUGGESTED_PROFILE_NAMES = ["backend", "frontend", "flutter", "ai-engineer", "devops"];

function StepDots({ step, theme }) {
    return h(Text, { color: theme.textMuted },
        STEPS.map((_, i) => (i === step ? "●" : "○")).join(" "));
}

export function OnboardingWizard() {
    const { theme, dispatch, actions } = useStore();
    const [step, setStep] = useState(0);
    const themeNames = getThemeNames();
    const themeIndex = Math.max(0, themeNames.indexOf(theme.id));

    function finish() {
        actions.dismissOnboarding();
    }

    function next() {
        if (step >= STEPS.length - 1) { finish(); return; }
        setStep((s) => s + 1);
    }

    function back() {
        setStep((s) => Math.max(0, s - 1));
    }

    useInput((input, key) => {
        if (key.escape) { finish(); return; }
        if (STEPS[step] === "theme" && (key.upArrow || key.downArrow)) {
            const delta = key.upArrow ? -1 : 1;
            const nextIndex = (themeIndex + delta + themeNames.length) % themeNames.length;
            dispatch({ type: "setTheme", name: themeNames[nextIndex] });
            return;
        }
        if (key.return || key.rightArrow) { next(); return; }
        if (key.leftArrow) { back(); return; }
    }, { isActive: true });

    let body;
    if (STEPS[step] === "welcome") {
        body = h(Box, { flexDirection: "column" },
            h(Text, { color: theme.accent, bold: true }, "Welcome to DevForgeKit"),
            h(Text, { color: theme.text, wrap: "wrap" },
                "\nA cross-platform development workstation lifecycle manager - bootstrap, a 250+ component registry, profiles, recipes, plugins, a project generator, and this dashboard."),
            h(Text, { color: theme.textMuted, wrap: "wrap" },
                "\nThis short tour covers picking a theme, the keyboard model, what's on each page, and where to start. It only shows once."));
    } else if (STEPS[step] === "theme") {
        const previewTheme = getTheme(themeNames[themeIndex]);
        body = h(Box, { flexDirection: "column" },
            h(Text, { color: theme.accent, bold: true }, "Choose a theme"),
            h(Text, { color: theme.textMuted }, "\n↑↓ to preview live, Enter/→ to keep it and continue."),
            h(Box, { marginTop: 1 },
                h(Text, { color: previewTheme.accent, bold: true }, `${themeIndex + 1}/${themeNames.length}  `),
                h(Text, { color: previewTheme.text }, previewTheme.name)));
    } else if (STEPS[step] === "shortcuts") {
        body = h(Box, { flexDirection: "column" },
            h(Text, { color: theme.accent, bold: true }, "The keyboard model"),
            h(Text, { color: theme.textMuted }, "\nTwo focus zones: the menu (left) and the page (right). Tab switches between them."),
            h(Box, { marginTop: 1, flexDirection: "column" },
                h(KeyHints, { theme, hints: [["Tab", "focus"], ["↑↓ / jk", "move"], ["PgUp/PgDn · g/G", "page / jump"]] }),
                h(KeyHints, { theme, hints: [["Enter", "open"], ["Esc", "back"], ["/", "search or filter"]] }),
                h(KeyHints, { theme, hints: [[": / Ctrl+P", "Command Palette"], ["R", "refresh"], ["?", "help anytime"]] })));
    } else if (STEPS[step] === "pages") {
        body = h(Box, { flexDirection: "column" },
            h(Text, { color: theme.accent, bold: true }, "What's on each page"),
            h(Box, { marginTop: 1, flexDirection: "column" },
                h(Text, { color: theme.text }, "Dashboard - machine + registry status at a glance"),
                h(Text, { color: theme.text }, "Components / Profiles / Recipes - browse and install from the registry"),
                h(Text, { color: theme.text }, "Doctor / Compatibility - diagnose and repair your environment"),
                h(Text, { color: theme.text }, "AI Assistant (and its sub-pages) - providers, models, credentials, diagnostics"),
                h(Text, { color: theme.text }, "Workspaces - switch git/SSH/env/cloud identity as one unit"),
                h(Text, { color: theme.textMuted, wrap: "wrap" }, "\n? opens the full keyboard/page reference again from anywhere.")));
    } else if (STEPS[step] === "profile") {
        let profiles = [];
        try {
            const registry = registrySnapshot();
            profiles = SUGGESTED_PROFILE_NAMES
                .map((name) => registry.profiles.find((p) => p.name === name))
                .filter(Boolean);
        } catch {
            profiles = [];
        }
        body = h(Box, { flexDirection: "column" },
            h(Text, { color: theme.accent, bold: true }, "A profile bundles the tools for one kind of work"),
            h(Text, { color: theme.textMuted }, "\nA few popular ones - browse the full list anytime on Profiles (p):"),
            h(Box, { marginTop: 1, flexDirection: "column" },
                ...(profiles.length > 0
                    ? profiles.map((p) => h(Text, { key: p.name },
                        h(Text, { color: theme.accent }, `  ${p.name.padEnd(16)}`),
                        h(Text, { color: theme.textMuted }, (p.description || "").slice(0, 50))))
                    : [h(Text, { color: theme.textMuted }, "  (registry not available right now)")])));
    } else {
        body = h(Box, { flexDirection: "column" },
            h(Text, { color: theme.accent, bold: true }, "Optional: set up the AI Assistant"),
            h(Text, { color: theme.text, wrap: "wrap" },
                "\nDevForgeKit can explain diagnostics, review your setup, and generate projects using an AI provider you configure - OpenAI, Anthropic, Gemini, Groq, OpenRouter, or a local Ollama/LM Studio server."),
            h(Text, { color: theme.textMuted, wrap: "wrap" },
                "\nNot required - skip it for now and set it up anytime from AI Providers (P) or `devforgekit ai setup`."),
            h(Text, { color: theme.accent, bold: true }, "\nYou're all set - Enter to start."));
    }

    return h(Panel, { title: "Getting started", theme, isActive: true, flexGrow: 1 },
        h(Box, { flexDirection: "column", flexGrow: 1 },
            body,
            h(Box, { marginTop: 1, flexDirection: "column" },
                h(StepDots, { step, theme }),
                h(Box, { marginTop: 1 },
                    h(KeyHints, {
                        theme,
                        hints: step === STEPS.length - 1
                            ? [["Enter", "get started"], ["←", "back"], ["Esc", "skip"]]
                            : [["Enter/→", "next"], ["←", "back"], ["Esc", "skip tour"]]
                    })))));
}
