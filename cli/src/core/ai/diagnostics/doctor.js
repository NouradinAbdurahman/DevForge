// AI Doctor: turns a raw compatibility/component scan into the PRD's
// worked example ("Flutter itself is healthy. The iOS toolchain cannot
// build. Reason: ... Recommended fix: ... Estimated time: ... Risk: none")
// instead of a bare diagnostic line. Asks the provider for strict JSON and
// falls back to the raw text (marked `unstructured: true`) if the model
// doesn't comply - never fabricates a fix/risk field that wasn't actually
// in the response.
import { getProvider } from "../providers/index.js";
import { buildPrompt } from "../prompts/library.js";
import { gatherContext } from "../context/gather.js";
import { recordEvent } from "../memory/history.js";

function parseJSONResponse(content) {
    const cleaned = content.trim().replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        return null;
    }
}

// runAIDoctor(opts) -> { summary, reason, fix, estimatedTime, risk, raw, unstructured? }
// `fetchImpl` is an optional passthrough to getProvider() (see its own
// doc comment) - lets tests exercise this against an injected fake
// instead of a real network call.
export async function runAIDoctor({ providerId, workspace, apiKey, model, endpoint, fetchImpl, context } = {}) {
    const gathered = context || await gatherContext({ full: true });
    const provider = getProvider(providerId, { apiKey, model, endpoint, workspace, fetchImpl });
    const messages = buildPrompt("doctor", gathered);
    const { content } = await provider.chat(messages);
    const parsed = parseJSONResponse(content);

    const result = (parsed && typeof parsed.summary === "string")
        ? {
            summary: parsed.summary,
            reason: parsed.reason || "",
            fix: parsed.fix || "",
            estimatedTime: parsed.estimatedTime || "",
            risk: parsed.risk || "unknown",
            raw: content
        }
        : { summary: content, reason: "", fix: "", estimatedTime: "", risk: "unknown", raw: content, unstructured: true };

    recordEvent("ai-doctor", result.summary.slice(0, 200), { risk: result.risk });
    return result;
}
