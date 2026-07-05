import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveInstallOrder } from "../src/core/installer.js";

const fixture = [
    { name: "java", dependencies: [] },
    { name: "android-studio", dependencies: ["java"] },
    { name: "dart", dependencies: [] },
    { name: "flutter", dependencies: ["dart", "android-studio"] },
    { name: "a", dependencies: ["b"] },
    { name: "b", dependencies: ["a"] }
];

test("dependencies are resolved before the component that needs them", () => {
    const order = resolveInstallOrder(["flutter"], { packages: fixture }).map((p) => p.name);
    assert.ok(order.indexOf("java") < order.indexOf("android-studio"));
    assert.ok(order.indexOf("android-studio") < order.indexOf("flutter"));
    assert.ok(order.indexOf("dart") < order.indexOf("flutter"));
});

test("a shared dependency is only installed once across multiple requested names", () => {
    const order = resolveInstallOrder(["android-studio", "flutter"], { packages: fixture }).map((p) => p.name);
    assert.equal(order.filter((n) => n === "java").length, 1);
    assert.equal(order.filter((n) => n === "android-studio").length, 1);
});

test("a dependency cycle throws a clear error instead of recursing forever", () => {
    assert.throws(
        () => resolveInstallOrder(["a"], { packages: fixture }),
        /Dependency cycle detected/
    );
});

test("an unknown dependency name throws a clear error", () => {
    assert.throws(
        () => resolveInstallOrder(["flutter"], { packages: [{ name: "flutter", dependencies: ["does-not-exist"] }] }),
        /Unknown component/
    );
});
