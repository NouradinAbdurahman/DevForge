// Direct unit tests for store.js's pure reducer - faster and more
// precise than driving a full Ink render for logic that doesn't touch
// rendering at all (toast dedup, which flags reset on which actions).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { reducer, initialState } from "../src/tui/store.js";

function withTempHome() {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-store-test-"));
    process.env.HOME = tempHome;
    return () => {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    };
}

test("notify pushes a toast and a notification/log entry", () => {
    const restore = withTempHome();
    try {
        const state = initialState({});
        const next = reducer(state, { type: "notify", message: "Flutter installed", level: "success" });
        assert.equal(next.toasts.length, 1);
        assert.equal(next.toasts[0].message, "Flutter installed");
        assert.equal(next.notifications.length, 1);
        assert.equal(next.logs.length, 1);
    } finally {
        restore();
    }
});

test("notify dedupes a toast identical (message+level) to the newest queued one", () => {
    const restore = withTempHome();
    try {
        let state = initialState({});
        state = reducer(state, { type: "notify", message: "Still waiting...", level: "info" });
        state = reducer(state, { type: "notify", message: "Still waiting...", level: "info" });
        state = reducer(state, { type: "notify", message: "Still waiting...", level: "info" });
        assert.equal(state.toasts.length, 1, "repeated identical toasts should not queue duplicates");
        // History still records every event, even repeats.
        assert.equal(state.notifications.length, 3);
        assert.equal(state.logs.length, 3);
    } finally {
        restore();
    }
});

test("notify does NOT dedupe when the level differs, even with the same message", () => {
    const restore = withTempHome();
    try {
        let state = initialState({});
        state = reducer(state, { type: "notify", message: "Snapshot failed", level: "error" });
        state = reducer(state, { type: "notify", message: "Snapshot failed", level: "warning" });
        assert.equal(state.toasts.length, 2);
    } finally {
        restore();
    }
});

test("notify does NOT dedupe against an older (non-newest) queued toast", () => {
    const restore = withTempHome();
    try {
        let state = initialState({});
        state = reducer(state, { type: "notify", message: "A", level: "info" });
        state = reducer(state, { type: "notify", message: "B", level: "info" });
        state = reducer(state, { type: "notify", message: "A", level: "info" }); // not adjacent to the first "A"
        assert.equal(state.toasts.length, 3);
    } finally {
        restore();
    }
});

test("dismissToast removes exactly the toast with the given id", () => {
    const restore = withTempHome();
    try {
        let state = initialState({});
        state = reducer(state, { type: "notify", message: "one", level: "info" });
        state = reducer(state, { type: "notify", message: "two", level: "info" });
        const idToRemove = state.toasts[0].id;
        state = reducer(state, { type: "dismissToast", id: idToRemove });
        assert.equal(state.toasts.length, 1);
        assert.equal(state.toasts[0].message, "two");
    } finally {
        restore();
    }
});

test("navigate resets searchOpen and paletteOpen, and sets focus to content", () => {
    const restore = withTempHome();
    try {
        let state = initialState({});
        state = reducer(state, { type: "openSearch" });
        state = reducer(state, { type: "navigate", page: "components" });
        assert.equal(state.page, "components");
        assert.equal(state.focus, "content");
        assert.equal(state.searchOpen, false);
        assert.equal(state.paletteOpen, false);
    } finally {
        restore();
    }
});

test("openPalette/closePalette toggle paletteOpen and typing together", () => {
    const restore = withTempHome();
    try {
        let state = initialState({});
        state = reducer(state, { type: "openPalette" });
        assert.equal(state.paletteOpen, true);
        assert.equal(state.typing, true);
        state = reducer(state, { type: "closePalette" });
        assert.equal(state.paletteOpen, false);
        assert.equal(state.typing, false);
    } finally {
        restore();
    }
});

test("an unknown action type is a no-op (returns the same state)", () => {
    const restore = withTempHome();
    try {
        const state = initialState({});
        const next = reducer(state, { type: "not-a-real-action" });
        assert.equal(next, state);
    } finally {
        restore();
    }
});
