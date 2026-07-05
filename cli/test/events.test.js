import { test } from "node:test";
import assert from "node:assert/strict";
import { pluginEvents, emitInstallEvent } from "../src/core/events.js";
import { installPlan } from "../src/core/installer.js";

test("emitInstallEvent fires install.beforeInstall/afterInstall with the given payload", () => {
    const seen = [];
    const before = (payload) => seen.push(["before", payload]);
    const after = (payload) => seen.push(["after", payload]);
    pluginEvents.on("install.beforeInstall", before);
    pluginEvents.on("install.afterInstall", after);

    try {
        emitInstallEvent("before", { name: "widget" });
        emitInstallEvent("after", { name: "widget", status: "installed" });
    } finally {
        pluginEvents.off("install.beforeInstall", before);
        pluginEvents.off("install.afterInstall", after);
    }

    assert.deepEqual(seen, [
        ["before", { name: "widget" }],
        ["after", { name: "widget", status: "installed" }]
    ]);
});

test("installPlan emits real before/after events for each fixture package it processes", async () => {
    const seen = [];
    const before = (payload) => seen.push(["before", payload.name]);
    const after = (payload) => seen.push(["after", payload.name, payload.status]);
    pluginEvents.on("install.beforeInstall", before);
    pluginEvents.on("install.afterInstall", after);

    const fixturePackages = [
        { name: "already-satisfied", install: { method: "shell", command: "true" }, validate: "true" },
        { name: "freshly-installed", install: { method: "shell", command: "true" } }
    ];

    try {
        await installPlan(["already-satisfied", "freshly-installed"], { packages: fixturePackages });
    } finally {
        pluginEvents.off("install.beforeInstall", before);
        pluginEvents.off("install.afterInstall", after);
    }

    // "already-satisfied" is skipped (validate already passes) - no
    // install event fires for it, only for the one actually installed.
    assert.deepEqual(seen, [
        ["before", "freshly-installed"],
        ["after", "freshly-installed", "installed"]
    ]);
});
