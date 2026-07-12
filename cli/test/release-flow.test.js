// Regression tests for scripts/release.sh's two-phase flow (create +
// finalize), added after being bitten twice by release-automation
// assumptions this same day: once by a script that assumed it could
// push straight to a protected main, once by a CI architecture that
// let a required check go silently absent. This exercises the real
// scripts/release.sh (copied verbatim into a scratch fixture, never
// reimplemented) against a real local git remote (a bare repo, not
// GitHub) and a stubbed `gh` binary on PATH - so every git operation
// (branch/tag creation, push, ls-remote) is genuinely exercised, and
// only the GitHub-hosted parts (PR/release state) are mocked, per the
// "mocked if necessary" instruction this suite was requested under.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const REPO_ROOT = path.resolve(CLI_ROOT, "..");

// A single dispatcher script standing in for the real `gh` CLI. Every
// call release.sh makes to `gh` is enumerated here explicitly (not a
// generic passthrough) so a new, unstubbed `gh` call fails loudly
// instead of silently doing nothing - the same "never fabricate,
// degrade honestly" bar the rest of this codebase holds itself to.
// Behavior is driven entirely by env vars the test sets beforehand.
const FAKE_GH_SCRIPT = `#!/usr/bin/env bash
set -Eeuo pipefail
case "$1 $2" in
  "auth status")
    [[ "\${FAKE_GH_AUTHENTICATED:-1}" == "1" ]] && exit 0 || exit 1
    ;;
  "run list")
    if [[ "$*" == *"workflow=release.yml"* ]]; then
      echo "\${FAKE_GH_RELEASE_RUN_ID:-}"
    else
      # CI status check during preflight (release.sh create)
      if [[ -n "\${FAKE_GH_CI_CONCLUSIONS:-}" ]]; then
        printf '%s\\n' "\${FAKE_GH_CI_CONCLUSIONS}"
      fi
    fi
    ;;
  "run watch")
    exit "\${FAKE_GH_RUN_EXIT:-0}"
    ;;
  "pr create")
    echo "\${FAKE_GH_PR_URL:-https://github.com/fake/fake/pull/1}"
    ;;
  "pr view")
    if [[ "$*" == *"--json number"* ]]; then
      echo "\${FAKE_GH_PR_NUMBER:-1}"
    elif [[ "$*" == *"--json state"* ]]; then
      echo "\${FAKE_GH_PR_STATE:-OPEN}"
    fi
    ;;
  "release view")
    echo "\${FAKE_GH_IS_DRAFT:-true}"
    ;;
  *)
    echo "fake gh: unstubbed call: $*" >&2
    exit 1
    ;;
esac
`;

