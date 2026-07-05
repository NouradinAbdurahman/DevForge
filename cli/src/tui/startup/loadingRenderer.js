// Step 5 of the startup sequence: a small boot checklist tied to real
// initialization work (registry, plugins, workspace store...), not a
// fabricated timer. Every task's `run()` starts immediately and in
// parallel; the checklist just reflects how far each one has actually
// gotten. If every task has already settled by the time the first
// frame paints, every line renders checked on that first frame - "no
// fake delays" per the PRD.
import { writeFrame, paint, sleep } from "./transition.js";

// formatLoadingLine(label, done, theme) -> one themed line, pending
// ("… Loading registry") or complete ("✓ Loading registry").
export function formatLoadingLine(label, done, theme) {
    if (done) return paint(theme?.success, "✓ ") + paint(theme?.text, label);
    return paint(theme?.textMuted, "… " + label);
}

// runLoadingSequence({ tasks, theme, pollMs }) -> Promise<{label, error}[]>
// `tasks` is [{ label, run() }] - `run` may be sync or async and is
// invoked exactly once, immediately. Resolves once every task has
// settled (success or failure); a failing task is recorded but never
// blocks the rest of the checklist from completing.
export async function runLoadingSequence({ tasks, theme, pollMs = 30, write = writeFrame }) {
    const state = tasks.map((task) => ({ label: task.label, done: false, error: null }));

    const settle = tasks.map((task, i) =>
        Promise.resolve()
            .then(() => task.run())
            .catch((err) => { state[i].error = err; })
            .finally(() => { state[i].done = true; })
    );

    const allSettled = Promise.all(settle);
    let finished = false;
    allSettled.then(() => { finished = true; });

    const render = () => write(state.map((s) => formatLoadingLine(s.label, s.done, theme)));

    render();
    while (!finished) {
        await Promise.race([sleep(pollMs), allSettled]);
        render();
    }
    return state;
}
