import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreResults } from "../src/core/health.js";

test("all PASS scores 100 and Machine Ready", () => {
    const { score, verdict } = scoreResults([{ status: "PASS" }, { status: "PASS" }]);
    assert.equal(score, 100);
    assert.equal(verdict, "Machine Ready");
});

test("empty results score 100 (no steps ran, nothing failed)", () => {
    const { score } = scoreResults([]);
    assert.equal(score, 100);
});

test("matches the bash formula: (pass*100 + warn*50) / total", () => {
    // 2 PASS, 1 WARNING, 1 FAIL -> (2*100 + 1*50 + 0) / 4 = 62 (floored)
    const results = [
        { status: "PASS" }, { status: "PASS" }, { status: "WARNING" }, { status: "FAIL" }
    ];
    const { score, pass, warn, fail, total } = scoreResults(results);
    assert.equal(pass, 2);
    assert.equal(warn, 1);
    assert.equal(fail, 1);
    assert.equal(total, 4);
    assert.equal(score, 62);
});

test("score below 70 reports Machine Needs Attention", () => {
    const { verdict } = scoreResults([{ status: "FAIL" }, { status: "FAIL" }, { status: "PASS" }]);
    assert.equal(verdict, "Machine Needs Attention");
});

test("score between 70 and 89 reports Mostly Ready", () => {
    // 3 PASS, 1 WARNING -> (300 + 50) / 4 = 87
    const { score, verdict } = scoreResults([
        { status: "PASS" }, { status: "PASS" }, { status: "PASS" }, { status: "WARNING" }
    ]);
    assert.equal(score, 87);
    assert.equal(verdict, "Machine Mostly Ready - see warnings above");
});
