// Tests for the pure markdown block parser (AI Chat Rendering & Response
// Experience, v2.1.3.1). No Ink involved here on purpose - the parser is
// plain data in, plain data out, so it's fully covered by fast unit
// tests; components/markdown.js's rendering is covered separately.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, parseInline } from "../src/tui/lib/markdown.js";

test("parses headers at every level into heading blocks with the right level", () => {
    const blocks = parseMarkdown("# Title\n\n## Section\n\n### Subsection");
    assert.deepEqual(blocks.map((b) => [b.type, b.level]), [
        ["heading", 1], ["heading", 2], ["heading", 3]
    ]);
    assert.equal(blocks[0].segments[0].text, "Title");
});

test("parses **bold** and __bold__ into bold segments", () => {
    const [block] = parseMarkdown("This is **bold** and __also bold__.");
    assert.equal(block.type, "paragraph");
    const bold = block.segments.filter((s) => s.bold);
    assert.equal(bold.length, 2);
    assert.equal(bold[0].text, "bold");
    assert.equal(bold[1].text, "also bold");
});

test("parses *italic* and _italic_ without misreading ** as two *", () => {
    const [block] = parseMarkdown("*italic* and _also italic_ but **not this**.");
    const italic = block.segments.filter((s) => s.italic);
    const bold = block.segments.filter((s) => s.bold);
    assert.equal(italic.length, 2);
    assert.equal(bold.length, 1);
    assert.equal(bold[0].text, "not this");
});

test("converts - and * bullet markers into a consistent bullet-list block", () => {
    const blocks = parseMarkdown("- Flutter\n* Docker\n- Node");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "bullet-list");
    assert.deepEqual(blocks[0].items.map((segs) => segs[0].text), ["Flutter", "Docker", "Node"]);
});

test("keeps numbered lists as a numbered-list block, in order", () => {
    const blocks = parseMarkdown("1. Run tests\n2. Deploy\n3. Celebrate");
    assert.equal(blocks[0].type, "numbered-list");
    assert.deepEqual(blocks[0].items.map((segs) => segs[0].text), ["Run tests", "Deploy", "Celebrate"]);
});

test("parses a fenced code block with a language tag", () => {
    const [block] = parseMarkdown("```bash\nnpm install\nnpm run build\n```");
    assert.equal(block.type, "code-block");
    assert.equal(block.language, "bash");
    assert.equal(block.code, "npm install\nnpm run build");
});

test("parses a fenced code block with no language tag", () => {
    const [block] = parseMarkdown("```\nplain text\n```");
    assert.equal(block.type, "code-block");
    assert.equal(block.language, null);
});

test("converts `inline code` into a code segment inside a paragraph", () => {
    const [block] = parseMarkdown("Run `git status` to check.");
    const code = block.segments.find((s) => s.code);
    assert.equal(code.text, "git status");
});

test("parses a markdown table into headers + rows, not raw pipe text", () => {
    const [block] = parseMarkdown("| Tool | Status |\n| --- | --- |\n| Flutter | Installed |\n| Docker | Missing |");
    assert.equal(block.type, "table");
    assert.deepEqual(block.headers, ["Tool", "Status"]);
    assert.deepEqual(block.rows, [["Flutter", "Installed"], ["Docker", "Missing"]]);
});

test("converts <br> into a real line break and strips all other HTML tags", () => {
    const [block] = parseMarkdown("Line one.<br>Line two.<div>ignored</div> Line three.");
    const joined = block.segments.map((s) => s.text).join("");
    assert.ok(joined.includes("Line one."));
    assert.ok(joined.includes("Line two."));
    assert.ok(!joined.includes("<br>"));
    assert.ok(!joined.includes("<div>"));
    assert.ok(!joined.includes("ignored") || !joined.includes("<"));
});

test("converts --- into a divider block", () => {
    const blocks = parseMarkdown("Above\n\n---\n\nBelow");
    assert.equal(blocks.map((b) => b.type).includes("divider"), true);
});

test("converts a markdown link into a plain, readable segment - never raw [label](url) syntax", () => {
    const [block] = parseMarkdown("See [Docs](https://example.com/docs) for more.");
    const link = block.segments.find((s) => s.link);
    assert.equal(link.text, "Docs (https://example.com/docs)");
    assert.ok(!block.segments.some((s) => s.text.includes("](")));
});

test("a realistic, mixed AI response parses into the right sequence of block types (regression)", () => {
    const sample = [
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
    const blocks = parseMarkdown(sample);
    assert.deepEqual(blocks.map((b) => b.type), [
        "heading", "paragraph", "bullet-list", "numbered-list",
        "code-block", "table", "divider", "paragraph"
    ]);
});

test("plain text with no markdown at all becomes a single paragraph, untouched", () => {
    const blocks = parseMarkdown("Everything looks fine. No issues detected.");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "paragraph");
    assert.equal(blocks[0].segments[0].text, "Everything looks fine. No issues detected.");
});

test("empty input parses to an empty block list without throwing", () => {
    assert.deepEqual(parseMarkdown(""), []);
    assert.deepEqual(parseMarkdown(undefined), []);
});

test("a long response with many blocks parses without throwing (long-response regression)", () => {
    const long = Array.from({ length: 50 }, (_, i) => `## Section ${i}\n\nSome text about section ${i}.\n\n- item ${i}`).join("\n\n");
    const blocks = parseMarkdown(long);
    assert.equal(blocks.filter((b) => b.type === "heading").length, 50);
});

test("parseInline handles plain text with no formatting", () => {
    const segments = parseInline("just plain text");
    assert.deepEqual(segments, [{ text: "just plain text" }]);
});
