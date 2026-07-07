// Lightweight fzf-style fuzzy matcher - no dependency (the audit found
// no existing fuzzy-match utility anywhere in the repo; every "search"
// before this was a plain .toLowerCase().includes()). Subsequence
// matching with bonuses for consecutive runs, word-boundary starts, and
// case-exact hits, so "cpp" ranks "Components" below "Cross-Platform"
// less than a plain substring search would, and "dkr" still finds
// "docker". Shared by the Command Palette (v2.0.1) and Search/Filter
// (v2.0.2) - one scoring function, one feel, everywhere fuzzy matching
// is used.

// fuzzyMatch(query, text) -> { score, indices } | null
// `indices` are the positions in `text` that matched, for highlighting.
// Returns null when `query`'s characters don't all appear, in order,
// somewhere in `text` (case-insensitive).
export function fuzzyMatch(query, text) {
    if (!query) return { score: 0, indices: [] };
    if (!text) return null;

    const q = query.toLowerCase();
    const t = text.toLowerCase();
    const indices = [];
    let score = 0;
    let qi = 0;
    let lastMatchIndex = -1;
    let consecutiveRun = 0;

    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] !== q[qi]) continue;

        let charScore = 1;
        // Consecutive matches score much higher than scattered ones -
        // "dkr" matching "d-o-c-k-e-r" scattered is a weaker signal
        // than "doc" matching the literal prefix "doc-ker".
        if (lastMatchIndex === ti - 1) {
            consecutiveRun++;
            charScore += consecutiveRun * 3;
        } else {
            consecutiveRun = 0;
        }
        // Word-boundary bonus: start of string, or right after a
        // space/dash/underscore/slash - rewards matching how a human
        // actually reads the label ("ai-models" typing "am" should
        // beat some unrelated word that merely contains "a...m").
        if (ti === 0 || /[\s\-_/]/.test(t[ti - 1])) charScore += 4;
        // Case-exact bonus (query "D" matching "D" not "d").
        if (query[qi] === text[ti]) charScore += 1;

        score += charScore;
        indices.push(ti);
        lastMatchIndex = ti;
        qi++;
    }

    if (qi < q.length) return null; // not all query chars found, in order
    // Shorter targets are more specific for the same match quality -
    // "docker" beating "docker-compose" for query "dock".
    score -= t.length * 0.05;
    return { score, indices };
}

// fuzzyFilter(query, items, getText) -> items sorted by score descending,
// each wrapped as { item, score, indices }. Items that don't match at
// all are dropped. Empty query returns every item, unscored, in its
// original order (the "browse everything" case every filter needs).
// splitByIndices(text, indices) -> [{ text, matched }] - breaks `text`
// into single-character-run segments so a renderer can highlight the
// exact (possibly non-contiguous) positions fuzzyMatch found, the same
// shape SearchPage.js's splitMatches() already produces for its plain
// substring highlighting, generalized to scattered fuzzy positions.
export function splitByIndices(text, indices) {
    if (!indices || indices.length === 0) return [{ text, matched: false }];
    const matchSet = new Set(indices);
    const parts = [];
    let current = "";
    let currentMatched = null;
    for (let i = 0; i < text.length; i++) {
        const isMatch = matchSet.has(i);
        if (currentMatched !== null && isMatch !== currentMatched) {
            parts.push({ text: current, matched: currentMatched });
            current = "";
        }
        current += text[i];
        currentMatched = isMatch;
    }
    if (current) parts.push({ text: current, matched: currentMatched });
    return parts;
}

export function fuzzyFilter(query, items, getText = (x) => String(x)) {
    if (!query) return items.map((item) => ({ item, score: 0, indices: [] }));
    const scored = [];
    for (const item of items) {
        const result = fuzzyMatch(query, getText(item));
        if (result) scored.push({ item, score: result.score, indices: result.indices });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored;
}
