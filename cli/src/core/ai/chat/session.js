// A chat session: turn-taking over a provider, primed with the base
// system prompt + context on the first turn. Deliberately in-memory only
// - `turns` never touches disk (see memory/history.js's doc comment on
// why conversations themselves are never persisted, only structured
// events).
import { getProvider } from "../providers/index.js";
import { buildPrompt } from "../prompts/library.js";
import { gatherContext } from "../context/gather.js";

export function createChatSession({ providerId, workspace, apiKey, model, endpoint, fetchImpl } = {}) {
    const provider = getProvider(providerId, { apiKey, model, endpoint, workspace, fetchImpl });
    const turns = [];
    let primed = false;

    async function prime() {
        if (primed) return;
        const context = await gatherContext();
        const [systemMessage] = buildPrompt("chat", context);
        turns.push(systemMessage);
        primed = true;
    }

    // send(userText, [{ stream, onToken }]) -> { content, model }
    async function send(userText, { stream: useStream = false, onToken } = {}) {
        await prime();
        turns.push({ role: "user", content: userText });
        const result = useStream
            ? await provider.stream(turns, {}, onToken)
            : await provider.chat(turns, {});
        turns.push({ role: "assistant", content: result.content });
        return result;
    }

    function reset() {
        turns.length = 0;
        primed = false;
    }

    function getTurns() {
        return [...turns];
    }

    return { send, reset, getTurns, providerId: provider.id };
}
