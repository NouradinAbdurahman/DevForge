// End-to-end (real filesystem, no mocks) generator runs - restricted to
// the generators that need no external scaffolding CLI (express,
// electron), so this suite never depends on Flutter/Node-npx-network/
// dotnet/composer/curl being available in whatever environment runs it
// (the same reasoning dependency-resolution.test.js/installer-timing.
// test.js use fixture packages instead of real `brew install`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runProjectGenerator } from "../src/core/projectGenerator.js";
import { expressGenerator } from "../src/generators/express.js";
import { electronGenerator } from "../src/generators/electron.js";

function withWorkDir(fn) {
    const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-generators-e2e-"));
    try {
        return fn(workDir);
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
}

test("end-to-end: generating an Express project writes a real, valid, git-initialized project", async () => {
    await withWorkDir(async (workDir) => {
        const { dir, nextSteps } = await runProjectGenerator(expressGenerator, {
            name: "e2e-express-app",
            parentDir: workDir,
            options: { auth: true, prisma: true, swagger: true, docker: true }
        });

        assert.ok(existsSync(path.join(dir, ".git")));
        assert.ok(existsSync(path.join(dir, "src", "app.js")));
        assert.ok(existsSync(path.join(dir, "src", "server.js")));
        assert.ok(existsSync(path.join(dir, "prisma", "schema.prisma")));
        assert.ok(existsSync(path.join(dir, "Dockerfile")));

        const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
        assert.equal(pkg.name, "e2e-express-app");
        assert.ok(pkg.dependencies.express);

        assert.ok(nextSteps.some((s) => s.includes("npm install")));
    });
});

test("end-to-end: generating an Electron project produces a runnable package.json layout", async () => {
    await withWorkDir(async (workDir) => {
        const { dir } = await runProjectGenerator(electronGenerator, {
            name: "e2e-electron-app",
            parentDir: workDir,
            options: {}
        });

        assert.ok(existsSync(path.join(dir, "src", "main.js")));
        assert.ok(existsSync(path.join(dir, "src", "renderer", "index.html")));
        const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
        assert.equal(pkg.scripts.start, "electron .");
    });
});
