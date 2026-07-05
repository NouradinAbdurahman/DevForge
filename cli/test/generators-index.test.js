import { test } from "node:test";
import assert from "node:assert/strict";
import { GENERATORS, listGenerators, getGenerator } from "../src/generators/index.js";

test("at least the 16 documented stacks are registered, each with the required fields", () => {
    assert.ok(listGenerators().length >= 16);
    for (const g of GENERATORS) {
        assert.ok(g.id && /^[a-z][a-z0-9-]*$/.test(g.id), `bad id: ${g.id}`);
        assert.ok(g.label, `${g.id} missing label`);
        assert.ok(g.description, `${g.id} missing description`);
        assert.ok(g.generate || g.scaffold, `${g.id} must define generate and/or scaffold`);
    }
});

test("every generator id is unique", () => {
    const ids = GENERATORS.map((g) => g.id);
    assert.equal(new Set(ids).size, ids.length);
});

test("getGenerator resolves a known stack by id", () => {
    assert.equal(getGenerator("nextjs")?.label, "Next.js");
    assert.equal(getGenerator("express")?.label, "Express");
    assert.equal(getGenerator("flutter")?.label, "Flutter");
});

test("getGenerator returns undefined for an unknown stack", () => {
    assert.equal(getGenerator("does-not-exist"), undefined);
});

test("every generator declaring requiresTool has both a command and a hint", () => {
    for (const g of GENERATORS) {
        if (!g.requiresTool) continue;
        assert.ok(g.requiresTool.command, `${g.id}: requiresTool.command missing`);
        assert.ok(g.requiresTool.hint, `${g.id}: requiresTool.hint missing`);
    }
});
