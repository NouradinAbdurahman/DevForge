// "Did you mean?" - a shared fuzzy-match helper so component/search/
// explain/info/recipe/profile/plugin all suggest the same way instead
// of each command inventing its own typo tolerance. Plain Levenshtein
// edit distance (no dependency - well-understood, easy to verify
// correct with a handful of known distances) over the exact name list a
// command already has in hand (registry package names, recipe ids,
// subcommand names, ...) - never a live lookup, never guessed.
function levenshtein(a, b) {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const d = Array.from({ length: rows }, (_, i) => [i, ...new Array(cols - 1).fill(0)]);
    for (let j = 1; j < cols; j++) d[0][j] = j;

    for (let i = 1; i < rows; i++) {
        for (let j = 1; j < cols; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(
                d[i - 1][j] + 1, // deletion
                d[i][j - 1] + 1, // insertion
                d[i - 1][j - 1] + cost // substitution
            );
        }
    }
    return d[rows - 1][cols - 1];
}

// suggestSimilar(input, candidates, { max, maxDistance }) -> string[],
// closest matches first. maxDistance scales with input length (a 3-char
// typo tolerance on a 4-letter name would suggest almost anything) -
// capped at 40% of the input's length, minimum 2, so "fluter" ->
// "flutter" (distance 1) matches but "x" -> "xterm" (distance 4) doesn't
// drown the result in noise.
export function suggestSimilar(input, candidates, { max = 3, maxDistance } = {}) {
    const cap = maxDistance ?? Math.max(2, Math.ceil(input.length * 0.4));
    return candidates
        .map((candidate) => ({ candidate, distance: levenshtein(input.toLowerCase(), candidate.toLowerCase()) }))
        .filter((r) => r.distance <= cap && r.candidate.toLowerCase() !== input.toLowerCase())
        .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))
        .slice(0, max)
        .map((r) => r.candidate);
}

// didYouMeanMessage(input, candidates, opts) -> "Did you mean: x, y?" or
// null when nothing is close enough to suggest.
export function didYouMeanMessage(input, candidates, opts) {
    const matches = suggestSimilar(input, candidates, opts);
    return matches.length > 0 ? `Did you mean: ${matches.join(", ")}?` : null;
}