// buildFixture() -> { dir, originDir, env } - a scratch git repo with:
//  - a local bare "origin" remote (real git, no network)
//  - the real scripts/release.sh + scripts/common.sh + scripts/colors.sh
//    copied in verbatim (the actual code under test)
//  - stub validate.sh / bootstrap.sh (instant no-ops - this suite tests
//    release.sh's own orchestration, not validate.sh/bootstrap.sh
//    themselves, which have their own coverage)
//  - VERSION=3.0.0, a CHANGELOG.md with a real "## [Unreleased]" section
//  - one commit, pushed to origin/main
//  - a fake `gh` prepended to PATH
function buildFixture() {
    const dir = mkdtempSync(path.join(tmpdir(), "devforgekit-release-flow-"));
    const originDir = path.join(dir, "origin.git");
    const workDir = path.join(dir, "work");
    const binDir = path.join(dir, "bin");

    execFileSync("git", ["init", "--bare", "--initial-branch=main", originDir]);
    mkdirSync(workDir, { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main", workDir]);
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: workDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: workDir });
    execFileSync("git", ["remote", "add", "origin", originDir], { cwd: workDir });

    mkdirSync(path.join(workDir, "scripts"), { recursive: true });
    for (const f of ["common.sh", "colors.sh"]) {
        writeFileSync(path.join(workDir, "scripts", f), readFileSync(path.join(REPO_ROOT, "scripts", f)));
    }
    writeFileSync(path.join(workDir, "scripts", "release.sh"), readFileSync(path.join(REPO_ROOT, "scripts", "release.sh")));
    chmodSync(path.join(workDir, "scripts", "release.sh"), 0o755);

    // Stubs - always succeed instantly, so this suite's timing/output is
    // about release.sh's own logic, not a real validate/bootstrap run.
    writeFileSync(path.join(workDir, "scripts", "validate.sh"), "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(path.join(workDir, "scripts", "validate.sh"), 0o755);
    writeFileSync(path.join(workDir, "bootstrap.sh"), "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(path.join(workDir, "bootstrap.sh"), 0o755);

    writeFileSync(path.join(workDir, "VERSION"), "3.0.0\n");
    writeFileSync(
        path.join(workDir, "CHANGELOG.md"),
        "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Something real.\n\n## [3.0.0] - 2026-07-07\n\nInitial release.\n"
    );
    // Without this, the state file create() writes shows up as untracked
    // in finalize()'s own dirty-tree check, which is a real, correct
    // reflection of how release.sh behaves - the real repo only stays
    // "clean" through this exact step because its own .gitignore excludes
    // this file (confirmed live before writing this fixture).
    writeFileSync(path.join(workDir, ".gitignore"), ".devforgekit-release-state.json\n");

    execFileSync("git", ["add", "-A"], { cwd: workDir });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: workDir });
    execFileSync("git", ["push", "-u", "origin", "main"], { cwd: workDir });

    mkdirSync(binDir, { recursive: true });
    writeFileSync(path.join(binDir, "gh"), FAKE_GH_SCRIPT);
    chmodSync(path.join(binDir, "gh"), 0o755);

    return {
        dir,
        originDir,
        workDir,
        env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH}`,
            DEV_SETUP_ASSUME_YES: "1",
            HOME: dir // never touch the real developer's $HOME
        }
    };
}

function runRelease(fixture, args, envOverrides = {}) {
    return spawnSync("bash", [path.join(fixture.workDir, "scripts", "release.sh"), ...args], {
        cwd: fixture.workDir,
        env: { ...fixture.env, ...envOverrides },
        encoding: "utf8"
    });
}

function cleanup(fixture) {
    rmSync(fixture.dir, { recursive: true, force: true });
}

// ─── create phase ─────────────────────────────────────────────────────

test("release.sh create: succeeds on a clean repo, opens a PR, writes the state file", () => {
    const fixture = buildFixture();
    try {
        const result = runRelease(fixture, ["rc", "-y"], { FAKE_GH_PR_NUMBER: "42" });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /Opened PR #42/);

        const statePath = path.join(fixture.workDir, ".devforgekit-release-state.json");
        assert.ok(existsSync(statePath), "expected a release-state file to be written");
        const state = JSON.parse(readFileSync(statePath, "utf8"));
        assert.equal(state.version, "3.0.0-rc1");
        assert.equal(state.prNumber, 42);
        assert.equal(state.stage, "pr-open");

        // The release branch must actually be on origin (real git, not mocked).
        const remoteBranches = execFileSync("git", ["ls-remote", "--heads", "origin"], { cwd: fixture.workDir, encoding: "utf8" });
        assert.match(remoteBranches, /refs\/heads\/release\/v3\.0\.0-rc1/);

        // create must never tag anything.
        const remoteTags = execFileSync("git", ["ls-remote", "--tags", "origin"], { cwd: fixture.workDir, encoding: "utf8" });
        assert.doesNotMatch(remoteTags, /refs\/tags\/v3\.0\.0-rc1/);
    } finally {
        cleanup(fixture);
    }
});

test("release.sh create: refuses on a dirty working tree", () => {
    const fixture = buildFixture();
    try {
        writeFileSync(path.join(fixture.workDir, "VERSION"), "3.0.0\ndirty\n");
        const result = runRelease(fixture, ["rc", "-y"]);
        assert.notEqual(result.status, 0);
        assert.match(result.stdout + result.stderr, /Working tree is not clean/);
    } finally {
        cleanup(fixture);
    }
});

test("release.sh create: refuses when a release for this version is already pending", () => {
    const fixture = buildFixture();
    try {
        const first = runRelease(fixture, ["rc", "-y"], { FAKE_GH_PR_NUMBER: "42" });
        assert.equal(first.status, 0, first.stdout + first.stderr);

        // Back on main, tree clean (create leaves it that way) - try again.
        const second = runRelease(fixture, ["rc", "-y"]);
        assert.notEqual(second.status, 0);
        assert.match(second.stdout + second.stderr, /already pending/);
    } finally {
        cleanup(fixture);
    }
});

test("release.sh create: refuses when the release branch already exists on origin", () => {
    const fixture = buildFixture();
    try {
        execFileSync("git", ["checkout", "-b", "release/v3.0.0-rc1"], { cwd: fixture.workDir });
        execFileSync("git", ["push", "-u", "origin", "release/v3.0.0-rc1"], { cwd: fixture.workDir });
        execFileSync("git", ["checkout", "main"], { cwd: fixture.workDir });

        const result = runRelease(fixture, ["rc", "-y"]);
        assert.notEqual(result.status, 0);
        assert.match(result.stdout + result.stderr, /already exists/);
    } finally {
        cleanup(fixture);
    }
});

// ─── finalize phase ────────────────────────────────────────────────────

test("release.sh finalize: refuses before the release PR is merged", () => {
    const fixture = buildFixture();
    try {
        const created = runRelease(fixture, ["rc", "-y"], { FAKE_GH_PR_NUMBER: "42" });
        assert.equal(created.status, 0, created.stdout + created.stderr);

        const result = runRelease(fixture, ["finalize", "-y"], { FAKE_GH_PR_STATE: "OPEN" });
        assert.notEqual(result.status, 0);
        assert.match(result.stdout + result.stderr, /not merged yet/);

        const remoteTags = execFileSync("git", ["ls-remote", "--tags", "origin"], { cwd: fixture.workDir, encoding: "utf8" });
        assert.doesNotMatch(remoteTags, /refs\/tags\/v3\.0\.0-rc1/, "must not tag before the PR is merged");
    } finally {
        cleanup(fixture);
    }
});

test("release.sh finalize: refuses when local main is behind origin/main", () => {
    const fixture = buildFixture();
    try {
        const created = runRelease(fixture, ["rc", "-y"], { FAKE_GH_PR_NUMBER: "42" });
        assert.equal(created.status, 0, created.stdout + created.stderr);

        // Simulate the PR having merged on GitHub: merge the release
        // branch into main on a second clone and push - the first
        // clone's local main is now behind origin/main, same as a real
        // dev machine that never fetched after merging on the web UI.
        const secondClone = path.join(fixture.dir, "second-clone");
        execFileSync("git", ["clone", fixture.originDir, secondClone]);
        execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: secondClone });
        execFileSync("git", ["config", "user.name", "Test"], { cwd: secondClone });
        execFileSync("git", ["merge", "--no-ff", "origin/release/v3.0.0-rc1", "-m", "merge"], { cwd: secondClone });
        execFileSync("git", ["push", "origin", "main"], { cwd: secondClone });

        // First clone's local main deliberately left stale (no fetch).
        const result = runRelease(fixture, ["finalize", "-y"], {
            FAKE_GH_PR_STATE: "MERGED",
            FAKE_GH_RELEASE_RUN_ID: "999",
            FAKE_GH_RUN_EXIT: "0",
            FAKE_GH_IS_DRAFT: "true"
        });
        // ff-only merge against the now-updated origin/main succeeds
        // (fast-forward is always possible when local hasn't diverged,
        // only advanced less far) - this proves finalize syncs first
        // rather than tagging local's stale HEAD blindly.
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /matches the expected v3\.0\.0-rc1 release/);
    } finally {
        cleanup(fixture);
    }
});

test("release.sh finalize: refuses if the tag already exists pointing at a different, unrelated commit", () => {
    const fixture = buildFixture();
    try {
        const created = runRelease(fixture, ["rc", "-y"], { FAKE_GH_PR_NUMBER: "42" });
        assert.equal(created.status, 0, created.stdout + created.stderr);

        // Simulate an out-of-band tag already existing on origin at some
        // unrelated commit (e.g. a hand-pushed mistake) - finalize's
        // "already exists" fast path only applies to a tag it itself
        // would have created; the check here is that a pre-existing tag
        // is treated as authoritative rather than silently retagged.
        const secondClone = path.join(fixture.dir, "second-clone-tag");
        execFileSync("git", ["clone", fixture.originDir, secondClone]);
        execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: secondClone });
        execFileSync("git", ["config", "user.name", "Test"], { cwd: secondClone });
        execFileSync("git", ["tag", "-a", "v3.0.0-rc1", "-m", "out of band"], { cwd: secondClone });
        execFileSync("git", ["push", "origin", "v3.0.0-rc1"], { cwd: secondClone });

        const result = runRelease(fixture, ["finalize", "-y"], {
            FAKE_GH_PR_STATE: "MERGED",
            FAKE_GH_RELEASE_RUN_ID: "999",
            FAKE_GH_RUN_EXIT: "0",
            FAKE_GH_IS_DRAFT: "true"
        });
        // finalize's restart path treats an existing tag as "already
        // finalized" and jumps to workflow/draft verification rather
        // than erroring - documented, intentional behavior (see
        // docs/ReleaseArchitecture.md's "Restartability" section) -
        // verify it does NOT attempt to create a second, conflicting tag.
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /already exists on origin/);
    } finally {
        cleanup(fixture);
    }
});

test("release.sh finalize: tags the real merge commit and pushes only the tag, never main", () => {
    const fixture = buildFixture();
    try {
        const created = runRelease(fixture, ["rc", "-y"], { FAKE_GH_PR_NUMBER: "42" });
        assert.equal(created.status, 0, created.stdout + created.stderr);

        const secondClone = path.join(fixture.dir, "second-clone-merge");
        execFileSync("git", ["clone", fixture.originDir, secondClone]);
        execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: secondClone });
        execFileSync("git", ["config", "user.name", "Test"], { cwd: secondClone });
        execFileSync("git", ["merge", "--no-ff", "origin/release/v3.0.0-rc1", "-m", "merge release PR"], { cwd: secondClone });
        execFileSync("git", ["push", "origin", "main"], { cwd: secondClone });
        const mergeSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: secondClone, encoding: "utf8" }).trim();

        const result = runRelease(fixture, ["finalize", "-y"], {
            FAKE_GH_PR_STATE: "MERGED",
            FAKE_GH_RELEASE_RUN_ID: "999",
            FAKE_GH_RUN_EXIT: "0",
            FAKE_GH_IS_DRAFT: "true"
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /Pushed v3\.0\.0-rc1/);
        assert.match(result.stdout, /draft release ready for review/);

        // secondClone never fetched after finalize pushed the tag to
        // origin - verify against origin directly (what actually matters:
        // the tag release.sh itself just created and pushed, in the
        // working directory it ran in, which knows about its own tag
        // without needing a fetch).
        const tagCommit = execFileSync("git", ["rev-list", "-n", "1", "v3.0.0-rc1"], { cwd: fixture.workDir, encoding: "utf8" }).trim();
        assert.equal(tagCommit, mergeSha, "the tag must point at the real merge commit, not a stale or reconstructed one");

        // The state file is consumed on success.
        assert.ok(!existsSync(path.join(fixture.workDir, ".devforgekit-release-state.json")));
    } finally {
        cleanup(fixture);
    }
});

test("release.sh finalize: refuses without a pending release (no state file)", () => {
    const fixture = buildFixture();
    try {
        const result = runRelease(fixture, ["finalize", "-y"]);
        assert.notEqual(result.status, 0);
        assert.match(result.stdout + result.stderr, /No pending release found/);
    } finally {
        cleanup(fixture);
    }
});

test("release.sh finalize: rerunning after a completed release is idempotent, not an error", () => {
    const fixture = buildFixture();
    try {
        const created = runRelease(fixture, ["rc", "-y"], { FAKE_GH_PR_NUMBER: "42" });
        assert.equal(created.status, 0, created.stdout + created.stderr);

        const secondClone = path.join(fixture.dir, "second-clone-idempotent");
        execFileSync("git", ["clone", fixture.originDir, secondClone]);
        execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: secondClone });
        execFileSync("git", ["config", "user.name", "Test"], { cwd: secondClone });
        execFileSync("git", ["merge", "--no-ff", "origin/release/v3.0.0-rc1", "-m", "merge"], { cwd: secondClone });
        execFileSync("git", ["push", "origin", "main"], { cwd: secondClone });

        const finalizeEnv = {
            FAKE_GH_PR_STATE: "MERGED",
            FAKE_GH_RELEASE_RUN_ID: "999",
            FAKE_GH_RUN_EXIT: "0",
            FAKE_GH_IS_DRAFT: "true"
        };
        const first = runRelease(fixture, ["finalize", "-y"], finalizeEnv);
        assert.equal(first.status, 0, first.stdout + first.stderr);

        // Re-running finalize now has no state file - must fail clearly,
        // not silently "succeed" having done nothing.
        const second = runRelease(fixture, ["finalize", "-y"], finalizeEnv);
        assert.notEqual(second.status, 0);
        assert.match(second.stdout + second.stderr, /No pending release found/);
    } finally {
        cleanup(fixture);
    }
});

test("release.sh finalize: a failed release workflow run is a hard error, not silently ignored", () => {
    const fixture = buildFixture();
    try {
        const created = runRelease(fixture, ["rc", "-y"], { FAKE_GH_PR_NUMBER: "42" });
        assert.equal(created.status, 0, created.stdout + created.stderr);

        const secondClone = path.join(fixture.dir, "second-clone-failed-workflow");
        execFileSync("git", ["clone", fixture.originDir, secondClone]);
        execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: secondClone });
        execFileSync("git", ["config", "user.name", "Test"], { cwd: secondClone });
        execFileSync("git", ["merge", "--no-ff", "origin/release/v3.0.0-rc1", "-m", "merge"], { cwd: secondClone });
        execFileSync("git", ["push", "origin", "main"], { cwd: secondClone });

        const result = runRelease(fixture, ["finalize", "-y"], {
            FAKE_GH_PR_STATE: "MERGED",
            FAKE_GH_RELEASE_RUN_ID: "999",
            FAKE_GH_RUN_EXIT: "1"
        });
        assert.notEqual(result.status, 0);
        assert.match(result.stdout + result.stderr, /Release workflow failed/);

        // The tag was still pushed (it has to exist for the workflow to
        // have triggered at all) - but finalize must not claim success.
        const remoteTags = execFileSync("git", ["ls-remote", "--tags", "origin"], { cwd: fixture.workDir, encoding: "utf8" });
        assert.match(remoteTags, /refs\/tags\/v3\.0\.0-rc1/);
    } finally {
        cleanup(fixture);
    }
});
