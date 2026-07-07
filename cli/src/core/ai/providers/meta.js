// Provider metadata: logos (unicode icons), capabilities, and display info.
// Single source of truth for "what can each provider do?" and "what icon
// represents it?" Used by the TUI and CLI for consistent visual identity.
const PROVIDER_ICONS = {
    openai: "◉",
    anthropic: "◎",
    gemini: "◆",
    groq: "⬣",
    openrouter: "⬢",
    ollama: "◈",
    lmstudio: "▣"
};

const PROVIDER_CAPABILITIES = {
    openai: {
        chat: true, vision: true, tools: true, json: true,
        streaming: true, functionCalling: true, reasoning: true,
        embeddings: true
    },
    anthropic: {
        chat: true, vision: true, tools: true, json: true,
        streaming: true, functionCalling: true, reasoning: true,
        embeddings: false
    },
    gemini: {
        chat: true, vision: true, tools: true, json: true,
        streaming: true, functionCalling: true, reasoning: true,
        embeddings: true
    },
    groq: {
        chat: true, vision: false, tools: true, json: true,
        streaming: true, functionCalling: true, reasoning: false,
        embeddings: false
    },
    openrouter: {
        chat: true, vision: true, tools: true, json: true,
        streaming: true, functionCalling: true, reasoning: true,
        embeddings: false
    },
    ollama: {
        chat: true, vision: false, tools: false, json: false,
        streaming: true, functionCalling: false, reasoning: false,
        embeddings: true
    },
    lmstudio: {
        chat: true, vision: false, tools: false, json: false,
        streaming: true, functionCalling: false, reasoning: false,
        embeddings: false
    }
};

const CAPABILITY_LABELS = {
    chat: "Chat",
    vision: "Vision",
    tools: "Tools",
    json: "JSON",
    streaming: "Streaming",
    functionCalling: "Function Calling",
    reasoning: "Reasoning",
    embeddings: "Embeddings"
};

export function providerIcon(providerId) {
    return PROVIDER_ICONS[providerId] || "●";
}

export function providerCapabilities(providerId) {
    return PROVIDER_CAPABILITIES[providerId] || null;
}

export function capabilityLabels() {
    return CAPABILITY_LABELS;
}

export function capabilityList(providerId) {
    const caps = PROVIDER_CAPABILITIES[providerId];
    if (!caps) return [];
    return Object.entries(caps).map(([key, supported]) => ({
        key,
        label: CAPABILITY_LABELS[key] || key,
        supported
    }));
}

export { PROVIDER_ICONS, PROVIDER_CAPABILITIES, CAPABILITY_LABELS };
