// Step 2 of the startup sequence: a brief, subtle scattering of
// glowing dots before the logo draws itself. Kept pure/testable
// (buildParticleFrame) separately from the timer-driven animation loop
// (renderParticles) that actually writes frames to the terminal.
import { writeFrame, paint, sleep } from "./transition.js";

const GLYPHS = [".", "·", "∙", "•"];

// buildParticleFrame(width, height, density, rng) -> string[] of
// `height` lines, each `width` chars wide, with a sparse sprinkling of
// dot glyphs. `rng` is an injectable () => number in [0, 1) so tests
// can assert on deterministic output instead of real randomness.
export function buildParticleFrame(width, height, density = 0.02, rng = Math.random) {
    const lines = [];
    for (let y = 0; y < height; y++) {
        let line = "";
        for (let x = 0; x < width; x++) {
            line += rng() < density ? GLYPHS[Math.floor(rng() * GLYPHS.length)] : " ";
        }
        lines.push(line);
    }
    return lines;
}

// renderParticles({ theme, width, height, durationMs, frameMs, write }) ->
// Promise that resolves once `durationMs` of particle frames have been
// painted. Each frame is independently random, giving a soft
// "twinkle" rather than moving sprites - deliberately simple, this is
// a ~80ms brand moment, not a particle system. `write` is injectable
// (defaults to the real terminal writer) so tests can capture frames
// instead of stubbing the global process.stdout.
export async function renderParticles({ theme, width, height, durationMs = 80, frameMs = 40, rng = Math.random, write = writeFrame }) {
    const color = theme?.textMuted;
    const frames = Math.max(1, Math.round(durationMs / frameMs));
    for (let i = 0; i < frames; i++) {
        const lines = buildParticleFrame(width, height, 0.015, rng).map((line) => paint(color, line));
        write(lines);
        await sleep(frameMs);
    }
}
