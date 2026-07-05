// Reusable command tree inspector (v1.3.x TUI Command Explorer).
//
// Single source of truth: getCommandTree() inspects the live Commander.js
// program instance (the same one `devforgekit --help` uses) and returns a
// structured tree. The TUI Commands page and the global search both consume
// this - no command list is ever duplicated.
//
// Whenever a new command is registered in index.js (or via a plugin), it
// automatically appears in the tree with zero additional code.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.js";

// Category mapping: top-level command name → category label.
// Commands not in this map are placed in "Other".
const COMMAND_CATEGORIES = {
    install: "Core",
    bootstrap: "Core",
    update: "Core",
    doctor: "Core",
    check: "Core",
    validate: "Core",
    "self-update": "Core",
    new: "Projects",
    dashboard: "Core",
    backup: "System",
    restore: "System",
    release: "System",
    preferences: "System",
    services: "System",
    clean: "System",
    config: "Configuration",
    profile: "Configuration",
    recipe: "Configuration",
    component: "Registry",
    collection: "Registry",
    registry: "Registry",
    search: "Registry",
    stats: "Registry",
    info: "Registry",
    workspace: "Workspace",
    snapshot: "Workspace",
    compatibility: "Repair",
    repair: "Repair",
    ai: "AI",
    theme: "Themes",
    plugin: "Plugins",
    graph: "Graph",
    benchmark: "Benchmark",
    package: "Analytics",
    inventory: "System",
    report: "System"
};

// Category display order (unlisted categories sort alphabetically after).
const CATEGORY_ORDER = [
    "Core", "Projects", "Registry", "Workspace", "Repair", "AI",
    "Themes", "Plugins", "Graph", "Benchmark", "Analytics",
    "Configuration", "System", "Other"
];

// Documentation file mapping: command name → doc filename in docs/.
const DOC_MAP = {
    compatibility: "CompatibilityEngine.md",
    snapshot: "SnapshotEngine.md",
    repair: "RepairEngine.md",
    benchmark: "BenchmarkEngine.md",
    package: "PackageIntelligence.md",
    graph: "DevelopmentGraph.md",
    ai: "AIAssistant.md",
    workspace: "WorkspaceManager.md",
    plugin: "PluginSDK.md",
    theme: "ThemeSystem.md"
};

/**
 * Extract a structured option object from a Commander Option instance.
 */
function extractOption(opt) {
    return {
        flags: opt.flags,
        description: opt.description || "",
        short: opt.short,
        long: opt.long,
        required: opt.required,
        optional: opt.optional,
        defaultValue: opt.defaultValue
    };
}

/**
 * Extract a structured command object from a Commander Command instance.
 * Recursively walks subcommands.
 */
function extractCommand(cmd, parentName) {
    const name = cmd.name();
    const fullName = parentName ? `${parentName} ${name}` : name;
    const description = cmd.description() || "";
    const aliases = cmd.aliases ? cmd.aliases() : [];

    // Options: filter out --help (added automatically by Commander)
    const options = (cmd.options || [])
        .filter((o) => o.long !== "--help")
        .map(extractOption);

    // Subcommands (skip the implicit "help" subcommand Commander adds)
    const subcommands = (cmd.commands || [])
        .filter((c) => c.name() !== "help" && c.name() !== "")
        .map((c) => extractCommand(c, fullName));

    // Extract examples from helpInformation() if available
    let examples = [];
    try {
        const helpText = cmd.helpInformation();
        examples = extractExamples(helpText, fullName);
    } catch {
        // helpInformation may not be available in all contexts
    }

    // Determine category
    const category = COMMAND_CATEGORIES[name] || "Other";

    // Check for documentation
    const docFile = DOC_MAP[name];
    let documentation = null;
    if (docFile) {
        const docPath = path.join(repoRoot(), "docs", docFile);
        if (existsSync(docPath)) {
            documentation = docFile;
        }
    }

    return {
        name,
        fullName,
        description,
        aliases,
        options,
        subcommands,
        examples,
        category,
        documentation,
        // Usage string: "command [options]" or "command <arg>"
        usage: buildUsage(cmd, fullName),
        // Syntax: just the flags portion
        syntax: buildSyntax(cmd)
    };
}

/**
 * Build a usage string from a command's options and arguments.
 */
