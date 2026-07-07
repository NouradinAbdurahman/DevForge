// Doctor: live component diagnostics inside the dashboard (the same
// validate/repair loop commands/doctor.js runs natively), plus a
// one-key handoff to the full scripts/doctor.sh (which owns the real
// terminal via suspend - its colored output and PATH-manager fixes are
// Layer 1's, not re-rendered here).
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, SelectList, KeyValue, KeyHints, DetailPanel, InstallProgress, statusColor, useDetailWidth } from "../components/ui.js";
import { useStore } from "../store.js";
import { registrySnapshot, getPackageSafe } from "../data.js";
import { validate, repair } from "../../core/installer.js";
import { scoreResults } from "../../core/health.js";
import { runScript } from "../../core/shell.js";

export function DoctorPage({ isActive }) {
    const { theme, state, actions, suspend } = useStore();
    const [results, setResults] = useState(null);
    const [progress, setProgress] = useState(null);
    const [highlighted, setHighlighted] = useState(null);
    const detailW = useDetailWidth(44);

    async function runDiagnostics({ fix = false } = {}) {
        if (progress) return;
        const { packages } = registrySnapshot();
        const checkable = packages.filter((p) => p.validate);
        setResults(null);
        setProgress({ done: 0, total: checkable.length });
        actions.setBusy({ label: fix ? "doctor --fix (components)" : "doctor (components)" });
        actions.log(`component diagnostics started (${checkable.length} checks${fix ? ", with repair" : ""})`);

        const out = [];
        for (const pkg of checkable) {
            let status;
            let note = "";
            try {
                status = (await validate(pkg)) === 0 ? "PASS" : "WARNING";
                if (status === "WARNING" && fix && pkg.repair) {
                    await repair(pkg, { onOutput: () => {} });
                    status = (await validate(pkg)) === 0 ? "PASS" : "WARNING";
                    note = status === "PASS" ? "repaired" : "repair attempted";
                }
            } catch {
                status = "WARNING";
                note = "could not run";
            }
            out.push({ name: pkg.name, status, note, fix: pkg.repair ? "repairable" : "" });
            setProgress((p) => p && ({ ...p, done: p.done + 1 }));
        }

        setResults(out);
        setProgress(null);
        const { score, verdict } = scoreResults(out);
        actions.setBusy(null);
        actions.notify(`Diagnostics done: ${score}% - ${verdict}`, score >= 90 ? "success" : "warning");
    }

    async function runFullDoctor(fix) {
        actions.log(`scripts/doctor.sh${fix ? " --fix" : ""} (suspended)`);
        await suspend(async () => {
            await runScript("scripts/doctor.sh", fix ? ["--fix"] : []);
        });
    }

    useInput((input) => {
        if (input === "s") runDiagnostics();
        else if (input === "F") runDiagnostics({ fix: true });
        else if (input === "D") runFullDoctor(false);
        else if (input === "X") runFullDoctor(true);
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    const issues = results ? results.filter((r) => r.status !== "PASS") : [];
    const tally = results ? scoreResults(results) : null;
    const shown = results
        ? [...issues, ...results.filter((r) => r.status === "PASS")]
        : [];
    const current = highlighted && shown.includes(highlighted) ? highlighted : shown[0] || null;
    const pkg = current ? getPackageSafe(current.name) : null;

    return h(Box, { flexGrow: 1 },
        h(Panel, { title: "Doctor - component diagnostics", theme, isActive, flexGrow: 1 },
            !results && !progress ? h(Box, { flexDirection: "column" },
                h(Text, { color: theme.text }, "Real-time diagnostics over every registry component with a health check."),
                h(Box, { marginTop: 1 }, h(KeyHints, {
                    theme,
                    hints: [["s", "scan"], ["F", "scan + auto-repair"], ["D", "full doctor.sh"], ["X", "full doctor.sh --fix"]]
                }))
            ) : null,
            progress ? h(InstallProgress, { label: "Probing components...", unit: "checks", value: progress.done, total: progress.total, theme }) : null,
            results ? h(Box, { flexDirection: "column" },
                h(Text, { color: theme.textMuted }, `${issues.length} issue(s), ${results.length - issues.length} passing - issues first:`),
                h(SelectList, {
                    items: shown, isActive: isActive && !progress, height: 12, theme,
                    onHighlight: setHighlighted,
                    renderItem: (r, selected) => h(Text, {
                        key: r.name,
                        backgroundColor: selected && isActive ? theme.selection : undefined,
                        color: selected && isActive ? theme.selectionText : statusColor(r.status, theme),
                        wrap: "truncate-end"
                    }, `${selected ? "❯ " : "  "}${r.status.padEnd(8)} ${r.name.padEnd(22)} ${r.note || r.fix}`)
                })
            ) : null
        ),
        h(DetailPanel, {
            title: tally ? `Health: ${tally.score}%` : "Health", theme, width: detailW,
            emptyText: "Run a scan first (s).",
            body: tally ? h(Box, { flexDirection: "column" },
                h(KeyValue, {
                    theme, labelWidth: 10,
                    pairs: [
                        ["Verdict", tally.verdict, tally.score >= 90 ? theme.success : tally.score >= 70 ? theme.warning : theme.error],
                        ["Pass", tally.pass, theme.success],
                        ["Warnings", tally.warn, theme.warning],
                        ["Fail", tally.fail, theme.error]
                    ]
                }),
                current && pkg ? h(Box, { flexDirection: "column", marginTop: 1 },
                    h(Text, { color: theme.accent, bold: true }, current.name),
                    h(Text, { color: theme.textMuted, wrap: "wrap" },
                        current.status === "PASS"
                            ? "Healthy."
                            : pkg.repair
                                ? `Recommended fix: ${pkg.repair} (press F to run repairs)`
                                : pkg.install
                                    ? "Not installed or failing - install it from the Components page (c)."
                                    : "No repair command declared for this component."),
                    h(Text, { color: theme.textMuted, wrap: "wrap" }, pkg.documentation ? `Docs: ${pkg.documentation}` : "")
                ) : null
            ) : undefined,
            footer: h(Text, { color: theme.textMuted, wrap: "wrap" },
                "\nD/X hand the terminal to scripts/doctor.sh (PATH manager, brew doctor, mise doctor...) and return here after.")
        })
    );
}
