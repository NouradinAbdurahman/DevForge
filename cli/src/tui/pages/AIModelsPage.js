// AI Models: a dedicated model browser with search, sort, favorites,
// recent models, and a model information panel. Lists available models
// for the current AI provider. Uses cached model lists with refresh.
import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, SelectList, KeyValue, KeyHints, DetailPanel, LoadingState, useDetailWidth, useFilterField, FilterBar } from "../components/ui.js";
import { fuzzyFilter, fuzzyMatch, splitByIndices } from "../fuzzy.js";
import { AIPageWrapper } from "../components/ai.js";
import { useStore } from "../store.js";
import { loadConfig, setConfigValue } from "../../core/config.js";
import { getActiveWorkspace } from "../../core/workspace/store.js";
import { providerLabel } from "../../core/ai/credentials/manager.js";
import { providerIcon } from "../../core/ai/providers/meta.js";
import { getModelsWithCache, clearModelCache } from "../../core/ai/models/cache.js";
import { getModelMeta, sortModels } from "../../core/ai/models/meta.js";
import { diagnoseProviderError } from "../../core/ai/diagnostics/errors.js";

const SORT_MODES = ["name", "newest", "fastest", "cheapest", "context"];
const SORT_LABELS = { name: "Name", newest: "Newest", fastest: "Fastest", cheapest: "Cheapest", context: "Context" };
const TABS = ["all", "favorites", "recent"];
const TAB_LABELS = { all: "All Models", favorites: "Favorites", recent: "Recent" };

