// Help: the keyboard reference (also in docs/TUI.md).
import { Box, Text } from "ink";
import { h, Panel, KeyValue } from "../components/ui.js";
import { useStore } from "../store.js";

export function HelpPage() {
    const { theme } = useStore();

    return h(Box, { flexGrow: 1 },
        h(Panel, { title: "Global keys", theme, flexGrow: 1 },
            h(KeyValue, {
                theme, labelWidth: 12,
                pairs: [
                    ["Tab", "switch focus between the menu and the page"],
                    ["↑↓ / jk", "move within the focused list"],
                    ["PgUp/PgDn", "jump a full page within the focused list"],
                    ["g / G", "jump to the first / last item in the focused list"],
                    ["Enter", "open / activate the highlighted item"],
                    ["Esc", "back (closes search, wizard steps, text fields)"],
                    ["/", "global search (components, profiles, recipes, plugins) - or the page's own filter, where one exists"],
                    [": / Ctrl+P", "Command Palette - fuzzy-jump to any page or global action"],
                    ["R", "refresh cached data (registry, install states)"],
                    ["?", "this help page"],
                    ["q", "quit (from anywhere except a text field)"]
                ]
            }),
            h(Box, { marginTop: 1 }, h(Text, { color: theme.accent, bold: true }, "Menu shortcuts (when the menu has focus)")),
            h(KeyValue, {
                theme, labelWidth: 12,
                pairs: [
                    ["1", "Dashboard"], ["w", "Workspaces"], ["c", "Components"], ["p", "Profiles"], ["r", "Recipes"],
                    ["g", "Project Generator"], ["n", "Plugins"], ["d", "Doctor"], ["m", "Compatibility"],
                    ["e", "AI Assistant"], ["E", "AI Overview"], ["P", "AI Providers"], ["M", "AI Models"],
                    ["K", "AI Credentials"], ["D", "AI Diagnostics"], ["C", "AI Capabilities"], ["H", "AI History"],
                    ["u", "Updates"], ["i", "Inventory"], ["k", "Commands"], ["o", "Configuration"],
                    ["l", "Logs"], ["a", "About"]
                ]
            })
        ),
        h(Panel, { title: "Page keys", theme, flexGrow: 1 },
            h(KeyValue, {
                theme, labelWidth: 14,
                pairs: [
                    ["Workspaces", "Enter switch · n new · v verify · x snapshot · z deactivate · D delete (x2)"],
                    ["Components", "/ filter · ←→ status filter · a install · u update · r remove"],
                    ["Profiles", "a install · s set default"],
                    ["Recipes", "a run (install + configure + verify)"],
                    ["Generator", "Enter pick · Space cycle option · c confirm"],
                    ["Plugins", "x run first command (suspends)"],
                    ["Doctor", "s scan · F scan+repair · D doctor.sh · X doctor.sh --fix"],
                    ["Updates", "a update selected · A full update.sh (suspends)"],
                    ["Inventory", "a regenerate reports (suspends)"],
                    ["Config", "Enter/Space cycle or edit a field"],
                    ["Commands", "/ filter · c copy · e cycle examples · r run"],
                    ["Logs", "←/→ filter level · e export"]
                ]
            }),
            h(Box, { marginTop: 1 }, h(Text, { color: theme.textMuted, wrap: "wrap" },
                "\"Suspends\" = the dashboard steps aside and the underlying script owns the terminal (like lazygit handing off to $EDITOR), then you return here.")))
    );
}
