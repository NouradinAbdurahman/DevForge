// Resolves and writes the generated per-shell environment file
// (~/.config/devforgekit/shell.<ext>) - always a full overwrite, never
// an edit or append, so there is never drift between what's on disk and
// what the current registry + tracked-package state says it should be.
//
// Manual-edit detection: state.js records a content hash per shell file
// at every write. If the file on disk no longer matches the hash of what
// the engine last generated, a user (or another tool) edited inside the
// managed file - the edited version is preserved as
// <file>.user-<timestamp> before the overwrite and the caller gets
// `manualEditBackup` so it can tell the user, instead of silently
// destroying their change. (The user's rc file itself is never touched
// outside the marker block - see hook.js; this covers the one file the
// engine fully owns.)
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { userConfigDir } from "../paths.js";
import { renderShellFile, shellFileExtension } from "./writers/index.js";

export function shellFilePath(shell) {
    return path.join(userConfigDir(), `shell.${shellFileExtension(shell)}`);
}

export function contentHash(content) {
    return createHash("sha256").update(content).digest("hex");
}

// detectManualEdit(shell, lastHash) -> the current on-disk content when
// it differs from what the engine last generated (a manual edit), else
// null. No recorded hash (first generation, or a pre-v2 state file)
// means nothing to compare - never a false positive.
export function detectManualEdit(shell, lastHash) {
    if (!lastHash) return null;
    const file = shellFilePath(shell);
    if (!existsSync(file)) return null;
    const current = readFileSync(file, "utf8");
    return contentHash(current) === lastHash ? null : current;
}

// writeShellFile(shell, model, { lastHash }) ->
//   { file, hash, manualEditBackup }
// mkdir's userConfigDir() first since a first-ever run may not have it yet.
export function writeShellFile(shell, model, { lastHash } = {}) {
    const file = shellFilePath(shell);
    mkdirSync(path.dirname(file), { recursive: true });

    let manualEditBackup = null;
    if (detectManualEdit(shell, lastHash) !== null) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        manualEditBackup = `${file}.user-${stamp}`;
        copyFileSync(file, manualEditBackup);
    }

    const content = renderShellFile(shell, model);
    writeFileSync(file, content);
    return { file, hash: contentHash(content), manualEditBackup };
}
