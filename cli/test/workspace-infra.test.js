import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { commandExists } from "../src/core/shell.js";
import { listDockerContexts, captureDockerContext, applyWorkspaceDocker } from "../src/core/workspace/docker.js";
import { listKubeContexts, captureKubeContext, applyWorkspaceKubernetes } from "../src/core/workspace/kubernetes.js";
import { applyWorkspaceCloud, cloudEnvVars, REAL_SWITCH_PROVIDERS, SUPPLEMENTARY_ENV_VARS } from "../src/core/workspace/cloud.js";

// docker/kubectl may genuinely be installed on the machine running these
// tests - HOME is pointed at a scratch directory so `docker context ls`/
// `kubectl config get-contexts` (both HOME-relative: ~/.docker,
// ~/.kube) see an empty, isolated config rather than the developer's
// real contexts. No mutating command (`docker context use`/`kubectl
// config use-context`) is ever reachable in these tests without first
// creating a matching context *inside* that isolated HOME, so the
// developer's real docker/kubectl state is never touched.
async function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-workspace-infra-test-"));
    process.env.HOME = tempHome;
    try {
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

test("applyWorkspaceDocker is a safe no-op when no context is declared", async () => {
    await withTempHome(async () => {
        const result = await applyWorkspaceDocker({ docker: {} });
        assert.deepEqual(result, { applied: false, reason: "No docker context declared for this workspace" });
    });
});

test("applyWorkspaceDocker never mutates anything for a context that doesn't exist locally", async () => {
    await withTempHome(async () => {
        if (!(await commandExists("docker"))) return; // nothing to exercise on a machine without docker
        const before = await captureDockerContext();
        const result = await applyWorkspaceDocker({ docker: { context: "totally-fake-ctx-12345" } });
        assert.equal(result.applied, false);
        assert.match(result.reason, /does not exist locally/);
        assert.equal(await captureDockerContext(), before);
    });
});

test("listDockerContexts/listKubeContexts degrade to [] rather than throwing when unavailable/unconfigured", async () => {
    await withTempHome(async () => {
        assert.ok(Array.isArray(await listDockerContexts()));
        assert.ok(Array.isArray(await listKubeContexts()));
    });
});

test("applyWorkspaceKubernetes is a safe no-op when no context is declared", async () => {
    await withTempHome(async () => {
        const result = await applyWorkspaceKubernetes({ kubernetes: {} });
        assert.deepEqual(result, { applied: false, reason: "No kubernetes context declared for this workspace" });
    });
});

test("applyWorkspaceKubernetes never mutates anything for a context that doesn't exist locally", async () => {
    await withTempHome(async () => {
        if (!(await commandExists("kubectl"))) return;
        const before = await captureKubeContext();
        const result = await applyWorkspaceKubernetes({ kubernetes: { context: "totally-fake-ctx-12345", namespace: "acme" } });
        assert.equal(result.applied, false);
        assert.match(result.reason, /does not exist locally/);
        assert.equal(await captureKubeContext(), before);
    });
});

test("cloudEnvVars only exports the documented, real env vars (AWS_PROFILE, GOOGLE_CLOUD_PROJECT)", () => {
    const vars = cloudEnvVars({
        cloud: {
            aws: { ref: "acme-prod" }, gcp: { ref: "acme-gcp" }, azure: { ref: "Acme Sub" },
            firebase: { ref: "acme-fb" }, vercel: { ref: null }
        }
    });
    assert.deepEqual(vars, { AWS_PROFILE: "acme-prod", GOOGLE_CLOUD_PROJECT: "acme-gcp" });
    assert.deepEqual(Object.keys(SUPPLEMENTARY_ENV_VARS).sort(), ["aws", "gcp"]);
});

test("applyWorkspaceCloud only ever shells out for gcp/azure; every other provider is reported reference-only", async () => {
    await withTempHome(async () => {
        const results = await applyWorkspaceCloud({
            cloud: {
                aws: { ref: "acme-prod" },
                gcp: { ref: "acme-gcp-config" },
                azure: { ref: "Acme Subscription" },
                firebase: { ref: "acme-fb" },
                vercel: { ref: null }
            }
        });

        assert.deepEqual(REAL_SWITCH_PROVIDERS, ["gcp", "azure"]);
        const byProvider = Object.fromEntries(results.map((r) => [r.provider, r]));

        assert.equal(byProvider.aws.applied, false);
        assert.match(byProvider.aws.reason, /reference-only/);
        assert.equal(byProvider.firebase.applied, false);
        assert.match(byProvider.firebase.reason, /reference-only/);
        assert.ok(!("vercel" in byProvider), "a provider with no ref set should not appear at all");

        // gcp/azure are only ever reported not-applied here because the
        // CLI is missing or the config/subscription doesn't exist locally
        // - never silently skipped, and never actually mutated.
        assert.equal(byProvider.gcp.applied, false);
        assert.equal(byProvider.azure.applied, false);
    });
});
