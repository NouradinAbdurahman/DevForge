import { test } from "node:test";
import assert from "node:assert/strict";
import {
    componentInstallStats, diskFreeGb, outdatedPackages,
    osInfo, hardwareInfo, memoryGb, diskUsage, uptimeString, softwareUpdateStatus
} from "../src/commands/stats.js";

const isMacOS = process.platform === "darwin";
const macOnly = isMacOS ? test : test.skip;

test("componentInstallStats returns a PASS/WARNING entry for every validate-able package", async () => {
    const results = await componentInstallStats();
    assert.ok(results.length > 0);
    for (const entry of results) {
        assert.ok(["PASS", "WARNING"].includes(entry.status));
        assert.ok(typeof entry.name === "string");
    }
});

test("diskFreeGb returns a real, positive number of free gigabytes", async () => {
    const gb = await diskFreeGb();
    assert.ok(Number.isFinite(gb));
    assert.ok(gb >= 0);
});

test("outdatedPackages returns an array (possibly empty) of package names", async () => {
    const outdated = await outdatedPackages();
    assert.ok(Array.isArray(outdated));
});

// --- Device probes (Dashboard's "Device" panel) - real, live values
// from this machine, never fabricated. -----------------------------

macOnly("osInfo reports a real macOS name/version/build from sw_vers", async () => {
    const info = await osInfo();
    assert.equal(typeof info.name, "string");
    assert.ok(info.name.length > 0);
    assert.match(info.version, /^\d+(\.\d+)*$/, `version should look like a real macOS version, got '${info.version}'`);
    assert.notEqual(info.build, "unknown");
});

macOnly("hardwareInfo reports a real model and chip/processor from system_profiler", async () => {
    const info = await hardwareInfo();
    assert.notEqual(info.model, "unknown");
    assert.notEqual(info.chip, "unknown");
});

macOnly("memoryGb returns a real, positive, plausible amount of installed RAM", async () => {
    const gb = await memoryGb();
    assert.ok(Number.isFinite(gb));
    assert.ok(gb > 0 && gb <= 1024, `memoryGb() = ${gb} is outside a plausible range`);
});

test("diskUsage returns real, internally-consistent whole-device storage numbers", async () => {
    const usage = await diskUsage();
    assert.ok(usage.totalGb > 0);
    assert.ok(usage.usedGb >= 0);
    assert.ok(usage.freeGb >= 0);
    assert.ok(usage.usedPercent >= 0 && usage.usedPercent <= 100);
    // used + free should roughly reconcile to total (allowing for
    // filesystem-reserved blocks df excludes from either column).
    assert.ok(Math.abs((usage.usedGb + usage.freeGb) - usage.totalGb) <= Math.max(2, usage.totalGb * 0.05));
});

test("uptimeString returns the real, non-empty output of `uptime`", async () => {
    const line = await uptimeString();
    assert.ok(line.length > 0);
    assert.match(line, /up/i);
});

test("softwareUpdateStatus reports a real, honest result - never a fabricated verdict", async () => {
    const result = await softwareUpdateStatus();
    if (result.checked) {
        assert.equal(typeof result.upToDate, "boolean");
        assert.ok(Array.isArray(result.updates));
        assert.equal(result.error, null);
    } else {
        // Timed out / errored / unparseable output - honest failure,
        // never a guessed upToDate value.
        assert.equal(result.upToDate, null);
        assert.equal(typeof result.error, "string");
    }
}, { timeout: 25000 });
