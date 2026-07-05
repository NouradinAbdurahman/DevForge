import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDependencyGraph, detectCycles, detectDuplicateTools } from "../src/core/compatibility/graph.js";

test("buildDependencyGraph walks `dependencies` edges and reports a missing one", () => {
    const packages = [
        { name: "a", dependencies: ["b"] },
        { name: "b", dependencies: ["c"] }
    ];
    const { nodes, edges, missing } = buildDependencyGraph(["a"], { packages });
    assert.deepEqual(nodes.sort(), ["a", "b", "c"]);
    assert.deepEqual(edges, [{ from: "a", to: "b", type: "dependency" }, { from: "b", to: "c", type: "dependency" }]);
    assert.deepEqual(missing, ["c"]);
});

test("detectCycles finds a direct and an indirect cycle without infinite-looping", () => {
    const direct = [{ name: "a", dependencies: ["b"] }, { name: "b", dependencies: ["a"] }];
    assert.equal(detectCycles(["a"], { packages: direct }).length, 1);

    const indirect = [
        { name: "a", dependencies: ["b"] },
        { name: "b", dependencies: ["c"] },
        { name: "c", dependencies: ["a"] }
    ];
    const cycles = detectCycles(["a"], { packages: indirect });
    assert.equal(cycles.length, 1);
    assert.equal(cycles[0][0], cycles[0][cycles[0].length - 1]);
});

test("detectCycles reports nothing for a clean, acyclic dependency chain", () => {
    const packages = [{ name: "a", dependencies: ["b"] }, { name: "b", dependencies: [] }];
    assert.deepEqual(detectCycles(["a"], { packages }), []);
});

test("detectDuplicateTools flags two packages claiming the same name/alias, and is clean otherwise", () => {
    const clashing = [
        { name: "gcc", aliases: ["cc"] },
        { name: "clang", aliases: ["cc"] }
    ];
    const duplicates = detectDuplicateTools(clashing);
    assert.equal(duplicates.length, 1);
    assert.equal(duplicates[0].claim, "cc");
    assert.deepEqual(duplicates[0].owners.sort(), ["clang", "gcc"]);

    const clean = [{ name: "gcc", aliases: [] }, { name: "clang", aliases: [] }];
    assert.deepEqual(detectDuplicateTools(clean), []);
});
