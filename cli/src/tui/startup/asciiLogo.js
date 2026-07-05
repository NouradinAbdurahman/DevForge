// The DevForgeKit logo: a fixed, hand-supplied ASCII art block (not
// generated at runtime by a figlet library - this exact 8-row art is
// hardcoded here as a static asset, the same way any other brand
// asset would be checked into the repo) plus the tagline. Used by both
// the startup animation and the persistent DashboardHeader - the same
// module, not a lookalike copy - so the logo is pixel-identical in
// both places.
const LOGO_LINES = [
    "______          ______                   _   ___ _   ",
    "|  _  \\         |  ___|                 | | / (_) |  ",
    "| | | |_____   _| |_ ___  _ __ __ _  ___| |/ / _| |_ ",
    "| | | / _ \\ \\ / /  _/ _ \\| '__/ _` |/ _ \\    \\| | __|",
    "| |/ /  __/\\ V /| || (_) | | | (_| |  __/ |\\  \\ | |_ ",
    "|___/ \\___| \\_/ \\_| \\___/|_|  \\__, |\\___\\_| \\_/_|\\__|",
    "                               __/ |                 ",
    "                              |___/                  "
];

// LOGO_LEFT_MARGIN - the one left-margin value both the startup
// animation and the persistent DashboardHeader use, so the logo lands
// at the exact same column in both places (left-aligned, never
// centered, never re-computed per terminal width).
export const LOGO_LEFT_MARGIN = 2;

export const WORDMARK = "DevForgeKit";

// buildLogoLines() -> the 8 fixed rows of the ASCII logo, verbatim.
export function buildLogoLines() {
    return LOGO_LINES;
}

export const TAGLINES = [
    "Developer Environment Platform",
    "Build. Configure. Ship."
];

// pickTagline(seed) - deterministic when a seed is given (tests), random
// otherwise. Not meant to be cryptographically random - just enough
// variety to keep repeated launches from feeling identical.
export function pickTagline(seed = Math.random()) {
    const index = Math.floor(seed * TAGLINES.length) % TAGLINES.length;
    return TAGLINES[index];
}

// SESSION_TAGLINE - picked exactly once, at module load (Node caches
// the module instance, so every importer - the startup animation and
// the persistent DashboardHeader alike - sees the same value for the
// life of the process). This is what makes "the logo already on
// screen becomes the dashboard header" literally true for the
// tagline: it never changes out from under the user mid-session, only
// between separate launches of the CLI.
export const SESSION_TAGLINE = pickTagline();

// logoWidth() - the fixed column width of the logo, used by callers
// that need to lay it out (left margin, etc.) without re-rendering it
// first.
export function logoWidth() {
    return LOGO_LINES[0].length;
}
