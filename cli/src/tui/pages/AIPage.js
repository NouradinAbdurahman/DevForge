// AI Assistant: request/response chat with a context panel showing
// the current provider, model, workspace, git branch, and components.
// Quick actions for doctor, generate, planner, explain, etc. The
// current provider and model are always visible while chatting.
import { useState, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, TextField, Spinner, KeyValue, useDetailWidth } from "../components/ui.js";
import { MarkdownText } from "../components/markdown.js";
import { AIPageWrapper } from "../components/ai.js";
import { useStore } from "../store.js";
import { createChatSession } from "../../core/ai/chat/session.js";
import { loadConfig } from "../../core/config.js";
import { getActiveWorkspace } from "../../core/workspace/store.js";
import { providerLabel } from "../../core/ai/credentials/manager.js";
import { activeWorkspaceName } from "../data.js";

const QUICK_ACTIONS = [
    ["1", "Doctor"],
    ["2", "Generate"],
    ["3", "Planner"],
    ["4", "Explain"],
    ["5", "Review"],
    ["6", "Optimize"],
    ["7", "Fix"]
];

const ACTION_PROMPTS = {
    "1": "Run a doctor check on my development environment and report any issues.",
    "2": "Generate a new project component based on my current workspace setup.",
    "3": "Create a development plan for my current workspace.",
    "4": "Explain the compatibility status of my installed tools.",
    "5": "Review my development environment for potential improvements.",
    "6": "Suggest optimizations for my current development setup.",
    "7": "Identify and help fix any issues in my development environment."
};

export function AIPage({ isActive }) {
    const { theme, state, actions } = useStore();
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState([]);
    const [sending, setSending] = useState(false);
    const sessionRef = useRef(null);
    const detailW = useDetailWidth(44);

    const config = loadConfig();
    const providerId = config.aiProvider && config.aiProvider !== "none" ? config.aiProvider : null;
    const wsName = activeWorkspaceName();

    function ensureSession() {
        if (!sessionRef.current) {
            sessionRef.current = createChatSession({
                providerId,
                model: config.aiModel || undefined,
                endpoint: config.aiEndpoint || undefined,
                workspace: getActiveWorkspace(),
                surface: "tui"
            });
        }
        return sessionRef.current;
    }

    async function sendPrompt(text) {
        if (!text.trim() || sending || !providerId) return;
        const userText = text;
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
        if (key.return) {
            sendPrompt(input);
            return;
        }
        // Quick action shortcuts (only when not typing in the input)
        if (!input && providerId && !sending) {
            for (const [k] of QUICK_ACTIONS) {
                if (_input === k) {
                    sendPrompt(ACTION_PROMPTS[k]);
                    return;
                }
            }
        }
        // Sub-page navigation
        if (!input) {
            if (_input === "o") actions.navigate("ai-overview");
            else if (_input === "p") actions.navigate("ai-providers");
            else if (_input === "m") actions.navigate("ai-models");
            else if (_input === "k") actions.navigate("ai-credentials");
            else if (_input === "d") actions.navigate("ai-diagnostics");
            else if (_input === "h") actions.navigate("ai-history");
            else if (_input === "c") actions.navigate("ai-capabilities");
        }
    }, { isActive: Boolean(isActive) && !state.searchOpen && !sending });

    const aiConfig = { provider: providerId, model: config.aiModel, endpoint: config.aiEndpoint };

    return h(AIPageWrapper, { page: "ai", config: aiConfig, theme, onNavigate: actions.navigate },
        h(Box, { flexGrow: 1 },
            h(Panel, { title: providerId ? `Chat — ${providerLabel(providerId)}` : "Chat", theme, isActive, flexGrow: 1 },
                h(Box, { flexDirection: "column", flexGrow: 1 },
                    messages.length === 0 && providerId
                        ? h(Text, { color: theme.textMuted }, "Ask about this environment — installed tools, compatibility, workspace, git status...")
                        : null,
                    // Assistant messages go through the Markdown renderer
                    // (v2.1.3.1) rather than printing the model's raw
                    // output - never `## Section`/`**bold**`/`<br>` shown
                    // verbatim. User messages are plain typed text, so
                    // they're shown as-is.
                    ...messages.map((m, i) => m.role === "user"
                        ? h(Box, { key: "u-" + i, marginTop: 1 },
                            h(Text, { color: theme.accent, bold: true }, "You  "),
                            h(Text, { color: theme.text, wrap: "wrap" }, m.content)
                        )
                        : h(Box, { key: "a-" + i, flexDirection: "column" },
                            h(Text, { color: theme.textMuted, bold: true }, "AI"),
                            h(MarkdownText, { text: m.content, theme })
                        )),
                    sending ? h(Box, null, h(Spinner, { theme }), h(Text, { color: theme.textMuted }, " thinking...")) : null
                ),
                // The input line lives inside the Chat panel itself, right
                // under the conversation it feeds - not as a stray line
                // below the whole page, which read as "belonging" to
                // nothing in particular and left it unclear where typing
                // actually went (a real, reported UX bug in v2.1.2's TUI).
                // A top border visually separates it from the transcript
                // above without a second nested Panel border.
                h(Box, {
                    flexShrink: 0, marginTop: 1, paddingTop: 1,
                    borderStyle: "single", borderTop: true, borderBottom: false, borderLeft: false, borderRight: false,
                    borderColor: theme.border
                },
                    h(Text, { color: isActive && !sending ? theme.accent : theme.textMuted, bold: true }, "❯ "),
                    h(TextField, {
                        value: input,
                        onChange: setInput,
                        isActive: Boolean(isActive) && !sending,
                        placeholder: providerId ? "Type a message, Enter to send..." : "Configure a provider first (p)",
                        theme
                    })
                )
            ),
            h(Panel, { title: "Context", theme, width: detailW },
                h(Box, { flexDirection: "column" },
                    h(KeyValue, {
                        theme, labelWidth: 16,
                        pairs: [
                            ["Provider", providerId ? providerLabel(providerId) : "—", providerId ? theme.accent : theme.textMuted],
                            ["Model", config.aiModel || "default", theme.text],
                            ["Workspace", wsName || "—", theme.text],
                            ["Streaming", "Enabled", theme.success]
                        ]
                    }),
                    // Quick Actions live here, permanently - they used to
                    // only show in the Chat panel before the first message
                    // was sent, then visually vanish even though the 1-7
                    // shortcuts kept working (a real reported UX bug: the
                    // shortcuts never stopped working, but nothing on
                    // screen still told you they existed). Explicit short
                    // rows rather than one wrapped KeyHints blob - this
                    // panel is narrow enough that a long wrapped Text run
                    // was overflowing the border and, combined with the
                    // extra height, corrupting the KeyValue rows above it
                    // (the same Ink row-budget bug docs/TUI.md's v2.1.1
                    // note already documents). "Enter send" is dropped
                    // here too - the input field's own placeholder already
                    // says "Enter to send".
                    h(Box, { marginTop: 1, flexDirection: "column" },
                        h(Text, { color: theme.textMuted }, "Quick Actions"),
                        ...QUICK_ACTIONS.map(([key, label]) => h(Text, { key },
                            h(Text, { color: theme.accent, bold: true }, key),
                            h(Text, { color: theme.textMuted }, ` ${label}`)
                        ))
                    )
                )
            )
        )
    );
}
