// Low-level terminal primitives for the startup sequence: raw ANSI
// writes and theme-token-to-color painting. Deliberately not Ink -
// the animation runs before the dashboard's React tree exists, so it
// talks to the terminal directly the same way tui/index.js already
// does for the alternate screen buffer.
import chalk from "chalk";

export const HIDE_CURSOR = "\x1b[?25l";
export const SHOW_CURSOR = "\x1b[?25h";
export const CURSOR_HOME = "\x1b[H";
// Clear from the cursor to the end of the screen - repaints each frame
// in place without a full blank-then-redraw flash, and (being inside
// the alt screen already) never touches real scrollback.
export const CLEAR_DOWN = "\x1b[0J";

export function hideCursor() {
    process.stdout.write(HIDE_CURSOR);
}

export function showCursor() {
    process.stdout.write(SHOW_CURSOR);
}

// writeFrame(lines) - paints one animation frame: home the cursor,
// write the lines, then clear anything left over from a longer
// previous frame.
export function writeFrame(lines) {
    process.stdout.write(CURSOR_HOME + lines.join("\r\n") + "\r\n" + CLEAR_DOWN);
}

export function clearFrame() {
    process.stdout.write(CURSOR_HOME + CLEAR_DOWN);
}

// paint(color, text) - applies a theme color token's value (a hex
// string like "#7aa2f7" or a named ANSI color like "cyan") to text.
// Falls back to plain text for anything chalk doesn't recognize
// (e.g. `undefined`, meaning "terminal default") rather than throwing.
export function paint(color, text) {
    if (!color) return text;
    if (color.startsWith("#")) return chalk.hex(color)(text);
    if (typeof chalk[color] === "function") return chalk[color](text);
    return text;
}

export function bold(text) {
    return chalk.bold(text);
}

export function dim(text) {
    return chalk.dim(text);
}

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
