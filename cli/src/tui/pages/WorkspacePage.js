// Workspaces: browse/create/switch/verify/snapshot/delete isolated dev
// environments (git/ssh/env/docker/k8s/cloud/shell identity) - the same
// engine `devforgekit workspace ...` drives (core/workspace/*.js).
//
// v2.1.8 Redesign: tabbed interface with Overview, Workspaces, Snapshots,
// and Health tabs. The old single-list page is now the "Workspaces" tab.
// Overview shows active workspace metadata + health score. Snapshots
// browses and restores point-in-time snapshots. Health shows the
// per-subsystem health breakdown.
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import {
    h, Panel, SelectList, KeyValue, KeyHints, TextField, statusColor,
    useDetailWidth, DetailPanel, ErrorState, LoadingState
} from "../components/ui.js";
import { useStore } from "../store.js";
import { workspaceList, activeWorkspaceName } from "../data.js";
import { createWorkspace, deleteWorkspace } from "../../core/workspace/store.js";
import { switchToWorkspace, deactivateWorkspace } from "../../core/workspace/switcher.js";
import { verifyWorkspace } from "../../core/workspace/health.js";
import { createSnapshot, listSnapshots, restoreSnapshot } from "../../core/workspace/snapshot.js";
import { getWorkspaceMetadata } from "../../core/workspace/metadata.js";
import { computeWorkspaceHealth } from "../../core/workspace/verification.js";

const TABS = [
    { id: "overview", label: "Overview", key: "1" },
    { id: "workspaces", label: "Workspaces", key: "2" },
    { id: "snapshots", label: "Snapshots", key: "3" },
    { id: "health", label: "Health", key: "4" },
];

