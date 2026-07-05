#!/usr/bin/env node
import { createProgram } from "../src/index.js";

// `devforgekit` with no arguments opens the interactive dashboard
// (v1.2.3) when the terminal can actually host it; otherwise commander
// prints --help exactly as before. Any argument at all - including
// --help/--version - takes the classic command path unchanged.
if (process.argv.length <= 2) {
    const { isTuiCapable, launchDashboard } = await import("../src/tui/index.js");
    if (isTuiCapable()) {
        await launchDashboard();
        process.exit(process.exitCode ?? 0);
    }
}

const program = createProgram();
await program.parseAsync(process.argv);
