// Compatibility: a dashboard view over scanCompatibility()'s result -
// overall score, issues (worst severity first), and a drill-down panel on
// the highlighted one. Mirrors DoctorPage.js's layout (issues-first list +
// detail panel) since both pages show the same shape of data (a scored
// PASS/WARNING/FAIL-style sweep), just over a different check.
import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, SelectList, KeyValue, KeyHints, Spinner, statusColor, useDetailWidth } from "../components/ui.js";
import { useStore } from "../store.js";
import { compatibilitySnapshot, activeWorkspaceName } from "../data.js";
import { getWorkspace, saveWorkspace } from "../../core/workspace/store.js";
import { planRepair, executeRepairPlan } from "../../core/compatibility/repair.js";

const SEVERITY_TO_STATUS = {
    PASS: "PASS",
    RECOMMEND: "PASS",
    WARNING: "WARNING",
    CRITICAL: "FAIL",
    UNSUPPORTED: "FAIL"
};

export function CompatibilityPage({ isActive }) {
    const { theme, state, actions, suspend } = useStore();
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [highlighted, setHighlighted] = useState(null);
    const [repairing, setRepairing] = useState(false);
    const detailW = useDetailWidth(46);

    async function load() {
        if (loading) return;
        setLoading(true);
        actions.log("compatibility scan started");
        try {
            const scan = await compatibilitySnapshot();
            setResult(scan);
            actions.notify(`Compatibility: ${scan.score}% - ${scan.verdict}`, scan.score >= 90 ? "success" : "warning");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        // Only on first mount - the cache backing compatibilitySnapshot()
        // is cleared globally by the `R` key (App.js), not per-page.
        load();
    }, []);

    async function repairHighlighted() {
        if (!result || repairing) return;
        const actionsToRun = planRepair(result);
        if (actionsToRun.length === 0) {
            actions.notify("Nothing to repair.", "info");
            return;
        }
        setRepairing(true);
        actions.setBusy({ label: "compatibility repair" });
        try {
            // Suspended (like DoctorPage's D/X full-doctor handoff): a
            // conflict action's confirmation prompt uses the `prompts`
            // library's own stdin handling, which would fight Ink's raw-
            // mode input if it ran while the dashboard still owned the
            // terminal.
            const results = await suspend(() => executeRepairPlan(actionsToRun, { assumeYes: false }));
            const succeeded = results.filter((r) => r.ok).length;
            actions.notify(`Repair: ${succeeded}/${results.length} action(s) succeeded`, succeeded === results.length ? "success" : "warning");

            const activeName = activeWorkspaceName();
            if (activeName) {
                const doc = getWorkspace(activeName);
                const entry = { timestamp: new Date().toISOString(), actionCount: actionsToRun.length, succeeded, failed: results.length - succeeded };
                const repairHistory = [...(doc.compatibility?.repairHistory || []), entry].slice(-50);
                saveWorkspace({ ...doc, compatibility: { ...doc.compatibility, repairHistory } });
            }
        } finally {
            setRepairing(false);
            actions.setBusy(null);
            await load();
        }
    }

    useInput((input) => {
        if (input === "s") load();
        else if (input === "F") repairHighlighted();
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    const issues = result ? [...result.issues].sort((a, b) => {
        const order = { UNSUPPORTED: 0, CRITICAL: 1, WARNING: 2, RECOMMEND: 3, PASS: 4 };
        return order[a.severity] - order[b.severity];
    }) : [];
    const current = highlighted && issues.includes(highlighted) ? highlighted : issues[0] || null;

    return h(Box, { flexGrow: 1 },
        h(Panel, { title: "Compatibility", theme, isActive, flexGrow: 1 },
            !result && !loading ? h(Box, { flexDirection: "column" },
                h(Text, { color: theme.text }, "Cross-tool/cross-version compatibility over every installed component."),
                h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints: [["s", "scan"], ["F", "repair"]] }))
            ) : null,
            loading ? h(Box, null, h(Spinner, { theme }), h(Text, { color: theme.accent }, " scanning...")) : null,
            result && !loading ? h(Box, { flexDirection: "column" },
                h(Text, { color: theme.textMuted }, `${issues.length} finding(s) - worst severity first:`),
                h(SelectList, {
                    items: issues, isActive, height: 12, theme,
                    onHighlight: setHighlighted,
                    renderItem: (issue, selected) => h(Text, {
                        key: `${issue.tool}-${issue.message}`,
                        backgroundColor: selected && isActive ? theme.selection : undefined,
                        color: selected && isActive ? theme.selectionText : statusColor(SEVERITY_TO_STATUS[issue.severity], theme)
                    }, `${selected ? "❯ " : "  "}${issue.severity.padEnd(11)} ${issue.tool.padEnd(16)} ${issue.message}`)
                })
            ) : null
        ),
        h(Panel, { title: result ? `Score: ${result.score}%` : "Score", theme, width: detailW },
            result ? h(KeyValue, {
                theme, labelWidth: 12,
                pairs: [
                    ["Verdict", result.verdict, result.verdict === "Healthy" ? theme.success : result.verdict === "Warning" ? theme.warning : theme.error],
                    ["Pass", result.pass, theme.success],
                    ["Recommend", result.recommend, theme.textMuted],
                    ["Warning", result.warn, theme.warning],
                    ["Critical", result.critical, theme.error],
                    ["Unsupported", result.unsupported, theme.error]
                ]
            }) : h(Text, { color: theme.textMuted }, "Run a scan first (s)."),
            current ? h(Box, { flexDirection: "column", marginTop: 1 },
                h(Text, { color: theme.accent, bold: true }, current.tool),
                h(Text, { color: theme.textMuted, wrap: "wrap" }, current.message),
                current.recommendation ? h(Text, { color: theme.textMuted, wrap: "wrap" }, `\nRecommendation: ${current.recommendation}`) : null
            ) : null,
            h(Box, { marginTop: 1, flexDirection: "column" },
                h(KeyHints, { theme, hints: [["F", "run 'devforgekit compatibility repair'"]] }),
                h(Text, { color: theme.textMuted, wrap: "wrap" }, "(install missing requirements, run recommended upgrades) - conflicting-package removal still needs the CLI's confirmation prompt."))
        )
    );
}
