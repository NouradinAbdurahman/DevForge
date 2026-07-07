import { test } from "node:test";
import assert from "node:assert/strict";
import { fuzzyMatch, fuzzyFilter, splitByIndices } from "../src/tui/fuzzy.js";

test("fuzzyMatch requires all query characters to appear in order", () => {
    assert.ok(fuzzyMatch("dkr", "docker"));
    assert.ok(fuzzyMatch("doc", "docker"));
    assert.equal(fuzzyMatch("xyz", "docker"), null);
    assert.equal(fuzzyMatch("rdk", "docker"), null); // wrong order
});

test("fuzzyMatch is case-insensitive but rewards a case-exact hit", () => {
    const lower = fuzzyMatch("d", "docker");
    const exact = fuzzyMatch("D", "Docker");
    assert.ok(lower);
    assert.ok(exact.score >= lower.score);
});

test("fuzzyMatch empty query matches everything with score 0", () => {
    const result = fuzzyMatch("", "anything");
    assert.deepEqual(result, { score: 0, indices: [] });
});

test("fuzzyMatch null/empty text never matches a non-empty query", () => {
    assert.equal(fuzzyMatch("a", ""), null);
    assert.equal(fuzzyMatch("a", null), null);
});

test("fuzzyMatch scores a consecutive-run match higher than a scattered one", () => {
    const consecutive = fuzzyMatch("doc", "docker"); // prefix run
    const scattered = fuzzyMatch("dkr", "docker"); // d-o-c-k-e-r scattered
    assert.ok(consecutive.score > scattered.score);
});

test("fuzzyMatch prefers a word-boundary start over a mid-word match", () => {
    const boundary = fuzzyMatch("ai", "ai-models"); // starts at position 0
    const midword = fuzzyMatch("ai", "compatibility"); // "ai" inside, not at a boundary
    assert.ok(boundary.score > midword.score);
});

test("fuzzyMatch prefers a shorter, more specific target for an equal-quality match", () => {
    const shortMatch = fuzzyMatch("dock", "docker");
    const longMatch = fuzzyMatch("dock", "docker-compose");
    assert.ok(shortMatch.score > longMatch.score);
});

test("fuzzyMatch returns the matched character indices for highlighting", () => {
    const result = fuzzyMatch("dkr", "docker");
    assert.deepEqual(result.indices, [0, 3, 5]);
});

test("fuzzyFilter drops non-matching items and sorts by score descending", () => {
    const items = ["docker", "docker-compose", "kubernetes", "aws-cli"];
    const filtered = fuzzyFilter("dock", items);
    assert.deepEqual(filtered.map((f) => f.item), ["docker", "docker-compose"]);
});

test("fuzzyFilter with an empty query returns every item, unscored, original order", () => {
    const items = ["b", "a", "c"];
    const filtered = fuzzyFilter("", items);
    assert.deepEqual(filtered.map((f) => f.item), ["b", "a", "c"]);
    assert.ok(filtered.every((f) => f.score === 0));
});

test("splitByIndices breaks text into matched/unmatched runs, including scattered (non-contiguous) positions", () => {
    const parts = splitByIndices("docker", [0, 3, 5]); // d..k.r
    assert.deepEqual(parts, [
        { text: "d", matched: true },
        { text: "oc", matched: false },
        { text: "k", matched: true },
        { text: "e", matched: false },
        { text: "r", matched: true }
    ]);
});

test("splitByIndices with no indices returns the whole text unmatched", () => {
    assert.deepEqual(splitByIndices("docker", []), [{ text: "docker", matched: false }]);
});

test("fuzzyFilter supports a getText accessor for non-string items", () => {
    // "do" is a literal consecutive prefix in "Doctor" but scattered
    // (d...o) in "Dashboard" - Doctor correctly ranks first.
    const items = [{ id: 1, label: "Dashboard" }, { id: 2, label: "Doctor" }, { id: 3, label: "Recipes" }];
    const filtered = fuzzyFilter("do", items, (i) => i.label);
    assert.deepEqual(filtered.map((f) => f.item.id), [2, 1]);
});
