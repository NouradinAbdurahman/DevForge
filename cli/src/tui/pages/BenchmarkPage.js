// Benchmark Engine TUI page (v2.1.7). Full dashboard for running
// benchmarks, viewing history, trends, comparison, and intelligence.
import { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, SelectList, KeyValue, KeyHints, DetailPanel, InstallProgress, Badge, statusColor, useDetailWidth, EmptyState, ProgressBar } from "../components/ui.js";
import { useStore } from "../store.js";
import {
    runBenchmark,
    saveResult,
    listHistory,
    getResult,
    compareResults,
    getTrendSummary,
    renderSparkline,
    explainBenchmark,
    explainBenchmarkResult,
    generateRichReport,
    gradeForScore,
    BENCHMARK_METADATA
} from "../../core/benchmark.js";

const TABS = [
    { id: "overview", label: "Overview", key: "1" },
    { id: "history", label: "History", key: "2" },
    { id: "categories", label: "Categories", key: "3" },
    { id: "trends", label: "Trends", key: "4" },
    { id: "compare", label: "Compare", key: "5" }
];

const PROFILE_LABELS = { quick: "Quick (~10-20s)", standard: "Standard (~30-60s)", full: "Full (~2-5min)" };

function scoreTone(score, theme) {
    if (score >= 90) return theme.success;
    if (score >= 70) return theme.warning;
    return theme.error;
}

