import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestSimilar, didYouMeanMessage } from "../src/lib/suggest.js";

test("suggestSimilar() finds close typos within a scaled edit-distance cap", () => {
    const candidates = ["flutter", "python", "node", "docker", "postgres"];
    assert.deepEqual(suggestSimilar("fluter", candidates), ["flutter"]);
    assert.deepEqual(suggestSimilar("pyhton", candidates), ["python"]);
    assert.deepEqual(suggestSimilar("dcoker", candidates), ["docker"]);
});

test("suggestSimilar() returns nothing for an unrelated query", () => {
    const candidates = ["flutter", "python", "node"];
    assert.deepEqual(suggestSimilar("xyzzyx", candidates), []);
});

test("suggestSimilar() excludes an exact match (case-insensitive) from its own suggestions", () => {
    const candidates = ["flutter", "python", "node"];
    assert.deepEqual(suggestSimilar("flutter", candidates), []);
    assert.deepEqual(suggestSimilar("Flutter", candidates), []);
});

test("suggestSimilar() ranks closer matches first and respects `max`", () => {
    const candidates = ["react", "reacts", "reactive", "redux"];
    const results = suggestSimilar("reac", candidates, { max: 2, maxDistance: 5 });
    assert.equal(results.length, 2);
    assert.equal(results[0], "react");
});

test("suggestSimilar() scales its distance cap with input length (short inputs stay strict)", () => {
    // "x" -> "xterm" is a distance-4 edit on a 1-char input; the default
    // cap (max(2, ceil(len*0.4))) is 2, so this must NOT be suggested -
    // otherwise a 1-character typo would match almost anything.
    assert.deepEqual(suggestSimilar("x", ["xterm"]), []);
});

test("didYouMeanMessage() formats a single suggestion", () => {
    assert.equal(
        didYouMeanMessage("fluter", ["flutter", "python"]),
        "Did you mean: flutter?"
    );
});

test("didYouMeanMessage() formats multiple suggestions comma-separated", () => {
    const msg = didYouMeanMessage("reac", ["react", "reacts", "redux"], { max: 2, maxDistance: 5 });
    assert.match(msg, /^Did you mean: react, reacts\?$/);
});

test("didYouMeanMessage() returns null when nothing is close enough", () => {
    assert.equal(didYouMeanMessage("xyzzyx", ["flutter", "python", "node"]), null);
});
