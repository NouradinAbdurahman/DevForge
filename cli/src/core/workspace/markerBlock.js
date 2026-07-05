// Idempotent "marker block" file editor: writes a clearly-delimited,
// tool-owned block of text into an otherwise user-owned file (e.g.
// ~/.ssh/config, ~/.zshrc), replacing any previous block with the same
// id on every write so re-running never accumulates duplicates and never
// touches anything outside the block. A direct Node port of
// scripts/common.sh's path_manager_fix marker-block convention
// (`# >>> DevForgeKit path-manager >>>` ... `# <<< ... <<<`), generalized
// with an `id` so multiple independent blocks (one per workspace, in
// ssh.js's case) can coexist in the same file. Shared by ssh.js and
// shellIntegration.js rather than each reimplementing this.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";

function beginMarker(id) {
    return `# >>> DevForgeKit ${id} >>>`;
}

function endMarker(id) {
    return `# <<< DevForgeKit ${id} <<<`;
}

// stripBlock(content, id) -> content with any existing id block (and the
// single trailing newline after it) removed. A plain indexOf scan rather
// than a regex - marker text is a fixed, non-regex-special string, and
// this reads more obviously correct than escaping it for a RegExp.
function stripBlock(content, id) {
    const begin = beginMarker(id);
    const end = endMarker(id);
    const start = content.indexOf(begin);
    if (start === -1) return content;
    const endIdx = content.indexOf(end, start + begin.length);
    if (endIdx === -1) return content;
    let stop = endIdx + end.length;
    if (content[stop] === "\n") stop += 1;
    return content.slice(0, start) + content.slice(stop);
}

// readBlock(filePath, id) -> the block's inner text (without the marker
// lines), or null if the file or that id's block doesn't exist.
export function readBlock(filePath, id) {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, "utf8");
    const begin = beginMarker(id);
    const end = endMarker(id);
    const start = content.indexOf(begin);
    if (start === -1) return null;
    const endIdx = content.indexOf(end, start + begin.length);
    if (endIdx === -1) return null;
    return content.slice(start + begin.length, endIdx).replace(/^\n/, "").replace(/\n$/, "");
}

export function hasBlock(filePath, id) {
    return readBlock(filePath, id) !== null;
}

// writeBlock(filePath, id, lines, { header, backup }) -> void. Removes
// any previous block with this id, then appends a fresh one built from
// `lines` (array of strings). `header` is an optional array of comment
// lines placed right after the begin marker (e.g. "managed by, do not
// hand-edit" - see path_manager_fix's wording). Creates the file (and
// its parent directory) if missing. `backup: true` copies the file to
// `<file>.devforgekit-backup` the first time DevForgeKit ever touches a
// pre-existing file (mirrors common.sh's fs_safe_copy backup behavior) -
// skipped on every later call, since by then the file already carries a
// DevForgeKit block.
export function writeBlock(filePath, id, lines, { header = [], backup = false } = {}) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const existed = existsSync(filePath);
    const current = existed ? readFileSync(filePath, "utf8") : "";

    if (backup && existed && !current.includes(beginMarker(id))) {
        copyFileSync(filePath, `${filePath}.devforgekit-backup`);
    }

    const stripped = stripBlock(current, id);
    const base = stripped.length > 0 && !stripped.endsWith("\n") ? `${stripped}\n` : stripped;
    const block = [beginMarker(id), ...header, ...lines, endMarker(id)].join("\n");
    writeFileSync(filePath, `${base}${block}\n`);
}

// removeBlock(filePath, id) -> true if a block was actually found and
// removed, false otherwise (including "file doesn't exist").
export function removeBlock(filePath, id) {
    if (!existsSync(filePath)) return false;
    const current = readFileSync(filePath, "utf8");
    const stripped = stripBlock(current, id);
    if (stripped === current) return false;
    writeFileSync(filePath, stripped);
    return true;
}
