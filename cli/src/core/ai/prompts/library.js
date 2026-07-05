// The Prompt Library: the base system prompt every `ai` command shares,
// domain-specific snippets layered in when relevant, and one instruction
// template per AI command kind. Plain data + string assembly - no
// business logic lives here, matching core/compatibility/report.js's
// "formatting only" scope.
const BASE_SYSTEM_PROMPT = `You are DevForgeKit AI, the development assistant built into the DevForgeKit CLI.
You understand the user's local development environment through the JSON context block provided below -
installed tools, compatibility status, the active workspace, git status, and configuration. Ground every
answer in that real data; never invent tool names, versions, or file paths that aren't present in it. When
you don't have enough information in the context to answer precisely, say so plainly instead of guessing.`;

// One short, real snippet per domain - not filler. Each nudges the model
// toward the actual conventions/gotchas of that ecosystem.
const DOMAIN_PROMPTS = {
    flutter: "Flutter/Dart focus: check Dart SDK/Xcode/Android SDK/CocoaPods version compatibility, platform channel issues, and pubspec.yaml dependency conflicts.",
    docker: "Docker focus: distinguish image build issues from runtime issues, check for Docker Desktop vs. Colima conflicts, and prefer multi-stage builds for production Dockerfiles.",
    kubernetes: "Kubernetes focus: check client/server version skew (kubectl should stay within one minor version of the cluster), context/namespace correctness, and resource limits.",
    python: "Python focus: distinguish interpreter version issues from virtualenv/dependency issues; prefer pyproject.toml-based tooling (poetry/uv) over bare pip when both are present.",
    node: "Node.js focus: check Node version against a project's engines field, package manager consistency (don't mix npm/pnpm/yarn lockfiles), and whether a version is past its LTS/EOL date.",
    react: "React focus: distinguish build-time errors from runtime errors, check for hook-rule violations, and prefer the project's existing state-management choice over introducing a new one.",
    rust: "Rust focus: check toolchain channel (stable/beta/nightly) and edition compatibility, and prefer `cargo check` for fast feedback over a full build.",
    devops: "DevOps focus: check CI/CD pipeline configuration, infrastructure-as-code drift, and secrets handling - never suggest committing a credential to version control.",
    security: "Security focus: flag anything resembling a hardcoded secret, an overly permissive file mode, or a known-vulnerable dependency version - explain the real risk, don't just name a CVE.",
    databases: "Databases focus: check server version compatibility with the client/ORM in use, connection pooling configuration, and migration state before recommending a schema change."
};

export function listDomainPrompts() {
    return Object.keys(DOMAIN_PROMPTS);
}

export function getDomainPrompt(name) {
    return DOMAIN_PROMPTS[name] || null;
}

// detectDomain(text) -> the first domain whose name appears in the input
// text, or null. A simple, honest heuristic (not a classifier) - good
// enough to layer in a relevant snippet without claiming more than it is.
export function detectDomain(text = "") {
    const lower = text.toLowerCase();
    return Object.keys(DOMAIN_PROMPTS).find((domain) => lower.includes(domain)) || null;
}

function contextBlock(context) {
    return `Current environment (JSON):\n${JSON.stringify(context, null, 2)}`;
}

// One instruction template per `ai` command kind. `doctor` and `repair`
// ask for strict JSON so diagnostics/doctor.js and planner/planner.js can
// parse a structured result instead of scraping prose.
const INSTRUCTIONS = {
    chat: (input) => input,
    doctor: () => `Review the compatibility/component diagnostics in the context above. Respond with ONLY a JSON object
matching exactly this shape (no markdown fences, no extra prose): { "summary": string, "reason": string,
"fix": string, "estimatedTime": string, "risk": "none"|"low"|"medium"|"high" }. If everything is healthy,
say so in "summary" and use "fix": "none needed".`,
    explain: (input) => `Explain "${input}" in the context of this environment, in plain language a developer
who is not an expert in this specific area would understand. Reference the real data in the context block.`,
    review: () => `Review this project (see the context block for its git status and detected tooling) for
architecture, dependencies, security, performance, Docker/CI configuration, tests, and code quality concerns.
List concrete, actionable findings - don't restate generic best practices that don't apply here.`,
    generate: (input) => `The user wants to generate a project described as: "${input}". Respond with ONLY a
JSON object matching exactly this shape (no markdown fences, no extra prose): { "stack": string, "name": string,
"options": object }, where "stack" MUST be one of the stack ids listed in the context block's
"availableGeneratorStacks" array, and "options" only uses flag names that stack's generator actually supports.
Never invent a stack id that isn't in that list.`,
    analyze: () => `Analyze this environment's overall health and configuration. Summarize what's working well
and what deserves attention, grounded in the context block's real data.`,
    summarize: () => `Summarize the current state of this environment and any active project in 3-5 sentences,
suitable as a quick status update for a developer returning to this machine after time away.`,
    optimize: () => `Suggest concrete optimizations for this environment or project - performance, disk usage,
redundant tooling, outdated packages - grounded in the context block's real data. Prioritize the highest-impact
suggestions first.`,
    repair: () => `Explain the repair plan in the context block in plain language: what each action does, why
it's needed, its risk, and its estimated time. Do not suggest any action beyond what's already in the plan.`,
    plan: (input) => `The user's goal is: "${input}". Using ONLY the real collections/recipes/components listed
in the context block's "registryOptions" field, respond with ONLY a JSON object matching exactly this shape
(no markdown fences, no extra prose): { "profileName": string, "description": string, "collections": string[],
"recipes": string[], "components": string[] }. Every string in "collections"/"recipes"/"components" MUST
exactly match a "name" listed in "registryOptions" - never invent a name that isn't listed there. Prefer
recipes/collections over long ad hoc component lists when one already covers the goal well.`
};

// buildPrompt(kind, context, input) -> [{ role, content }, ...] ready to
// pass to an AIProvider's chat()/stream(). Throws for an unknown kind
// rather than silently falling back to a generic prompt.
export function buildPrompt(kind, context, input = "") {
    const instructionFn = INSTRUCTIONS[kind];
    if (!instructionFn) {
        throw new Error(`Unknown AI prompt kind '${kind}'. Known kinds: ${Object.keys(INSTRUCTIONS).join(", ")}`);
    }

    const domain = detectDomain(input);
    const system = [BASE_SYSTEM_PROMPT, domain ? DOMAIN_PROMPTS[domain] : null, contextBlock(context)]
        .filter(Boolean)
        .join("\n\n");

    return [
        { role: "system", content: system },
        { role: "user", content: instructionFn(input) }
    ];
}

export function knownPromptKinds() {
    return Object.keys(INSTRUCTIONS);
}
