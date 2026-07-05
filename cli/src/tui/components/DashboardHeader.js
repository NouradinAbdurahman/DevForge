// The persistent dashboard header (v1.4.1, docs/TUI.md's "Persistent
// dashboard header" section): the same "DevForgeKit" logo/wordmark/
// tagline the startup animation draws (tui/startup/asciiLogo.js - the
// exact same building blocks, not a lookalike copy) becomes a
// permanent application banner once the dashboard mounts, instead of
// a splash screen that disappears. Every page shares this one
// component - it never re-centers, never moves, and its height only
// ever grows on generously large terminals (see layout/responsive.js's
// headerMode); on anything at or near a page's own minimum size it
// collapses to the compact 3-row form so no existing page layout is
// squeezed.
//
// Left-aligned, not centered - the logo starts at the exact same
// column (LOGO_LEFT_MARGIN) the startup animation used, so there's no
// jump at handoff. The logo always renders in theme.accent, the same
// token the startup animation uses, so the color never shifts either.
import React from "react";
import { Box, Text } from "ink";
import { h } from "./ui.js";
import { buildLogoLines, WORDMARK, SESSION_TAGLINE, LOGO_LEFT_MARGIN } from "../startup/asciiLogo.js";
import { registrySnapshot } from "../data.js";
import { getVersion } from "../../version.js";
import { headerMode } from "../layout/responsive.js";

// StatsLine - "Version x.y.z • N Components • N Profiles • N Recipes",
// colored as distinct segments (label/value/separator) rather than one
// flat muted string, so the numbers that matter actually stand out.
// Built as nested <Text> spans (not a <Box> of sibling <Text>
// elements) - Ink treats nested Text as one reflowable text run,
// wrapping whole words if space runs out; a Box of siblings instead
// gives each child its own flex-shrink share of the width, which
// truncates mid-word the moment the row doesn't fit.
function StatsLine({ theme }) {
    let stats = null;
    try {
        stats = registrySnapshot().stats;
    } catch {
        // Registry failed to load - the Dashboard page already surfaces
        // that in detail; the header just falls back to the version.
    }

    const sep = (key) => h(Text, { key, color: theme.border }, " • ");
    const segments = [
        h(Text, { key: "version-label", color: theme.textMuted }, "Version "),
        h(Text, { key: "version-value", color: theme.accent, bold: true }, getVersion())
    ];
    if (stats) {
        const counts = [
            ["components", stats.totalComponents, "Components"],
            ["profiles", stats.totalProfiles, "Profiles"],
            ["recipes", stats.totalRecipes, "Recipes"]
        ];
        for (const [key, count, label] of counts) {
            segments.push(sep(`${key}-sep`));
            segments.push(h(Text, { key: `${key}-count`, color: theme.accent, bold: true }, String(count)));
            segments.push(h(Text, { key: `${key}-label`, color: theme.textMuted }, ` ${label}`));
        }
    }
    return h(Text, null, ...segments);
}

function DashboardHeaderImpl({ theme, columns, rows }) {
    const mode = headerMode(columns, rows);
    const showLogo = mode === "full" || mode === "compact";
    const showTagline = mode === "full" || mode === "minimal";
    const showStats = mode === "full";
    const logo = showLogo ? buildLogoLines() : [];

    return h(Box, { flexDirection: "column", width: columns },
        h(Box, { flexDirection: "column", paddingLeft: LOGO_LEFT_MARGIN },
            ...logo.map((line, i) => h(Text, { key: i, color: theme.accent }, line)),
            showLogo ? h(Text, null, " ") : null,
            h(Text, { color: theme.text, bold: true }, WORDMARK),
            showTagline ? h(Text, { color: theme.textMuted }, SESSION_TAGLINE) : null,
            showStats ? h(StatsLine, { theme }) : null
        ),
        h(Text, { color: theme.border }, "─".repeat(Math.max(1, columns)))
    );
}

export const DashboardHeader = React.memo(DashboardHeaderImpl);
