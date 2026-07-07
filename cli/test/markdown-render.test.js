// Ink-level rendering tests for the AI chat Markdown renderer (v2.1.3.1).
// The parser itself is exhaustively covered in markdown-parser.test.js;
// these confirm the render layer actually turns parsed blocks into real
// terminal output - no raw '##'/'**'/'<br>'/table-pipe syntax ever
// reaching the screen, which was the whole point of this milestone.
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { MarkdownText } from "../src/tui/components/markdown.js";
import { getTheme } from "../src/tui/theme.js";

const h = React.createElement;
const theme = getTheme("dark");

const SAMPLE = [
    "## Project Analysis",
    "",
    "This project uses **Flutter** and `pubspec.yaml`.<br>It looks healthy.",
    "",
    "- Flutter",
    "- Docker",
    "",
    "1. Run tests",
    "2. Deploy",
    "",
    "```bash",
    "npm install",
    "```",
    "",
    "| Tool | Status |",
    "| --- | --- |",
    "| Flutter | Installed |",
    "",
    "---",
    "",
    "See [Docs](https://example.com) for more."
].join("\n");

test("MarkdownText never leaks raw Markdown/HTML syntax for a realistic mixed response", () => {
    const { lastFrame, unmount } = render(h(MarkdownText, { text: SAMPLE, theme }));
    const frame = lastFrame();

    assert.ok(!frame.includes("##"), "raw '##' heading syntax leaked through");
    assert.ok(!frame.includes("**"), "raw '**' bold syntax leaked through");
    assert.ok(!frame.includes("<br>"), "raw '<br>' HTML leaked through");
    assert.ok(!frame.includes("](http"), "raw markdown link syntax leaked through");
    assert.ok(!/\|\s*---\s*\|/.test(frame), "raw table separator row leaked through");

    assert.match(frame, /Project Analysis/);
    assert.match(frame, /Flutter/);
    assert.match(frame, /npm install/);
    assert.match(frame, /Installed/);
    assert.match(frame, /Docs/);
    unmount();
});

test("bullet items render with a consistent bullet marker", () => {
    const { lastFrame, unmount } = render(h(MarkdownText, { text: "- Flutter\n- Docker\n- Node", theme }));
    const frame = lastFrame();
    assert.equal((frame.match(/•/g) || []).length, 3);
    unmount();
});

test("numbered items render aligned and in order", () => {
    const { lastFrame, unmount } = render(h(MarkdownText, { text: "1. First\n2. Second\n3. Third", theme }));
    const frame = lastFrame();
    const firstIndex = frame.indexOf("First");
    const secondIndex = frame.indexOf("Second");
    const thirdIndex = frame.indexOf("Third");
    assert.ok(firstIndex < secondIndex && secondIndex < thirdIndex);
    unmount();
});

test("a code block's content renders inside a bordered box", () => {
    const { lastFrame, unmount } = render(h(MarkdownText, { text: "```bash\nnpm install\n```", theme }));
    const frame = lastFrame();
    assert.match(frame, /npm install/);
    assert.match(frame, /[╭╮╰╯│─]/); // some border character from the round-bordered code box
    unmount();
});

test("plain text with no markdown renders as-is, with no crash", () => {
    const { lastFrame, unmount } = render(h(MarkdownText, { text: "Everything looks fine.", theme }));
    assert.match(lastFrame(), /Everything looks fine\./);
    unmount();
});

test("empty text renders without throwing", () => {
    const { lastFrame, unmount } = render(h(MarkdownText, { text: "", theme }));
    assert.equal(typeof lastFrame(), "string");
    unmount();
});

// ink-testing-library's fake stdout hardcodes columns to 100 with no
// setter (confirmed in node_modules/ink-testing-library/build/index.js) -
// there's no supported way to simulate a narrow/wide terminal for a
// standalone component render, so this checks the one thing that's
// actually variable: a very long unbroken line still renders (wrapped by
// Ink's own Text `wrap: "wrap"`, not manually truncated or thrown away)
// at the harness's fixed 100-column width.
test("a very long paragraph wraps instead of being truncated or crashing", () => {
    const long = "word ".repeat(200).trim();
    const { lastFrame, unmount } = render(h(MarkdownText, { text: long, theme }));
    const frame = lastFrame();
    assert.ok(frame.includes("word"));
    assert.ok(frame.split("\n").length > 1, "expected a 1000-character line to wrap across multiple terminal rows");
    unmount();
});
