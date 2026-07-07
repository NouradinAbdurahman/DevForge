// Model metadata: heuristic information about known models. This is NOT
// a live API call — it's a static knowledge base that gives users useful
// context when browsing models (context window, capabilities, cost tier,
// release year, etc.). Unknown models get reasonable defaults.
const MODEL_META = {
    // OpenAI
    "gpt-4o": { context: "128K tokens", vision: true, reasoning: "Good", coding: "★★★★★", latency: "Medium", cost: "$$$", released: "2024", supports: ["Text", "Vision", "JSON", "Tools", "Streaming"] },
    "gpt-4o-mini": { context: "128K tokens", vision: true, reasoning: "Good", coding: "★★★★☆", latency: "Fast", cost: "$", released: "2024", supports: ["Text", "Vision", "JSON", "Tools", "Streaming"] },
    "gpt-4-turbo": { context: "128K tokens", vision: true, reasoning: "Excellent", coding: "★★★★★", latency: "Medium", cost: "$$$$", released: "2023", supports: ["Text", "Vision", "JSON", "Tools", "Streaming"] },
    "gpt-4": { context: "8K tokens", vision: false, reasoning: "Excellent", coding: "★★★★★", latency: "Slow", cost: "$$$$", released: "2023", supports: ["Text", "JSON", "Tools", "Streaming"] },
    "gpt-3.5-turbo": { context: "16K tokens", vision: false, reasoning: "Fair", coding: "★★★☆☆", latency: "Fast", cost: "$", released: "2022", supports: ["Text", "JSON", "Tools", "Streaming"] },
    "o1": { context: "200K tokens", vision: false, reasoning: "Excellent", coding: "★★★★★", latency: "Slow", cost: "$$$$", released: "2024", supports: ["Text", "Reasoning", "Streaming"] },
    "o1-mini": { context: "128K tokens", vision: false, reasoning: "Excellent", coding: "★★★★☆", latency: "Medium", cost: "$$$", released: "2024", supports: ["Text", "Reasoning"] },
    "o3-mini": { context: "200K tokens", vision: false, reasoning: "Excellent", coding: "★★★★★", latency: "Medium", cost: "$$", released: "2025", supports: ["Text", "Reasoning", "Streaming"] },
    // Anthropic
    "claude-3-5-sonnet-latest": { context: "200K tokens", vision: true, reasoning: "Excellent", coding: "★★★★★", latency: "Medium", cost: "$$$", released: "2024", supports: ["Text", "Vision", "JSON", "Tools", "Streaming"] },
    "claude-3-5-haiku-latest": { context: "200K tokens", vision: true, reasoning: "Good", coding: "★★★★☆", latency: "Fast", cost: "$", released: "2024", supports: ["Text", "Vision", "JSON", "Tools", "Streaming"] },
    "claude-3-opus-latest": { context: "200K tokens", vision: true, reasoning: "Excellent", coding: "★★★★★", latency: "Slow", cost: "$$$$", released: "2024", supports: ["Text", "Vision", "JSON", "Tools", "Streaming"] },
    // Gemini
    "gemini-1.5-flash": { context: "1M tokens", vision: true, reasoning: "Good", coding: "★★★★☆", latency: "Fast", cost: "$", released: "2024", supports: ["Text", "Vision", "JSON", "Tools", "Streaming"] },
    "gemini-1.5-pro": { context: "2M tokens", vision: true, reasoning: "Excellent", coding: "★★★★★", latency: "Medium", cost: "$$$", released: "2024", supports: ["Text", "Vision", "JSON", "Tools", "Streaming"] },
    "gemini-2.0-flash": { context: "1M tokens", vision: true, reasoning: "Excellent", coding: "★★★★★", latency: "Fast", cost: "$", released: "2024", supports: ["Text", "Vision", "JSON", "Tools", "Streaming"] },
    // Groq
    "llama-3.1-8b-instant": { context: "128K tokens", vision: false, reasoning: "Fair", coding: "★★★☆☆", latency: "Very Fast", cost: "Free", released: "2024", supports: ["Text", "JSON", "Tools", "Streaming"] },
    "llama-3.1-70b-versatile": { context: "128K tokens", vision: false, reasoning: "Good", coding: "★★★★☆", latency: "Fast", cost: "$", released: "2024", supports: ["Text", "JSON", "Tools", "Streaming"] },
    "llama-3.3-70b-versatile": { context: "128K tokens", vision: false, reasoning: "Good", coding: "★★★★☆", latency: "Fast", cost: "$", released: "2024", supports: ["Text", "JSON", "Tools", "Streaming"] },
    // Ollama
    "llama3": { context: "8K tokens", vision: false, reasoning: "Fair", coding: "★★★☆☆", latency: "Local", cost: "Free", released: "2024", supports: ["Text", "Streaming"] },
    "llama3.1": { context: "128K tokens", vision: false, reasoning: "Good", coding: "★★★★☆", latency: "Local", cost: "Free", released: "2024", supports: ["Text", "Streaming"] },
    "mistral": { context: "32K tokens", vision: false, reasoning: "Good", coding: "★★★★☆", latency: "Local", cost: "Free", released: "2023", supports: ["Text", "Streaming"] },
    "qwen2.5": { context: "128K tokens", vision: false, reasoning: "Good", coding: "★★★★☆", latency: "Local", cost: "Free", released: "2024", supports: ["Text", "Streaming"] },
    "deepseek-r1": { context: "128K tokens", vision: false, reasoning: "Excellent", coding: "★★★★★", latency: "Local", cost: "Free", released: "2025", supports: ["Text", "Reasoning", "Streaming"] },
    // LM Studio
    "local-model": { context: "Variable", vision: false, reasoning: "Variable", coding: "Variable", latency: "Local", cost: "Free", released: "—", supports: ["Text", "Streaming"] }
};

