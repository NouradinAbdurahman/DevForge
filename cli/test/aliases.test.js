import { test } from "node:test";
import assert from "node:assert/strict";
import { createProgram } from "../src/index.js";

function findCommand(program, name) {
    return program.commands.find((c) => c.name() === name);
}

test("every documented top-level command is registered", () => {
    const program = createProgram();
    const names = program.commands.map((c) => c.name());
    for (const expected of [
        "install", "update", "backup", "restore", "check", "doctor",
        "validate", "inventory", "report", "services", "clean", "release",
        "preferences", "profile", "config", "component", "plugin"
    ]) {
        assert.ok(names.includes(expected), `expected '${expected}' to be a registered command, got: ${names.join(", ")}`);
    }
});

test("'bootstrap' is an alias for 'install'", () => {
    const program = createProgram();
    assert.ok(findCommand(program, "install").aliases().includes("bootstrap"));
});

test("'cleanup' is an alias for 'clean'", () => {
    const program = createProgram();
    assert.ok(findCommand(program, "clean").aliases().includes("cleanup"));
});

test("'prefs' is an alias for 'preferences'", () => {
    const program = createProgram();
    assert.ok(findCommand(program, "preferences").aliases().includes("prefs"));
});

test("the hello-world plugin registers its 'hello' command hook", () => {
    const program = createProgram();
    assert.ok(findCommand(program, "hello"), "expected the plugin-registered 'hello' command");
});
