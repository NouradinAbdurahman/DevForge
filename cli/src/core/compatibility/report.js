// Report generation for `devforgekit compatibility export`. `toJson` and
// `toMarkdown` are the two real formats; `toPdfReadyMarkdown` is
// deliberately the exact same Markdown, labeled honestly - there is no PDF
// rendering library bundled or being added here, so "PDF-ready" means
// clean, heading-structured Markdown a tool like `pandoc` can convert, not
// a binary PDF this module produces itself.
const SEVERITY_ORDER = ["UNSUPPORTED", "CRITICAL", "WARNING", "RECOMMEND", "PASS"];

function groupBySeverity(issues) {
    const groups = {};
    for (const issue of issues) {
        (groups[issue.severity] ||= []).push(issue);
    }
    return groups;
}

export function toJson(scanResult) {
    return `${JSON.stringify(scanResult, null, 2)}\n`;
}

export function toMarkdown(scanResult, { title = "DevForgeKit Compatibility Report" } = {}) {
    const groups = groupBySeverity(scanResult.issues);
    const lines = [
        `# ${title}`,
        "",
        `Generated: ${new Date().toISOString()}`,
        "",
        `**Score:** ${scanResult.score}% - **${scanResult.verdict}**`,
        "",
        "| Pass | Recommend | Warning | Critical | Unsupported |",
        "| --- | --- | --- | --- | --- |",
        `| ${scanResult.pass} | ${scanResult.recommend} | ${scanResult.warn} | ${scanResult.critical} | ${scanResult.unsupported} |`,
        ""
    ];

    for (const severity of SEVERITY_ORDER) {
        const items = groups[severity] || [];
        if (items.length === 0) continue;
        lines.push(`## ${severity}`, "");
        for (const issue of items) {
            lines.push(`- **${issue.tool}**: ${issue.message}${issue.recommendation ? ` _(${issue.recommendation})_` : ""}`);
        }
        lines.push("");
    }

    return lines.join("\n");
}

// toPdfReadyMarkdown - see module doc comment: not a binary PDF, the same
// Markdown `toMarkdown` produces, kept as its own named export so the CLI's
// `--format pdf` has something explicit to call (and so a real PDF renderer
// can replace just this one function later without touching callers).
export function toPdfReadyMarkdown(scanResult, opts) {
    return toMarkdown(scanResult, opts);
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const SEVERITY_COLOR = {
    UNSUPPORTED: "#8b0000",
    CRITICAL: "#c0392b",
    WARNING: "#b8860b",
    RECOMMEND: "#2e6da4",
    PASS: "#2e7d32"
};

// toHtml - a single self-contained file (inline CSS, no external requests),
// since this is a plain report written to disk, not an Artifact page.
export function toHtml(scanResult, { title = "DevForgeKit Compatibility Report" } = {}) {
    const groups = groupBySeverity(scanResult.issues);
    const sections = SEVERITY_ORDER
        .filter((s) => (groups[s] || []).length > 0)
        .map((severity) => `
      <section>
        <h2 style="color:${SEVERITY_COLOR[severity]}">${severity} (${groups[severity].length})</h2>
        <ul>
          ${groups[severity].map((issue) => `<li><strong>${escapeHtml(issue.tool)}</strong>: ${escapeHtml(issue.message)}${issue.recommendation ? ` <em>(${escapeHtml(issue.recommendation)})</em>` : ""}</li>`).join("\n          ")}
        </ul>
      </section>`)
        .join("\n");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { margin-bottom: 0.25rem; }
  .score { font-size: 1.25rem; font-weight: 600; }
  table { border-collapse: collapse; margin: 1rem 0; }
  td, th { border: 1px solid #ccc; padding: 0.4rem 0.8rem; text-align: center; }
  section { margin-top: 1.5rem; }
  ul { padding-left: 1.25rem; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>Generated: ${new Date().toISOString()}</p>
  <p class="score">Score: ${scanResult.score}% - ${escapeHtml(scanResult.verdict)}</p>
  <table>
    <tr><th>Pass</th><th>Recommend</th><th>Warning</th><th>Critical</th><th>Unsupported</th></tr>
    <tr><td>${scanResult.pass}</td><td>${scanResult.recommend}</td><td>${scanResult.warn}</td><td>${scanResult.critical}</td><td>${scanResult.unsupported}</td></tr>
  </table>
  ${sections}
</body>
</html>
`;
}