// getModelMeta(modelId) -> { context, vision, reasoning, coding, latency, cost, released, supports }
// Returns best-effort metadata. For unknown models, tries prefix matching
// (e.g. "gpt-4o-2024-08-06" matches "gpt-4o"). Falls back to defaults.
export function getModelMeta(modelId) {
    if (!modelId) return null;

    // Exact match
    if (MODEL_META[modelId]) return MODEL_META[modelId];

    // Prefix match: try progressively shorter prefixes
    const lower = modelId.toLowerCase();
    for (const [key, meta] of Object.entries(MODEL_META)) {
        if (lower.startsWith(key)) return meta;
    }

    // Heuristic defaults based on name patterns
    const supports = ["Text", "Streaming"];
    if (/vision|vl|multimodal/i.test(modelId)) supports.push("Vision");
    if (/reason|think|o1|o3|o4|r1/i.test(modelId)) supports.push("Reasoning");
    if (/code|coder|coding/i.test(modelId)) supports.push("Code");

    return {
        context: "Unknown",
        vision: /vision|vl|multimodal/i.test(modelId),
        reasoning: "Unknown",
        coding: "Unknown",
        latency: "Unknown",
        cost: "Unknown",
        released: "Unknown",
        supports
    };
}

// Sort models by a given criteria
// sortModels(models, sortBy) -> sortedModels
export function sortModels(models, sortBy = "name") {
    const sorted = [...models];
    switch (sortBy) {
        case "newest":
            return sorted.sort((a, b) => {
                const ma = getModelMeta(a);
                const mb = getModelMeta(b);
                return (mb?.released || "").localeCompare(ma?.released || "");
            });
        case "fastest":
            return sorted.sort((a, b) => {
                const order = { "Very Fast": 0, "Fast": 1, "Local": 2, "Medium": 3, "Slow": 4, "Unknown": 5 };
                const ma = getModelMeta(a);
                const mb = getModelMeta(b);
                return (order[ma?.latency] ?? 5) - (order[mb?.latency] ?? 5);
            });
        case "cheapest":
            return sorted.sort((a, b) => {
                const order = { "Free": 0, "$": 1, "$$": 2, "$$$": 3, "$$$$": 4, "Unknown": 5 };
                const ma = getModelMeta(a);
                const mb = getModelMeta(b);
                return (order[ma?.cost] ?? 5) - (order[mb?.cost] ?? 5);
            });
        case "context":
            return sorted.sort((a, b) => {
                const ma = getModelMeta(a);
                const mb = getModelMeta(b);
                const parseCtx = (s) => {
                    if (!s) return 0;
                    const m = s.match(/(\d+)\s*K/i);
                    if (m) return parseInt(m[1]) * 1000;
                    const m2 = s.match(/(\d+)\s*M/i);
                    if (m2) return parseInt(m2[1]) * 1000000;
                    return 0;
                };
                return parseCtx(mb?.context) - parseCtx(ma?.context);
            });
        case "name":
        default:
            return sorted.sort((a, b) => a.localeCompare(b));
    }
}

export { MODEL_META };