export function BenchmarkPage({ isActive }) {
    const { theme, state, actions } = useStore();
    const [tab, setTab] = useState("overview");
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState(null);
    const [latest, setLatest] = useState(null);
    const [history, setHistory] = useState(null);
    const [comparison, setComparison] = useState(null);
    const [highlighted, setHighlighted] = useState(null);
    const [profile, setProfile] = useState("quick");
    const detailW = useDetailWidth(46);

    // Load history on mount
    useEffect(() => {
        if (history === null) {
            try { setHistory(listHistory()); } catch { setHistory([]); }
        }
    }, [history]);

    // Load latest result
    useEffect(() => {
        if (latest === null && history && history.length > 0) {
            try { setLatest(getResult(history[0].id)); } catch { /* ignore */ }
        }
    }, [latest, history]);

    const runBench = useCallback(async () => {
        if (running) return;
        setRunning(true);
        setProgress({ label: "Starting...", done: 0, total: 6 });
        actions.setBusy({ label: "benchmark" });
        actions.log("benchmark started");

        try {
            const result = await runBenchmark({
                profile,
                onProgress: (p) => setProgress({ label: p.label, done: p.index + 1, total: p.total })
            });
            saveResult(result);
            setLatest(result);
            setProgress(null);
            setRunning(false);
            actions.setBusy(null);
            try { setHistory(listHistory()); } catch { /* ignore */ }
            actions.notify(`Benchmark: ${result.overallScore}/100 (${result.overallGrade})`, result.overallScore >= 80 ? "success" : "warning");
        } catch (err) {
            setProgress(null);
            setRunning(false);
            actions.setBusy(null);
            actions.notify(`Benchmark failed: ${err.message}`, "error");
        }
    }, [running, profile, actions]);

    const runCompare = useCallback(() => {
        if (!history || history.length < 2) return;
        try {
            const oldR = getResult(history[1].id);
            const newR = getResult(history[0].id);
            setComparison(compareResults(oldR, newR));
        } catch { /* ignore */ }
    }, [history]);

    useInput((input) => {
        if (!isActive || state.searchOpen) return;
        if (input === "1") setTab("overview");
        else if (input === "2") setTab("history");
        else if (input === "3") setTab("categories");
        else if (input === "4") setTab("trends");
        else if (input === "5") { setTab("compare"); runCompare(); }
        else if (input === "r") runBench();
        else if (input === "p") {
            const profiles = ["quick", "standard", "full"];
            const idx = profiles.indexOf(profile);
            setProfile(profiles[(idx + 1) % profiles.length]);
        }
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    // History items for list
    const historyItems = (history || []).map((h) => ({
        ...h,
        label: `${(h.id || "").slice(0, 24).padEnd(24)}  ${String(h.overallScore).padStart(3)}/100  ${h.overallGrade || "?"}  ${h.createdAt?.slice(0, 10) || "?"}`
    }));
    const currentHistory = highlighted && historyItems.includes(highlighted) ? highlighted : historyItems[0] || null;

    // Category items for latest result
    const categoryItems = latest ? Object.entries(latest.categoryScores || {}).map(([key, score]) => ({
        key, score, label: BENCHMARK_METADATA[key]?.label || key,
        grade: gradeForScore(score)
    })) : [];
    const currentCategory = highlighted && categoryItems.includes(highlighted) ? highlighted : categoryItems[0] || null;

    const tabHints = [
        ["1", "Overview"], ["2", "History"], ["3", "Categories"], ["4", "Trends"], ["5", "Compare"],
        ["r", "run"], ["p", `profile: ${profile}`]
    ];

    return h(Box, { flexGrow: 1 },
        h(Panel, {
            title: `Benchmark Engine — ${TABS.find((t) => t.id === tab)?.label || ""}`,
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
                unit: "categories",
                theme
            }) : null,

            // Tab content
            !progress ? h(Box, { flexDirection: "column" },
                tab === "overview" ? h(OverviewTab, {
                    latest, history, profile, theme
                }) : null,

                tab === "history" ? h(HistoryTab, {
                    history: historyItems, isActive, onHighlight: setHighlighted, theme
                }) : null,

                tab === "categories" ? h(CategoriesTab, {
                    categories: categoryItems, latest, isActive, onHighlight: setHighlighted, theme
                }) : null,

                tab === "trends" ? h(TrendsTab, {
                    latest, theme
                }) : null,

                tab === "compare" ? h(CompareTab, {
                    comparison, history, theme
                }) : null
            ) : null
        ),

        // Right: detail panel
        h(DetailPanel, {
            title: tab === "history" ? "Result Details" : tab === "categories" ? "Category Intelligence" : "Benchmark Details",
            theme, width: detailW,
            emptyText: "Select an item to see details.",
            body: h(DetailBody, {
                tab, latest, history: currentHistory, category: currentCategory, comparison, theme
            }),
            footer: h(Box, { marginTop: 1 },
                h(KeyHints, { theme, hints: tabHints })
            )
        })
    );
}

// ─── Overview Tab ─────────────────────────────────────────────────────

function OverviewTab({ latest, history, profile, theme }) {
    const recentRuns = (history || []).slice(0, 5);
    const avgScore = recentRuns.length > 0
        ? Math.round(recentRuns.reduce((acc, r) => acc + (r.overallScore || 0), 0) / recentRuns.length)
        : null;

    return h(Box, { flexDirection: "column" },
        // Summary cards
        h(Box, { marginBottom: 1 },
            h(Box, { flexDirection: "column", marginRight: 2 },
                h(Text, { color: theme.textMuted, bold: true }, "Score"),
                h(Text, {
                    color: latest ? scoreTone(latest.overallScore, theme) : theme.textMuted,
                    bold: true
                }, latest ? `${latest.overallScore}/100` : "—")
            ),
            h(Box, { flexDirection: "column", marginRight: 2 },
                h(Text, { color: theme.textMuted, bold: true }, "Grade"),
                h(Text, {
                    color: latest ? scoreTone(latest.overallScore, theme) : theme.textMuted,
                    bold: true
                }, latest ? latest.overallGrade : "—")
            ),
            h(Box, { flexDirection: "column", marginRight: 2 },
                h(Text, { color: theme.textMuted, bold: true }, "Profile"),
                h(Text, { color: theme.accent, bold: true }, latest ? latest.profile : profile)
            ),
            h(Box, { flexDirection: "column", marginRight: 2 },
                h(Text, { color: theme.textMuted, bold: true }, "Avg"),
                h(Text, { color: avgScore ? scoreTone(avgScore, theme) : theme.textMuted, bold: true },
                    avgScore ? `${avgScore}` : "—")
            ),
            h(Box, { flexDirection: "column" },
                h(Text, { color: theme.textMuted, bold: true }, "Runs"),
                h(Text, { color: theme.text, bold: true }, String(history?.length || 0))
            )
        ),

        // Quality score
        latest?.qualityScore ? h(Box, { marginBottom: 1 },
            h(KeyValue, {
                theme, labelWidth: 14,
                pairs: [
                    ["Quality", `${latest.qualityScore.score}/100 (${latest.qualityScore.grade})`,
                        scoreTone(latest.qualityScore.score, theme)],
                    ["Coverage", `${latest.qualityScore.coverage}%`],
                    ["Confidence", `${latest.qualityScore.confidence}%`],
                    ["Stability", `${latest.qualityScore.stability}%`]
                ]
            })
        ) : null,

        // Slowest/fastest
        latest?.slowest ? h(Box, { marginBottom: 1 },
            h(Text, { color: theme.textMuted },
                `Slowest: ${BENCHMARK_METADATA[latest.slowest.category]?.label || latest.slowest.category} (${latest.slowest.score}/100)`
            )
        ) : null,
        latest?.fastest ? h(Box, { marginBottom: 1 },
            h(Text, { color: theme.textMuted },
                `Fastest: ${BENCHMARK_METADATA[latest.fastest.category]?.label || latest.fastest.category} (${latest.fastest.score}/100)`
            )
        ) : null,

        // Recent runs
        recentRuns.length > 0 ? h(Box, { flexDirection: "column", marginTop: 1 },
            h(Text, { color: theme.textMuted, bold: true }, "Recent Runs"),
            ...recentRuns.map((r, i) => h(Text, {
                key: i,
                color: scoreTone(r.overallScore || 0, theme)
            }, `  ${r.createdAt?.slice(0, 10) || "?"}  ${String(r.overallScore).padStart(3)}/100  ${r.overallGrade || "?"}  ${r.profile}`))
        ) : null,

        // Hints
        !latest ? h(Box, { marginTop: 1 },
            h(Text, { color: theme.textMuted }, "Press "),
            h(Text, { color: theme.accent, bold: true }, "r"),
            h(Text, { color: theme.textMuted }, " to run a benchmark. Press "),
            h(Text, { color: theme.accent, bold: true }, "p"),
            h(Text, { color: theme.textMuted }, " to change profile.")
        ) : null
    );
}

// ─── History Tab ──────────────────────────────────────────────────────

function HistoryTab({ history, isActive, onHighlight, theme }) {
    if (!history || history.length === 0) {
        return h(EmptyState, {
            title: "No benchmark history.",
            description: "Press 'r' to run your first benchmark.",
            theme
        });
    }

    return h(SelectList, {
        items: history, isActive, height: 16, theme,
        onHighlight: onHighlight,
        renderItem: (item, selected) => h(Text, {
            key: item.id,
            backgroundColor: selected && isActive ? theme.selection : undefined,
            color: selected && isActive ? theme.selectionText : scoreTone(item.overallScore || 0, theme),
            wrap: "truncate-end"
        }, `${selected ? "❯ " : "  "}${(item.id || "").slice(0, 24).padEnd(24)}  ${String(item.overallScore).padStart(3)}/100  ${(item.overallGrade || "?").padEnd(3)}  ${item.createdAt?.slice(0, 10) || "?"}`)
    });
}

// ─── Categories Tab ───────────────────────────────────────────────────

function CategoriesTab({ categories, latest, isActive, onHighlight, theme }) {
    if (!latest) {
        return h(EmptyState, {
            title: "No benchmark result.",
            description: "Press 'r' to run a benchmark.",
            theme
        });
    }

    if (categories.length === 0) {
        return h(EmptyState, {
            title: "No category scores.",
            description: "Benchmark may have skipped all categories.",
            theme
        });
    }

    return h(SelectList, {
        items: categories, isActive, height: 16, theme,
        onHighlight: onHighlight,
        renderItem: (item, selected) => h(Text, {
            key: item.key,
            backgroundColor: selected && isActive ? theme.selection : undefined,
            color: selected && isActive ? theme.selectionText : scoreTone(item.score, theme),
            wrap: "truncate-end"
        }, `${selected ? "❯ " : "  "}${item.label.padEnd(20)}  ${String(item.score).padStart(3)}/100  (${item.grade})`)
    });
}

// ─── Trends Tab ───────────────────────────────────────────────────────

function TrendsTab({ latest, theme }) {
    const [trends, setTrends] = useState(null);

    useEffect(() => {
        if (trends === null) {
            const cats = latest ? Object.keys(latest.categoryScores || {}) : ["overall"];
            const allCats = ["overall", ...cats];
            const results = allCats.map((cat) => {
                try { return getTrendSummary(cat, { limit: 10 }); } catch { return null; }
            }).filter(Boolean);
            setTrends(results);
        }
    }, [trends, latest]);

    if (!trends || trends.length === 0) {
        return h(EmptyState, {
            title: "No trend data.",
            description: "Run more benchmarks to see trends over time.",
            theme
        });
    }

    return h(Box, { flexDirection: "column" },
        h(Text, { color: theme.textMuted, bold: true }, "Performance Trends"),
        h(Text, { color: theme.textMuted }, "  (across benchmark history)"),
        h(Text, ""),
        ...trends.map((t, i) => {
            const label = BENCHMARK_METADATA?.[t.category]?.label || (t.category === "overall" ? "Overall" : t.category);
            const dirColor = t.direction === "improving" ? theme.success :
                t.direction === "declining" ? theme.error : theme.textMuted;
            return h(Box, { key: i, flexDirection: "column", marginBottom: 1 },
                h(Text, { color: theme.text, bold: true }, `  ${label}`),
                h(Text, { color: dirColor },
                    `    ${t.direction}  ${t.first || "?"} → ${t.last || "?"}  (${t.delta > 0 ? "+" : ""}${t.delta || 0})`
                ),
                t.sparkline ? h(Text, { color: theme.accent },
                    `    ${t.sparkline}`
                ) : null
            );
        })
    );
}

// ─── Compare Tab ──────────────────────────────────────────────────────

function CompareTab({ comparison, history, theme }) {
    if (!comparison) {
        if (history && history.length >= 2) {
            return h(EmptyState, {
                title: "Press '5' to load comparison.",
                description: "Compares the two most recent benchmark results.",
                theme
            });
        }
        return h(EmptyState, {
            title: "Not enough data.",
            description: "Need at least 2 benchmark results to compare.",
            theme
        });
    }

    return h(Box, { flexDirection: "column" },
        // Overall
        h(Box, { marginBottom: 1 },
            h(Text, { color: theme.text, bold: true },
                `Overall: ${comparison.old.overallScore} → ${comparison.new.overallScore}`
            ),
            comparison.overallDelta != null
                ? h(Text, {
                    color: comparison.overallDelta > 0 ? theme.success :
                        comparison.overallDelta < 0 ? theme.error : theme.textMuted,
                    bold: true
                }, `  (${comparison.overallDelta > 0 ? "+" : ""}${comparison.overallDelta})`)
                : null
        ),

        // Summary
        comparison.summary ? h(Box, { marginBottom: 1 },
            h(Text, { color: theme.textMuted },
                `${comparison.summary.improved} improved, ${comparison.summary.regressed} regressed, ${comparison.summary.significant} significant`
            )
        ) : null,

        // Category breakdown
        h(Text, { color: theme.textMuted, bold: true }, "Categories:"),
        ...comparison.categories.map((cat, i) => h(Text, {
            key: i,
            color: cat.status === "improved" ? theme.success :
                cat.status === "regressed" ? theme.error : theme.textMuted,
            wrap: "truncate-end"
        },
            `  ${cat.status === "improved" ? "↑" : cat.status === "regressed" ? "↓" : "="} ${(cat.label || cat.category).padEnd(20)}  ${String(cat.oldScore ?? "?").padStart(3)} → ${String(cat.newScore ?? "?").padStart(3)}  ${cat.significant ? "*" : ""}`
        ))
    );
}

// ─── Detail Body ──────────────────────────────────────────────────────

function DetailBody({ tab, latest, history, category, comparison, theme }) {
    if (tab === "history" && history) {
        const pairs = [
            ["ID", (history.id || "").slice(0, 32)],
            ["Date", history.createdAt?.slice(0, 19).replace("T", " ") || "unknown"],
            ["Profile", history.profile || "unknown"],
            ["Score", `${history.overallScore ?? 0}/100`, scoreTone(history.overallScore || 0, theme)],
            ["Grade", history.overallGrade || "?"],
            ["Duration", `${((history.durationMs || 0) / 1000).toFixed(1)}s`],
            ["Machine", history.machine || "unknown"],
            ["OS", history.os || "unknown"]
        ];
        if (history.qualityScore) {
            pairs.push(["Quality", `${history.qualityScore.score}/100 (${history.qualityScore.grade})`,
                scoreTone(history.qualityScore.score, theme)]);
            pairs.push(["Coverage", `${history.qualityScore.coverage}%`]);
            pairs.push(["Confidence", `${history.qualityScore.confidence}%`]);
        }
        if (history.categoryScores && Object.keys(history.categoryScores).length > 0) {
            pairs.push(["Categories", Object.keys(history.categoryScores).join(", ")]);
        }
        return h(Box, { flexDirection: "column" },
            h(KeyValue, { theme, pairs, labelWidth: 12 })
        );
    }

    if (tab === "categories" && category) {
        const meta = BENCHMARK_METADATA[category.key];
        const pairs = [
            ["Category", category.label],
            ["Score", `${category.score}/100 (${category.grade})`, scoreTone(category.score, theme)],
            ["Expected", meta?.expectedRange || "N/A"]
        ];

        return h(Box, { flexDirection: "column" },
            h(KeyValue, { theme, pairs, labelWidth: 12 }),
            meta ? h(Box, { marginTop: 1, flexDirection: "column" },
                h(Text, { color: theme.textMuted, bold: true }, "Description"),
                h(Text, { color: theme.text, wrap: "wrap" }, `  ${meta.description}`)
            ) : null,
            meta ? h(Box, { marginTop: 1, flexDirection: "column" },
                h(Text, { color: theme.textMuted, bold: true }, "Why it matters"),
                h(Text, { color: theme.text, wrap: "wrap" }, `  ${meta.why}`)
            ) : null,
            meta ? h(Box, { marginTop: 1, flexDirection: "column" },
                h(Text, { color: theme.textMuted, bold: true }, "Affects"),
                ...meta.affects.map((a, i) => h(Text, { key: i, color: theme.text }, `  • ${a}`))
            ) : null,
            category.score < 70 && meta ? h(Box, { marginTop: 1, flexDirection: "column" },
                h(Text, { color: theme.textMuted, bold: true }, "Recommendation"),
                h(Text, { color: theme.warning, wrap: "wrap" }, `  ${meta.recommendation}`)
            ) : null
        );
    }

    if (tab === "compare" && comparison) {
        const pairs = [
            ["Old", `${comparison.old.overallScore}/100 (${comparison.old.overallGrade})`],
            ["New", `${comparison.new.overallScore}/100 (${comparison.new.overallGrade})`],
            ["Delta", comparison.overallDelta != null ?
                `${comparison.overallDelta > 0 ? "+" : ""}${comparison.overallDelta}` : "N/A",
                comparison.overallDelta > 0 ? theme.success :
                    comparison.overallDelta < 0 ? theme.error : theme.textMuted],
            ["Improved", String(comparison.summary?.improved || 0), theme.success],
            ["Regressed", String(comparison.summary?.regressed || 0), theme.error],
            ["Significant", String(comparison.summary?.significant || 0), theme.warning]
        ];
        return h(Box, { flexDirection: "column" },
            h(KeyValue, { theme, pairs, labelWidth: 12 }),
            comparison.categories.length > 0 ? h(Box, { marginTop: 1, flexDirection: "column" },
                h(Text, { color: theme.textMuted, bold: true }, "Significant Changes"),
                ...comparison.categories.filter((c) => c.significant).map((c, i) => h(Text, {
                    key: i, color: c.status === "improved" ? theme.success : theme.error, wrap: "wrap"
                }, `  ${c.label}: ${c.oldScore}→${c.newScore} (${c.delta > 0 ? "+" : ""}${c.delta})`)),
                comparison.categories.filter((c) => c.significant).length === 0
                    ? h(Text, { color: theme.textMuted }, "  None") : null
            ) : null
        );
    }

    // Default: overview detail
    if (!latest) {
        return h(EmptyState, { title: "No benchmark run yet.", theme });
    }

    const pairs = [
        ["Score", `${latest.overallScore}/100`, scoreTone(latest.overallScore, theme)],
        ["Grade", latest.overallGrade],
        ["Profile", latest.profile],
        ["Duration", `${((latest.durationMs || 0) / 1000).toFixed(1)}s`],
        ["Machine", latest.machine?.hostname || "unknown"],
        ["OS", latest.machine?.os || "unknown"],
        ["CPU", latest.machine?.cpuModel || "unknown"],
        ["Cores", String(latest.machine?.cpuCount || 0)],
        ["RAM", `${latest.machine?.totalMemoryGb || 0}GB`],
        ["Node", latest.environment?.nodeVersion || "unknown"],
        ["Shell", latest.environment?.shellType || "unknown"]
    ];

    if (latest.qualityScore) {
        pairs.push(["Quality", `${latest.qualityScore.score}/100 (${latest.qualityScore.grade})`,
            scoreTone(latest.qualityScore.score, theme)]);
    }

    return h(Box, { flexDirection: "column" },
        h(KeyValue, { theme, pairs, labelWidth: 12 }),
        latest.slowest ? h(Box, { marginTop: 1 },
            h(Text, { color: theme.error },
                `Slowest: ${BENCHMARK_METADATA[latest.slowest.category]?.label || latest.slowest.category} (${latest.slowest.score}/100)`)
        ) : null,
        latest.fastest ? h(Box, { marginTop: 1 },
            h(Text, { color: theme.success },
                `Fastest: ${BENCHMARK_METADATA[latest.fastest.category]?.label || latest.fastest.category} (${latest.fastest.score}/100)`)
        ) : null,
        latest.skipped?.length > 0 ? h(Box, { marginTop: 1, flexDirection: "column" },
            h(Text, { color: theme.textMuted, bold: true }, "Skipped"),
            ...latest.skipped.map((s, i) => h(Text, {
                key: i, color: theme.textMuted
            }, `  • ${BENCHMARK_METADATA[s.category]?.label || s.category}: ${s.reason}`))
        ) : null
    );
}
