// Repair: the Intelligent Repair Engine's TUI home. A full dashboard
// page for scan → plan → execute → verify, with issue list, plan
// preview, progress bar, details panel, and history — consistent with
// the AI pages and Doctor page patterns.
import { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, SelectList, KeyValue, KeyHints, DetailPanel, InstallProgress, Badge, statusColor, useDetailWidth, EmptyState, ProgressBar } from "../components/ui.js";
import { useStore } from "../store.js";
import {
    scanIssues,
    planRepairs,
    executeRepairs,
    dryRunPlan,
    explainRepair,
    listHistory,
    RISK_LEVELS,
    RISK_LABELS,
    REPAIR_CATEGORIES,
    CATEGORY_LABELS
} from "../../core/repair.js";

const SEVERITY_GLYPH = { FATAL: "✗", CRITICAL: "✗", WARNING: "⚠", INFO: "i" };
const SEVERITY_TONE = { FATAL: "error", CRITICAL: "error", WARNING: "warning", INFO: "info" };

function riskTone(risk, theme) {
    if (risk === "high") return theme.error;
    if (risk === "medium") return theme.warning;
    if (risk === "low") return theme.success;
    return theme.textMuted;
}

const TABS = [
    { id: "overview", label: "Overview", key: "1" },
    { id: "issues", label: "Issues", key: "2" },
    { id: "plan", label: "Plan", key: "3" },
    { id: "history", label: "History", key: "4" }
];