function buildUsage(cmd, fullName) {
    const parts = [fullName];
    // Commander stores argument info in _args or .args
    const args = cmd._args || cmd.args || [];
    if (args.length > 0) {
        const argStr = args.map((a) => {
            const name = a.name || a._name || "arg";
            if (a.required) return `<${name}>`;
            return `[${name}]`;
        }).join(" ");
        parts.push(argStr);
    }
    if (cmd.options && cmd.options.some((o) => o.long !== "--help")) {
        parts.push("[options]");
    }
    return parts.join(" ");
}

/**
 * Build a syntax string showing just the options.
 */
function buildSyntax(cmd) {
    const opts = (cmd.options || []).filter((o) => o.long !== "--help");
    if (opts.length === 0) return "";
    return opts.map((o) => o.flags).join("  ");
}

/**
 * Extract example commands from Commander's helpInformation output.
 * Examples are lines starting with "$ " in the help text.
 */
function extractExamples(helpText, fullName) {
    const lines = helpText.split("\n");
    const examples = [];
    let inExamples = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "Examples:" || trimmed === "Example:") {
            inExamples = true;
            continue;
        }
        if (inExamples) {
            if (trimmed.startsWith("$ ")) {
                examples.push(trimmed.slice(2));
            } else if (trimmed && !trimmed.startsWith("$") && !trimmed.startsWith(" ")) {
                // End of examples section
                break;
            }
        }
    }

    return examples;
}

/**
 * Get the full command tree from a Commander program instance.
 *
 * @param {Command} program - The Commander program (from createProgram())
 * @returns {Object} - { commands: [...], categories: {...}, total: N }
 */
export function getCommandTree(program) {
    // The program itself is a Command; its .commands array holds top-level commands
    const topCommands = (program.commands || [])
        .filter((c) => c.name() !== "help" && c.name() !== "")
        .map((c) => extractCommand(c, null));

    // Sort by category, then by name
    topCommands.sort((a, b) => {
        const catA = CATEGORY_ORDER.indexOf(a.category);
        const catB = CATEGORY_ORDER.indexOf(b.category);
        const catIdxA = catA === -1 ? 999 : catA;
        const catIdxB = catB === -1 ? 999 : catB;
        if (catIdxA !== catIdxB) return catIdxA - catIdxB;
        return a.name.localeCompare(b.name);
    });

    // Group by category
    const categories = {};
    for (const cmd of topCommands) {
        if (!categories[cmd.category]) categories[cmd.category] = [];
        categories[cmd.category].push(cmd);
    }

    return {
        commands: topCommands,
        categories,
        total: topCommands.length
    };
}

/**
 * Search the command tree by query string.
 * Searches across: name, description, aliases, options, subcommands, examples.
 *
 * @param {Object} tree - Result from getCommandTree()
 * @param {string} query - Search query
 * @returns {Array} - Matching command objects
 */
export function searchCommandTree(tree, query) {
    const q = query.trim().toLowerCase();
    if (!q) return tree.commands;

    return tree.commands.filter((cmd) => {
        if (cmd.name.toLowerCase().includes(q)) return true;
        if (cmd.description.toLowerCase().includes(q)) return true;
        if (cmd.aliases.some((a) => a.toLowerCase().includes(q))) return true;
        if (cmd.options.some((o) =>
            o.flags.toLowerCase().includes(q) ||
            o.description.toLowerCase().includes(q)
        )) return true;
        if (cmd.subcommands.some((s) =>
            s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q)
        )) return true;
        if (cmd.examples.some((e) => e.toLowerCase().includes(q))) return true;
        if (cmd.category.toLowerCase().includes(q)) return true;
        return false;
    });
}

/**
 * Find related commands for a given command.
 * Related = same category, or shares a dependency/alias overlap.
 *
 * @param {Object} tree - Result from getCommandTree()
 * @param {Object} cmd - Command object
 * @returns {Array} - Related command objects (excluding the input)
 */
export function findRelatedCommands(tree, cmd) {
    return tree.commands.filter((c) =>
        c.name !== cmd.name &&
        c.category === cmd.category
    ).slice(0, 5);
}

/**
 * Get the list of available documentation files for commands.
 *
 * @returns {Array} - Array of { command, docFile } pairs
 */
export function getAvailableDocs() {
    const docs = [];
    const docsDir = path.join(repoRoot(), "docs");
    for (const [cmdName, docFile] of Object.entries(DOC_MAP)) {
        if (existsSync(path.join(docsDir, docFile))) {
            docs.push({ command: cmdName, docFile });
        }
    }
    return docs;
}
