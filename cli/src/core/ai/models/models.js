// Thin wrapper over a provider's own listModels() - kept as its own
// module (rather than inlined in commands/ai.js) so it matches the PRD's
// module list and gives future callers (the dashboard's AI page) one
// place to import from.
import { getProvider } from "../providers/index.js";

export async function listModelsForProvider(providerId, opts = {}) {
    const provider = getProvider(providerId, opts);
    return provider.listModels();
}
