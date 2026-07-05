// AI Assistant: request/response chat (not token-streamed - see the
// v1.3.0 plan's scope note; true streaming inside Ink's render loop is
// high-risk relative to value, and the CLI's `ai chat --stream` already
// covers real streaming). Mirrors DoctorPage/CompatibilityPage's
// "empty state when not configured" pattern.
import { useState, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, TextField, Spinner } from "../components/ui.js";
import { useStore } from "../store.js";
import { createChatSession } from "../../core/ai/chat/session.js";
import { loadConfig } from "../../core/config.js";
import { getActiveWorkspace } from "../../core/workspace/store.js";

export function AIPage({ isActive }) {
    const { theme, state, actions } = useStore();
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState([]);
    const [sending, setSending] = useState(false);
    const sessionRef = useRef(null);

    const config = loadConfig();
    const providerId = config.aiProvider && config.aiProvider !== "none" ? config.aiProvider : null;

    function ensureSession() {
        if (!sessionRef.current) {
            sessionRef.current = createChatSession({
                providerId,
                model: config.aiModel || undefined,
                endpoint: config.aiEndpoint || undefined,
                workspace: getActiveWorkspace()
            });
        }
        return sessionRef.current;
    }

    async function handleSubmit() {
        if (!input.trim() || sending || !providerId) return;
        const userText = input;
        setInput("");
        setMessages((m) => [...m, { role: "user", content: userText }]);
        setSending(true);
        actions.setBusy({ label: "ai chat" });
        try {
            const result = await ensureSession().send(userText);
            setMessages((m) => [...m, { role: "assistant", content: result.content }]);
        } catch (err) {
            setMessages((m) => [...m, { role: "assistant", content: `Error: ${err.message}` }]);
        } finally {
            setSending(false);
            actions.setBusy(null);
        }
    }

    useInput((_input, key) => {
        if (key.return) handleSubmit();
    }, { isActive: Boolean(isActive) && !state.searchOpen && !sending });

    if (!providerId) {
        return h(Panel, { title: "AI Assistant", theme, flexGrow: 1 },
            h(Box, { flexDirection: "column" },
                h(Text, { color: theme.warning }, "No AI provider configured."),
                h(Text, { color: theme.textMuted, wrap: "wrap" },
                    "Set one on the Configuration page ('o'), or run 'devforgekit config set aiProvider <openai|anthropic|gemini|groq|openrouter|ollama|lmstudio>'. Cloud providers also need an API key (env var or workspace secret)."))
        );
    }

    return h(Box, { flexDirection: "column", flexGrow: 1 },
        h(Panel, { title: `AI Assistant (${providerId})`, theme, isActive, flexGrow: 1 },
            h(Box, { flexDirection: "column" },
                messages.length === 0
                    ? h(Text, { color: theme.textMuted }, "Ask about this environment - installed tools, compatibility, workspace, git status...")
                    : null,
                ...messages.map((m, i) => h(Text, {
                    key: m.role + "-" + m.content.slice(0, 20) + "-" + i,
                    color: m.role === "user" ? theme.accent : theme.text,
                    wrap: "wrap"
                }, `${m.role === "user" ? "You" : "AI"}: ${m.content}`)),
                sending ? h(Box, null, h(Spinner, { theme }), h(Text, { color: theme.textMuted }, " thinking...")) : null
            )
        ),
        h(Box, null,
            h(Text, { color: theme.textMuted }, "> "),
            h(TextField, {
                value: input,
                onChange: setInput,
                isActive: Boolean(isActive) && !sending,
                placeholder: "Type a message, Enter to send",
                theme
            })
        )
    );
}
