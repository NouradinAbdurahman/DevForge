// assertSafeTarArchive(archivePath) -> Promise<string[]> (the entry
// list, in case a caller wants it). Every `tar -xzf` call site in this
// codebase (workspace bundle import, plugin install, snapshot
// restore/diff/preview) used to extract an untrusted archive straight to
// disk before validating anything about its contents - a crafted entry
// like `../../../../.ssh/authorized_keys` or an absolute path would
// already have been written by the time any later checksum/shape
// validation ran. This lists the archive's entries first (`tar -tzf`,
// read-only, nothing written) and refuses to extract if any entry would
// escape the destination directory - the standard "zip-slip" defense -
// before the real extraction ever runs. Call this immediately before
// every `tar -xzf`.
import path from "node:path";
import { captureShellCommandWithDetails, shellQuote } from "./shell.js";
import { DevForgeError } from "./errors.js";

export async function assertSafeTarArchive(archivePath) {
    const { code, stdout, stderr } = await captureShellCommandWithDetails(`tar -tzf ${shellQuote(archivePath)}`);
    if (code !== 0) {
        throw new DevForgeError(`Could not read archive contents for safety validation: ${archivePath}${stderr ? ` (${stderr.trim()})` : ""}`);
    }

    const entries = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    for (const entry of entries) {
        // A leading "./" (tar's own conventional prefix) is fine; strip
        // it before checking so it doesn't mask a real ".." that follows.
        const normalized = path.normalize(entry.replace(/^\.\//, ""));
        if (path.isAbsolute(entry) || path.isAbsolute(normalized)) {
            throw new DevForgeError(`Archive contains an absolute path entry, refusing to extract: ${entry}`);
        }
        if (normalized === ".." || normalized.startsWith(`..${path.sep}`) || normalized.includes(`${path.sep}..${path.sep}`)) {
            throw new DevForgeError(`Archive contains a path-traversal entry, refusing to extract: ${entry}`);
        }
    }
    return entries;
}
