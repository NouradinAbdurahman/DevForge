import { test } from "node:test";
import assert from "node:assert/strict";
import chalk from "chalk";
import { healthBar, healthColor, table, section, formatDuration, rule } from "../src/lib/ui.js";

// One shared ANSI-stripping helper (and one eslint-disable) instead of
// six inline regex literals repeating the same control-character warning.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const strip = (s) => s.replace(ANSI_PATTERN, "");

test("healthBar() fills proportionally to score and clamps out-of-range input", () => {
    assert.match(strip(healthBar(0)), /^░{24} {2}0%$/);
    assert.match(strip(healthBar(100)), /^█{24} {2}100%$/);
    const half = strip(healthBar(50));
    assert.equal((half.match(/█/g) || []).length, 12);
    // out of range never throws and never over/under-fills
    assert.doesNotThrow(() => healthBar(150));
    assert.doesNotThrow(() => healthBar(-10));
    assert.match(strip(healthBar(150)), /^█{24} {2}100%$/);
});

test("healthColor() follows the 90/70 threshold convention core/health.js's scoreResults() uses", () => {
    // Function-identity comparison, not rendered-string comparison:
    // chalk auto-disables color entirely in a non-TTY test runner, so
    // chalk.green("x") and chalk.yellow("x") would both just be "x" -
    // the actual threshold logic has to be tested at the color-fn level.
    assert.equal(healthColor(100), chalk.green);
    assert.equal(healthColor(90), chalk.green);
    assert.equal(healthColor(89), chalk.yellow);
    assert.equal(healthColor(70), chalk.yellow);
    assert.equal(healthColor(69), chalk.red);
    assert.equal(healthColor(0), chalk.red);
});

test("table() aligns columns by visible width, ignoring ANSI color codes", () => {
    const colored = "\x1b[32m✓ installed\x1b[39m";
    const output = table(
        [
            { name: "flutter", status: colored },
            { name: "go", status: "not installed" }
        ],
        [{ key: "name", label: "NAME" }, { key: "status", label: "STATUS" }]
    );
    const lines = output.split("\n");
    // header + divider + 2 rows
    assert.equal(lines.length, 4);
    // strip ANSI and check every line's STATUS column starts at the same column index
    const statusColumnStart = strip(lines[0]).indexOf("STATUS");
    assert.equal(strip(lines[2]).indexOf("✓ installed"), statusColumnStart);
    assert.equal(strip(lines[3]).indexOf("not installed"), statusColumnStart);
});

test("table() renders null/undefined/empty-string cells as '-', never blank", () => {
    const output = table([{ name: "x", version: null, provider: undefined, note: "" }], [
        { key: "name", label: "NAME" },
        { key: "version", label: "VERSION" },
        { key: "provider", label: "PROVIDER" },
        { key: "note", label: "NOTE" }
    ]);
    const dataLine = output.split("\n")[2];
    assert.match(dataLine, /x\s+-\s+-\s+-/);
});

test("table() truncates a cell exceeding maxWidth with an ellipsis, by visible length", () => {
    const output = table([{ name: "a-very-long-component-name-indeed" }], [{ key: "name", label: "NAME", maxWidth: 10 }]);
    const dataLine = output.split("\n")[2].trim();
    assert.ok(dataLine.length <= 10);
    assert.ok(dataLine.endsWith("…"));
});

test("section() wraps title + content between two rules", () => {
    const output = section("Environment Health", ["line one", "line two"]);
    const lines = output.split("\n");
    assert.match(lines[0], /Environment Health/);
    assert.match(lines[1], /─+/);
    assert.equal(lines[2], "line one");
    assert.equal(lines[3], "line two");
    assert.match(lines[4], /─+/);
});

test("formatDuration() matches the mockup's 'Xm Ys' / 'Xs' / 'Xms' shapes", () => {
    assert.equal(formatDuration(138000), "2m 18s");
    assert.equal(formatDuration(45000), "45s");
    assert.equal(formatDuration(750), "750ms");
    assert.equal(formatDuration(60000), "1m 0s");
});

test("rule() is a dim horizontal line capped at 78 columns", () => {
    const stripped = strip(rule());
    assert.ok(stripped.length <= 78);
    assert.ok(stripped.length > 0);
    assert.ok(/^─+$/.test(stripped));
});
