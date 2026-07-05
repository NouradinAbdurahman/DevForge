// The overview page: machine + registry at a glance. Slow numbers
// (installed count, health, outdated, disk, software update) resolve in
// the background after first paint - the page renders instantly with
// placeholders. Every device fact below (OS, model, memory, storage,
// software update, uptime) is a real, live probe against this machine
// (core/commands/stats.js's osInfo/hardwareInfo/memoryGb/diskUsage/
// uptimeString/softwareUpdateStatus) - never a hardcoded or guessed
// value; anything that can't be determined shows "checking..." or an
// honest error instead of a fabricated number.
import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { h, Panel, KeyValue } from "../components/ui.js";
import { useStore } from "../store.js";
import {
    registrySnapshot, machineStats, outdated, plugins, currentConfig, generators, activeWorkspaceName,
    deviceOsInfo, deviceHardwareInfo, deviceMemoryGb, deviceDiskUsage, deviceUptime, deviceSoftwareUpdate
} from "../data.js";
import { getVersion } from "../../version.js";

export function DashboardPage() {
    const { theme, state } = useStore();
    const [machine, setMachine] = useState(null);
    const [outdatedList, setOutdatedList] = useState(null);
    const [device, setDevice] = useState(null);
    const [update, setUpdate] = useState(null);
    const [error, setError] = useState(null);

    let registry = null;
    let config = null;
    let pluginList = [];
    try {
        registry = registrySnapshot();
        config = currentConfig();
        pluginList = plugins().filter((p) => p.valid);
    } catch (err) {
        if (!error) setError(err.message);
    }

    useEffect(() => {
        let mounted = true;
        machineStats().then((s) => mounted && setMachine(s)).catch(() => {});
        outdated().then((o) => mounted && setOutdatedList(o)).catch(() => {});
        // OS/hardware/memory/disk/uptime are all fast, local, no-network
        // probes - bundled together so the Device panel fills in as one
        // unit. Software update is checked separately (it can take up to
        // ~20s contacting Apple's servers) so it never blocks the rest.
        Promise.all([deviceOsInfo(), deviceHardwareInfo(), deviceMemoryGb(), deviceDiskUsage(), deviceUptime()])
            .then(([osData, hardware, memoryGb, disk, uptime]) => mounted && setDevice({ os: osData, hardware, memoryGb, disk, uptime }))
            .catch(() => {});
        deviceSoftwareUpdate().then((u) => mounted && setUpdate(u)).catch(() => {});
        return () => { mounted = false; };
    }, []);

    if (error) {
        return h(Panel, { title: "Dashboard", theme },
            h(Text, { color: theme.error }, `Registry failed to load: ${error}`));
    }

    const recentActions = state.logs.slice(-5).reverse();

    // Software update status line - "checking..." until the (slower,
    // network-dependent) probe resolves, then either the real verdict
    // or an honest "not checked" rather than a guessed "up to date".
    let updateLine = ["Software update", "checking...", undefined];
    if (update) {
        if (!update.checked) {
            updateLine = ["Software update", `not checked (${update.error})`, theme.textMuted];
        } else if (update.upToDate) {
            updateLine = ["Software update", "up to date", theme.success];
        } else {
            updateLine = ["Software update", `${update.updates.length} available: ${update.updates.slice(0, 2).join(", ")}${update.updates.length > 2 ? ", ..." : ""}`, theme.warning];
        }
    }

    return h(Box, { flexDirection: "column", flexGrow: 1 },
        h(Box, null,
            h(Panel, { title: "Machine", theme, flexGrow: 1 },
                h(KeyValue, {
                    theme,
                    pairs: [
                        ["Installed components", machine ? `${machine.installed} / ${machine.checked}` : "checking..."],
                        ["Health score", machine ? `${machine.health.score}% - ${machine.health.verdict}` : "checking...",
                            machine ? (machine.health.score >= 90 ? theme.success : machine.health.score >= 70 ? theme.warning : theme.error) : theme.textMuted],
                        ["Outdated packages", outdatedList ? String(outdatedList.length) : "checking...",
                            outdatedList && outdatedList.length > 0 ? theme.warning : undefined],
                        ["Storage", device ? `${device.disk.usedGb} / ${device.disk.totalGb} GB (${device.disk.usedPercent}% used)` : "checking...",
                            device ? (device.disk.usedPercent >= 95 ? theme.error : device.disk.usedPercent >= 85 ? theme.warning : undefined) : undefined],
                        updateLine
                    ]
                })
            ),
            h(Panel, { title: "Registry", theme, flexGrow: 1 },
                h(KeyValue, {
                    theme,
                    pairs: [
                        ["Components", registry.stats.totalComponents],
                        ["Categories", registry.stats.totalCategories],
                        ["Collections", registry.stats.totalCollections],
                        ["Profiles", registry.stats.totalProfiles],
                        ["Recipes", registry.stats.totalRecipes],
                        ["Quality score", `${registry.stats.qualityScore}/100`]
                    ]
                })
            )
        ),
        h(Box, null,
            h(Panel, { title: "Device", theme, flexGrow: 1 },
                h(KeyValue, {
                    theme,
                    pairs: [
                        ["OS", device ? `${device.os.name} ${device.os.version} (${device.os.build})` : "checking..."],
                        ["Model", device ? device.hardware.model : "checking..."],
                        ["Chip", device ? device.hardware.chip : "checking..."],
                        ["Memory", device ? `${device.memoryGb} GB` : "checking..."],
                        // The real `uptime` output, trimmed to just the
                        // "up ..." clause for display - the load-average
                        // tail is real too, just not device-overview
                        // material, and made this row wrap awkwardly.
                        ["Uptime", device ? device.uptime.replace(/^.*?\bup\b\s*/, "").split(",").slice(0, 2).join(",") : "checking..."]
                    ]
                })
            ),
            h(Panel, { title: "Platform", theme, flexGrow: 1 },
                h(KeyValue, {
                    theme,
                    pairs: [
                        ["DevForgeKit", `v${getVersion()}`],
                        ["Workspace", activeWorkspaceName() || "-"],
                        ["Current profile", config.defaultProfile || "-"],
                        ["Editor / shell", `${config.editor} / ${config.shell}`],
                        ["Plugins installed", pluginList.length],
                        ["Generator stacks", generators().length]
                    ]
                })
            )
        ),
        h(Panel, { title: "Recent actions (this session)", theme },
            recentActions.length === 0
                ? h(Text, { color: theme.textMuted }, "No actions yet - install something, run doctor, generate a project...")
                : h(Box, { flexDirection: "column" },
                    ...recentActions.map((entry) =>
                        h(Text, {
                            key: entry.time.getTime() + "-" + entry.message,
                            color: entry.level === "error" ? theme.error : entry.level === "warning" ? theme.warning : theme.text
                        }, `${entry.time.toTimeString().slice(0, 8)}  ${entry.message.slice(0, 70)}`)))
        ),
        outdatedList && outdatedList.length > 0
            ? h(Panel, { title: "Update notifications", theme },
                h(Text, { color: theme.warning },
                    `${outdatedList.length} Homebrew package(s) can be updated: ${outdatedList.slice(0, 8).join(", ")}${outdatedList.length > 8 ? ", ..." : ""} - open Updates (u)`))
            : null
    );
}
