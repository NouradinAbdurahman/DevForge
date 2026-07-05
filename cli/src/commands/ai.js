// The AI Development Assistant's command surface (v1.3.0 - see
// docs/AIAssistant.md). Every subcommand is a thin wrapper; real logic
// lives in core/ai/*.js. With no provider configured (the default,
// `aiProvider: "none"`), every subcommand degrades to a clear, actionable
// message instead of crashing or faking a response - see the module doc
// comments under core/ai/ for why.
import path from "node:path";
import { loadConfig } from "../core/config.js";
import { getActiveWorkspace } from "../core/workspace/store.js";
import { getProvider, listProviders, resolveApiKey, requiresApiKey, envVarForProvider, KNOWN_PROVIDERS } from "../core/ai/providers/index.js";
import { gatherContext, installedComponentNames } from "../core/ai/context/gather.js";
import { buildPrompt } from "../core/ai/prompts/library.js";
import { recordEvent, getHistory } from "../core/ai/memory/history.js";
import { runAIDoctor } from "../core/ai/diagnostics/doctor.js";
import { planGoal } from "../core/ai/planner/planner.js";
import { createChatSession } from "../core/ai/chat/session.js";
import { listModelsForProvider } from "../core/ai/models/models.js";
import { scanCompatibility } from "../core/compatibility/engine.js";
import { planRepair, executeRepairPlan } from "../core/compatibility/repair.js";
import { runInstallPlan } from "../lib/installRunner.js";
import { getCollection, getRecipe, expandRecipe } from "../core/registry.js";
import { GENERATORS, getGenerator } from "../generators/index.js";
import { runProjectGenerator } from "../core/projectGenerator.js";
import { text, confirm } from "../lib/prompts.js";
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

function printNotConfigured() {
    logger.warn("No AI provider configured.");
    logger.info(`Run 'devforgekit config set aiProvider <${KNOWN_PROVIDERS.join("|")}>' to choose one, or pass --provider explicitly.`);
    logger.info("Cloud providers also need an API key: set the matching env var (e.g. OPENAI_API_KEY), or reference a workspace secret via the active workspace's ai.apiKeyRef.");
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
        logger.warn(`'${resolved.providerId}' is configured but no API key was found.`);
        logger.info(`Set ${envVarForProvider(resolved.providerId)}, or reference a workspace secret via the active workspace's ai.apiKeyRef.`);
        process.exitCode = 1;
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
    const { content } = await provider.chat(messages);
    console.log(content);
    recordEvent(`ai-${kind}`, `Ran 'ai ${kind}'${input ? `: ${input.slice(0, 100)}` : ""}`);
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

    ai.command("history")
        .description("Show the local AI event log (never chat contents - see docs/MemorySystem.md)")
        .action(withErrorHandling(() => {
            const history = getHistory();
            if (history.length === 0) {
                logger.info("No AI activity recorded yet.");
                return;
            }
            logger.section(`AI activity (${history.length})`);
            for (const entry of history) console.log(`  ${entry.timestamp}  [${entry.type}]  ${entry.summary}`);
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
}
