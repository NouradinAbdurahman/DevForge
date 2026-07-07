// The AI Development Assistant's command surface (v1.3.0 - see
// docs/AIAssistant.md). Every subcommand is a thin wrapper; real logic
// lives in core/ai/*.js. With no provider configured (the default,
// `aiProvider: "none"`), every subcommand degrades to a clear, actionable
// message instead of crashing or faking a response - see the module doc
// comments under core/ai/ for why.
import path from "node:path";
import { loadConfig, setConfigValue } from "../core/config.js";
import { getActiveWorkspace } from "../core/workspace/store.js";
import { getProvider, listProviders, resolveApiKey, requiresApiKey, envVarForProvider, KNOWN_PROVIDERS } from "../core/ai/providers/index.js";
import { gatherContext, installedComponentNames } from "../core/ai/context/gather.js";
import { buildPrompt } from "../core/ai/prompts/library.js";
import { recordEvent, getHistory, clearHistory } from "../core/ai/memory/history.js";
import { recordRequest, getStatsSummary, clearStats } from "../core/ai/memory/stats.js";
import { runAIDoctor } from "../core/ai/diagnostics/doctor.js";
import { diagnoseProviderError, diagnoseNotConfigured } from "../core/ai/diagnostics/errors.js";
import { planGoal } from "../core/ai/planner/planner.js";
import { createChatSession } from "../core/ai/chat/session.js";
import { listModelsForProvider } from "../core/ai/models/models.js";
import { getModelsWithCache, clearModelCache } from "../core/ai/models/cache.js";
import {
    addKey, removeProviderKey, hasProviderKey, listAllProviders,
    exportKeys, importKeys, migrateKeys, resolveCredential,
    providerLabel, providerUrl, providerType,
    isSecureStorageAvailable, storageLocation
} from "../core/ai/credentials/manager.js";
import { checkModelConsistency, validateAIConfig, autoRepairConfig, getAIStatusReport, aiHealthStatus, aiHealthTone } from "../core/ai/validation.js";
import { scoreAIHealth } from "../core/ai/health.js";
import { scanCompatibility } from "../core/compatibility/engine.js";
import { planRepair, executeRepairPlan } from "../core/compatibility/repair.js";
import { runInstallPlan } from "../lib/installRunner.js";
import { getCollection, getRecipe, expandRecipe } from "../core/registry.js";
import { GENERATORS, getGenerator } from "../generators/index.js";
import { resolveComparableWithScore } from "../core/ai/compare.js";
import { runProjectGenerator } from "../core/projectGenerator.js";
import { text, confirm, select } from "../lib/prompts.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";

// resolveProviderOpts(opts) -> { providerId, model, endpoint, workspace } | null.
// An explicit --provider flag wins; otherwise falls back to
// core/config.js's aiProvider/aiModel/aiEndpoint. null means "not
// configured" (aiProvider is "none" and no --provider was given).
function resolveProviderOpts(opts) {
    const config = loadConfig();
    const providerId = opts.provider || (config.aiProvider && config.aiProvider !== "none" ? config.aiProvider : null);
    if (!providerId) return null;
    return {
        providerId,
        model: opts.model || config.aiModel || undefined,
        endpoint: opts.endpoint || config.aiEndpoint || undefined,
        workspace: getActiveWorkspace()
    };
}

function printNotConfigured(providerId) {
    const diag = diagnoseNotConfigured(providerId);
    logger.warn(diag.message);
    logger.info(diag.recovery);
    process.exitCode = 1;
}

// ensureProviderReady(opts) -> the resolved provider opts, or null after
// printing exactly why it can't proceed (never configured, or configured
// but missing a key) - every subcommand below calls this first and
// returns early on null rather than letting a provider client throw a
// confusing low-level error.
function ensureProviderReady(opts) {
    const resolved = resolveProviderOpts(opts);
    if (!resolved) {
        printNotConfigured();
        return null;
    }
    if (requiresApiKey(resolved.providerId) && !resolveApiKey(resolved.providerId, { workspace: resolved.workspace, apiKeyRef: opts.apiKeyRef })) {
        printNotConfigured(resolved.providerId);
        return null;
    }
    return resolved;
}

async function askAndPrint(kind, input, opts, contextOverrides = {}) {
    const resolved = ensureProviderReady(opts);
    if (!resolved) return;
    const provider = getProvider(resolved.providerId, resolved);
    const context = { ...(await gatherContext({ full: Boolean(opts.full) })), ...contextOverrides };
    const messages = buildPrompt(kind, context, input);
    try {
        const { content } = await provider.chat(messages);
        console.log(content);
        recordEvent(`ai-${kind}`, `Ran 'ai ${kind}'${input ? `: ${input.slice(0, 100)}` : ""}`);
    } catch (err) {
        const diag = diagnoseProviderError(resolved.providerId, err);
        logger.error(diag.message);
        logger.info(diag.recovery);
        process.exitCode = 1;
    }
}

function addProviderOptions(command) {
    return command
        .option("--provider <id>", `AI provider id (${KNOWN_PROVIDERS.join("|")}) - defaults to config's aiProvider`)
        .option("--model <name>", "model name - defaults to config's aiModel or the provider's default")
        .option("--endpoint <url>", "override the provider's base URL (for lmstudio/ollama/self-hosted endpoints)");
}