export function RepairPage({ isActive }) {
    const { theme, state, actions } = useStore();
    const [tab, setTab] = useState("overview");
    const [issues, setIssues] = useState(null);
    const [plan, setPlan] = useState(null);
    const [progress, setProgress] = useState(null);
    const [execution, setExecution] = useState(null);
    const [history, setHistory] = useState(null);
    const [highlighted, setHighlighted] = useState(null);
    const [filterRisk, setFilterRisk] = useState(null);
    const detailW = useDetailWidth(46);

    // Load history on mount
    useEffect(() => {
        if (history === null) {
            try { setHistory(listHistory()); } catch { setHistory([]); }
        }
    }, [history]);

    const runScan = useCallback(async () => {
        if (progress) return;
        setIssues(null);
        setPlan(null);
        setExecution(null);
        setProgress({ label: "Scanning...", done: 0, total: 12 });
        actions.setBusy({ label: "repair scan" });
        actions.log("repair scan started");

        try {
            const result = await scanIssues({
                onProgress: (p) => setProgress({ label: p.label, done: p.index + 1, total: p.total })
            });
            setIssues(result);
            setProgress(null);
            actions.setBusy(null);
            actions.notify(`Scan complete: ${result.length} issue(s)`, result.length === 0 ? "success" : "warning");
        } catch (err) {
            setProgress(null);
            actions.setBusy(null);
            actions.notify(`Scan failed: ${err.message}`, "error");
        }
    }, [progress, actions]);

    const generatePlan = useCallback(() => {
        if (!issues || issues.length === 0) return;
        const p = planRepairs(issues);
        setPlan(p);
        actions.notify(`Plan: ${p.totalRepairs} repairs, risk ${p.riskLabel}`, "info");
    }, [issues, actions]);

    const runRepairs = useCallback(async ({ dryRun = false } = {}) => {
        if (!plan || plan.totalRepairs === 0) return;
        if (dryRun) {
            const preview = dryRunPlan(plan);
            setExecution({ dryRun: true, ...preview });
            actions.notify("Dry run complete", "info");
            return;
        }

        setExecution(null);
        setProgress({ label: "Repairing...", done: 0, total: plan.totalRepairs });
        actions.setBusy({ label: "repair execute" });
        actions.log("repair execution started");

        try {
            const result = await executeRepairs(plan, {
                assumeYes: true,
                onProgress: (p) => setProgress({ label: p.title || "Repairing...", done: p.index + 1, total: p.total })
            });
            setExecution(result);
            setProgress(null);
            actions.setBusy(null);
            // Refresh history
            try { setHistory(listHistory()); } catch { /* ignore */ }
            actions.notify(`Repairs: ${result.fixed} fixed, ${result.failed} failed, ${result.skipped} skipped`, result.failed === 0 ? "success" : "warning");
        } catch (err) {
            setProgress(null);
            actions.setBusy(null);
            actions.notify(`Repair failed: ${err.message}`, "error");
        }
    }, [plan, actions]);

    useInput((input) => {
        if (!isActive || state.searchOpen) return;
        // Tab switching
        if (input === "1") setTab("overview");
        else if (input === "2") setTab("issues");
        else if (input === "3") setTab("plan");
        else if (input === "4") setTab("history");
        // Actions
        else if (input === "s") runScan();
        else if (input === "p") generatePlan();
        else if (input === "r") runRepairs({ dryRun: false });
        else if (input === "d") runRepairs({ dryRun: true });
        // Risk filter (issues tab)
        else if (input === "f" && tab === "issues") {
            const risks = [null, "low", "medium", "high"];
            const idx = risks.indexOf(filterRisk);
            setFilterRisk(risks[(idx + 1) % risks.length]);
        }
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    // Filtered issues
    const filteredIssues = issues && filterRisk
        ? issues.filter((i) => i.risk === filterRisk)
        : issues;

    // Current issue for detail panel
    const currentIssue = highlighted && filteredIssues && filteredIssues.includes(highlighted)
        ? highlighted
        : filteredIssues && filteredIssues[0] || null;

    // History items
    const historyItems = (history || []).map((h) => ({
        ...h,
        label: `${h.id.slice(0, 20)}  ${h.fixed}f/${h.failed}x  ${h.createdAt?.slice(0, 10) || "?"}`
    }));
    const currentHistory = highlighted && historyItems.includes(highlighted) ? highlighted : historyItems[0] || null;

    const tabHints = [
        ["1", "Overview"], ["2", "Issues"], ["3", "Plan"], ["4", "History"],
        ["s", "scan"], ["p", "plan"], ["r", "repair"], ["d", "dry-run"]
    ];
    if (tab === "issues") tabHints.push(["f", `filter: ${filterRisk || "off"}`]);

    return h(Box, { flexGrow: 1 },
        // Left: main panel
        h(Panel, {
            title: `Repair Engine — ${TABS.find((t) => t.id === tab)?.label || ""}`,
            theme, isActive, flexGrow: 1
        },
            // Tab bar
            h(Box, { marginBottom: 1 },
                ...TABS.map((t) => h(Text, {
                    key: t.id,
                    color: tab === t.id ? theme.accent : theme.textMuted,
                    bold: tab === t.id
                }, ` [${t.key}] ${t.label} `))
            ),

            // Progress overlay
            progress ? h(InstallProgress, {
                label: progress.label,
                value: progress.done,
                total: progress.total,
                unit: "steps",
                theme
            }) : null,

            // Tab content
            !progress ? h(Box, { flexDirection: "column" },
                tab === "overview" ? h(OverviewTab, {
                    issues, plan, execution, history, theme
                }) : null,

                tab === "issues" ? h(IssuesTab, {
                    issues: filteredIssues,
                    unfilteredCount: issues?.length,
                    filterRisk,
                    isActive,
                    onHighlight: setHighlighted,
                    theme
                }) : null,

                tab === "plan" ? h(PlanTab, {
                    plan, issues, theme
                }) : null,

                tab === "history" ? h(HistoryTab, {
                    history: historyItems,
                    isActive,
                    onHighlight: setHighlighted,
                    theme
                }) : null
            ) : null
        ),

        // Right: detail panel
        h(DetailPanel, {
            title: tab === "history" ? "Repair Details" : "Issue Details",
            theme, width: detailW,
            emptyText: "Select an item to see details.",
            body: h(DetailBody, {
                tab, issue: currentIssue, history: currentHistory, plan, execution, theme
            }),
            footer: h(Box, { marginTop: 1 },
                h(KeyHints, { theme, hints: tabHints })
            )
        })
    );
}

// ─── Overview Tab ─────────────────────────────────────────────────────

function OverviewTab({ issues, plan, execution, history, theme }) {
    const recentRuns = (history || []).slice(0, 5);
    const lastSuccess = recentRuns.find((r) => r.failed === 0 && r.fixed > 0);
    const lastFailure = recentRuns.find((r) => r.failed > 0);
    const avgQuality = recentRuns.length > 0
        ? Math.round(recentRuns.reduce((acc, r) => acc + (r.qualityScore?.score || 0), 0) / recentRuns.length)
        : null;

    return h(Box, { flexDirection: "column" },
        // Summary cards
        h(Box, { marginBottom: 1 },
            h(Box, { flexDirection: "column", marginRight: 2 },
                h(Text, { color: theme.textMuted, bold: true }, "Issues"),
                h(Text, { color: issues ? (issues.length > 0 ? theme.warning : theme.success) : theme.textMuted, bold: true },
                    issues ? String(issues.length) : "—")
            ),
            h(Box, { flexDirection: "column", marginRight: 2 },
                h(Text, { color: theme.textMuted, bold: true }, "Repairs"),
                h(Text, { color: plan ? theme.accent : theme.textMuted, bold: true },
                    plan ? String(plan.totalRepairs) : "—")
            ),
            h(Box, { flexDirection: "column", marginRight: 2 },
                h(Text, { color: theme.textMuted, bold: true }, "Risk"),
                h(Text, { color: plan ? riskTone(plan.riskLevel, theme) : theme.textMuted, bold: true },
                    plan ? plan.riskLabel : "—")
            ),
            h(Box, { flexDirection: "column", marginRight: 2 },
                h(Text, { color: theme.textMuted, bold: true }, "Quality"),
                h(Text, { color: avgQuality ? (avgQuality >= 80 ? theme.success : avgQuality >= 60 ? theme.warning : theme.error) : theme.textMuted, bold: true },
                    avgQuality ? `${avgQuality}%` : "—")
            ),
            h(Box, { flexDirection: "column" },
                h(Text, { color: theme.textMuted, bold: true }, "History"),
                h(Text, { color: theme.text, bold: true }, String(history?.length || 0))
            )
        ),

        // Execution results
        execution ? h(Box, { flexDirection: "column", marginBottom: 1 },
            h(Text, { color: theme.accent, bold: true }, execution.dryRun ? "Dry Run Results" : "Repair Results"),
            h(KeyValue, {
                theme, labelWidth: 16,
                pairs: execution.dryRun ? [
                    ["Repairs", execution.totalRepairs],
                    ["Risk", execution.riskLevel],
                    ["Est. time", execution.estimatedTime],
                    ["Files", execution.filesAffected?.length || 0],
                    ["Packages", execution.packagesAffected?.length || 0]
                ] : [
                    ["Fixed", execution.fixed || 0, theme.success],
                    ["Failed", execution.failed || 0, theme.error],
                    ["Skipped", execution.skipped || 0, theme.warning],
                    ["Files modified", execution.filesModified || 0],
                    ["Rollback", execution.rollbackAvailable ? "Available" : "N/A"],
                    ["Duration", `${Math.round((execution.durationMs || 0) / 1000)}s`]
                ]
            })
        ) : null,

        // Recent runs
        recentRuns.length > 0 ? h(Box, { flexDirection: "column", marginTop: 1 },
            h(Text, { color: theme.textMuted, bold: true }, "Recent Runs"),
            ...recentRuns.map((r, i) => h(Text, {
                key: i,
                color: r.failed > 0 ? theme.error : r.fixed > 0 ? theme.success : theme.textMuted
            }, `  ${r.createdAt?.slice(0, 10) || "?"}  ${r.fixed}f/${r.failed}x/${r.skipped}s  ${r.qualityScore ? r.qualityScore.score + "%" : "n/a"}`))
        ) : null,

        // Status hints
        !issues ? h(Box, { marginTop: 1 },
            h(Text, { color: theme.textMuted }, "Press "),
            h(Text, { color: theme.accent, bold: true }, "s"),
            h(Text, { color: theme.textMuted }, " to scan for issues.")
        ) : null,

        issues && issues.length > 0 && !plan ? h(Box, { marginTop: 1 },
            h(Text, { color: theme.textMuted }, "Press "),
            h(Text, { color: theme.accent, bold: true }, "p"),
            h(Text, { color: theme.textMuted }, " to generate a repair plan.")
        ) : null,

        plan && plan.totalRepairs > 0 && !execution ? h(Box, { marginTop: 1 },
            h(Text, { color: theme.textMuted }, "Press "),
            h(Text, { color: theme.accent, bold: true }, "r"),
            h(Text, { color: theme.textMuted }, " to repair or "),
            h(Text, { color: theme.accent, bold: true }, "d"),
            h(Text, { color: theme.textMuted }, " for dry run.")
        ) : null
    );
}

// ─── Issues Tab ───────────────────────────────────────────────────────

function IssuesTab({ issues, unfilteredCount, filterRisk, isActive, onHighlight, theme }) {
    if (!issues) {
        return h(EmptyState, {
            title: "No scan run yet.",
            description: "Press 's' to scan for issues across all subsystems.",
            theme
        });
    }

    if (issues.length === 0) {
        return h(EmptyState, {
            title: "No issues detected!",
            description: filterRisk ? `No ${filterRisk} risk issues. Press 'f' to change filter.` : "Environment is healthy.",
            theme
        });
    }

    const items = issues.map((i) => ({
        ...i,
        label: `${SEVERITY_GLYPH[i.severity] || "•"} ${i.title || i.description}`
    }));

    return h(Box, { flexDirection: "column" },
        filterRisk ? h(Text, { color: theme.textMuted },
            `Filter: ${filterRisk} risk (${issues.length}/${unfilteredCount} shown). Press 'f' to change.`
        ) : null,
        h(SelectList, {
            items, isActive, height: 16, theme,
            onHighlight: onHighlight,
            renderItem: (item, selected) => h(Text, {
                key: item.id,
                backgroundColor: selected && isActive ? theme.selection : undefined,
                color: selected && isActive ? theme.selectionText : statusColor(item.severity, theme),
                wrap: "truncate-end"
            }, `${selected ? "❯ " : "  "}${SEVERITY_GLYPH[item.severity] || "•"} ${item.title || item.description}`)
        })
    );
}

// ─── Plan Tab ─────────────────────────────────────────────────────────

function PlanTab({ plan, issues, theme }) {
    if (!plan) {
        return h(EmptyState, {
            title: "No plan generated.",
            description: issues && issues.length > 0
                ? "Press 'p' to generate a repair plan from the scan results."
                : "Run a scan first (press 's').",
            theme
        });
    }

    if (plan.totalRepairs === 0) {
        return h(EmptyState, {
            title: "Nothing to repair.",
            description: `${plan.totalInfo} informational item(s) only.`,
            theme
        });
    }

    return h(Box, { flexDirection: "column" },
        // Plan summary
        h(Box, { marginBottom: 1 },
            h(Box, { flexDirection: "column", marginRight: 2 },
                h(Text, { color: theme.textMuted }, "Repairs"),
                h(Text, { color: theme.accent, bold: true }, String(plan.totalRepairs))
            ),
            h(Box, { flexDirection: "column", marginRight: 2 },
                h(Text, { color: theme.textMuted }, "Risk"),
                h(Text, { color: riskTone(plan.riskLevel, theme), bold: true }, plan.riskLabel)
            ),
            h(Box, { flexDirection: "column", marginRight: 2 },
                h(Text, { color: theme.textMuted }, "Time"),
                h(Text, { color: theme.text, bold: true }, plan.estimatedTime)
            ),
            h(Box, { flexDirection: "column", marginRight: 2 },
                h(Text, { color: theme.textMuted }, "Restart"),
                h(Text, { color: plan.requiresRestart ? theme.warning : theme.textMuted, bold: true },
                    plan.requiresRestart ? "Yes" : "No")
            ),
            h(Box, { flexDirection: "column", marginRight: 2 },
                h(Text, { color: theme.textMuted }, "Rollback"),
                h(Text, { color: plan.rollbackAvailable ? theme.success : theme.warning, bold: true },
                    plan.rollbackAvailable ? "Yes" : `No (${plan.rollbackUnavailableCount})`)
            ),
            h(Box, { flexDirection: "column" },
                h(Text, { color: theme.textMuted }, "Files"),
                h(Text, { color: theme.text, bold: true }, String(plan.filesAffected.length))
            )
        ),

        // Repair order
        h(Text, { color: theme.textMuted, bold: true }, "Repair Order:"),
        ...plan.issues.map((issue, i) => h(Text, {
            key: issue.id,
            color: statusColor(issue.severity, theme),
            wrap: "truncate-end"
        }, `  ${i + 1}. [${issue.severity}] ${issue.title || issue.description}`)),

        // Informational
        plan.informational && plan.informational.length > 0
            ? h(Box, { marginTop: 1, flexDirection: "column" },
                h(Text, { color: theme.textMuted, bold: true }, `Informational (${plan.informational.length}):`),
                ...plan.informational.map((info, i) => h(Text, {
                    key: i, color: theme.textMuted, wrap: "truncate-end"
                }, `  • ${info.description}`))
            )
            : null
    );
}

// ─── History Tab ──────────────────────────────────────────────────────

function HistoryTab({ history, isActive, onHighlight, theme }) {
    if (!history || history.length === 0) {
        return h(EmptyState, {
            title: "No repair history.",
            description: "Run 'devforgekit repair' to start your first repair.",
            theme
        });
    }

    return h(SelectList, {
        items: history, isActive, height: 16, theme,
        onHighlight: onHighlight,
        renderItem: (item, selected) => h(Text, {
            key: item.id,
            backgroundColor: selected && isActive ? theme.selection : undefined,
            color: selected && isActive ? theme.selectionText : (item.failed > 0 ? theme.error : item.fixed > 0 ? theme.success : theme.textMuted),
            wrap: "truncate-end"
        }, `${selected ? "❯ " : "  "}${(item.id || "").slice(0, 20).padEnd(20)}  ${String(item.fixed).padStart(3)}f ${String(item.failed).padStart(3)}x  ${item.createdAt?.slice(0, 10) || "?"}`)
    });
}

// ─── Detail Body ──────────────────────────────────────────────────────

function DetailBody({ tab, issue, history, plan, execution, theme }) {
    if (tab === "history" && history) {
        const pairs = [
            ["ID", (history.id || "").slice(0, 32)],
            ["Date", history.createdAt?.slice(0, 19).replace("T", " ") || "unknown"],
            ["Issues", history.issueCount || 0],
            ["Fixed", history.fixed || 0, theme.success],
            ["Failed", history.failed || 0, theme.error],
            ["Skipped", history.skipped || 0, theme.warning],
            ["Risk", history.riskLabel || history.riskLevel || "unknown"],
            ["Platform", history.platform || "unknown"],
            ["Machine", history.machine || "unknown"]
        ];
        if (history.qualityScore) {
            pairs.push(["Quality", `${history.qualityScore.score}/100 (${history.qualityScore.grade})`,
                history.qualityScore.score >= 80 ? theme.success : history.qualityScore.score >= 60 ? theme.warning : theme.error]);
        }
        if (history.rollbackSnapshotId) {
            pairs.push(["Snapshot", history.rollbackSnapshotId.slice(0, 20) + "..."]);
        }
        if (history.categoriesAffected && history.categoriesAffected.length > 0) {
            pairs.push(["Categories", history.categoriesAffected.join(", ")]);
        }
        return h(Box, { flexDirection: "column" },
            h(KeyValue, { theme, pairs, labelWidth: 12 })
        );
    }

    if (tab === "plan" && plan) {
        const pairs = [
            ["Total repairs", plan.totalRepairs],
            ["Informational", plan.totalInfo],
            ["Est. time", plan.estimatedTime],
            ["Risk level", plan.riskLabel, riskTone(plan.riskLevel, theme)],
            ["Restart req.", plan.requiresRestart ? "Yes" : "No"],
            ["Rollback", plan.rollbackAvailable ? "Available" : `${plan.rollbackUnavailableCount} unavailable`],
            ["Files", plan.filesAffected.length],
            ["Packages", plan.packagesAffected.length]
        ];
        return h(Box, { flexDirection: "column" },
            h(KeyValue, { theme, pairs, labelWidth: 14 }),
            plan.categoriesAffected.length > 0 ? h(Box, { marginTop: 1, flexDirection: "column" },
                h(Text, { color: theme.textMuted, bold: true }, "Categories"),
                ...plan.categoriesAffected.map((c, i) => h(Text, { key: i, color: theme.text }, `  ${c}`))
            ) : null,
            plan.filesAffected.length > 0 ? h(Box, { marginTop: 1, flexDirection: "column" },
                h(Text, { color: theme.textMuted, bold: true }, "Files affected"),
                ...plan.filesAffected.map((f, i) => h(Text, { key: i, color: theme.text, wrap: "truncate-end" }, `  ${f}`))
            ) : null,
            plan.packagesAffected.length > 0 ? h(Box, { marginTop: 1, flexDirection: "column" },
                h(Text, { color: theme.textMuted, bold: true }, "Packages"),
                ...plan.packagesAffected.map((p, i) => h(Text, { key: i, color: theme.text }, `  ${p}`))
            ) : null
        );
    }

    if (tab === "overview" && execution) {
        if (execution.dryRun) {
            const pairs = [
                ["Dry run", "Yes"],
                ["Repairs", execution.totalRepairs],
                ["Risk", execution.riskLevel],
                ["Est. time", execution.estimatedTime],
                ["Restart", execution.requiresRestart ? "Yes" : "No"],
                ["Files", execution.filesAffected?.length || 0],
                ["Packages", execution.packagesAffected?.length || 0]
            ];
            return h(Box, { flexDirection: "column" },
                h(KeyValue, { theme, pairs, labelWidth: 14 }),
                execution.categoriesAffected?.length > 0 ? h(Box, { marginTop: 1, flexDirection: "column" },
                    h(Text, { color: theme.textMuted, bold: true }, "Categories"),
                    ...execution.categoriesAffected.map((c, i) => h(Text, { key: i, color: theme.text }, `  ${c}`))
                ) : null
            );
        }
        const pairs = [
            ["Fixed", execution.fixed || 0, theme.success],
            ["Failed", execution.failed || 0, theme.error],
            ["Skipped", execution.skipped || 0, theme.warning],
            ["Files modified", execution.filesModified || 0],
            ["Rollback", execution.rollbackAvailable ? "Available" : "N/A"],
            ["Duration", `${Math.round((execution.durationMs || 0) / 1000)}s`]
        ];
        return h(Box, { flexDirection: "column" },
            h(KeyValue, { theme, pairs, labelWidth: 14 })
        );
    }

    // Default: issue details
    if (!issue) {
        return h(EmptyState, { title: "No issue selected.", theme });
    }

    const action = issue.action || {};
    const pairs = [
        ["Title", issue.title || "unknown"],
        ["Severity", issue.severity, statusColor(issue.severity, theme)],
        ["Category", issue.categoryLabel || issue.category],
        ["Subsystem", issue.subsystem],
        ["Risk", issue.riskLabel, riskTone(issue.risk, theme)],
        ["Time", issue.estimatedTime],
        ["Rollback", issue.rollbackAvailable ? "Available" : "N/A"],
        ["Restart", issue.requiresRestart ? "Yes" : "No"],
        ["Action", action.type || "manual"]
    ];

    if (action.command) pairs.push(["Command", action.command]);
    if (action.package) pairs.push(["Package", action.package]);
    if (action.filesAffected) pairs.push(["Files", action.filesAffected.join(", ")]);

    return h(Box, { flexDirection: "column" },
        h(KeyValue, { theme, pairs, labelWidth: 10 }),
        h(Box, { marginTop: 1, flexDirection: "column" },
            h(Text, { color: theme.textMuted, bold: true }, "Problem"),
            h(Text, { color: theme.text, wrap: "wrap" }, `  ${issue.description}`)
        ),
        h(Box, { marginTop: 1, flexDirection: "column" },
            h(Text, { color: theme.textMuted, bold: true }, "Impact"),
            h(Text, { color: theme.text, wrap: "wrap" }, `  ${issue.impact}`)
        ),
        h(Box, { marginTop: 1, flexDirection: "column" },
            h(Text, { color: theme.textMuted, bold: true }, "Fix"),
            h(Text, { color: theme.text, wrap: "wrap" }, `  ${issue.fix}`)
        )
    );
}
