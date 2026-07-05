import { test } from "node:test";
import assert from "node:assert/strict";
import { toJson, toMarkdown, toHtml, toPdfReadyMarkdown } from "../src/core/compatibility/report.js";

const scanResult = {
    score: 82,
    verdict: "Warning",
    pass: 3,
    recommend: 1,
    warn: 1,
    critical: 0,
    unsupported: 0,
    issues: [
        { severity: "WARNING", tool: "node", message: "node 18 is deprecated", recommendation: "Run: mise upgrade node" },
        { severity: "PASS", tool: "git", message: "git: no compatibility rules declared" }
    ]
};

test("toJson round-trips the scan result verbatim", () => {
    assert.deepEqual(JSON.parse(toJson(scanResult)), scanResult);
});

test("toMarkdown includes the score, tally table, and one section per severity present (worst first)", () => {
    const md = toMarkdown(scanResult);
    assert.match(md, /\*\*Score:\*\* 82% - \*\*Warning\*\*/);
    assert.match(md, /## WARNING/);
    assert.match(md, /node 18 is deprecated/);
    assert.match(md, /_\(Run: mise upgrade node\)_/);
    assert.match(md, /## PASS/);
    // No CRITICAL/UNSUPPORTED/RECOMMEND section should be emitted when there are no such issues.
    assert.doesNotMatch(md, /## CRITICAL/);
    assert.doesNotMatch(md, /## UNSUPPORTED/);
});

test("toPdfReadyMarkdown is the exact same Markdown, not a fabricated binary format", () => {
    assert.equal(toPdfReadyMarkdown(scanResult), toMarkdown(scanResult));
});

test("toHtml escapes issue text and embeds the score/tally, with no external requests (fully self-contained)", () => {
    const html = toHtml({ ...scanResult, issues: [{ severity: "WARNING", tool: "x", message: "<script>alert(1)</script>" }] });
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /https?:\/\//);
    assert.match(html, /Score: 82%/);
});
