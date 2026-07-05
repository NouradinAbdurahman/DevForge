import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGroupedChoices } from "../src/commands/component.js";

const categories = [
    { id: "languages", label: "Languages", description: "x" },
    { id: "cloud", label: "Cloud", description: "x" }
];
const packages = [
    { name: "node", description: "JS runtime", category: "languages" },
    { name: "python", description: "Python runtime", category: "languages" },
    { name: "aws-cli", description: "AWS CLI", category: "cloud" }
];

test("grouped choices place a disabled heading before each category's components", () => {
    const choices = buildGroupedChoices(packages, categories);

    const languagesHeadingIndex = choices.findIndex((c) => c.disabled && c.title.includes("Languages"));
    const cloudHeadingIndex = choices.findIndex((c) => c.disabled && c.title.includes("Cloud"));
    assert.ok(languagesHeadingIndex >= 0, "expected a disabled Languages heading");
    assert.ok(cloudHeadingIndex >= 0, "expected a disabled Cloud heading");

    const nodeIndex = choices.findIndex((c) => c.value === "node");
    const pythonIndex = choices.findIndex((c) => c.value === "python");
    const awsIndex = choices.findIndex((c) => c.value === "aws-cli");

    assert.ok(languagesHeadingIndex < nodeIndex && nodeIndex < cloudHeadingIndex);
    assert.ok(languagesHeadingIndex < pythonIndex && pythonIndex < cloudHeadingIndex);
    assert.ok(cloudHeadingIndex < awsIndex);
});

test("every real component appears exactly once as a selectable choice", () => {
    const choices = buildGroupedChoices(packages, categories);
    const selectable = choices.filter((c) => !c.disabled);
    assert.equal(selectable.length, packages.length);
    for (const pkg of packages) {
        assert.equal(selectable.filter((c) => c.value === pkg.name).length, 1);
    }
});
