import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, detectDomain, getDomainPrompt, listDomainPrompts, knownPromptKinds } from "../src/core/ai/prompts/library.js";

test("detectDomain finds the first domain name mentioned in the input, case-insensitively", () => {
    assert.equal(detectDomain("My Docker build is failing"), "docker");
    assert.equal(detectDomain("nothing relevant here"), null);
});

test("getDomainPrompt/listDomainPrompts expose the 10 built-in domains from the PRD", () => {
    const domains = listDomainPrompts();
    for (const expected of ["flutter", "docker", "kubernetes", "python", "node", "react", "rust", "devops", "security", "databases"]) {
        assert.ok(domains.includes(expected), `expected domain '${expected}'`);
        assert.equal(typeof getDomainPrompt(expected), "string");
    }
    assert.equal(getDomainPrompt("not-a-domain"), null);
});

test("buildPrompt() returns a system message (with the context JSON embedded) followed by a user message", () => {
    const context = { cwd: "/tmp/project", git: { isRepo: true } };
    const messages = buildPrompt("chat", context, "hello");
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, "system");
    assert.ok(messages[0].content.includes("/tmp/project"));
    assert.equal(messages[1].role, "user");
    assert.equal(messages[1].content, "hello");
});

test("buildPrompt() layers in the relevant domain snippet when the input mentions one", () => {
    const messages = buildPrompt("explain", {}, "why is my flutter build failing");
    assert.match(messages[0].content, /Flutter\/Dart focus/);
});

test("buildPrompt() throws for an unknown prompt kind rather than silently falling back", () => {
    assert.throws(() => buildPrompt("not-a-real-kind", {}, ""), /Unknown AI prompt kind/);
});

test("every prompt kind the CLI actually registers has an instruction template", () => {
    const kinds = knownPromptKinds();
    for (const expected of ["chat", "doctor", "explain", "review", "generate", "analyze", "summarize", "optimize", "repair", "plan"]) {
        assert.ok(kinds.includes(expected), `expected prompt kind '${expected}'`);
    }
});

test("the doctor/generate/plan prompt kinds instruct the model to respond with strict JSON only", () => {
    for (const kind of ["doctor", "generate", "plan"]) {
        const messages = buildPrompt(kind, {}, "example input");
        assert.match(messages[1].content, /JSON object/);
        assert.match(messages[1].content, /no markdown fences/);
    }
});
