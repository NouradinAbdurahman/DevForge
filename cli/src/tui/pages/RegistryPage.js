// Registry: the health-scorecard overview `devforgekit registry audit`
// prints, in dashboard form (v2.1.1 Registry Excellence) - distinct from
// ComponentsPage (browse-and-install one package at a time). Answers
// "how healthy is the registry as a whole, and where's the highest-
// leverage gap to close." Read-only: no install/remove actions here.
//
// Deliberately compact - one panel, not four stacked ones. An earlier
// revision spread this across Registry Health / Recommendations / a
// Lowest-quality Table / Top categories+tags, each in its own bordered
// Panel; the combined height (four 2-row borders plus ~9 KeyValue rows,
// a wrapped recommendations block, and a 6-row table) exceeded this
// app's documented worst-case content budget (PAGE_MIN_SIZE, 80x24 -
// see docs/TUI.md). Past that budget Ink doesn't cleanly truncate from
// the bottom; it silently drops or merges rows from wherever the layout
// happened to run out of room, which is exactly the corruption a
// resize-driven render caught here. One panel, few rows, always fits.
import { Box, Text, useInput } from "ink";
import { h, Panel, KeyValue, KeyHints } from "../components/ui.js";
import { useStore } from "../store.js";
import { registrySnapshot, registryAudit } from "../data.js";
import { scoreManifest } from "../../core/quality.js";

const LOWEST_QUALITY_COUNT = 3;
const RECOMMENDATIONS_SHOWN = 2;

export function RegistryPage({ isActive }) {
    const { theme, state, actions } = useStore();
    const { packages } = registrySnapshot();
    const audit = registryAudit();

    useInput((input) => {
        if (input === "c") actions.navigate("components");
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    const lowest = packages
        .map((pkg) => ({ name: pkg.name, score: scoreManifest(pkg).score }))
        .sort((a, b) => a.score - b.score)
        .slice(0, LOWEST_QUALITY_COUNT);

    const qualityColor = (score) => (score >= 80 ? theme.success : score >= 50 ? theme.warning : theme.error);
    const coverageLine = `Compat ${audit.compatibilityCoverage}% · Docs ${audit.documentationCoverage}% · Validate ${audit.validationCoverage}% · Aliases ${audit.aliasesCoverage}% · Arch ${audit.architectureCoverage}%`;

    return h(Box, { flexGrow: 1 },
        h(Panel, { title: "Registry Health", theme, isActive, flexGrow: 1 },
            h(KeyValue, {
                theme, labelWidth: 16,
                pairs: [
                    ["Packages", `${audit.total} total · ${audit.verified} CI-verified (${Math.round((audit.verified / audit.total) * 100)}%)`],
                    ["Quality", `${audit.averageQuality}/100`, qualityColor(audit.averageQuality)],
                    ["Coverage", coverageLine],
                    ["Deprecated", audit.deprecated],
                    ["Broken", audit.brokenMetadata, audit.brokenMetadata > 0 ? theme.error : undefined]
                ]
            }),
            h(Box, { flexDirection: "column", marginTop: 1 },
                h(Text, { color: theme.textMuted, bold: true }, "Needs attention"),
                ...lowest.map((p) => h(Text, { key: p.name, color: qualityColor(p.score), wrap: "truncate-end" }, `  ${p.name.padEnd(20)} ${p.score}/100`))
            ),
            h(Box, { flexDirection: "column", marginTop: 1 },
                h(Text, { color: theme.textMuted, bold: true }, "Recommendations"),
                audit.recommendations.length === 0
                    ? h(Text, { color: theme.success }, "  No high-leverage gaps found.")
                    : audit.recommendations.slice(0, RECOMMENDATIONS_SHOWN).map((rec, i) =>
                        h(Text, { key: i, color: theme.text, wrap: "truncate-end" }, `  - ${rec}`))
            ),
            h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints: [["c", "browse components"]] }))
        )
    );
}
