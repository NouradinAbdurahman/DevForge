// Workspaces: browse/create/switch/verify/snapshot/delete isolated dev
// environments (git/ssh/env/docker/k8s/cloud/shell identity) - the same
// engine `devforgekit workspace ...` drives (core/workspace/*.js). This
// page deliberately exposes only the high-frequency actions (matching
// RecipesPage/DoctorPage's scoping precedent); rename/clone/export/
// import/env/ssh/rollback management stay CLI-only rather than
// cramming every one of the 30 subcommands into a terminal UI.
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, SelectList, KeyValue, KeyHints, TextField, statusColor, useDetailWidth } from "../components/ui.js";
import { useStore } from "../store.js";
import { workspaceList, activeWorkspaceName } from "../data.js";
import { createWorkspace, deleteWorkspace } from "../../core/workspace/store.js";
import { switchToWorkspace, deactivateWorkspace } from "../../core/workspace/switcher.js";
import { verifyWorkspace } from "../../core/workspace/health.js";
import { createSnapshot } from "../../core/workspace/snapshot.js";

export function WorkspacePage({ isActive }) {
    const { theme, state, dispatch, actions } = useStore();
    const [step, setStep] = useState("list"); // list -> create-name -> create-description
    const [highlighted, setHighlighted] = useState(null);
    const [busy, setBusy] = useState(false);
    const [verifyResult, setVerifyResult] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(null); // armed workspace name
    const [draftName, setDraftName] = useState("");
    const [draftDescription, setDraftDescription] = useState("");
    const detailW = useDetailWidth(48);

    const entries = workspaceList();
    const activeName = activeWorkspaceName();
    // Always resolve `current` fresh from `entries` by name rather than
    // trusting the `highlighted` reference itself - workspaceList() is
    // deliberately uncached (so create/switch/delete show up
    // immediately, see data.js), so a stale/partial `highlighted` object
    // (e.g. the { name } placeholder set right after creating one below)
    // must never be rendered directly.
    const current = (highlighted && entries.find((e) => e.name === highlighted.name)) || entries[0] || null;

    function selectHighlight(entry) {
        setHighlighted(entry);
        setConfirmDelete(null);
        setVerifyResult(null);
    }

    async function doSwitch(entry) {
        if (!entry || !entry.valid || busy) return;
        setBusy(true);
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
        // step === "list"
        if (input === "n") startCreate();
        else if (input === "v") doVerify(current);
        else if (input === "x") doSnapshot(current);
        else if (input === "z") doDeactivate();
        else if (input === "D") armOrDelete(current);
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    const listPanel = step === "list"
        ? h(Box, { flexDirection: "column" },
            h(SelectList, {
                items: entries, isActive, height: 14, theme,
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
                        color: selected && isActive ? theme.selectionText : (entry.valid ? theme.text : theme.error)
                    }, `${selected ? "❯ " : "  "}${isActiveWs ? "▸" : " "}${label}`);
                }
            }),
            h(Box, { marginTop: 1 }, h(KeyHints, {
                theme,
                hints: [["Enter", "switch"], ["n", "new"], ["v", "verify"], ["x", "snapshot"], ["z", "deactivate"], ["D", "delete (press twice)"]]
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

    return h(Box, { flexGrow: 1 },
        h(Panel, { title: `Workspaces (${entries.length})${activeName ? ` · active: ${activeName}` : ""}`, theme, isActive, flexGrow: 1 }, listPanel),
        h(Panel, { title: current ? `Workspace: ${current.name}` : "Details", theme, width: detailW },
            current && current.valid ? h(Box, { flexDirection: "column" },
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
                        ["Projects", String(current.doc.projectHistory.length)]
                    ]
                }),
                verifyResult && verifyResult.name === current.name ? h(Box, { flexDirection: "column", marginTop: 1 },
                    h(Text, { color: theme.accent, bold: true }, `Verify: ${verifyResult.score}% - ${verifyResult.verdict}`),
                    ...verifyResult.results.slice(0, 8).map((r, i) =>
                        h(Text, { key: r.description + i, color: statusColor(r.status, theme), wrap: "truncate-end" }, ` ${r.status.padEnd(8)} ${r.description}`))
                ) : null
            ) : (current ? h(Text, { color: theme.error, wrap: "wrap" }, `Invalid: ${current.reason}`) : h(Text, { color: theme.textMuted }, "No workspace highlighted.")),
            h(Text, { color: theme.textMuted, wrap: "wrap" },
                "\nFull management (rename/clone/export/import/env/ssh/rollback) is available via 'devforgekit workspace ...' in a terminal.")
        )
    );
}
