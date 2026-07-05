// Terminal emulator detection for the TUI. Different terminals have
// subtly different resize behavior, color support, and alternate screen
// handling. This module detects the current emulator from environment
// variables and provides diagnostics for the debug strip.
//
// Detection is based on standard environment variables:
// - TERM_PROGRAM: set by iTerm2, VS Code, Ghostty, Warp, Kitty, WezTerm
// - TERM: set by tmux, screen, and others
// - SSH_CONNECTION/SSH_CLIENT: set when connected via SSH
//
// This is best-effort - detection is not guaranteed to be correct in
// every environment, but it covers the terminals listed in the PRD.

export function detectTerminal() {
    const termProgram = process.env.TERM_PROGRAM;
    const term = process.env.TERM || "";
    const sshConn = process.env.SSH_CONNECTION || process.env.SSH_CLIENT;

    // SSH takes precedence - even if TERM_PROGRAM is set locally, the
    // actual terminal is the one on the remote end.
    if (sshConn) {
        // But check if we're inside tmux/screen over SSH
        if (term.startsWith("tmux")) return "tmux-over-ssh";
        if (term.startsWith("screen")) return "screen-over-ssh";
        return "ssh";
    }

    // Check TERM_PROGRAM first - most modern terminals set it.
    if (termProgram) {
        const map = {
            "iTerm.app": "iTerm2",
            "vscode": "VS Code",
            "ghostty": "Ghostty",
            "WarpTerminal": "Warp",
            "kitty": "Kitty",
            "WezTerm": "WezTerm",
            "Apple_Terminal": "Apple Terminal",
            "Hyper": "Hyper"
        };
        if (map[termProgram]) return map[termProgram];
        return termProgram;
    }

    // Check TERM for multiplexers.
    if (term.startsWith("tmux")) return "tmux";
    if (term.startsWith("screen")) return "screen";

    // Check for Cursor IDE terminal (sets COLORTERM but not TERM_PROGRAM
    // in some versions).
    if (process.env.TERM === "xterm-256color" && process.env.COLORTERM === "truecolor" && !termProgram) {
        // Can't reliably distinguish Cursor from other truecolor xterms;
        // don't guess.
    }

    // Fallback: unknown but capable.
    return "terminal";
}

// One-line diagnostics string for the debug strip.
export function terminalDiagnostics() {
    const emulator = detectTerminal();
    const altScreen = process.stdout.write ? "alt" : "main";
    const rawMode = process.stdin.isRaw ? "raw" : "cooked";
    return `${emulator} · ${altScreen} · ${rawMode}`;
}

// Check if the current terminal supports true color (24-bit).
export function supportsTrueColor() {
    return process.env.COLORTERM === "truecolor" || process.env.COLORTERM === "24bit";
}

// Check if the current terminal is a multiplexer (tmux/screen).
export function isMultiplexer() {
    const term = process.env.TERM || "";
    return term.startsWith("tmux") || term.startsWith("screen");
}

// Check if we're connected via SSH.
export function isSSH() {
    return Boolean(process.env.SSH_CONNECTION || process.env.SSH_CLIENT);
}
