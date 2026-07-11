// Components: browse all 250 registry packages, filter by text/status,
// inspect the highlighted one, and install/update/remove it without
// leaving the dashboard. Actions call the exact same core/installer.js
// functions the CLI commands use, with output streamed into the detail
// pane via the onOutput hook (see core/shell.js).
import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, SelectList, KeyValue, KeyHints, InstallProgress, Badge, statusColor, useDetailWidth, useFilterField, FilterBar, EmptyState } from "../components/ui.js";
import { useStore } from "../store.js";
import { registrySnapshot, installedStatuses } from "../data.js";
import { fuzzyFilter, fuzzyMatch, splitByIndices } from "../fuzzy.js";
import { installWithDetails, update as updatePkg, uninstall as uninstallPkg, validate } from "../../core/installer.js";
import { scoreManifest } from "../../core/quality.js";
import { getVerificationStatus, INSTALL_STATUS, STATUS_META, RESPONSIBILITY, checkPlatformSupport, checkArchitectureSupport } from "../../core/installAudit.js";

const STATUS_FILTERS = ["all", "installed", "available", "stable", "beta", "deprecated"];

export function ComponentsPage({ isActive }) {
    const { theme, state, dispatch, actions } = useStore();
    const { query: filterText, setQuery: setFilterText, isOpen: typingFilter } = useFilterField({
        isActive: Boolean(isActive) && !state.searchOpen,
        onTypingChange: (typing) => dispatch({ type: "setTyping", typing })
    });
    const [statusFilter, setStatusFilter] = useState(0);
    const [installed, setInstalled] = useState(null);
    const [highlighted, setHighlighted] = useState(null);
    const [running, setRunning] = useState(null); // { name, action, lines, step, total }
    const detailW = useDetailWidth(46);

    const { packages } = registrySnapshot();

    useEffect(() => {
        let mounted = true;
        installedStatuses().then((map) => mounted && setInstalled(new Map(map))).catch(() => {});
        return () => { mounted = false; };
    }, []);

    const mode = STATUS_FILTERS[statusFilter];
    const modeFiltered = packages.filter((pkg) => {
        if (mode === "installed") return installed?.get(pkg.name) === true;
        if (mode === "available") return installed ? installed.get(pkg.name) !== true : true;
        if (["stable", "beta", "deprecated"].includes(mode)) return (pkg.stability || "stable") === mode;
        return true;
    });
    // Fuzzy-match against name+category+tags combined (so "dkr" still
    // finds docker, and typing a tag word like "containers" still works
    // even when it's not a substring of the package name), sorted by
    // relevance - the same fuzzy.js scoring the Command Palette uses, so
    // filtering feels identical everywhere it appears.
    const q = filterText.trim();
    const items = q
        ? fuzzyFilter(q, modeFiltered, (pkg) => `${pkg.name} ${pkg.category} ${(pkg.tags || []).join(" ")} ${(pkg.aliases || []).join(" ")}`).map((f) => f.item)
        : modeFiltered;

    const current = highlighted && items.includes(highlighted) ? highlighted : items[0] || null;

    async function runAction(action, pkg) {
        if (!pkg || running) return;
        const label = `${action} ${pkg.name}`;
        setRunning({ name: pkg.name, action, lines: [], step: 0, total: 1, failureReason: null, suggestedFix: null });
        actions.setBusy({ label });
        actions.log(`${label} started`);
        const onOutput = (text) => setRunning((r) => r && ({
            ...r,
            lines: [...r.lines, ...text.split("\n").filter(Boolean)].slice(-8)
        }));

        try {
            let ok;
            let failureDetails = null;
            if (action === "install") {
                // Use installWithDetails for structured error reporting
                const details = await installWithDetails(pkg, null, { onOutput });
                ok = details.success;
                if (!ok) {
                    failureDetails = {
                        reason: details.failureReason,
                        message: details.failureMessage,
                        fix: details.suggestedFix
                    };
                }
            } else if (action === "update") {
                ok = (await updatePkg(pkg, { onOutput })) === 0;
            } else {
                ok = (await uninstallPkg(pkg, { onOutput })) === 0;
            }

            if (failureDetails) {
                setRunning((r) => r && ({ ...r, failureReason: failureDetails.message, suggestedFix: failureDetails.fix }));
                actions.notify(`${label} failed: ${failureDetails.message}`, "error");
            } else {
                actions.notify(`${label} ${ok ? "completed" : "failed"}`, ok ? "success" : "error");
            }

            if (pkg.validate) {
                const nowInstalled = (await validate(pkg)) === 0;
                setInstalled((m) => m && new Map(m).set(pkg.name, nowInstalled));
            }
        } catch (err) {
            actions.notify(`${label} failed: ${err.message}`, "error");
        } finally {
            setRunning(null);
            actions.setBusy(null);
        }
    }

    useInput((input, key) => {
        if (typingFilter) return;
        if (key.leftArrow) {
            setStatusFilter((s) => (s + STATUS_FILTERS.length - 1) % STATUS_FILTERS.length);
        } else if (key.rightArrow) {
            setStatusFilter((s) => (s + 1) % STATUS_FILTERS.length);
        } else if (input === "a") {
            runAction("install", current);
        } else if (input === "u") {
            if (current?.update) runAction("update", current);
            else actions.notify(`${current?.name} has no update command`, "warning");
        } else if (input === "r") {
            if (!current?.uninstall) { actions.notify(`${current?.name} has no uninstall command`, "warning"); return; }
            actions.confirmAsync(`Remove '${current.name}'?`).then((ok) => { if (ok) runAction("remove", current); });
        }
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    const installedMark = (pkg) => {
        if (!installed) return "·";
        return installed.get(pkg.name) === true ? "✓" : " ";
    };

    return h(Box, { flexGrow: 1 },
        h(Panel, { title: `Components (${items.length}/${packages.length})`, theme, isActive, flexGrow: 1 },
            typingFilter
                ? h(FilterBar, { query: filterText, onChange: setFilterText, isOpen: typingFilter, isActive: Boolean(isActive) && typingFilter, theme })
                : h(Text, { color: theme.textMuted }, `/ to filter${filterText ? `: "${filterText}"` : ""}   ‹ ${mode} ›${installed === null ? "   checking installed status..." : ""}`),
            h(SelectList, {
                items, isActive: isActive && !typingFilter, height: 14, theme,
                emptyText: filterText ? `No components match "${filterText}".` : "No components in this filter.",
                onHighlight: (pkg) => setHighlighted(pkg),
                renderItem: (pkg, selected) => {
                    const rowSelected = selected && isActive;
                    const bg = rowSelected ? theme.selection : undefined;
                    const paddedName = pkg.name.padEnd(22).slice(0, 22);
                    const nameMatch = q ? fuzzyMatch(q, pkg.name) : null;
                    const nameParts = nameMatch ? splitByIndices(paddedName, nameMatch.indices) : [{ text: paddedName, matched: false }];
                    const isInstalled = installed?.get(pkg.name) === true;
                    return h(Text, { key: pkg.name, wrap: "truncate-end" },
                        h(Text, { backgroundColor: bg, color: rowSelected ? theme.selectionText : theme.text },
                            `${selected ? "❯" : " "} `),
                        h(Text, { backgroundColor: bg, color: rowSelected ? theme.selectionText : statusColor(isInstalled ? "ok" : "", theme) },
                            `${installedMark(pkg)} `),
                        ...nameParts.map((p, i) => h(Text, {
                            key: i,
                            backgroundColor: bg,
                            color: rowSelected ? theme.selectionText : (p.matched ? theme.searchHighlight : theme.text),
                            bold: p.matched && !rowSelected
                        }, p.text)),
                        h(Text, { backgroundColor: bg, color: rowSelected ? theme.selectionText : theme.text },
                            ` ${String(pkg.category).padEnd(16).slice(0, 16)} ${pkg.stability || "stable"}`)
                    );
                }
            })
        ),
        h(Panel, { title: current ? current.name : "Details", theme, width: detailW },
            current ? h(Box, { flexDirection: "column" },
                h(Text, { color: theme.text, wrap: "wrap" }, current.description),
                // ── Badges (quick-glance chips) ─────────────────────────
                // scoreManifest() computed once here and reused below for
                // the Quality row, rather than called twice per render.
                (() => {
                    const scored = scoreManifest(current);
                    const stability = current.stability || "stable";
                    const stabilityTone = stability === "deprecated" ? "error" : stability === "beta" ? "warning" : "success";
                    const hasCompatRule = scored.checks.find((c) => c.label === "Compatibility rule declared")?.pass;
                    const qualityTone = scored.score >= 80 ? "success" : scored.score >= 50 ? "warning" : "error";
                    return h(Box, { marginTop: 1 },
                        h(Badge, { text: stability, tone: stabilityTone, theme }),
                        h(Text, null, " "),
                        h(Badge, { text: `quality ${scored.score}`, tone: qualityTone, theme }),
                        hasCompatRule ? h(Text, null, " ") : null,
                        hasCompatRule ? h(Badge, { text: "compat rules", tone: "info", theme }) : null
                    );
                })(),
                // ── Status badge ───────────────────────────────────────
                (() => {
                    const ver = getVerificationStatus(current.name);
                    const meta = STATUS_META[ver.status] || STATUS_META[INSTALL_STATUS.UNTESTED];
                    const badgeColor = ver.status === INSTALL_STATUS.VERIFIED || ver.status === INSTALL_STATUS.INSTALLED ? theme.success
                        : ver.status === INSTALL_STATUS.BROKEN_REGISTRY_METADATA || ver.status === INSTALL_STATUS.BROKEN_DOWNLOAD || ver.status === INSTALL_STATUS.REMOVED_BY_VENDOR ? theme.error
                        : ver.status === INSTALL_STATUS.UNSUPPORTED_PLATFORM || ver.status === INSTALL_STATUS.UNSUPPORTED_ARCHITECTURE || ver.status === INSTALL_STATUS.DEPRECATED ? theme.error
                        : ver.status === INSTALL_STATUS.MANUAL_INSTALLATION || ver.status === INSTALL_STATUS.AUTHENTICATION_REQUIRED || ver.status === INSTALL_STATUS.LICENSE_REQUIRED || ver.status === INSTALL_STATUS.MISSING_DEPENDENCY || ver.status === INSTALL_STATUS.MISSING_PACKAGE_MANAGER || ver.status === INSTALL_STATUS.NETWORK_ERROR || ver.status === INSTALL_STATUS.TIMEOUT ? theme.warning
                        : ver.status === INSTALL_STATUS.UPDATE_AVAILABLE ? theme.accent
                        : theme.textMuted;
                    return h(Box, { marginTop: 1 },
                        h(Text, { color: badgeColor, bold: true }, `${meta.icon} ${meta.label}`),
                        ver.verifiedAt ? h(Text, { color: theme.textMuted }, ` · ${ver.verifiedAt.slice(0, 10)}`) : null
                    );
                })(),
                // ── Responsibility ──────────────────────────────────────
                (() => {
                    const ver = getVerificationStatus(current.name);
                    const meta = STATUS_META[ver.status] || STATUS_META[INSTALL_STATUS.UNTESTED];
                    if (meta.responsibility === RESPONSIBILITY.NONE) return null;
                    const respColor = meta.responsibility === RESPONSIBILITY.DEVFORGEKIT ? theme.error
                        : meta.responsibility === RESPONSIBILITY.VENDOR ? theme.warning
                        : theme.accent;
                    return h(Box, null,
                        h(Text, { color: theme.textMuted }, "Responsible: "),
                        h(Text, { color: respColor, bold: true }, meta.responsibility)
                    );
                })(),
                // ── Failure reason ──────────────────────────────────────
                (() => {
                    const ver = getVerificationStatus(current.name);
                    if (ver.failureMessage) {
                        return h(Box, { marginTop: 1 },
                            h(Text, { color: theme.error, wrap: "wrap" }, `Reason: ${ver.failureMessage}`)
                        );
                    }
                    return null;
                })(),
                // ── Platform support ────────────────────────────────────
                (() => {
                    const plat = checkPlatformSupport(current);
                    if (plat.supported === null) return null;
                    const color = plat.supported ? theme.success : theme.error;
                    const icon = plat.supported ? "✓" : "✗";
                    const platforms = (plat.supportedPlatforms || current.platforms || []).join(", ");
                    return h(Box, { marginTop: 1 },
                        h(Text, { color: theme.textMuted }, "Platform: "),
                        h(Text, { color, bold: true }, `${icon} ${platforms}`)
                    );
                })(),
                // ── Architecture support ────────────────────────────────
                (() => {
                    const arch = checkArchitectureSupport(current);
                    if (arch.supported === null) return null;
                    const color = arch.supported ? theme.success : theme.error;
                    const icon = arch.supported ? "✓" : "✗";
                    const archs = (arch.supportedArchitectures || current.architectures || []).join(", ");
                    return h(Box, null,
                        h(Text, { color: theme.textMuted }, "Arch: "),
                        h(Text, { color, bold: true }, `${icon} ${archs}`)
                    );
                })(),
                // ── Why can't this be installed? ─────────────────────────
                (() => {
                    const ver = getVerificationStatus(current.name);
                    const meta = STATUS_META[ver.status] || STATUS_META[INSTALL_STATUS.UNTESTED];
                    if (ver.status === INSTALL_STATUS.VERIFIED || ver.status === INSTALL_STATUS.INSTALLED || ver.status === INSTALL_STATUS.UNTESTED) return null;
                    return h(Box, { marginTop: 1, flexDirection: "column" },
                        h(Text, { color: theme.textMuted, bold: true }, "Why can't this be installed?"),
                        h(Text, { color: theme.text, wrap: "wrap" }, `  ${ver.failureMessage || meta.description}`),
                        h(Text, { color: theme.textMuted }, `  Can DevForgeKit fix? ${meta.canDevForgeKitFix ? "Yes" : "No"}`),
                        h(Text, { color: theme.textMuted }, `  Can you fix? ${meta.canUserFix ? "Yes" : "No"}`),
                        meta.canUserFix && ver.failureReason ? h(Text, { color: theme.warning, wrap: "wrap" }, `  Fix: Run devforgekit component repair ${current.name}`) : null
                    );
                })(),
                // ── Alternatives ────────────────────────────────────────
                (() => {
                    const alts = (current.recommendedAlternatives || []);
                    if (alts.length === 0) return null;
                    return h(Box, { marginTop: 1 },
                        h(Text, { color: theme.textMuted }, "Alternatives: "),
                        h(Text, { color: theme.accent, wrap: "wrap" }, alts.join(", "))
                    );
                })(),
                // ── Metadata key-value pairs ─────────────────────────────
                h(KeyValue, {
                    theme, labelWidth: 14,
                    pairs: [
                        ["Category", current.category],
                        ["Installed", installed ? (installed.get(current.name) ? "yes" : "no") : "checking...",
                            installed?.get(current.name) ? theme.success : undefined],
                        ["Stability", current.stability || "stable"],
                        ["Quality", `${scoreManifest(current).score}/100`],
                        ["Install Cmd", current.install ? (current.install.method || current.install.command || "-").slice(0, 28) : "-"],
                        ["Validate", current.validate ? current.validate.slice(0, 28) : "-"],
                        ["Update", current.update ? current.update.slice(0, 28) : "-"],
                        ["Uninstall", current.uninstall ? (current.uninstall.method || current.uninstall.command || "-").slice(0, 28) : "-"],
                        ["Dependencies", (current.dependencies || []).join(", ") || "none"],
                        ["Homepage", current.homepage || "-"],
                        ["Docs", current.documentation || "-"]
                    ]
                }),
                h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints: [["a", "install"], ["u", "update"], ["r", "remove"]] })),
                running ? h(InstallProgress, {
                    theme,
                    label: `${running.action}: ${running.name}`,
                    unit: "steps",
                    value: running.step,
                    total: running.total,
                    lines: running.lines.map((line) => line.slice(0, 42)),
                    extra: h(Box, { flexDirection: "column" },
                        running.failureReason ? h(Text, { color: theme.error, wrap: "wrap", bold: true }, `\n✗ ${running.failureReason}`) : null,
                        running.suggestedFix ? h(Text, { color: theme.warning, wrap: "wrap" }, `Fix: ${running.suggestedFix}`) : null
                    )
                }) : null
            ) : h(EmptyState, { title: "No component highlighted.", theme })
        )
    );
}

