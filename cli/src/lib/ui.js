// Shared "premium" presentation primitives - horizontal rules, health
// bars, and aligned tables - so install/doctor/component/env output all
// render with the same visual language instead of each command hand-
// rolling its own spacing. Deliberately plain horizontal rules, not
// full ASCII boxes with corner characters: that's what every mockup in
// the product brief actually shows, and it sidesteps a whole class of
// width-alignment bugs a bordered box invites.
//
// Terminal-width aware; chalk already strips color automatically when
// stdout isn't a TTY (NO_COLOR, piped output, CI), so nothing here
// needs its own color-disable branch.
import chalk from "chalk";

function width() {
    return (process.stdout.isTTY && process.stdout.columns) || 80;
}

// visibleLength/padVisible - table columns must align by VISIBLE width,
// not raw character count: a chalk-colored cell ("✓ installed" in
// green) contains invisible ANSI escape bytes that would otherwise
// throw padEnd's own length math off and misalign every column after
// the first colored one.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function visibleLength(text) {
    return text.replace(ANSI_PATTERN, "").length;
}

function padVisible(text, targetWidth) {
    const pad = Math.max(0, targetWidth - visibleLength(text));
    return text + " ".repeat(pad);
}

export function rule(char = "─") {
    return chalk.dim(char.repeat(Math.min(width(), 78)));
}

// healthColor(score) -> the one shared tri-color threshold every
// health-scored view uses (>=90 good, >=70 caution, below concerning) -
// matches core/health.js's scoreResults() verdict tiers exactly, so a
// green bar and a "Machine Ready" verdict always agree.
export function healthColor(score) {
    if (score >= 90) return chalk.green;
    if (score >= 70) return chalk.yellow;
    return chalk.red;
}

// healthBar(score, { barWidth }) -> "█████████████████░░░░░░░  97%"
export function healthBar(score, { barWidth = 24 } = {}) {
    const clamped = Math.max(0, Math.min(100, score));
    const filled = Math.round((clamped / 100) * barWidth);
    const bar = "█".repeat(filled) + "░".repeat(Math.max(0, barWidth - filled));
    const color = healthColor(clamped);
    return `${color(bar)}  ${color(`${clamped}%`)}`;
}

// section(title, lines) -> title, a rule, the content lines, a closing
// rule - the exact "Installing Flutter / bar / ... " and "Environment
// Health / 97% / ── / Node Healthy / ──" shape from the product brief.
export function section(title, lines) {
    return [chalk.bold(title), rule(), ...lines, rule()].join("\n");
}

// formatDuration(ms) -> "2m 18s" / "43s" / "210ms" - one shared format
// for every "elapsed"/"remaining" line instead of each command
// re-deriving its own.
export function formatDuration(ms) {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

// table(rows, columns) -> a column-aligned, header-underlined table.
// columns: [{ key, label, maxWidth? }]. A cell value of null/undefined
// renders as "-", never blank (an empty cell reads as a rendering bug,
// "-" reads as "not applicable/unknown" - the same honesty convention
// the rest of this codebase uses for missing data).
export function table(rows, columns) {
    const cell = (row, col) => {
        const value = row[col.key];
        const text = value === null || value === undefined || value === "" ? "-" : String(value);
        return col.maxWidth && visibleLength(text) > col.maxWidth ? `${text.slice(0, col.maxWidth - 1)}…` : text;
    };

    const widths = columns.map((col) =>
        Math.max(col.label.length, ...rows.map((row) => visibleLength(cell(row, col))))
    );

    const renderRow = (cells, bold = false) =>
        cells.map((text, i) => padVisible(bold ? chalk.bold(text) : text, widths[i])).join("  ");

    const lines = [
        renderRow(columns.map((c) => c.label), true),
        chalk.dim(widths.map((w) => "─".repeat(w)).join("  "))
    ];
    for (const row of rows) {
        lines.push(renderRow(columns.map((col) => cell(row, col))));
    }
    return lines.join("\n");
}
