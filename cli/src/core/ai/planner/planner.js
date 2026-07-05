// The AI Planner: maps a natural-language goal ("I want to become a
// backend engineer") onto the *real* registry - existing collections,
// recipes, and components - rather than letting the model invent a plan
// out of thin air. Every name the model returns is checked against the
// real registry and dropped (not acted on) if it doesn't exist; the
// resulting plan is executed through the same `profile create`/`recipe
// install` machinery every other profile already uses, never a bespoke
// install path.
import { loadCollections, loadRecipes, loadPackages } from "../../registry.js";
import { getProvider } from "../providers/index.js";
import { buildPrompt } from "../prompts/library.js";
import { gatherContext } from "../context/gather.js";
import { recordEvent } from "../memory/history.js";
import { DevForgeError } from "../../errors.js";

function registryOptions() {
    return {
        collections: loadCollections().map((c) => ({ name: c.name, description: c.description })),
        recipes: loadRecipes().map((r) => ({ name: r.name, description: r.description })),
        components: loadPackages().map((p) => ({ name: p.name, category: p.category, description: p.description }))
    };
}

function parseJSONResponse(content) {
    const cleaned = content.trim().replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        return null;
    }
}

function filterKnown(names, known, dropped) {
    const kept = [];
    for (const name of names || []) {
        if (known.has(name)) kept.push(name);
        else dropped.push(name);
    }
    return kept;
}

// planGoal(goalText, opts) -> { profileName, description, collections,
// recipes, components, dropped }. `dropped` lists any name the model
// returned that isn't real - reported to the caller, never silently acted
// on.
export async function planGoal(goalText, { providerId, workspace, apiKey, model, endpoint, fetchImpl } = {}) {
    const options = registryOptions();
    const baseContext = await gatherContext();
    const context = { ...baseContext, registryOptions: options };

    const provider = getProvider(providerId, { apiKey, model, endpoint, workspace, fetchImpl });
    const messages = buildPrompt("plan", context, goalText);
    const { content } = await provider.chat(messages);
    const parsed = parseJSONResponse(content);

    if (!parsed || typeof parsed.profileName !== "string") {
        throw new DevForgeError(`AI planner returned an unexpected response: ${content.slice(0, 300)}`);
    }

    const dropped = [];
    const plan = {
        profileName: parsed.profileName,
        description: parsed.description || `Plan for: ${goalText}`,
        collections: filterKnown(parsed.collections, new Set(options.collections.map((c) => c.name)), dropped),
        recipes: filterKnown(parsed.recipes, new Set(options.recipes.map((r) => r.name)), dropped),
        components: filterKnown(parsed.components, new Set(options.components.map((c) => c.name)), dropped),
        dropped
    };

    recordEvent("ai-plan", `Planned '${plan.profileName}' for goal: ${goalText.slice(0, 100)}`, {
        collections: plan.collections.length,
        recipes: plan.recipes.length,
        components: plan.components.length
    });
    return plan;
}
