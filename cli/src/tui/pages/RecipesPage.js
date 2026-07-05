// Recipes: browse the built-in + user recipes, preview exactly what a
// run would do (resolved components, configure steps, verify pass -
// the PRD's "show steps / preview actions"), and execute one. Execution
// reuses core/installer.js and core/recipes.js verbatim - the same
// engine `devforgekit recipe install` drives. Rollback/history is *not*
// offered here because the recipe engine itself has no rollback
// capability to call - a disabled-looking button pretending otherwise
// would be dishonest (see docs/TUI.md's scoping notes).
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, SelectList, KeyValue, KeyHints, ProgressBar, statusColor, useDetailWidth } from "../components/ui.js";
import { useStore } from "../store.js";
import { registrySnapshot } from "../data.js";
import { expandRecipe } from "../../core/registry.js";
import { installPlan } from "../../core/installer.js";
import { runConfigureStep, verifyComponents } from "../../core/recipes.js";
import { setConfigValue } from "../../core/config.js";

export function RecipesPage({ isActive }) {
    const { theme, state, actions } = useStore();
    const [highlighted, setHighlighted] = useState(null);
    const [running, setRunning] = useState(null);
    const [lastVerify, setLastVerify] = useState(null);
    const detailW = useDetailWidth(50);

    const { recipes } = registrySnapshot();
    const current = highlighted && recipes.includes(highlighted) ? highlighted : recipes[0] || null;

    let expanded = [];
    try {
        if (current) expanded = expandRecipe(current);
    } catch {
        expanded = [];
    }

    async function runRecipe(recipe) {
        if (!recipe || running) return;
        const names = expandRecipe(recipe);
        const configureSteps = recipe.configure || [];
        const total = names.length + configureSteps.length + (recipe.verify !== false ? 1 : 0);
        const label = `recipe install ${recipe.name}`;
        setRunning({ step: 0, total, phase: "install", lines: [] });
        actions.setBusy({ label });
        actions.log(`${label} started (${names.length} components, ${configureSteps.length} configure steps)`);

        try {
            // 1. install (same dependency-resolving plan the CLI uses)
            const { results } = await installPlan(names, {
                onStep: (pkg, index) => setRunning((r) => r && ({ ...r, step: index + 1, phase: `install ${pkg.name}` })),
                onOutput: (text) => setRunning((r) => r && ({ ...r, lines: [...r.lines, ...text.split("\n").filter(Boolean)].slice(-5) }))
            });
            const failed = results.filter((r) => r.status === "failed").length;

            // 2. configure steps (git/vscode/cursor/shell/mise)
            for (let i = 0; i < configureSteps.length; i++) {
                setRunning((r) => r && ({ ...r, step: names.length + i + 1, phase: `configure ${configureSteps[i]}` }));
                await runConfigureStep(configureSteps[i], {
                    onOutput: (text) => setRunning((r) => r && ({ ...r, lines: [...r.lines, ...text.split("\n").filter(Boolean)].slice(-5) }))
                });
                actions.log(`configure ${configureSteps[i]} done`);
            }

            // 3. verify pass
            let verify = null;
            if (recipe.verify !== false) {
                setRunning((r) => r && ({ ...r, step: total, phase: "verify" }));
                verify = await verifyComponents(names);
                setLastVerify(verify);
            }

            if (recipe.settings) {
                for (const [key, value] of Object.entries(recipe.settings)) {
                    setConfigValue(key, value);
                }
            }

            const summary = verify
                ? `${verify.passed} pass / ${verify.failed} fail / ${verify.total} checked`
                : `${results.length - failed}/${results.length} installed`;
            actions.notify(`Recipe '${recipe.name}' finished: ${summary}`, failed === 0 ? "success" : "warning");
        } catch (err) {
            actions.notify(`Recipe failed: ${err.message}`, "error");
        } finally {
            setRunning(null);
            actions.setBusy(null);
        }
    }

    useInput((input) => {
        if (input === "a") runRecipe(current);
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    return h(Box, { flexGrow: 1 },
        h(Panel, { title: `Recipes (${recipes.length})`, theme, isActive, flexGrow: 1 },
            h(SelectList, {
                // 8 items - each now 2 rows tall, so this keeps the
                // same ~16-row visual footprint the old single-line
                // list used; SelectList's own scroll window still
                // kicks in if more recipes exist than fit.
                items: recipes, isActive, height: 8, theme,
                onHighlight: setHighlighted,
                // A two-line card per recipe (icon + name, then the
                // description indented underneath) instead of cramming
                // both onto one line - the single-line form wrapped
                // unpredictably against the detail panel's width and
                // read as a jumble. Nested <Text> per line (not a
                // <Box> of sibling <Text> elements on the same line) -
                // Ink treats nested Text as one reflowable run and
                // truncates the line as a whole rather than mid-word.
                renderItem: (r, selected) => {
                    const rowSelected = selected && isActive;
                    const bg = rowSelected ? theme.selection : undefined;
                    const nameColor = rowSelected ? theme.selectionText : theme.accent;
                    const descColor = rowSelected ? theme.selectionText : theme.textMuted;
                    const cursor = rowSelected ? "❯ " : "  ";
                    const icon = r.icon ? `${r.icon} ` : "▹ ";
                    return h(Box, { key: r.name, flexDirection: "column" },
                        h(Text, { wrap: "truncate-end" },
                            h(Text, { backgroundColor: bg, color: nameColor, bold: true }, `${cursor}${icon}${r.name}`)),
                        h(Text, { backgroundColor: bg, color: descColor, wrap: "truncate-end" }, `     ${r.description || ""}`)
                    );
                }
            })
        ),
        h(Panel, { title: current ? `Recipe: ${current.icon ? `${current.icon} ` : ""}${current.name}` : "Details", theme, width: detailW },
            current ? h(Box, { flexDirection: "column" },
                h(Text, { color: theme.text, wrap: "wrap" }, current.description || ""),
                h(Text, { color: theme.accent, bold: true }, "\nWhat running this will do:"),
                h(KeyValue, {
                    theme, labelWidth: 13,
                    pairs: [
                        ["1. install", `${expanded.length} components (deps resolved)`],
                        ["2. configure", (current.configure || []).join(", ") || "nothing"],
                        ["3. verify", current.verify !== false ? "health-check every component" : "skipped"],
                        ["4. settings", current.settings ? Object.entries(current.settings).map(([k, v]) => `${k}=${v}`).join(" ") : "none"]
                    ]
                }),
                h(Text, { color: theme.textMuted, wrap: "wrap" }, `\n${expanded.slice(0, 16).join(", ")}${expanded.length > 16 ? ", ..." : ""}`),
                h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints: [["a", "run recipe"]] })),
                running ? h(Box, { flexDirection: "column", marginTop: 1 },
                    h(ProgressBar, { value: running.step, total: running.total, theme, label: running.phase }),
                    ...running.lines.map((line, i) => h(Text, { key: line + i, color: theme.textMuted }, line.slice(0, 46)))
                ) : null,
                lastVerify && !running ? h(Box, { flexDirection: "column", marginTop: 1 },
                    h(Text, { color: theme.accent, bold: true }, `Last verify: ${lastVerify.passed} pass / ${lastVerify.failed} fail`),
                    ...lastVerify.results.slice(0, 8).map((r) =>
                        h(Text, { key: r.name, color: statusColor(r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "WARNING", theme) }, ` ${r.status.padEnd(8)} ${r.name}`))
                ) : null
            ) : h(Text, { color: theme.textMuted }, "No recipes found.")
        )
    );
}