export function WorkspacePage({ isActive }) {
    const { theme, state, dispatch, actions } = useStore();
    const [tab, setTab] = useState("workspaces");
    const [step, setStep] = useState("list"); // list -> create-name -> create-description
    const [highlighted, setHighlighted] = useState(null);
    const [busy, setBusy] = useState(false);
    const [busyLabel, setBusyLabel] = useState("");
    const [verifyResult, setVerifyResult] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(null);
    const [draftName, setDraftName] = useState("");
    const [draftDescription, setDraftDescription] = useState("");
    const [snapshotWs, setSnapshotWs] = useState(null);
    const [snapshotHighlight, setSnapshotHighlight] = useState(null);
    const detailW = useDetailWidth(48);

    const entries = workspaceList();
    const activeName = activeWorkspaceName();
    const current = (highlighted && entries.find((e) => e.name === highlighted.name)) || entries[0] || null;

    function selectHighlight(entry) {
        setHighlighted(entry);
        setConfirmDelete(null);
        setVerifyResult(null);
    }

    async function doSwitch(entry) {
        if (!entry || !entry.valid || busy) return;
        setBusy(true);
        setBusyLabel(`switching to ${entry.name}...`);
        actions.setBusy({ label: `workspace switch ${entry.name}` });
        actions.log(`workspace switch ${entry.name}`);
        try {
            await switchToWorkspace(entry.name);
            actions.notify(`Switched to '${entry.name}'`, "success");
        } catch (err) {
            actions.notify(`Switch failed: ${err.message}`, "error");
        } finally {
            setBusy(false);
            actions.setBusy(null);
        }
    }

    async function doVerify(entry) {
        if (!entry || !entry.valid || busy) return;
        setBusy(true);
        setBusyLabel(`verifying ${entry.name}...`);
        actions.setBusy({ label: `workspace verify ${entry.name}` });
        try {
            const result = await verifyWorkspace(entry.doc);
            setVerifyResult({ name: entry.name, ...result });
            actions.log(`workspace verify ${entry.name}: ${result.score}% (${result.pass} pass, ${result.warn} warn, ${result.fail} fail)`);
            actions.notify(`Verify '${entry.name}': ${result.score}% - ${result.verdict}`, result.fail > 0 ? "error" : (result.warn > 0 ? "warning" : "success"));
        } catch (err) {
            actions.notify(`Verify failed: ${err.message}`, "error");
        } finally {
            setBusy(false);
            actions.setBusy(null);
        }
    }

    function doSnapshot(entry) {
        if (!entry || !entry.valid) return;
        try {
            const meta = createSnapshot(entry.name, { message: "Created from the dashboard" });
            actions.log(`workspace snapshot create ${entry.name} -> ${meta.id}`);
            actions.notify(`Snapshot ${meta.id} created for '${entry.name}'`, "success");
        } catch (err) {
            actions.notify(`Snapshot failed: ${err.message}`, "error");
        }
    }

    function doDeactivate() {
        if (!activeName) {
            actions.notify("No workspace is active.", "info");
            return;
        }
        deactivateWorkspace();
        actions.log(`workspace deactivate (was ${activeName})`);
        actions.notify(`Deactivated '${activeName}'`, "success");
    }

    function armOrDelete(entry) {
        if (!entry) return;
        if (confirmDelete !== entry.name) {
            setConfirmDelete(entry.name);
            actions.notify(
                entry.name === activeName
                    ? `'${entry.name}' is the ACTIVE workspace - deleting will deactivate it. Press D again to confirm.`
                    : `Press D again to confirm deleting '${entry.name}' (and all its snapshots/secrets).`,
                "warning"
            );
            return;
        }
        try {
            deleteWorkspace(entry.name, { force: entry.name === activeName });
            actions.log(`workspace delete ${entry.name}`);
            actions.notify(`Deleted '${entry.name}'`, "success");
        } catch (err) {
            actions.notify(`Delete failed: ${err.message}`, "error");
        }
        setConfirmDelete(null);
        setHighlighted(null);
        setVerifyResult(null);
    }

    function startCreate() {
        setDraftName("");
        setDraftDescription("");
        setStep("create-name");
        dispatch({ type: "setTyping", typing: true });
    }

    function cancelCreate() {
        setStep("list");
        dispatch({ type: "setTyping", typing: false });
    }

    function finishCreate() {
        const name = draftName.trim();
        if (!name) return;
        try {
            createWorkspace({ name, description: draftDescription.trim() || `Workspace: ${name}` });
            actions.log(`workspace create ${name}`);
            actions.notify(`Created workspace '${name}'`, "success");
            setHighlighted({ name });
            setStep("list");
            dispatch({ type: "setTyping", typing: false });
        } catch (err) {
            actions.notify(`Create failed: ${err.message}`, "error");
        }
    }

    useInput((input, key) => {
        if (step === "create-name") {
            if (key.return && draftName.trim()) setStep("create-description");
            else if (key.escape) cancelCreate();
            return;
        }
        if (step === "create-description") {
            if (key.return) finishCreate();
            else if (key.escape) cancelCreate();
            return;
        }
        const tabMatch = TABS.find((t) => t.key === input);
        if (tabMatch) {
            setTab(tabMatch.id);
            return;
        }
        if (tab === "workspaces") {
            if (input === "n") startCreate();
            else if (input === "v") doVerify(current);
            else if (input === "x") doSnapshot(current);
            else if (input === "z") doDeactivate();
            else if (input === "D") armOrDelete(current);
        } else if (tab === "snapshots") {
            if (input === "r" && snapshotHighlight) {
                try {
                    restoreSnapshot(snapshotWs || activeName, snapshotHighlight.id);
                    actions.notify(`Restored snapshot ${snapshotHighlight.id}`, "success");
                } catch (err) {
                    actions.notify(`Restore failed: ${err.message}`, "error");
                }
            }
        } else if (tab === "health") {
            if (input === "v") doVerify(current);
        }
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    // ─── Tab Bar ──────────────────────────────────────────────────────
    const tabBar = h(Box, { flexDirection: "row" },
        ...TABS.map((t) => {
            const active = tab === t.id;
            return h(Text, {
                key: t.id,
                color: active ? theme.accent : theme.textMuted,
                bold: active,
                backgroundColor: active ? theme.selection : undefined,
            }, ` ${t.label} `);
        })
    );

    // ─── Overview Tab ─────────────────────────────────────────────────
    const overviewTab = (() => {
        if (!activeName) {
            return h(Box, { flexDirection: "column", paddingX: 1 },
                h(Text, { color: theme.textMuted }, "No active workspace. Switch to one from the Workspaces tab (press 2).")
            );
        }
        const activeEntry = entries.find((e) => e.name === activeName);
        if (!activeEntry || !activeEntry.valid) {
            return h(ErrorState, { message: `Active workspace '${activeName}' is invalid.`, theme });
        }
        let snapCount = null;
        try { snapCount = listSnapshots(activeName).length; } catch { /* no snapshots dir */ }
        const meta = getWorkspaceMetadata(activeEntry.doc, { activeName, snapshotCount: snapCount });
        const health = computeWorkspaceHealth(activeEntry.doc);
        const healthColor = health.score >= 75 ? theme.success : health.score >= 50 ? theme.warning : theme.error;

        return h(Box, { flexDirection: "column", paddingX: 1 },
            h(Text, { color: theme.accent, bold: true }, `${meta.name} — ${meta.description}`),
            h(Text, { color: theme.textMuted }, `Status: ${meta.status}  |  Last used: ${meta.lastUsedAt || "(never)"}  |  Created: ${meta.createdAt || "?"}`),
            h(Box, { marginTop: 1, flexDirection: "row" },
                h(Text, { color: theme.textMuted }, "Health: "),
                h(Text, { color: healthColor, bold: true }, `${health.score}%`)
            ),
            h(Box, { marginTop: 1, flexDirection: "row", flexWrap: "wrap" },
                ...health.breakdown.map((item) =>
                    h(Text, {
                        key: item.subsystem,
                        color: item.status === "healthy" ? theme.success : theme.textMuted
                    }, ` ${item.status === "healthy" ? "✓" : "○"} ${item.subsystem}  `)
                )
            ),
            h(Box, { marginTop: 1 },
                h(KeyValue, {
                    theme, labelWidth: 14,
                    pairs: [
                        ["Git", `${meta.git.name || "(not set)"} <${meta.git.email || "?"}>`, theme.text],
                        ["SSH", `${meta.ssh.identities} identities`, theme.text],
                        ["Env", `${meta.env.variableCount} vars, ${meta.env.secretCount} secrets`, theme.text],
                        ["Docker", meta.docker.context || "(none)", theme.text],
                        ["Kubernetes", meta.kubernetes.context || "(none)", theme.text],
                        ["Cloud", meta.cloud.count > 0 ? meta.cloud.providers.map((c) => c.provider).join(", ") : "(none)", theme.text],
                        ["AI", meta.ai.provider, theme.text],
                        ["Editor", meta.editor.app, theme.text],
                        ["Shell", meta.shell.shell || "(default)", theme.text],
                        ["Profile", meta.profile || "(none)", theme.text],
                        ["Tags", meta.tags.join(", ") || "(none)", theme.text],
                        ["Snapshots", String(meta.snapshotCount ?? "?"), theme.text],
                    ]
                })
            )
        );
    })();

    // ─── Workspaces Tab ───────────────────────────────────────────────
    const workspacesTab = step === "list"
        ? h(Box, { flexDirection: "column" },
            h(SelectList, {
                items: entries, isActive, height: 12, theme,
                onHighlight: selectHighlight,
                onSelect: doSwitch,
                emptyText: "No workspaces yet - press n to create one.",
                renderItem: (entry, selected) => {
                    const isActiveWs = entry.name === activeName;
                    const label = entry.valid
                        ? `${entry.name.padEnd(20).slice(0, 20)} ${(entry.doc.description || "").slice(0, 34)}`
                        : `${entry.name.padEnd(20).slice(0, 20)} INVALID: ${(entry.reason || "").slice(0, 28)}`;
                    return h(Text, {
                        key: entry.name,
                        backgroundColor: selected && isActive ? theme.selection : undefined,
                        color: selected && isActive ? theme.selectionText : (entry.valid ? theme.text : theme.error),
                        wrap: "truncate-end"
                    }, `${selected ? "❯ " : "  "}${isActiveWs ? "▸" : " "}${label}`);
                }
            }),
            busy ? h(Box, { marginTop: 1 }, h(LoadingState, { label: busyLabel, theme })) : null,
            h(Box, { marginTop: 1 }, h(KeyHints, {
                theme,
                hints: [["Enter", "switch"], ["n", "new"], ["v", "verify"], ["x", "snapshot"], ["z", "deactivate"], ["D", "delete (2x)"]]
            }))
        )
        : h(Box, { flexDirection: "column" },
            h(Text, { color: theme.text }, "New workspace"),
            h(Box, null,
                h(Text, { color: theme.textMuted }, "Name: "),
                h(TextField, { value: draftName, onChange: setDraftName, isActive: step === "create-name", theme })
            ),
            step === "create-description" ? h(Box, null,
                h(Text, { color: theme.textMuted }, "Description: "),
                h(TextField, { value: draftDescription, onChange: setDraftDescription, isActive: true, theme, placeholder: `Workspace: ${draftName.trim()}` })
            ) : null,
            h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints: [["Enter", "continue"], ["Esc", "cancel"]] }))
        );

    // ─── Snapshots Tab ────────────────────────────────────────────────
    const snapshotsTab = (() => {
        const wsName = snapshotWs || activeName || (current && current.valid ? current.name : null);
        if (!wsName) {
            return h(Box, { paddingX: 1 }, h(Text, { color: theme.textMuted }, "No workspace selected. Switch to one first."));
        }
        let snaps = [];
        try { snaps = listSnapshots(wsName); } catch { /* no snapshots dir */ }
        const snapItems = snaps.map((s) => ({ ...s, name: s.id }));
        const currentSnap = (snapshotHighlight && snapItems.find((s) => s.id === snapshotHighlight.id)) || snapItems[0] || null;

        return h(Box, { flexDirection: "column" },
            h(Text, { color: theme.textMuted }, `Snapshots for '${wsName}' (${snaps.length})`),
            h(SelectList, {
                items: snapItems, isActive, height: 10, theme,
                onHighlight: (s) => setSnapshotHighlight(s),
                onSelect: () => {},
                emptyText: "No snapshots yet.",
                renderItem: (snap, selected) =>
                    h(Text, {
                        key: snap.id,
                        backgroundColor: selected && isActive ? theme.selection : undefined,
                        color: selected && isActive ? theme.selectionText : theme.text,
                        wrap: "truncate-end"
                    }, `${selected ? "❯ " : "  "}${snap.id}  ${snap.message || ""}`.slice(0, 60))
            }),
            currentSnap ? h(Box, { marginTop: 1, flexDirection: "column" },
                h(Text, { color: theme.accent, bold: true }, currentSnap.id),
                h(Text, { color: theme.textMuted }, `Created: ${currentSnap.createdAt || "?"}`),
                currentSnap.message ? h(Text, { color: theme.text }, currentSnap.message) : null
            ) : null,
            h(Box, { marginTop: 1 }, h(KeyHints, {
                theme,
                hints: [["r", "restore"], ["1-4", "switch tabs"]]
            }))
        );
    })();

    // ─── Health Tab ───────────────────────────────────────────────────
    const healthTab = (() => {
        if (!current || !current.valid) {
            return h(Box, { paddingX: 1 }, h(Text, { color: theme.textMuted }, "No valid workspace selected."));
        }
        const health = computeWorkspaceHealth(current.doc);
        const healthColor = health.score >= 75 ? theme.success : health.score >= 50 ? theme.warning : theme.error;

        return h(Box, { flexDirection: "column", paddingX: 1 },
            h(Text, { color: theme.accent, bold: true }, `Health: ${current.name}`),
            h(Text, { color: healthColor, bold: true }, `${health.score}%`),
            h(Text, { color: theme.textMuted }, ""),
            ...health.breakdown.map((item) =>
                h(Text, {
                    key: item.subsystem,
                    color: item.status === "healthy" ? theme.success : theme.textMuted
                }, `  ${item.status === "healthy" ? "✓" : "○"}  ${item.subsystem.padEnd(14)} ${item.detail}`)
            ),
            verifyResult && verifyResult.name === current.name ? h(Box, { flexDirection: "column", marginTop: 1 },
                h(Text, { color: theme.accent, bold: true }, `Verify: ${verifyResult.score}% - ${verifyResult.verdict}`),
                ...verifyResult.results.slice(0, 10).map((r, i) =>
                    h(Text, { key: r.description + i, color: statusColor(r.status, theme), wrap: "truncate-end" }, ` ${r.status.padEnd(8)} ${r.description}`))
            ) : null,
            h(Box, { marginTop: 1 }, h(KeyHints, {
                theme,
                hints: [["v", "run full verify"], ["1-4", "switch tabs"]]
            }))
        );
    })();

    // ─── Detail Panel (right side, for Workspaces tab) ────────────────
    const detailBody = current && current.valid
        ? h(Box, { flexDirection: "column" },
            h(Text, { color: theme.text, wrap: "wrap" }, current.doc.description || ""),
            h(KeyValue, {
                theme, labelWidth: 12,
                pairs: [
                    ["Status", current.doc.status, current.name === activeName ? theme.success : theme.text],
                    ["Tags", current.doc.tags.join(", ") || "none"],
                    ["Profile", current.doc.profile || "none"],
                    ["Components", String(current.doc.components.length)],
                    ["Git", current.doc.git.email || current.doc.git.name || "not set"],
                    ["SSH", `${current.doc.ssh.identities.length} identities`],
                    ["Env", `${Object.keys(current.doc.env.variables).length} vars, ${current.doc.env.secretKeys.length} secrets`],
                    ["Docker", current.doc.docker.context || "none"],
                    ["Kubernetes", current.doc.kubernetes.context || "none"],
                    ["Last used", current.doc.lastUsedAt || "(never)"],
                    ["Projects", String(current.doc.projectHistory.length)]
                ]
            }),
            verifyResult && verifyResult.name === current.name ? h(Box, { flexDirection: "column", marginTop: 1 },
                h(Text, { color: theme.accent, bold: true }, `Verify: ${verifyResult.score}% - ${verifyResult.verdict}`),
                ...verifyResult.results.slice(0, 8).map((r, i) =>
                    h(Text, { key: r.description + i, color: statusColor(r.status, theme), wrap: "truncate-end" }, ` ${r.status.padEnd(8)} ${r.description}`))
            ) : null
        )
        : (current ? h(ErrorState, { message: `Invalid: ${current.reason}`, theme }) : undefined);

    // ─── Render ───────────────────────────────────────────────────────
    const tabContent = tab === "overview" ? overviewTab
        : tab === "workspaces" ? workspacesTab
        : tab === "snapshots" ? snapshotsTab
        : healthTab;

    return h(Box, { flexGrow: 1, flexDirection: "column" },
        tabBar,
        h(Box, { flexGrow: 1 },
            tab === "workspaces"
                ? h(Box, { flexGrow: 1, flexDirection: "row" },
                    h(Panel, { title: `Workspaces (${entries.length})${activeName ? ` · active: ${activeName}` : ""}`, theme, isActive, flexGrow: 1 }, workspacesTab),
                    h(DetailPanel, {
                        title: current ? `Workspace: ${current.name}` : "Details",
                        theme, width: detailW,
                        emptyText: "No workspace highlighted.",
                        body: detailBody,
                        footer: h(Text, { color: theme.textMuted, wrap: "wrap" },
                            "\nFull management (rename/clone/export/import/diff/health/metadata) via 'devforgekit workspace ...'")
                    })
                )
                : h(Panel, { title: TABS.find((t) => t.id === tab).label, theme, isActive, flexGrow: 1 }, tabContent)
        )
    );
}
