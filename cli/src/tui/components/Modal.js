// ModalHost: the in-Ink replacement for lib/prompts.js's suspend-based
// text()/confirm() prompts. Rendered by App.js's Shell in place of the
// active page's content when state.modal is set (Ink has no true
// floating overlay/z-index - see components/ui.js's Panel comment on
// Box having no backgroundColor - so this is a full content-area swap,
// the same trick PageContainer already uses to switch pages, not a
// translucent popup). Header/nav/status bar stay visible around it.
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, TextField, KeyHints } from "./ui.js";
import { useStore } from "../store.js";

function ConfirmModal({ modal, theme, onResolve }) {
    useInput((input, key) => {
        if (key.return || input === "y" || input === "Y") onResolve(true);
        else if (key.escape || input === "n" || input === "N") onResolve(false);
    }, { isActive: true });

    return h(Panel, { title: "Confirm", theme, isActive: true, width: 60 },
        h(Text, { color: theme.text }, modal.message),
        h(Box, { marginTop: 1 },
            h(KeyHints, { theme, hints: [["y/Enter", "confirm"], ["n/Esc", "cancel"]] })));
}

function TextModal({ modal, theme, onResolve }) {
    const [value, setValue] = useState(modal.initial || "");

    // Enter always resolves with the typed string (even "" - callers
    // that treat a blank submit as "clear this value" rely on that, the
    // same contract lib/prompts.js's text() already had). Only Esc
    // resolves null, meaning "cancelled, don't touch anything".
    useInput((input, key) => {
        if (key.return) onResolve(value.trim());
        else if (key.escape) onResolve(null);
    }, { isActive: true });

    return h(Panel, { title: "Input", theme, isActive: true, width: 60 },
        h(Text, { color: theme.text }, modal.message),
        h(Box, { marginTop: 1 }, h(TextField, { value, onChange: setValue, isActive: true, theme })),
        h(Box, { marginTop: 1 },
            h(KeyHints, { theme, hints: [["Enter", "submit"], ["Esc", "cancel (blank clears)"]] })));
}

export function ModalHost({ theme }) {
    const { state, actions } = useStore();
    const modal = state.modal;
    if (!modal) return null;

    return h(Box, { flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center" },
        modal.kind === "confirm"
            ? h(ConfirmModal, { modal, theme, onResolve: actions.resolveModal })
            : h(TextModal, { modal, theme, onResolve: actions.resolveModal }));
}
