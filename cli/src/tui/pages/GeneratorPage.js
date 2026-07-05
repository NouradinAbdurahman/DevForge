// Project Generator: the interactive wizard over the same 16 generators
// `devforgekit new` uses (cli/src/generators/), plus the static
// templates/ list for reference. The wizard collects every stack option
// up front (the same flag surface commands/new.js exposes), then
// *suspends* the dashboard and runs runProjectGenerator with the real
// terminal - scaffolding CLIs like `flutter create`/`create-next-app`
// print their own output and that output belongs on the real screen,
// not squeezed into a log pane (see docs/TUI.md's suspend/resume notes).
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import path from "node:path";
import { h, Panel, SelectList, KeyValue, KeyHints, TextField, useDetailWidth } from "../components/ui.js";
import { useStore } from "../store.js";
import { generators, templates } from "../data.js";
import { runProjectGenerator } from "../../core/projectGenerator.js";

// The same option surface commands/new.js exposes as flags, declared
// per-stack so the wizard only asks what the chosen generator actually
// reads in its promptOptions(flags).
const STACK_OPTIONS = {
    flutter: [
        { key: "state", label: "State management", values: ["riverpod", "bloc", "none"] },
        { key: "backend", label: "Backend", values: ["supabase", "firebase", "none"] },
        { key: "docker", label: "Docker (web build)", values: [false, true] }
    ],
    nextjs: [
        { key: "shadcn", label: "shadcn/ui", values: [true, false] },
        { key: "husky", label: "Husky + lint-staged", values: [true, false] },
        { key: "docker", label: "Dockerfile", values: [true, false] }
    ],
    express: [
        { key: "auth", label: "JWT authentication", values: [true, false] },
        { key: "prisma", label: "Prisma + PostgreSQL", values: [true, false] },
        { key: "swagger", label: "Swagger/OpenAPI", values: [true, false] },
        { key: "docker", label: "Docker + compose", values: [true, false] }
    ],
    nestjs: [{ key: "docker", label: "Dockerfile", values: [true, false] }],
    fastapi: [{ key: "docker", label: "Docker + compose", values: [true, false] }],
    django: [{ key: "docker", label: "Docker + compose", values: [true, false] }],
    laravel: [{ key: "docker", label: "Docker (php-fpm + nginx)", values: [true, false] }],
    "spring-boot": [{ key: "docker", label: "Dockerfile", values: [true, false] }],
    aspnet: [{ key: "docker", label: "Dockerfile", values: [true, false] }]
};

function formatValue(v) {
    if (v === true) return "yes";
    if (v === false) return "no";
    return String(v);
}

