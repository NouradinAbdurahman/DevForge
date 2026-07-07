// Ink rendering layer for AI chat responses (AI Chat Rendering & Response
// Experience, v2.1.3.1) - turns lib/markdown.js's plain-data blocks into
// real Ink elements. This is the one place that decides what a heading,
// a bullet, a code block, or a table looks like inside DevForgeKit's
// TUI - reusable by any page that ever needs to show AI-authored text,
// not just the Chat page.
import { Box, Text } from "ink";
import { h, Table as SharedTable } from "./ui.js";
import { parseMarkdown } from "../lib/markdown.js";

// InlineSegments({ segments, theme, baseColor }) - one reflowable Text
// run built from styled spans (bold/italic/code/link), the same "nested
// Text, not sibling Boxes" trick KeyValue already relies on so a long
// run wraps as one unit instead of each span getting its own
// flex-shrink share of the width.
function InlineSegments({ segments, theme, baseColor, forceBold }) {
    return h(Text, { color: baseColor || theme.text, wrap: "wrap" },
        ...segments.map((seg, i) => h(Text, {
            key: i,
            bold: forceBold || Boolean(seg.bold),
            italic: Boolean(seg.italic),
            color: seg.code ? theme.accent : seg.link ? theme.info : undefined,
            backgroundColor: seg.code ? theme.surfaceAlt : undefined
        }, seg.text))
    );
}

function HeadingBlock({ block, theme }) {
    const color = block.level === 1 ? theme.accent : block.level === 2 ? theme.primary : theme.text;
    return h(Box, { flexDirection: "column", marginTop: 1 },
        h(InlineSegments, { segments: block.segments, theme, baseColor: color, forceBold: true }),
        block.level <= 2
            ? h(Box, { borderStyle: "single", borderBottom: true, borderTop: false, borderLeft: false, borderRight: false, borderColor: theme.border })
            : null
    );
}

function ParagraphBlock({ block, theme }) {
    return h(Box, { marginTop: 1 }, h(InlineSegments, { segments: block.segments, theme }));
}

function BulletListBlock({ block, theme }) {
    return h(Box, { flexDirection: "column", marginTop: 1 },
        ...block.items.map((segments, i) => h(Box, { key: i },
            h(Text, { color: theme.accent }, "• "),
            h(InlineSegments, { segments, theme })
        ))
    );
}

function NumberedListBlock({ block, theme }) {
    const width = String(block.items.length).length;
    return h(Box, { flexDirection: "column", marginTop: 1 },
        ...block.items.map((segments, i) => h(Box, { key: i },
            h(Text, { color: theme.accent }, `${String(i + 1).padStart(width)}. `),
            h(InlineSegments, { segments, theme })
        ))
    );
}

function CodeBlockView({ block, theme }) {
    return h(Box, {
        flexDirection: "column", marginTop: 1, paddingX: 1,
        borderStyle: "round", borderColor: theme.tableBorder || theme.border
    },
        block.language ? h(Text, { color: theme.textMuted }, block.language) : null,
        ...block.code.split("\n").map((line, i) => h(Text, { key: i, color: theme.text }, line || " "))
    );
}

function TableBlock({ block, theme }) {
    const widths = block.headers.map((header, i) =>
        Math.min(24, Math.max(header.length, ...block.rows.map((r) => (r[i] || "").length)) + 1));
    const columns = block.headers.map((header, i) => ({ key: `c${i}`, label: header, width: widths[i] }));
    const rows = block.rows.map((row, ri) => {
        const obj = { id: ri };
        row.forEach((cell, i) => { obj[`c${i}`] = cell; });
        return obj;
    });
    return h(Box, { marginTop: 1 }, h(SharedTable, { columns, rows, theme }));
}

function DividerBlock({ theme }) {
    return h(Box, { marginTop: 1, borderStyle: "single", borderBottom: true, borderTop: false, borderLeft: false, borderRight: false, borderColor: theme.border });
}

const BLOCK_RENDERERS = {
    heading: HeadingBlock,
    paragraph: ParagraphBlock,
    "bullet-list": BulletListBlock,
    "numbered-list": NumberedListBlock,
    "code-block": CodeBlockView,
    table: TableBlock,
    divider: DividerBlock
};

// MarkdownText({ text, theme }) - the one entry point every page should
// use to show AI-authored text. Never prints raw model output directly:
// this is the renderer standing between the LLM and the screen.
export function MarkdownText({ text, theme }) {
    const blocks = parseMarkdown(text || "");
    return h(Box, { flexDirection: "column" },
        ...blocks.map((block, i) => {
            const Renderer = BLOCK_RENDERERS[block.type];
            if (!Renderer) return null;
            return h(Renderer, { key: i, block, theme });
        })
    );
}
