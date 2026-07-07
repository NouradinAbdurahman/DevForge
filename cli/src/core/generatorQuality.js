// The Generator Quality Score (Project Generator Excellence, v2.1.2
// Phase 11) - the Manifest Quality Score's (core/quality.js) sibling for
// project generators: an objective, per-check breakdown of how complete
// a stack's generated output actually is, instead of one flat number.
//
// Every check runs against the REAL virtual file list a generator
// produces - `generator.generate({name, dir, options})` is pure (see
// core/projectGenerator.js: it returns `[{path, content}]`, writing to
// disk is a separate step writeGeneratedFiles does), so scoring a
// generator never touches the filesystem, shells out, or fabricates a
// result. Only `generate`'s declared output is checked here - a stack's
// `scaffold` step (the official CLI, e.g. `flutter create`) contributes
// files too, but those aren't knowable without actually running the CLI,
// so this score is honestly scoped to "what DevForgeKit's own generator
// code adds," not the combined result.

// probeFiles(generator) -> [{path, content}], or [] if generate() throws
// for any reason (never let a broken generator crash the whole score
// sweep - a throw becomes "0 files", which fails every check honestly
// rather than fabricating a specific reason for a stack we don't
// actually recognize the failure mode).
async function probeFiles(generator) {
    if (!generator.generate) return [];
    try {
        const files = await generator.generate({ name: "quality-probe-app", dir: "", options: {} });
        return files || [];
    } catch {
        return [];
    }
}

function hasFile(files, matcher) {
    return files.some((f) => (typeof matcher === "string" ? f.path === matcher : matcher.test(f.path)));
}

const CHECK_DEFS = [
    { label: "README generated", category: "Documentation", test: (files) => hasFile(files, "README.md") },
    { label: "Post-generation guidance (nextSteps)", category: "Documentation", test: (_files, g) => typeof g.nextSteps === "function" },
    { label: "Layered example code (real source files, not just config)", category: "Architecture", test: (files) => files.some((f) => /\.(js|ts|py|go|rs|java|dart|cs)$/.test(f.path)) },
    { label: "Nested folder structure", category: "Architecture", test: (files) => files.some((f) => f.path.includes("/")) },
    { label: "Test scaffolding included", category: "Testing", test: (files) => files.some((f) => /test|spec/i.test(f.path)) },
    { label: "CI workflow generated", category: "CI", test: (files) => hasFile(files, /^\.github\/workflows\//) },
    { label: "Docker support available", category: "Docker", test: (files, g) => hasFile(files, "Dockerfile") || Boolean(g.promptOptions) },
    { label: ".editorconfig generated", category: "Editor Support", test: (files) => hasFile(files, ".editorconfig") },
    { label: "VS Code settings generated", category: "Editor Support", test: (files) => hasFile(files, /^\.vscode\//) },
    { label: "Missing-tool errors are actionable (requiresTool has a hint)", category: "Validation", test: (_files, g) => !g.requiresTool || Boolean(g.requiresTool.hint) },
    { label: ".gitignore generated", category: "Validation", test: (files) => hasFile(files, ".gitignore") },
    { label: "Env var template (.env.example)", category: "Examples", test: (files) => hasFile(files, ".env.example") },
    { label: "Real companion-tool recommendations declared", category: "Examples", test: (_files, g) => (g.recommends || []).length > 0 },
    { label: "Cross-platform (no OS-specific shell scripts committed)", category: "Cross Platform", test: (files) => !files.some((f) => f.path.endsWith(".bat") || f.path.endsWith(".ps1")) }
];

function breakdownFromChecks(checks) {
    const order = [];
    const byCategory = new Map();
    for (const check of checks) {
        if (!byCategory.has(check.category)) {
            byCategory.set(check.category, []);
            order.push(check.category);
        }
        byCategory.get(check.category).push(check);
    }
    return order.map((category) => {
        const group = byCategory.get(category);
        const passCount = group.filter((c) => c.pass).length;
        return { category, passCount, total: group.length, score: Math.round((passCount / group.length) * 100) };
    });
}

// scoreGenerator(generator) -> { checks, score, passCount, total, breakdown }
// Async because probing calls the generator's real (pure) generate().
export async function scoreGenerator(generator) {
    const files = await probeFiles(generator);
    const checks = CHECK_DEFS.map((def) => ({
        label: def.label,
        category: def.category,
        pass: Boolean(def.test(files, generator))
    }));

    const passCount = checks.filter((c) => c.pass).length;
    const score = Math.round((passCount / checks.length) * 100);

    return { checks, score, passCount, total: checks.length, breakdown: breakdownFromChecks(checks) };
}
