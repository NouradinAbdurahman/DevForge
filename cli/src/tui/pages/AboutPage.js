// About: version, platform stats, and where everything lives.
import { Box, Text } from "ink";
import { h, Panel, KeyValue, ErrorState } from "../components/ui.js";
import { useStore } from "../store.js";
import { registrySnapshot, plugins, generators } from "../data.js";
import { getVersion } from "../../version.js";

export function AboutPage() {
    const { theme } = useStore();
    let stats = null;
    let loadError = null;
    try {
        stats = registrySnapshot().stats;
    } catch (err) {
        stats = null;
        loadError = err.message;
    }

    return h(Box, { flexGrow: 1 },
        h(Panel, { title: `DevForgeKit v${getVersion()}`, theme, flexGrow: 1 },
            h(Text, { color: theme.text, wrap: "wrap" },
                "A cross-platform development workstation lifecycle manager: bootstrap, registry, profiles, recipes, plugins, project generator - and this dashboard."),
            loadError ? h(Box, { marginTop: 1 }, h(ErrorState, { message: `Registry data unavailable: ${loadError}`, theme })) : null,
            stats ? h(KeyValue, {
                theme, labelWidth: 16,
                pairs: [
                    ["Components", stats.totalComponents],
                    ["Categories", stats.totalCategories],
                    ["Collections", stats.totalCollections],
                    ["Profiles", stats.totalProfiles],
                    ["Recipes", stats.totalRecipes],
                    ["Generator stacks", generators().length],
                    ["Plugins", plugins().filter((p) => p.valid).length]
                ]
            }) : null,
            h(Text, { color: theme.textMuted, wrap: "wrap" },
                "\nDocs: docs/TUI.md (this dashboard), docs/CLI.md (every command), docs/PlatformArchitecture.md (the whole design).\nRepo: https://github.com/NouradinAbdurahman/DevForgeKit (MIT)"))
    );
}
