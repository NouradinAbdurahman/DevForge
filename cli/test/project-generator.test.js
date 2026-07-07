import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runProjectGenerator, writeGeneratedFiles } from "../src/core/projectGenerator.js";

function withWorkDir(fn) {
    const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-projectgen-test-"));
    try {
        return fn(workDir);
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
}

test("writeGeneratedFiles creates nested directories and file content", () => {
    withWorkDir((workDir) => {
        writeGeneratedFiles(workDir, [
            { path: "README.md", content: "hello\n" },
            { path: "src/deep/nested/file.js", content: "// x\n" }
        ]);
        assert.equal(readFileSync(path.join(workDir, "README.md"), "utf8"), "hello\n");
        assert.equal(readFileSync(path.join(workDir, "src", "deep", "nested", "file.js"), "utf8"), "// x\n");
    });
});

test("writeGeneratedFiles honors an explicit file mode", () => {
    withWorkDir((workDir) => {
        writeGeneratedFiles(workDir, [{ path: "run.sh", content: "#!/bin/sh\n", mode: 0o755 }]);
        const stat = readFileSync(path.join(workDir, "run.sh"), "utf8");
        assert.equal(stat, "#!/bin/sh\n");
    });
});

test("runProjectGenerator refuses to scaffold into an existing, non-empty directory", async () => {
    await withWorkDir(async (workDir) => {
        const name = "taken";
        mkdirSync(path.join(workDir, name));
        writeFileSync(path.join(workDir, name, "existing.txt"), "already here\n");

        const fixtureGenerator = { id: "fixture", label: "Fixture", generate: () => [] };
        await assert.rejects(
            () => runProjectGenerator(fixtureGenerator, { name, parentDir: workDir }),
            /already exists and is not empty/
        );
    });
});

test("runProjectGenerator with no scaffold: creates the directory, writes files, and runs git init", async () => {
    await withWorkDir(async (workDir) => {
        const fixtureGenerator = {
            id: "fixture",
            label: "Fixture",
            generate: () => [{ path: "README.md", content: "hi\n" }],
            nextSteps: ({ name }) => [`cd ${name}`]
        };

        const { dir, nextSteps } = await runProjectGenerator(fixtureGenerator, { name: "my-fixture-app", parentDir: workDir });

        assert.equal(dir, path.join(workDir, "my-fixture-app"));
        assert.ok(existsSync(path.join(dir, "README.md")));
        assert.ok(existsSync(path.join(dir, ".git")), "expected git init to have run");
        assert.deepEqual(nextSteps, ["cd my-fixture-app"]);
    });
});

test("runProjectGenerator honors skipGitInit", async () => {
    await withWorkDir(async (workDir) => {
        const fixtureGenerator = { id: "fixture", label: "Fixture", skipGitInit: true, generate: () => [] };
        const { dir } = await runProjectGenerator(fixtureGenerator, { name: "no-git", parentDir: workDir });
        assert.ok(!existsSync(path.join(dir, ".git")));
    });
});

test("runProjectGenerator calls postGenerate after generate, with the resolved dir", async () => {
    await withWorkDir(async (workDir) => {
        let seenDir = null;
        const fixtureGenerator = {
            id: "fixture",
            label: "Fixture",
            generate: () => [{ path: "package.json", content: "{}\n" }],
            postGenerate: ({ dir }) => {
                seenDir = dir;
                writeFileSync(path.join(dir, "package.json"), '{"patched":true}\n');
            }
        };
        const { dir } = await runProjectGenerator(fixtureGenerator, { name: "patched-app", parentDir: workDir });
        assert.equal(seenDir, dir);
        assert.equal(readFileSync(path.join(dir, "package.json"), "utf8"), '{"patched":true}\n');
    });
});

test("runProjectGenerator surfaces a clear error when a required external tool is missing", async () => {
    await withWorkDir(async (workDir) => {
        const fixtureGenerator = {
            id: "fixture",
            label: "Fixture",
            requiresTool: { command: "definitely-not-a-real-binary-xyz", hint: "install it somehow" },
            generate: () => []
        };
        await assert.rejects(
            () => runProjectGenerator(fixtureGenerator, { name: "needs-tool", parentDir: workDir }),
            /definitely-not-a-real-binary-xyz.*not installed/s
        );
    });
});

test("runProjectGenerator throws if the scaffold command exits non-zero", async () => {
    await withWorkDir(async (workDir) => {
        const fixtureGenerator = {
            id: "fixture",
            label: "Fixture",
            scaffold: async () => 1
        };
        await assert.rejects(
            () => runProjectGenerator(fixtureGenerator, { name: "boom", parentDir: workDir }),
            /scaffold command failed/
        );
    });
});

// --- Universal LICENSE (Project Generator Excellence, v2.1.2) ----------

test("runProjectGenerator writes a real MIT LICENSE by default for a generator that provides none", async () => {
    await withWorkDir(async (workDir) => {
        const fixtureGenerator = { id: "fixture", label: "Fixture", generate: () => [] };
        const { dir } = await runProjectGenerator(fixtureGenerator, { name: "no-license-app", parentDir: workDir });
        const license = readFileSync(path.join(dir, "LICENSE"), "utf8");
        assert.match(license, /MIT License/);
    });
});

test("runProjectGenerator honors an explicit license choice", async () => {
    await withWorkDir(async (workDir) => {
        const fixtureGenerator = { id: "fixture", label: "Fixture", generate: () => [] };
        const { dir } = await runProjectGenerator(fixtureGenerator, {
            name: "apache-app", parentDir: workDir, options: { license: "apache-2.0" }
        });
        const license = readFileSync(path.join(dir, "LICENSE"), "utf8");
        assert.match(license, /Apache License/);
        assert.match(license, /Version 2\.0/);
    });
});

test("runProjectGenerator writes no LICENSE at all when license is 'none'", async () => {
    await withWorkDir(async (workDir) => {
        const fixtureGenerator = { id: "fixture", label: "Fixture", generate: () => [] };
        const { dir } = await runProjectGenerator(fixtureGenerator, {
            name: "no-license-chosen", parentDir: workDir, options: { license: "none" }
        });
        assert.ok(!existsSync(path.join(dir, "LICENSE")));
    });
});

test("runProjectGenerator never overwrites a LICENSE a generator already wrote itself", async () => {
    await withWorkDir(async (workDir) => {
        const fixtureGenerator = {
            id: "fixture", label: "Fixture",
            generate: () => [{ path: "LICENSE", content: "CUSTOM LICENSE TEXT\n" }]
        };
        const { dir } = await runProjectGenerator(fixtureGenerator, { name: "custom-license-app", parentDir: workDir });
        assert.equal(readFileSync(path.join(dir, "LICENSE"), "utf8"), "CUSTOM LICENSE TEXT\n");
    });
});