export function AIModelsPage({ isActive }) {
    const { theme, state, dispatch, actions } = useStore();
    const [models, setModels] = useState(null);
    const [loading, setLoading] = useState(false);
    const [highlighted, setHighlighted] = useState(null);
    // useFilterField owns open/close + tells the store when it's typing,
    // so '/' here can never also open the global search overlay - the
    // previous hand-rolled search/searching state didn't report typing,
    // which is exactly what let '/' fire both at once.
    const { query: search, setQuery: setSearch, isOpen: searching } = useFilterField({
        isActive: Boolean(isActive) && !state.searchOpen,
        onTypingChange: (typing) => dispatch({ type: "setTyping", typing })
    });
    const [sortMode, setSortMode] = useState("name");
    const [activeTab, setActiveTab] = useState("all");
    const detailW = useDetailWidth(44);

    const config = loadConfig();
    const providerId = config.aiProvider && config.aiProvider !== "none" ? config.aiProvider : null;
    const favorites = config.aiFavoriteModels || [];
    const recentModels = config.aiRecentModels || [];

    async function loadModels(refresh = false) {
        if (!providerId || loading) return;
        setLoading(true);
        actions.setBusy({ label: "loading models" });
        try {
            const workspace = getActiveWorkspace();
            const list = await getModelsWithCache(providerId, { workspace, refresh });
            setModels(list);
            actions.notify(`Loaded ${list.length} models for ${providerLabel(providerId)}`, "success");
        } catch (err) {
            const diag = diagnoseProviderError(providerId, err);
            actions.notify(diag.message, "error");
            setModels([]);
        } finally {
            setLoading(false);
            actions.setBusy(null);
        }
    }

    useEffect(() => {
        if (providerId) loadModels(false);
    }, [providerId]);

    function toggleFavorite(model) {
        const current = loadConfig().aiFavoriteModels || [];
        const updated = current.includes(model)
            ? current.filter((m) => m !== model)
            : [...current, model];
        setConfigValue("aiFavoriteModels", updated);
        actions.notify(updated.includes(model) ? `Starred '${model}'` : `Unstarred '${model}'`, "success");
    }

    function recordRecentModel(model) {
        const current = loadConfig().aiRecentModels || [];
        const updated = [model, ...current.filter((m) => m !== model)].slice(0, 10);
        setConfigValue("aiRecentModels", updated);
    }

    // Sub-page navigation and actions
    useInput((input) => {
        if (searching) return;
        if (input === "r" && providerId) {
            clearModelCache(providerId);
            loadModels(true);
            return;
        }
        if (input === "s") {
            const idx = SORT_MODES.indexOf(sortMode);
            setSortMode(SORT_MODES[(idx + 1) % SORT_MODES.length]);
            return;
        }
        if (input === "f" && highlighted) {
            toggleFavorite(highlighted);
            return;
        }
        if (input === "t") {
            const idx = TABS.indexOf(activeTab);
            setActiveTab(TABS[(idx + 1) % TABS.length]);
            return;
        }
        if (input === "o") actions.navigate("ai-overview");
        else if (input === "p") actions.navigate("ai-providers");
        else if (input === "a") actions.navigate("ai");
        else if (input === "k") actions.navigate("ai-credentials");
        else if (input === "d") actions.navigate("ai-diagnostics");
        else if (input === "c") actions.navigate("ai-capabilities");
        else if (input === "h") actions.navigate("ai-history");
    }, { isActive: Boolean(isActive) && !state.searchOpen && !searching });

    // Build the display list: filter by tab, filter by search, sort
    let displayList = models || [];
    if (activeTab === "favorites") {
        displayList = displayList.filter((m) => favorites.includes(m));
    } else if (activeTab === "recent") {
        displayList = recentModels.filter((m) => !models || models.includes(m));
    }
    // Fuzzy match (same fuzzy.js scoring the Command Palette/Components
    // page use) narrows the set; sortModels then applies the user's
    // explicit sort choice on top - relevance only wins ties when
    // sortMode is "name" (its default ordering is alphabetical, not
    // relevance, so fuzzy pre-filtering is what actually determines
    // which models even show up for a scattered query like "4o").
    const filtered = search ? fuzzyFilter(search, displayList).map((f) => f.item) : displayList;
    const shown = sortModels(filtered, sortMode);

    const currentModel = config.aiModel || (providerId ? "default" : "");
    const current = highlighted && shown.includes(highlighted) ? highlighted : shown[0] || null;
    const meta = current ? getModelMeta(current) : null;

    function selectModel(model) {
        setConfigValue("aiModel", model);
        recordRecentModel(model);
        actions.notify(`Model set to '${model}'`, "success");
        actions.log(`Set AI model to ${model}`);
    }

    const aiConfig = { provider: providerId, model: config.aiModel, endpoint: config.aiEndpoint };

    return h(AIPageWrapper, { page: "ai-models", config: aiConfig, theme, onNavigate: actions.navigate, showEmpty: true },
        h(Box, { flexGrow: 1 },
            h(Panel, { title: providerId ? `${providerIcon(providerId)} Models — ${providerLabel(providerId)}` : "Models", theme, isActive, flexGrow: 1 },
                !providerId ? h(Text, { color: theme.textMuted }, "No provider configured. Press P to choose one.") : null,
                providerId && !loading && !models ? h(Box, { flexDirection: "column" },
                    h(Text, { color: theme.text }, `Browse models for ${providerLabel(providerId)}.`),
                    h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints: [["Enter", "load models"], ["R", "refresh"]] }))
                ) : null,
                loading ? h(LoadingState, { label: "loading models...", theme }) : null,
                models && !loading ? h(Box, { flexDirection: "column" },
                    // Tab bar
                    h(Box, { marginBottom: 1 },
                        ...TABS.map((tab, i) => {
                            const isCurrent = tab === activeTab;
                            const count = tab === "all" ? models.length
                                : tab === "favorites" ? models.filter((m) => favorites.includes(m)).length
                                : recentModels.length;
                            return h(Text, {
                                key: tab,
                                color: isCurrent ? theme.accent : theme.textMuted,
                                bold: isCurrent
                            }, `${i > 0 ? "  " : ""}${isCurrent ? "▸ " : ""}[${TAB_LABELS[tab]}] (${count})`);
                        })
                    ),
                    h(FilterBar, { query: search, onChange: setSearch, isOpen: searching, isActive: Boolean(isActive) && searching, theme, placeholder: "filter models..." }),
                    h(Text, { color: theme.textMuted },
                        `${shown.length} model(s)${search ? ` matching "${search}"` : ""} · Sort: ${SORT_LABELS[sortMode]}`),
                    h(SelectList, {
                        items: shown.map((m) => ({ label: m, value: m })),
                        isActive: isActive && !loading && !searching,
                        height: 14,
                        theme,
                        onHighlight: (item) => setHighlighted(item.value),
                        onSelect: (item) => selectModel(item.value),
                        renderItem: (item, selected) => {
                            const rowSelected = selected && isActive;
                            const isCurrent = item.value === currentModel;
                            const isFav = favorites.includes(item.value);
                            const star = isFav ? "★ " : "  ";
                            const bg = rowSelected ? theme.selection : undefined;
                            const match = search ? fuzzyMatch(search, item.label) : null;
                            const parts = match ? splitByIndices(item.label, match.indices) : [{ text: item.label, matched: false }];
                            return h(Text, { key: item.value, wrap: "truncate-end" },
                                h(Text, { backgroundColor: bg, color: rowSelected ? theme.selectionText : (isCurrent ? theme.accent : theme.text), bold: isCurrent },
                                    `${selected ? "❯ " : "  "}${star}${isCurrent ? "▸ " : ""}`),
                                ...parts.map((p, i) => h(Text, {
                                    key: i,
                                    backgroundColor: bg,
                                    color: rowSelected ? theme.selectionText : (p.matched ? theme.searchHighlight : (isCurrent ? theme.accent : theme.text)),
                                    bold: isCurrent || (p.matched && !rowSelected)
                                }, p.text))
                            );
                        }
                    })
                ) : null
            ),
            h(DetailPanel, {
                title: "Model Info", theme, width: detailW,
                emptyText: "Select a model to see details",
                body: current ? h(Box, { flexDirection: "column" },
                    h(Text, { color: theme.accent, bold: true }, current),
                    h(Text, { color: current === currentModel ? theme.accent : theme.textMuted },
                        current === currentModel ? "← Current model" : ""),
                    meta ? h(Box, { marginTop: 1 },
                        h(KeyValue, {
                            theme, labelWidth: 14,
                            pairs: [
                                ["Provider", providerId ? providerLabel(providerId) : "—", theme.text],
                                ["Context", meta.context, theme.text],
                                ["Vision", meta.vision ? "Yes" : "No", meta.vision ? theme.success : theme.textMuted],
                                ["Reasoning", meta.reasoning, theme.text],
                                ["Coding", meta.coding, theme.text],
                                ["Latency", meta.latency, theme.text],
                                ["Cost", meta.cost, theme.text],
                                ["Released", meta.released, theme.textMuted],
                                ["Supports", meta.supports.join(", "), theme.textMuted]
                            ]
                        })
                    ) : null
                ) : undefined,
                hints: current ? [
                    ["Enter", "Use Model"],
                    ["/", "Search"],
                    ["S", "Sort"],
                    ["T", "Tab"],
                    ["F", "★ Favorite"],
                    ["R", "Refresh"],
                    ["Esc", "Close Search"]
                ] : undefined
            })
        )
    );
}
