// Configuration: view and edit the same layered config the CLI's
// `config get/set/list` manages. Edits go through core/config.js's
// setConfigValue - i.e. straight to ~/.config/devforgekit/config.yaml,
// never anywhere new. Enum fields cycle on Enter/Space; free-text
// fields open a TextField; the theme field applies live.
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, SelectList, TextField, KeyHints, useDetailWidth } from "../components/ui.js";
import { useStore } from "../store.js";
import { currentConfig } from "../data.js";
import { setConfigValue } from "../../core/config.js";
import { getThemeNames } from "../theme.js";

// The editable field surface: every existing config field plus the
// TUI's own tuiTheme. `values` = enum (cycles), `text` = free text.
// `note` marks the fields that are stored but not consumed by anything
// yet - shown inline so the dashboard never oversells them.
const FIELDS = [
    { key: "tuiTheme", values: null, note: "dashboard theme (applies live)" },
    { key: "editor", values: ["vscode", "cursor", "zed", "neovim"] },
    { key: "shell", values: ["zsh", "bash", "fish"] },
    { key: "packageManager", values: ["brew", "npm", "pnpm"] },
    { key: "browser", values: ["chrome", "safari", "firefox", "arc"] },
    { key: "aiProvider", values: ["none", "openai", "anthropic", "ollama"] },
    { key: "defaultProfile", text: true },
    { key: "updateSchedule", values: ["manual", "daily", "weekly"], note: "stored; no scheduler consumes it yet" },
    { key: "telemetry", values: [false, true], note: "stored; nothing reports anywhere yet" },
    { key: "registryUrl", text: true, note: "stored; remote registry fetch is design-only" },
    { key: "colorOutput", values: [true, false] },
    { key: "startupAnimation", values: [true, false], note: "the launch splash before the dashboard mounts" },
    { key: "startupAnimationSpeed", values: ["normal", "fast", "off"], note: "fast skips particles/pacing; off = same as startupAnimation: false" }
];

export function ConfigPage({ isActive }) {
    const { theme, state, dispatch, actions } = useStore();
    const [editing, setEditing] = useState(null); // field being text-edited
    const [draft, setDraft] = useState("");
    const [, forceRender] = useState(0);
    const detailW = useDetailWidth(40);

    const config = currentConfig();

    // tuiTheme falls back to the theme actually in effect (the store
    // resolved it at launch), so the row never shows "-" while the
    // dashboard is visibly rendering *some* theme.
    function displayValue(field) {
        if (field.key === "tuiTheme") return config.tuiTheme ?? state.themeName;
        return config[field.key];
    }

    function applyValue(field, value) {
        setConfigValue(field.key, value);
        actions.log(`config set ${field.key} ${value}`);
        actions.notify(`${field.key} = ${value}`, "success");
        if (field.key === "tuiTheme") {
            dispatch({ type: "setTheme", name: value });
        }
        forceRender((n) => n + 1);
    }

    function cycle(field) {
        if (field.text) {
            setEditing(field);
            setDraft(String(config[field.key] ?? ""));
            dispatch({ type: "setTyping", typing: true });
            return;
        }
        const values = field.key === "tuiTheme" ? getThemeNames() : field.values;
        const idx = values.findIndex((v) => String(v) === String(displayValue(field)));
        applyValue(field, values[(idx + 1) % values.length]);
    }

    useInput((input, key) => {
        if (editing) {
            if (key.return) {
                applyValue(editing, draft);
                setEditing(null);
                dispatch({ type: "setTyping", typing: false });
            } else if (key.escape) {
                setEditing(null);
                dispatch({ type: "setTyping", typing: false });
            }
        }
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    return h(Box, { flexGrow: 1 },
        h(Panel, { title: "Configuration (~/.config/devforgekit/config.yaml)", theme, isActive, flexGrow: 1 },
            editing
                ? h(Box, { flexDirection: "column" },
                    h(Text, { color: theme.text }, `${editing.key}:`),
                    h(TextField, { value: draft, onChange: setDraft, isActive: true, theme }),
                    h(KeyHints, { theme, hints: [["Enter", "save"], ["Esc", "cancel"]] }))
                : h(SelectList, {
                    items: FIELDS, isActive, height: 14, theme,
                    onSelect: cycle,
                    onSpace: cycle,
                    renderItem: (field, selected) => h(Text, {
                        key: field.key,
                        backgroundColor: selected && isActive ? theme.selection : undefined,
                        color: selected && isActive ? theme.selectionText : theme.text
                    }, `${selected ? "❯ " : "  "}${field.key.padEnd(18)} ${String(displayValue(field) ?? "-").padEnd(14)} ${field.note ? `(${field.note})` : ""}`)
                }),
            editing ? null : h(Box, { marginTop: 1, flexDirection: "column" },
                h(KeyHints, { theme, hints: [["Enter/Space", "cycle or edit"]] }),
                h(Text, { color: theme.textMuted, wrap: "wrap" }, "changes write to config.yaml immediately"))
        ),
        h(Panel, { title: "Precedence", theme, width: detailW },
            h(Text, { color: theme.textMuted, wrap: "wrap" },
                "defaults < repo .devforgekit.yml < ~/.config/devforgekit/config.yaml < DEVFORGEKIT_* env vars < per-command flags.\n\nThis page edits the user file - env vars still win at runtime, same as the CLI."))
    );
}
