// AI-assisted compatibility recommendations - real now that v1.3.0's AI
// Development Assistant (core/ai/) exists. Delegates to the same provider/
// prompt machinery `devforgekit ai explain`/`ai repair` use, so a
// compatibility scan gets the exact same real-provider, no-fabrication
// treatment: with no provider configured (or a cloud provider missing its
// API key), this throws a clear, actionable error rather than faking a
// response - mirroring `commands/ai.js`'s own "not configured" gate.
import { getProvider, resolveApiKey, requiresApiKey } from "../ai/providers/index.js";
import { buildPrompt } from "../ai/prompts/library.js";
import { getActiveWorkspace } from "../workspace/store.js";
import { loadConfig } from "../config.js";
import { DevForgeError } from "../errors.js";

// getAIRecommendations(scanResult, [opts]) -> Promise<string> - a plain-
// language explanation of a scanCompatibility() result, from the
// configured AI provider. `providerId`/`model`/`endpoint` override
// core/config.js's aiProvider/aiModel/aiEndpoint the same way every
// `ai` command's flags do; `fetchImpl` is the same optional passthrough
// every core/ai/ entry point accepts, so tests exercise the fully-wired
// path against an injected fake instead of a real network call.
export async function getAIRecommendations(scanResult, { providerId, model, endpoint, fetchImpl } = {}) {
    const config = loadConfig();
    const resolvedProviderId = providerId || (config.aiProvider && config.aiProvider !== "none" ? config.aiProvider : null);
    if (!resolvedProviderId) {
        throw new DevForgeError(
            "No AI provider configured. Run 'devforgekit config set aiProvider <openai|anthropic|gemini|groq|openrouter|ollama|lmstudio>' " +
            "(see docs/AIAssistant.md), or use 'devforgekit compatibility explain <name>'/'compatibility repair' for rule-based recommendations without AI."
        );
    }

    const workspace = getActiveWorkspace();
    if (requiresApiKey(resolvedProviderId) && !resolveApiKey(resolvedProviderId, { workspace })) {
        throw new DevForgeError(`'${resolvedProviderId}' is configured but no API key was found (set its env var, or reference a workspace secret via ai.apiKeyRef).`);
    }

    const provider = getProvider(resolvedProviderId, {
        model: model || config.aiModel || undefined,
        endpoint: endpoint || config.aiEndpoint || undefined,
        workspace,
        fetchImpl
    });
    const context = { compatibility: scanResult };
    const messages = buildPrompt("explain", context, "these compatibility scan results, and how to address any issues found");
    const { content } = await provider.chat(messages);
    return content;
}