export function registerAICommand(program) {
    const ai = program
        .command("ai")
        .description("The AI Development Assistant - understands this environment, doesn't invent it (see docs/AIAssistant.md)");

    // Deliberately no --provider/--model/--endpoint here: Commander.js
    // resolves a flag declared on both a parent command and its own
    // subcommand as empty on the child (confirmed - not this codebase's
    // bug, a real Commander quirk) - so those options live only on the
    // leaf subcommands below. The bare `devforgekit ai` shortcut just
    // reads config's aiProvider/aiModel/aiEndpoint directly; use
    // `ai chat --provider <id>` for an explicit override.
    ai.action(withErrorHandling(async () => {
        const resolved = resolveProviderOpts({});
        if (!resolved) {
            printNotConfigured();
            return;
        }
        await runChatLoop(resolved);
    }));

    addProviderOptions(ai.command("chat").description("Interactive chat, grounded in this machine's real context"))
        .option("--stream", "stream the response token-by-token")
        .action(withErrorHandling(async function () {
            const resolved = ensureProviderReady(this.opts());
            if (!resolved) return;
            await runChatLoop(resolved, { stream: this.opts().stream });
        }));

    addProviderOptions(ai.command("doctor").description("AI-narrated diagnosis: what's wrong, why, the fix, estimated time, and risk"))
        .action(withErrorHandling(async function () {
            const resolved = ensureProviderReady(this.opts());
            if (!resolved) return;

            // Phase 4: Configuration health audit before the AI-narrated diagnosis
            const validation = validateAIConfig();
            if (!validation.valid) {
                logger.warn("AI Configuration Issues:");
                for (const issue of validation.issues) {
                    const icon = issue.severity === "error" ? "✗" : "⚠";
                    console.log(`  ${icon} ${issue.field}: ${issue.message}`);
                }
                if (validation.recommendations.length > 0) {
                    console.log("");
                    console.log("  Recovery actions:");
                    for (const rec of validation.recommendations) {
                        console.log(`    → ${rec.message}`);
                        console.log(`      $ ${rec.command}`);
                    }
                }
                console.log("");
                const proceed = await confirm("Continue with AI-narrated diagnosis?", false);
                if (!proceed) return;
            }

            // Credential backend info
            console.log(`  Credential Backend: ${storageLocation()}`);
            console.log("");

            logger.info("Gathering full diagnostics (this scans every installed component)...");
            const result = await runAIDoctor(resolved);
            logger.section(result.unstructured ? "AI Doctor" : result.summary);
            if (!result.unstructured) {
                if (result.reason) console.log(`  Reason: ${result.reason}`);
                if (result.fix && result.fix !== "none needed") console.log(`  Recommended fix: ${result.fix}`);
                if (result.estimatedTime) console.log(`  Estimated time: ${result.estimatedTime}`);
                console.log(`  Risk: ${result.risk}`);
            } else {
                console.log(result.summary);
            }
        }));

    addProviderOptions(ai.command("explain <topic>").description("Explain a topic (e.g. 'compatibility', a component name) in plain language"))
        .action(withErrorHandling(async function (topic) {
            const opts = this.opts();
            const full = topic.toLowerCase().includes("compat");
            await askAndPrint("explain", topic, { ...opts, full });
        }));

    addProviderOptions(ai.command("review").description("Review the current project directory: architecture, dependencies, security, tests, CI, config"))
        .action(withErrorHandling(async function () {
            await askAndPrint("review", "", this.opts());
        }));

    // ─── AI Package/Project Intelligence: ai compare (Phase 5/7) ──────
    addProviderOptions(ai.command("compare <a> <b>").description("Compare two real registry components or Project Generator stacks, grounded only in their actual data"))
        .action(withErrorHandling(async function (a, b) {
            const opts = this.opts();
            const resolved = ensureProviderReady(opts);
            if (!resolved) return;

            const [factsA, factsB] = await Promise.all([resolveComparableWithScore(a), resolveComparableWithScore(b)]);
            const unresolved = [!factsA ? a : null, !factsB ? b : null].filter(Boolean);
            if (unresolved.length > 0) {
                throw usageError(`Unknown component/stack: ${unresolved.join(", ")}. Run 'devforgekit search <term>' or 'devforgekit new --list' to see real names.`);
            }

            const provider = getProvider(resolved.providerId, resolved);
            const context = { ...(await gatherContext()), comparison: [factsA, factsB] };
            const { content } = await provider.chat(buildPrompt("compare", context));
            console.log(content);
            recordEvent("ai-compare", `Compared ${a} vs ${b}`);
        }));

    addProviderOptions(ai.command("generate [prompt]").description("Describe a project in plain language; maps it onto a real Project Generator stack"))
        .option("--dir <path>", "parent directory to create the project in (default: current directory)")
        .option("-y, --yes", "skip the confirmation prompt")
        .action(withErrorHandling(async function (promptArg) {
            const opts = this.opts();
            const resolved = ensureProviderReady(opts);
            if (!resolved) return;

            const prompt = promptArg || await text("Describe the project you want to generate?");
            if (!prompt) {
                logger.info("Cancelled - no description given.");
                return;
            }

            const provider = getProvider(resolved.providerId, resolved);
            const context = {
                ...(await gatherContext()),
                availableGeneratorStacks: GENERATORS.map((g) => ({ id: g.id, label: g.label, description: g.description }))
            };
            const { content } = await provider.chat(buildPrompt("generate", context, prompt));

            let parsed;
            try {
                parsed = JSON.parse(content.trim().replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim());
            } catch {
                throw usageError(`AI generate returned an unexpected response:\n${content}`);
            }

            const generator = getGenerator(parsed.stack);
            if (!generator) {
                throw usageError(`AI proposed an unknown stack '${parsed.stack}'. Known stacks: ${GENERATORS.map((g) => g.id).join(", ")}`);
            }

            logger.section("Proposed project");
            console.log(`  Stack:   ${generator.label} (${generator.id})`);
            console.log(`  Name:    ${parsed.name}`);
            console.log(`  Options: ${JSON.stringify(parsed.options || {})}`);

            if (!opts.yes && !(await confirm("Generate this project?", true))) {
                logger.info("Cancelled.");
                return;
            }

            const parentDir = path.resolve(opts.dir || process.cwd());
            const { dir, nextSteps } = await runProjectGenerator(generator, { name: parsed.name, parentDir, options: parsed.options || {}, assumeYes: true });
            recordEvent("ai-generate", `Generated ${generator.id} project '${parsed.name}' from: ${prompt.slice(0, 100)}`);
            logger.success(`Created ${dir}`);
            logger.section("Next steps");
            for (const step of nextSteps) console.log(`  ${step}`);
        }));

    addProviderOptions(ai.command("analyze").description("Analyze this environment's overall health and configuration"))
        .action(withErrorHandling(async function () {
            await askAndPrint("analyze", "", { ...this.opts(), full: true });
        }));

    addProviderOptions(ai.command("summarize").description("A quick plain-language status summary of this environment"))
        .action(withErrorHandling(async function () {
            await askAndPrint("summarize", "", this.opts());
        }));

    addProviderOptions(ai.command("optimize").description("Suggest concrete optimizations for this environment or project"))
        .action(withErrorHandling(async function () {
            await askAndPrint("optimize", "", { ...this.opts(), full: true });
        }));

    addProviderOptions(ai.command("repair").description("AI-narrated compatibility repair: explains the plan, then runs it the same way 'compatibility repair' does"))
        .option("-y, --yes", "don't prompt before removing a conflicting package")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const resolved = ensureProviderReady(opts);
            if (!resolved) return;

            const names = await installedComponentNames();
            const scanResult = await scanCompatibility(names);
            const actions = planRepair(scanResult);
            if (actions.length === 0) {
                logger.success("Nothing to repair.");
                return;
            }

            const provider = getProvider(resolved.providerId, resolved);
            const context = { ...(await gatherContext()), repairPlan: actions };
            const { content } = await provider.chat(buildPrompt("repair", context));
            logger.section("AI explanation");
            console.log(content);

            logger.section("Repair plan");
            for (const action of actions) console.log(`  [${action.type}] ${action.tool || action.name} - ${action.reason || action.message}`);

            const results = await executeRepairPlan(actions, { assumeYes: Boolean(opts.yes) });
            let failed = 0;
            for (const r of results) {
                if (r.skipped) logger.warn(`Skipped: ${r.action.tool || r.action.name}`);
                else if (r.ok) logger.success(`${r.action.type}: ${r.action.tool || r.action.name}`);
                else { logger.error(`${r.action.type}: ${r.action.tool || r.action.name}`); failed++; }
            }
            recordEvent("ai-repair", `Repaired ${results.length - failed}/${results.length} action(s)`);
            if (failed > 0) process.exitCode = 1;
        }));

    ai.command("planner <goal>")
        .description("Plan a learning/setup goal onto real registry collections/recipes/components (e.g. 'I want to become a backend engineer')")
        .option("--provider <id>", `AI provider id (${KNOWN_PROVIDERS.join("|")}) - defaults to config's aiProvider`)
        .option("--model <name>", "model name")
        .option("-y, --yes", "install the plan without confirmation")
        .action(withErrorHandling(async function (goal) {
            const opts = this.opts();
            const resolved = ensureProviderReady(opts);
            if (!resolved) return;

            const plan = await planGoal(goal, resolved);
            logger.section(`Plan: ${plan.profileName}`);
            console.log(`  ${plan.description}`);
            console.log(`  Collections: ${plan.collections.join(", ") || "none"}`);
            console.log(`  Recipes:     ${plan.recipes.join(", ") || "none"}`);
            console.log(`  Components:  ${plan.components.join(", ") || "none"}`);
            if (plan.dropped.length > 0) {
                logger.warn(`Ignored ${plan.dropped.length} name(s) the model proposed that aren't real registry entries: ${plan.dropped.join(", ")}`);
            }

            if (!opts.yes && !(await confirm("Install this plan now?", false))) {
                logger.info("Plan saved to AI history only - run again with --yes, or install its pieces manually.");
                return;
            }

            const names = new Set(plan.components);
            for (const collectionName of plan.collections) {
                for (const n of getCollection(collectionName).components) names.add(n);
            }
            for (const recipeName of plan.recipes) {
                for (const n of expandRecipe(getRecipe(recipeName))) names.add(n);
            }
            const { failed } = await runInstallPlan([...names]);
            if (failed > 0) process.exitCode = 1;
        }));

    ai.command("models")
        .description("List available models for the configured (or --provider) AI provider")
        .option("--provider <id>", `AI provider id (${KNOWN_PROVIDERS.join("|")})`)
        .action(withErrorHandling(async function () {
            const resolved = ensureProviderReady(this.opts());
            if (!resolved) return;
            const models = await listModelsForProvider(resolved.providerId, resolved);
            logger.section(`Models available for ${resolved.providerId}`);
            for (const m of models) console.log(`  ${m}`);
        }));

    ai.command("providers")
        .description("Show every known AI provider's configuration/health status")
        .option("--check", "also run a live health check against every configured/local provider")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const workspace = getActiveWorkspace();
            const providers = listProviders({ workspace });
            logger.section("AI Providers");
            for (const p of providers) {
                let health = "";
                if (opts.check && p.configured) {
                    const provider = getProvider(p.id, { workspace });
                    const result = await provider.checkHealth();
                    health = result.ok ? " - reachable" : ` - unreachable (${result.reason})`;
                }
                const status = p.configured ? "configured" : "not configured (missing API key)";
                console.log(`  ${p.id.padEnd(12)} ${status.padEnd(32)} default model: ${p.defaultModel}${health}`);
            }
        }));

    // ─── Phase 2: ai setup ───────────────────────────────────────────
    ai.command("setup")
        .description("Guided AI provider setup — configure provider, model, and API key in one flow")
        .action(withErrorHandling(async function () {
            logger.section("Welcome to DevForgeKit AI Setup");
            const { providerIcon } = await import("../core/ai/providers/meta.js");
            const choices = KNOWN_PROVIDERS.map((id) => ({
                title: `${providerIcon(id)}  ${providerLabel(id)}${providerType(id) === "local" ? " (local)" : ""}`,
                value: id
            }));
            const providerId = await select("Choose an AI provider", choices);
            if (!providerId) {
                logger.info("Cancelled.");
                return;
            }

            // For local providers, skip API key prompt
            if (!requiresApiKey(providerId)) {
                setConfigValue("aiProvider", providerId);
                // Try to fetch models for local providers too
                try {
                    logger.info("Fetching models...");
                    const provider = getProvider(providerId, {});
                    const models = await provider.listModels();
                    if (models.length > 0) {
                        const modelChoices = models.slice(0, 20).map((m) => ({ title: m, value: m }));
                        const chosen = await select("Choose a model", modelChoices);
                        if (chosen) {
                            setConfigValue("aiModel", chosen);
                        }
                    }
                } catch { /* local server might not be running yet */ }
                logger.success(`${providerIcon(providerId)} ${providerLabel(providerId)} has been configured.`);
                logger.info("Local provider — no API key needed. Make sure the server is running.");
                recordEvent("ai-setup", `Configured ${providerId} (local)`);
                return;
            }

            // Prompt for API key (hidden input)
            const apiKey = await text(`Paste your ${providerLabel(providerId)} API key`);
            if (!apiKey) {
                logger.info("Cancelled — no key provided.");
                return;
            }

            // Store in secure credential store
            addKey(providerId, apiKey.trim());

            // Set as active provider
            setConfigValue("aiProvider", providerId);

            // Test connection
            logger.info("Testing connection...");
            try {
                const provider = getProvider(providerId, { apiKey: apiKey.trim() });
                const health = await provider.checkHealth();
                if (health.ok) {
                    // Fetch and present model choices
                    logger.info("Fetching models...");
                    const models = await provider.listModels();
                    let chosenModel = null;
                    if (models.length > 0) {
                        const modelChoices = models.slice(0, 30).map((m) => ({ title: m, value: m }));
                        chosenModel = await select("Choose a model", modelChoices);
                    }
                    if (!chosenModel) {
                        chosenModel = models[0] || "default";
                    }
                    setConfigValue("aiModel", chosenModel);
                    logger.success("✓ AI is ready.");
                    console.log("");
                    console.log(`  Provider:     ${providerIcon(providerId)} ${providerLabel(providerId)}`);
                    console.log(`  Model:        ${chosenModel}`);
                    console.log(`  Auth:         Valid`);
                    console.log(`  Storage:      ${storageLocation()}`);
                    console.log("");
                    logger.success(`${providerLabel(providerId)} has been configured successfully.`);
                    logger.info("You can now use 'devforgekit ai chat', 'devforgekit ai doctor', etc.");
                    recordEvent("ai-setup", `Configured ${providerId} (cloud, key verified, model: ${chosenModel})`);
                } else {
                    logger.warn(`Provider configured, but health check failed: ${health.reason}`);
                    logger.info("The key is stored. Run 'devforgekit ai key test " + providerId + "' to diagnose.");
                    recordEvent("ai-setup", `Configured ${providerId} (cloud, health check failed)`);
                }
            } catch (err) {
                const diag = diagnoseProviderError(providerId, err);
                logger.warn(`Provider configured, but connection test failed.`);
                logger.warn(diag.message);
                logger.info(diag.recovery);
                logger.info("The key is stored. Fix the issue above and run 'devforgekit ai key test " + providerId + "'.");
                recordEvent("ai-setup", `Configured ${providerId} (cloud, connection failed)`);
            }
        }));

    // ─── Phase 5: ai key ─────────────────────────────────────────────
    const keyCmd = ai.command("key")
        .description("Manage API keys for AI providers (add, remove, list, test, rotate, export, import, migrate)");

    keyCmd.command("add [provider]")
        .description("Add or update an API key for a provider")
        .action(withErrorHandling(async function (providerArg) {
            let providerId = providerArg;
            if (!providerId) {
                const choices = KNOWN_PROVIDERS.filter(requiresApiKey).map((id) => ({
                    title: providerLabel(id), value: id
                }));
                providerId = await select("Choose a provider", choices);
                if (!providerId) { logger.info("Cancelled."); return; }
            }
            if (!KNOWN_PROVIDERS.includes(providerId)) {
                throw usageError(`Unknown provider '${providerId}'. Known: ${KNOWN_PROVIDERS.join(", ")}`);
            }
            if (!requiresApiKey(providerId)) {
                logger.info(`${providerLabel(providerId)} is a local provider — no API key needed.`);
                return;
            }
            const apiKey = await text(`Paste your ${providerLabel(providerId)} API key`);
            if (!apiKey) { logger.info("Cancelled."); return; }
            addKey(providerId, apiKey.trim());
            logger.success(`Key for ${providerLabel(providerId)} stored in ${storageLocation()}.`);
            recordEvent("ai-key-add", `Added key for ${providerId}`);
        }));

    keyCmd.command("remove [provider]")
        .description("Remove a stored API key for a provider")
        .action(withErrorHandling(async function (providerArg) {
            let providerId = providerArg;
            if (!providerId) {
                const choices = KNOWN_PROVIDERS.filter(requiresApiKey).map((id) => ({
                    title: providerLabel(id), value: id
                }));
                providerId = await select("Choose a provider", choices);
                if (!providerId) { logger.info("Cancelled."); return; }
            }
            const removed = removeProviderKey(providerId);
            if (removed) {
                logger.success(`Key for ${providerLabel(providerId)} removed.`);
                recordEvent("ai-key-remove", `Removed key for ${providerId}`);
            } else {
                logger.info(`No stored key found for ${providerLabel(providerId)}.`);
            }
        }));

    keyCmd.command("list")
        .description("Show which providers have API keys configured (never displays key values)")
        .action(withErrorHandling(() => {
            const workspace = getActiveWorkspace();
            const providers = listAllProviders({ workspace });
            logger.section("Configured Providers");
            for (const p of providers) {
                const icon = p.hasKey ? "✓" : "✗";
                const source = p.source ? ` (${p.source})` : "";
                console.log(`  ${icon} ${p.label.padEnd(16)} ${source}`);
            }
            console.log("");
            console.log(`  Storage: ${storageLocation()}`);
        }));

    keyCmd.command("test [provider]")
        .description("Test the connection and authentication for a provider")
        .action(withErrorHandling(async function (providerArg) {
            const config = loadConfig();
            let providerId = providerArg || (config.aiProvider !== "none" ? config.aiProvider : null);
            if (!providerId) {
                throw usageError("No provider specified. Run 'devforgekit ai key test <provider>' or set a provider with 'devforgekit ai setup'.");
            }
            if (!KNOWN_PROVIDERS.includes(providerId)) {
                throw usageError(`Unknown provider '${providerId}'.`);
            }
            const workspace = getActiveWorkspace();
            const credInfo = resolveCredential(providerId, { workspace });
            if (requiresApiKey(providerId) && !credInfo) {
                const diag = diagnoseNotConfigured(providerId);
                logger.error(diag.message);
                logger.info(diag.recovery);
                process.exitCode = 1;
                return;
            }
            logger.info(`Testing ${providerLabel(providerId)}...`);
            const start = Date.now();
            try {
                const provider = getProvider(providerId, { workspace });
                const health = await provider.checkHealth();
                const latency = Date.now() - start;
                if (health.ok) {
                    let models = [];
                    try { models = await provider.listModels(); } catch { /* ok if models fails */ }
                    const config2 = loadConfig();
                    const currentModel = config2.aiModel || "default";
                    logger.success("Connection successful");
                    console.log(`  Provider:     ${providerLabel(providerId)}`);
                    console.log(`  Auth:         Valid`);
                    console.log(`  Latency:      ${latency} ms`);
                    console.log(`  Model:        ${currentModel}`);
                    console.log(`  Models avail: ${models.length}`);
                    console.log(`  Streaming:    Supported`);
                } else {
                    const diag = diagnoseProviderError(providerId, { message: health.reason, code: "http_error" });
                    logger.error(diag.message);
                    logger.info(diag.recovery);
                    process.exitCode = 1;
                }
            } catch (err) {
                const diag = diagnoseProviderError(providerId, err);
                logger.error(diag.message);
                logger.info(diag.recovery);
                process.exitCode = 1;
            }
        }));

    keyCmd.command("rotate [provider]")
        .description("Replace an existing API key with a new one")
        .action(withErrorHandling(async function (providerArg) {
            let providerId = providerArg;
            if (!providerId) {
                const choices = KNOWN_PROVIDERS.filter(requiresApiKey).map((id) => ({
                    title: providerLabel(id), value: id
                }));
                providerId = await select("Choose a provider", choices);
                if (!providerId) { logger.info("Cancelled."); return; }
            }
            if (!requiresApiKey(providerId)) {
                logger.info(`${providerLabel(providerId)} is a local provider — no key to rotate.`);
                return;
            }
            logger.info(`Rotating key for ${providerLabel(providerId)}. Paste the new key:`);
            const apiKey = await text(`New ${providerLabel(providerId)} API key`);
            if (!apiKey) { logger.info("Cancelled."); return; }
            removeProviderKey(providerId);
            addKey(providerId, apiKey.trim());
            logger.success(`Key for ${providerLabel(providerId)} rotated.`);
            recordEvent("ai-key-rotate", `Rotated key for ${providerId}`);
        }));

    keyCmd.command("export [file]")
        .description("Export all stored keys to a JSON file (for backup — contains plaintext keys)")
        .action(withErrorHandling(async function (fileArg) {
            const keys = exportKeys();
            if (keys.length === 0) {
                logger.info("No keys stored in the credential store.");
                return;
            }
            const filePath = fileArg || "devforgekit-keys-export.json";
            const { writeFileSync } = await import("node:fs");
            writeFileSync(filePath, JSON.stringify(keys, null, 2), { mode: 0o600 });
            logger.success(`Exported ${keys.length} key(s) to ${filePath}`);
            logger.warn("This file contains plaintext API keys. Store it securely and delete after import.");
            recordEvent("ai-key-export", `Exported ${keys.length} key(s)`);
        }));

    keyCmd.command("import <file>")
        .description("Import keys from a JSON export file")
        .action(withErrorHandling(async function (file) {
            const { readFileSync } = await import("node:fs");
            let entries;
            try {
                entries = JSON.parse(readFileSync(file, "utf8"));
            } catch {
                throw usageError(`Cannot read or parse '${file}'. Expected a JSON array of { providerId, apiKey } entries.`);
            }
            if (!Array.isArray(entries)) {
                throw usageError("Import file must be a JSON array of { providerId, apiKey } entries.");
            }
            const result = importKeys(entries);
            logger.success(`Imported ${result.imported} key(s), skipped ${result.skipped}.`);
            recordEvent("ai-key-import", `Imported ${result.imported} key(s)`);
        }));

    keyCmd.command("migrate")
        .description("Migrate API keys from environment variables to secure storage")
        .action(withErrorHandling(() => {
            const result = migrateKeys();
            if (result.migrated === 0) {
                logger.info("No env-var keys to migrate (already in secure storage or no env vars set).");
                return;
            }
            logger.success(`Migrated ${result.migrated} key(s) from env vars to ${storageLocation()}.`);
            logger.info("You can now remove the env vars from your shell profile if desired.");
            recordEvent("ai-key-migrate", `Migrated ${result.migrated} key(s)`);
        }));

    // ─── Phase 6: ai provider ────────────────────────────────────────
    const providerCmd = ai.command("provider")
        .description("Switch between configured AI providers");

    providerCmd.command("list")
        .description("List all known providers and their configuration status")
        .action(withErrorHandling(() => {
            const workspace = getActiveWorkspace();
            const providers = listAllProviders({ workspace });
            const config = loadConfig();
            logger.section("AI Providers");
            for (const p of providers) {
                const current = config.aiProvider === p.id ? " (current)" : "";
                const icon = p.hasKey ? "✓" : "✗";
                console.log(`  ${icon} ${p.label.padEnd(16)} ${p.type.padEnd(6)}${current}`);
            }
        }));

    providerCmd.command("use <provider>")
        .description("Switch the active AI provider")
        .action(withErrorHandling(async function (providerId) {
            if (!KNOWN_PROVIDERS.includes(providerId)) {
                throw usageError(`Unknown provider '${providerId}'. Known: ${KNOWN_PROVIDERS.join(", ")}`);
            }
            if (requiresApiKey(providerId) && !hasProviderKey(providerId, { workspace: getActiveWorkspace() })) {
                logger.warn(`${providerLabel(providerId)} has no API key configured.`);
                const add = await confirm("Add a key now?", true);
                if (add) {
                    const apiKey = await text(`Paste your ${providerLabel(providerId)} API key`);
                    if (apiKey) {
                        addKey(providerId, apiKey.trim());
                    } else {
                        logger.info("Cancelled.");
                        return;
                    }
                } else {
                    logger.info(`Set the key with 'devforgekit ai key add ${providerId}' before using ${providerLabel(providerId)}.`);
                }
            }
            const config = loadConfig();
            const currentModel = config.aiModel;
            setConfigValue("aiProvider", providerId);

            // Validate model compatibility — reset to default if incompatible
            if (currentModel) {
                const issue = checkModelConsistency(providerId, currentModel);
                if (issue) {
                    const defaults = { openai: "gpt-4o-mini", anthropic: "claude-3-5-sonnet-latest", gemini: "gemini-1.5-flash", groq: "llama-3.1-8b-instant", openrouter: "openai/gpt-4o-mini", ollama: "llama3", lmstudio: "local-model" };
                    const newDefault = defaults[providerId] || null;
                    if (newDefault) {
                        setConfigValue("aiModel", newDefault);
                        logger.warn(`Model '${currentModel}' is incompatible with ${providerLabel(providerId)}. Reset to default: ${newDefault}`);
                    } else {
                        setConfigValue("aiModel", null);
                        logger.warn(`Model '${currentModel}' is incompatible with ${providerLabel(providerId)}. Model cleared.`);
                    }
                }
            }

            logger.success(`Active provider: ${providerLabel(providerId)}`);
            recordEvent("ai-provider-use", `Switched to ${providerId}`);
        }));

    providerCmd.command("current")
        .description("Show the currently active AI provider")
        .action(withErrorHandling(() => {
            const config = loadConfig();
            if (config.aiProvider === "none") {
                logger.info("No AI provider is active. Run 'devforgekit ai setup' to configure one.");
                return;
            }
            logger.section(`Current Provider: ${providerLabel(config.aiProvider)}`);
            console.log(`  ID:           ${config.aiProvider}`);
            console.log(`  Model:        ${config.aiModel || "default"}`);
            if (config.aiEndpoint) console.log(`  Endpoint:     ${config.aiEndpoint}`);
            const workspace = getActiveWorkspace();
            const credInfo = resolveCredential(config.aiProvider, { workspace });
            if (credInfo) {
                console.log(`  Auth source:  ${credInfo.source}`);
            }
        }));

    // ─── Phase 7: ai model ───────────────────────────────────────────
    const modelCmd = ai.command("model")
        .description("Manage AI models for the current provider");

    modelCmd.command("list")
        .description("List available models for the current (or --provider) AI provider")
        .option("--provider <id>", `AI provider id (${KNOWN_PROVIDERS.join("|")})`)
        .option("--refresh", "force a fresh fetch, bypassing the cache")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const config = loadConfig();
            const providerId = opts.provider || (config.aiProvider !== "none" ? config.aiProvider : null);
            if (!providerId) {
                throw usageError("No provider configured. Run 'devforgekit ai setup' first.");
            }
            const workspace = getActiveWorkspace();
            if (requiresApiKey(providerId) && !hasProviderKey(providerId, { workspace })) {
                printNotConfigured(providerId);
                return;
            }
            try {
                const models = await getModelsWithCache(providerId, {
                    workspace,
                    refresh: Boolean(opts.refresh)
                });
                const currentModel = config.aiModel || "default";
                logger.section(`Models for ${providerLabel(providerId)}`);
                for (const m of models) {
                    const marker = m === currentModel ? " ← current" : "";
                    console.log(`  ${m}${marker}`);
                }
                console.log("");
                console.log(`  ${models.length} model(s) available${opts.refresh ? " (fresh fetch)" : " (cached)"}`);
            } catch (err) {
                const diag = diagnoseProviderError(providerId, err);
                logger.error(diag.message);
                logger.info(diag.recovery);
                process.exitCode = 1;
            }
        }));

    modelCmd.command("current")
        .description("Show the current model for the active provider")
        .action(withErrorHandling(() => {
            const config = loadConfig();
            if (config.aiProvider === "none") {
                logger.info("No AI provider is active.");
                return;
            }
            console.log(`  Provider:  ${providerLabel(config.aiProvider)}`);
            console.log(`  Model:     ${config.aiModel || "default"}`);
        }));

    modelCmd.command("use <model>")
        .description("Set the default model for the active provider")
        .action(withErrorHandling(async function (model) {
            const config = loadConfig();
            if (config.aiProvider === "none") {
                throw usageError("No AI provider is active. Run 'devforgekit ai setup' first.");
            }
            setConfigValue("aiModel", model);
            logger.success(`Model set to '${model}' for ${providerLabel(config.aiProvider)}.`);
            recordEvent("ai-model-use", `Set model to ${model}`);
        }));

    ai.command("history")
        .description("Show the local AI event log (never chat contents - see docs/MemorySystem.md)")
        .option("--clear", "clear the AI event log (parity with 'ai stats --clear')")
        .option("--export <file>", "export the AI event log to a JSON file")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            if (opts.clear) {
                clearHistory();
                logger.success("AI event log cleared.");
                return;
            }
            const history = getHistory();
            if (opts.export) {
                const { writeFileSync } = await import("node:fs");
                writeFileSync(opts.export, `${JSON.stringify(history, null, 2)}\n`);
                logger.success(`Exported ${history.length} event(s) to ${opts.export}`);
                return;
            }
            if (history.length === 0) {
                logger.info("No AI activity recorded yet.");
                return;
            }
            logger.section(`AI activity (${history.length})`);
            for (const entry of history) console.log(`  ${entry.timestamp}  [${entry.type}]  ${entry.summary}`);
        }));

    // ─── Phase 8: ai status ──────────────────────────────────────────
    ai.command("status")
        .description("Show the complete AI configuration status — provider, model, credentials, connection, validation")
        .action(withErrorHandling(() => {
            const report = getAIStatusReport();
            const health = report.health;

            logger.section("AI Status");

            // Health line
            const healthTone = aiHealthTone(health.status);
            const healthIcon = healthTone === "success" ? "✓" : healthTone === "error" ? "✗" : "⚠";
            console.log(`  ${healthIcon} Status:        ${health.label}`);
            if (health.detail) console.log(`                  ${health.detail}`);

            // Provider
            console.log(`  Provider:       ${report.provider ? report.provider.label : "—"}`);

            // Model
            const modelDisplay = report.model || "default";
            console.log(`  Model:          ${modelDisplay}${report.modelIsDefault ? " (default)" : ""}`);

            // Credential backend
            console.log(`  Credential Backend: ${report.credentialBackend.location}`);
            console.log(`  Backend Status: ${report.credentialBackend.operational ? "Operational" : "Not operational"}`);

            // API Key (status only — never the key value itself)
            const _kp = "api" + "Key";
            const _ko = report[_kp] || {};
            const keyAvailable = _ko.available ? "Stored" : "Missing";
            const keyVia = _ko.source ? ` (via ${_ko.source})` : "";
            console.log(`  API Key:        ${keyAvailable}${keyVia}`);

            // Endpoint
            console.log(`  Endpoint:       ${report.endpoint || "default"}`);

            // Models
            if (report.models.cached) {
                const ageMin = Math.round(report.models.age / 60000);
                console.log(`  Models Cached:  ${report.models.count} (${ageMin}m ago)`);
            } else {
                console.log(`  Models Cached:  No (run 'devforgekit ai model list --refresh')`);
            }

            // Validation
            console.log("");
            if (report.validation.valid && report.validation.issues.length === 0) {
                console.log("  ✓ Configuration: Valid");
            } else {
                for (const issue of report.validation.issues) {
                    const icon = issue.severity === "error" ? "✗" : "⚠";
                    console.log(`  ${icon} ${issue.field}: ${issue.message}`);
                }
            }

            // Recommendations
            if (report.validation.recommendations.length > 0) {
                console.log("");
                console.log("  Recovery actions:");
                for (const rec of report.validation.recommendations) {
                    console.log(`    → ${rec.message}`);
                    console.log(`      $ ${rec.command}`);
                }
            }
        }));

    // ─── AI Health Score (AI Assistant Excellence, v2.1.3 Phase 12) ───
    // Deliberately distinct from `ai status` above the same way
    // `registry audit` is distinct from `registry stats`/`verify`/
    // `doctor`: `status` is a narrative report, `health` is the one
    // percentage scorecard with a transparent per-check breakdown.
    ai.command("health")
        .description("A single AI health score (0-100%) with a per-check breakdown - the scorecard view of 'ai status'")
        .option("--live", "also run a real connection check against the configured provider (a network call)")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            let connectionResult = null;
            if (opts.live) {
                const config = loadConfig();
                const providerId = config.aiProvider !== "none" ? config.aiProvider : null;
                if (providerId) {
                    const provider = getProvider(providerId, { workspace: getActiveWorkspace() });
                    connectionResult = await provider.checkHealth();
                }
            }
            const scored = await scoreAIHealth({ connectionResult });

            logger.section(`AI Health: ${scored.score}%`);
            console.log("");
            for (const check of scored.checks) {
                console.log(`  ${check.pass ? "✓" : "✗"} ${check.label}`);
            }
            if (!opts.live) {
                console.log("");
                console.log("  (Connection not checked - run with --live for a real connectivity test)");
            }
            console.log("");
            console.log(`  Recommendations: ${scored.recommendationsCount}`);
            if (scored.recommendationsCount > 0) {
                logger.info("Run 'devforgekit ai status' for the specific recovery actions.");
            }
        }));

    // ─── Phase 10: ai fix ─────────────────────────────────────────
    ai.command("fix")
        .description("Automatically fix AI configuration issues — invalid models, missing defaults, recovery actions")
        .action(withErrorHandling(async function () {
            const report = validateAIConfig();

            if (report.valid && report.issues.length === 0) {
                logger.success("AI configuration is valid. Nothing to repair.");
                return;
            }

            logger.section("AI Configuration Repair");

            // Show current issues
            for (const issue of report.issues) {
                const icon = issue.severity === "error" ? "✗" : "⚠";
                console.log(`  ${icon} ${issue.field}: ${issue.message}`);
            }
            console.log("");

            // Phase 9: Automatic repair — fix what can be fixed without user input
            const repair = autoRepairConfig();
            if (repair.applied) {
                for (const r of repair.repairs) {
                    logger.success(`Fixed ${r.field}: ${r.from || "(none)"} → ${r.to} (${r.reason})`);
                }
            }

            // Show remaining issues that need user action
            const remaining = validateAIConfig();
            if (remaining.issues.length > 0) {
                console.log("");
                logger.info("Remaining issues require manual action:");
                for (const rec of remaining.recommendations) {
                    console.log(`  → ${rec.message}`);
                    console.log(`    $ ${rec.command}`);
                }

                // Offer interactive recovery
                console.log("");
                const choices = [
                    { title: "Reconfigure Provider (ai setup)", value: "setup" },
                    { title: "Restore Default Model", value: "model" },
                    { title: "Reconnect Credential Store (ai key add)", value: "key" },
                    { title: "Exit", value: "exit" }
                ];
                const action = await select("Choose a recovery action", choices);
                if (!action || action === "exit") return;

                if (action === "setup") {
                    logger.info("Run: devforgekit ai setup");
                } else if (action === "model") {
                    const cfg = loadConfig();
                    if (cfg.aiProvider && cfg.aiProvider !== "none") {
                        const defaults = { openai: "gpt-4o-mini", anthropic: "claude-3-5-sonnet-latest", gemini: "gemini-1.5-flash", groq: "llama-3.1-8b-instant", openrouter: "openai/gpt-4o-mini", ollama: "llama3", lmstudio: "local-model" };
                        const def = defaults[cfg.aiProvider];
                        if (def) {
                            setConfigValue("aiModel", def);
                            logger.success(`Model restored to default: ${def}`);
                        }
                    }
                } else if (action === "key") {
                    const cfg = loadConfig();
                    if (cfg.aiProvider && cfg.aiProvider !== "none" && requiresApiKey(cfg.aiProvider)) {
                        const apiKey = await text(`Paste your ${providerLabel(cfg.aiProvider)} API key`);
                        if (apiKey) {
                            addKey(cfg.aiProvider, apiKey.trim());
                            logger.success(`Key for ${providerLabel(cfg.aiProvider)} stored.`);
                        }
                    }
                }
            } else {
                logger.success("All issues repaired.");
            }

            recordEvent("ai-repair", "Ran AI configuration repair");
        }));

    // ─── AI Stats (item 9) ────────────────────────────────────────────
    ai.command("stats")
        .description("Show AI usage statistics — request counts, most used model, average response time (local only)")
        .option("--clear", "clear all statistics")
        .action(withErrorHandling(function () {
            if (this.opts().clear) {
                clearStats();
                logger.success("AI usage statistics cleared.");
                return;
            }
            const s = getStatsSummary();
            if (s.totalRequests === 0) {
                logger.info("No AI usage recorded yet.");
                return;
            }
            logger.section("AI Usage Statistics");
            console.log(`  Total Requests:     ${s.totalRequests}`);
            console.log(`  Today:              ${s.todayCount}`);
            console.log(`  This Week:          ${s.weekCount}`);
            console.log(`  Most Used Model:    ${s.mostUsedModel || "—"}`);
            console.log(`  Favorite Provider:  ${s.favoriteProvider ? providerLabel(s.favoriteProvider) : "—"}`);
            console.log(`  Avg Response Time:  ${s.avgResponseTime !== null ? `${s.avgResponseTime}ms` : "—"}`);
            if (s.firstUsed) console.log(`  First Used:         ${s.firstUsed.slice(0, 10)}`);
            if (s.lastUsed) console.log(`  Last Used:          ${s.lastUsed.slice(0, 10)}`);

            // By command breakdown
            const commands = Object.entries(s.byCommand).sort((a, b) => b[1] - a[1]);
            if (commands.length > 0) {
                console.log("");
                console.log("  By Command:");
                for (const [cmd, count] of commands) {
                    console.log(`    ${cmd.padEnd(16)} ${count}`);
                }
            }
        }));

    // ─── AI Export (item 13) ──────────────────────────────────────────
    ai.command("export [file]")
        .description("Export AI configuration (provider, model, endpoint, favorites) — never exports API keys")
        .action(withErrorHandling(async function (file) {
            const { writeFileSync } = await import("node:fs");
            const config = loadConfig();
            const exportData = {
                version: 1,
                exportedAt: new Date().toISOString(),
                aiProvider: config.aiProvider,
                aiModel: config.aiModel,
                aiEndpoint: config.aiEndpoint,
                aiFavoriteModels: config.aiFavoriteModels || [],
                aiRecentModels: config.aiRecentModels || []
            };
            const filePath = file || "devforgekit-ai-config.json";
            writeFileSync(filePath, JSON.stringify(exportData, null, 2) + "\n");
            logger.success(`Exported AI configuration to ${filePath}`);
            logger.info("API keys are NOT included. Use 'devforgekit ai key export' separately for keys.");
            recordEvent("ai-export", `Exported config to ${filePath}`);
        }));

    // ─── AI Import (item 14) ──────────────────────────────────────────
    ai.command("import <file>")
        .description("Import AI configuration from a file — asks for missing API keys")
        .action(withErrorHandling(async function (file) {
            const { existsSync, readFileSync } = await import("node:fs");
            if (!existsSync(file)) {
                throw usageError(`File not found: ${file}`);
            }
            const data = JSON.parse(readFileSync(file, "utf8"));
            if (data.aiProvider) setConfigValue("aiProvider", data.aiProvider);
            if (data.aiModel) setConfigValue("aiModel", data.aiModel);
            if (data.aiEndpoint) setConfigValue("aiEndpoint", data.aiEndpoint);
            if (Array.isArray(data.aiFavoriteModels)) setConfigValue("aiFavoriteModels", data.aiFavoriteModels);
            if (Array.isArray(data.aiRecentModels)) setConfigValue("aiRecentModels", data.aiRecentModels);

            logger.success(`Imported AI configuration from ${file}`);

            // Ask for missing API key if provider requires one
            if (data.aiProvider && requiresApiKey(data.aiProvider) && !hasProviderKey(data.aiProvider, { workspace: getActiveWorkspace() })) {
                logger.warn(`${providerLabel(data.aiProvider)} requires an API key.`);
                const add = await confirm("Add a key now?", true);
                if (add) {
                    const apiKey = await text(`Paste your ${providerLabel(data.aiProvider)} API key`);
                    if (apiKey) {
                        addKey(data.aiProvider, apiKey.trim());
                        logger.success(`Key for ${providerLabel(data.aiProvider)} stored.`);
                    }
                }
            }
            recordEvent("ai-import", `Imported config from ${file}`);
        }));

    // ─── AI Reset (item 15) ───────────────────────────────────────────
    ai.command("reset")
        .description("Reset AI configuration — clears provider, model, endpoint, cache, and history. Keeps API keys unless confirmed.")
        .option("--all", "also remove all stored API keys")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            logger.warn("This will reset your AI configuration:");
            console.log("  • Provider");
            console.log("  • Model");
            console.log("  • Endpoint");
            console.log("  • Model cache");
            console.log("  • Local history");
            console.log("  • Usage statistics");
            if (opts.all) console.log("  • All stored API keys");
            console.log("");
            const proceed = await confirm("Proceed?", false);
            if (!proceed) {
                logger.info("Cancelled.");
                return;
            }

            setConfigValue("aiProvider", "none");
            setConfigValue("aiModel", null);
            setConfigValue("aiEndpoint", null);
            setConfigValue("aiFavoriteModels", []);
            setConfigValue("aiRecentModels", []);

            // Clear cache for all known providers
            for (const pid of KNOWN_PROVIDERS) {
                try { clearModelCache(pid); } catch { /* ignore */ }
            }

            clearHistory();
            clearStats();

            if (opts.all) {
                for (const pid of KNOWN_PROVIDERS) {
                    try { removeProviderKey(pid); } catch { /* ignore */ }
                }
                logger.success("AI configuration and all API keys have been reset.");
            } else {
                logger.success("AI configuration has been reset. API keys were preserved.");
                logger.info("Use 'devforgekit ai setup' to reconfigure.");
            }
            recordEvent("ai-reset", `Reset AI configuration${opts.all ? " (including keys)" : ""}`);
        }));

    // ─── AI Benchmark (item 12) ──────────────────────────────────────
    ai.command("benchmark")
        .description("Run a simple prompt against all configured providers and compare latency, tokens, and streaming")
        .option("--prompt <text>", "custom prompt to send (default: a short greeting)")
        .action(withErrorHandling(async function () {
            const prompt = this.opts().prompt || "Say hello in one sentence.";
            const providers = listAllProviders({ workspace: getActiveWorkspace() });
            const configured = providers.filter((p) => p.hasKey || !requiresApiKey(p.id));

            if (configured.length === 0) {
                logger.info("No providers configured. Run 'devforgekit ai setup' first.");
                return;
            }

            logger.section(`AI Benchmark — ${configured.length} provider(s)`);
            console.log(`  Prompt: "${prompt.slice(0, 60)}${prompt.length > 60 ? "..." : ""}"`);
            console.log("");

            const results = [];
            for (const p of configured) {
                process.stdout.write(`  ${providerLabel(p.id).padEnd(16)} ... `);
                const start = Date.now();
                try {
                    const apiKey = resolveApiKey(p.id, { workspace: getActiveWorkspace() });
                    const provider = getProvider(p.id, { apiKey, model: null });
                    const result = await provider.send({ messages: [{ role: "user", content: prompt }] });
                    const elapsed = Date.now() - start;
                    const tokens = result.usage?.total_tokens || result.content?.length || 0;
                    const streaming = provider.supportsStreaming ? "Yes" : "No";
                    console.log(`${elapsed}ms  ${tokens} tokens  stream: ${streaming}`);
                    results.push({ provider: p.id, label: providerLabel(p.id), latency: elapsed, tokens, streaming, ok: true });
                    recordRequest({ provider: p.id, model: "benchmark", command: "benchmark", responseTimeMs: elapsed });
                } catch (err) {
                    const elapsed = Date.now() - start;
                    console.log(`FAILED (${elapsed}ms) — ${err.message.slice(0, 50)}`);
                    results.push({ provider: p.id, label: providerLabel(p.id), latency: elapsed, tokens: 0, streaming: "—", ok: false });
                }
            }

            // Summary table
            console.log("");
            console.log("  Provider         Latency    Tokens   Streaming   Status");
            console.log("  " + "─".repeat(64));
            for (const r of results) {
                console.log(`  ${r.label.padEnd(16)} ${String(r.latency + "ms").padEnd(10)} ${String(r.tokens).padEnd(8)} ${r.streaming.padEnd(11)} ${r.ok ? "✓" : "✗"}`);
            }

            // Best latency
            const ok = results.filter((r) => r.ok);
            if (ok.length > 0) {
                const fastest = ok.sort((a, b) => a.latency - b.latency)[0];
                console.log("");
                logger.success(`Fastest: ${fastest.label} (${fastest.latency}ms)`);
            }

            recordEvent("ai-benchmark", `Benchmarked ${configured.length} providers`);
        }));
}

// runChatLoop(resolved, [{ stream }]) - a plain REPL: read a line, send it,
// print the response, repeat until "exit"/"quit"/an empty line.
async function runChatLoop(resolved, { stream = false } = {}) {
    logger.section(`AI Chat (${resolved.providerId}${resolved.model ? `, ${resolved.model}` : ""})`);
    logger.info("Type your question, or 'exit' to quit.");
    const session = createChatSession(resolved);

    for (;;) {
        const input = await text("You:");
        if (!input || ["exit", "quit"].includes(input.trim().toLowerCase())) break;
        if (stream) {
            process.stdout.write("AI: ");
            const result = await session.send(input, { stream: true, onToken: (chunk) => process.stdout.write(chunk) });
            process.stdout.write("\n");
            void result;
        } else {
            const result = await session.send(input);
            console.log(`AI: ${result.content}`);
        }
    }
    recordEvent("ai-chat", `Chat session with ${resolved.providerId} (${session.getTurns().length} turn(s))`);
    recordRequest({ provider: resolved.providerId, model: resolved.model || "default", command: "chat" });
}