export function GeneratorPage({ isActive }) {
    const { theme, state, dispatch, actions, suspend } = useStore();
    const [step, setStep] = useState("stack"); // stack -> name -> options -> confirm
    const [stack, setStack] = useState(null);
    const [name, setName] = useState("");
    const [choices, setChoices] = useState({});
    const detailW = useDetailWidth(36);

    const stacks = generators();
    const optionDefs = stack ? (STACK_OPTIONS[stack.id] || []) : [];

    function reset() {
        setStep("stack");
        setStack(null);
        setName("");
        setChoices({});
    }

    async function generate() {
        const parentDir = process.cwd();
        const options = {};
        for (const def of optionDefs) {
            options[def.key] = choices[def.key] ?? def.values[0];
        }
        actions.log(`generate ${stack.id} '${name}' in ${parentDir}`);

        // Suspend the dashboard: the scaffolding CLI owns the terminal
        // while it runs, exactly like lazygit handing off to $EDITOR.
        await suspend(async () => {
            console.log(`\nGenerating ${stack.label} project '${name}' in ${parentDir}...\n`);
            try {
                const { dir, nextSteps } = await runProjectGenerator(stack, { name, parentDir, options });
                console.log(`\n✓ Created ${dir}\n\nNext steps:`);
                for (const s of nextSteps) console.log(`  ${s}`);
                actions.notify(`Generated ${stack.label} project '${name}'`, "success");
            } catch (err) {
                console.error(`\n✗ ${err.message}`);
                actions.notify(`Generate failed: ${err.message}`, "error");
            }
        });
        reset();
    }

    useInput((input, key) => {
        if (step === "name") {
            if (key.return && name.trim()) {
                dispatch({ type: "setTyping", typing: false });
                setStep(optionDefs.length > 0 ? "options" : "confirm");
            } else if (key.escape) {
                dispatch({ type: "setTyping", typing: false });
                setStep("stack");
            }
            return;
        }
        if (step === "options" || step === "confirm") {
            if (key.escape) reset();
            if (step === "confirm" && key.return) generate();
        }
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    return h(Box, { flexGrow: 1 },
        h(Panel, { title: `Project Generator (${stacks.length} stacks)`, theme, isActive, flexGrow: 1 },
            step === "stack" ? h(Box, { flexDirection: "column" },
                h(KeyHints, { theme, hints: [["Enter", "pick a stack"]] }),
                h(SelectList, {
                    items: stacks, isActive, height: 16, theme,
                    onSelect: (g) => {
                        setStack(g);
                        setName(`my-${g.id}-app`);
                        setStep("name");
                        dispatch({ type: "setTyping", typing: true });
                    },
                    renderItem: (g, selected) => h(Text, {
                        key: g.id,
                        backgroundColor: selected && isActive ? theme.selection : undefined,
                        color: selected && isActive ? theme.selectionText : theme.text
                    }, `${selected ? "❯ " : "  "}${g.id.padEnd(14)} ${g.description.slice(0, 52)}`)
                })
            ) : null,
            step === "name" ? h(Box, { flexDirection: "column" },
                h(Text, { color: theme.text }, `Stack: ${stack.label}`),
                h(Box, null,
                    h(Text, { color: theme.textMuted }, "Project name: "),
                    h(TextField, { value: name, onChange: setName, isActive, theme })
                ),
                h(KeyHints, { theme, hints: [["Enter", "continue"], ["Esc", "back"]] })
            ) : null,
            step === "options" ? h(Box, { flexDirection: "column" },
                h(Text, { color: theme.text }, `${stack.label} · ${name} - options:`),
                h(SelectList, {
                    items: optionDefs, isActive, height: 10, theme,
                    onSelect: (def) => {
                        const values = def.values;
                        const currentValue = choices[def.key] ?? values[0];
                        const next = values[(values.indexOf(currentValue) + 1) % values.length];
                        setChoices((c) => ({ ...c, [def.key]: next }));
                    },
                    onSpace: (def) => {
                        const values = def.values;
                        const currentValue = choices[def.key] ?? values[0];
                        const next = values[(values.indexOf(currentValue) + 1) % values.length];
                        setChoices((c) => ({ ...c, [def.key]: next }));
                    },
                    renderItem: (def, selected) => h(Text, {
                        key: def.key,
                        backgroundColor: selected && isActive ? theme.selection : undefined,
                        color: selected && isActive ? theme.selectionText : theme.text
                    }, `${selected ? "❯ " : "  "}${def.label.padEnd(26)} ${formatValue(choices[def.key] ?? def.values[0])}`)
                }),
                h(KeyHints, { theme, hints: [["↑↓", "move"], ["Enter/Space", "cycle"], ["c", "confirm"], ["Esc", "cancel"]] }),
                h(ConfirmKey, { isActive, onConfirm: () => setStep("confirm") })
            ) : null,
            step === "confirm" ? h(Box, { flexDirection: "column" },
                h(Text, { color: theme.accent, bold: true }, "Ready to generate:"),
                h(KeyValue, {
                    theme, labelWidth: 16,
                    pairs: [
                        ["Stack", stack.label],
                        ["Name", name],
                        ["Directory", path.join(process.cwd(), name)],
                        ...optionDefs.map((def) => [def.label, formatValue(choices[def.key] ?? def.values[0])]),
                        ...(stack.requiresTool ? [["Requires", stack.requiresTool.command]] : [])
                    ]
                }),
                h(Box, { marginTop: 1 }, h(KeyHints, {
                    theme,
                    hints: [["Enter", "generate (dashboard suspends while the scaffolder runs)"], ["Esc", "cancel"]]
                }))
            ) : null
        ),
        h(Panel, { title: `Static templates (${templates().length})`, theme, width: detailW },
            h(Text, { color: theme.textMuted, wrap: "wrap" },
                "Copyable starters under templates/ - independent of the generator:\n"),
            h(Text, { color: theme.text, wrap: "wrap" }, templates().join(", "))
        )
    );
}

// Tiny helper so "c" confirms from the options step without tangling the
// SelectList's own input handling.
function ConfirmKey({ isActive, onConfirm }) {
    useInput((input) => {
        if (input === "c") onConfirm();
    }, { isActive: Boolean(isActive) });
    return null;
}
