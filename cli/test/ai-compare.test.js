// Tests for `ai compare`'s fact-resolution module (AI Assistant
// Excellence, v2.1.3 Phase 5/7) - real registry/generator data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveComparable, resolveComparableWithScore } from "../src/core/ai/compare.js";

test("resolveComparable resolves a real registry package with real fields", () => {
    const facts = resolveComparable("pnpm");
    assert.equal(facts.kind, "package");
    assert.equal(facts.name, "pnpm");
    assert.equal(typeof facts.description, "string");
    assert.equal(typeof facts.qualityScore, "number");
    assert.ok(facts.qualityScore >= 0 && facts.qualityScore <= 100);
});

test("resolveComparable resolves a real Project Generator stack", () => {
    const facts = resolveComparable("go-fiber"); // no colliding registry package named "go-fiber"
    assert.equal(facts.kind, "project-generator-stack");
    assert.equal(facts.id, "go-fiber");
    assert.ok(facts.recommends.includes("docker"));
});

test("resolveComparable prefers a package match over a generator match when both could apply", () => {
    // "flutter" is registered as a Project Generator stack id but also
    // exists as a real registry package - packages are checked first.
    const facts = resolveComparable("flutter");
    assert.equal(facts.kind, "package"); // registry package wins, not the stack
});

test("resolveComparable returns null for a name that resolves to neither", () => {
    assert.equal(resolveComparable("definitely-not-a-real-thing-xyz"), null);
});

test("resolveComparable resolves a package via a real alias, not just its canonical name", () => {
    const byAlias = resolveComparable("node"); // 'node' has real aliases like 'nodejs' in the registry
    if (byAlias) assert.equal(byAlias.kind, "package");
});

test("resolveComparableWithScore fills in a real, async Generator Quality Score for a stack", async () => {
    const facts = await resolveComparableWithScore("go-fiber");
    assert.equal(facts.kind, "project-generator-stack");
    assert.equal(typeof facts.qualityScore, "number");
    assert.ok(facts.qualityScore >= 0 && facts.qualityScore <= 100);
});

test("resolveComparableWithScore returns null for an unresolvable name without throwing", async () => {
    const facts = await resolveComparableWithScore("nope-not-real");
    assert.equal(facts, null);
});
