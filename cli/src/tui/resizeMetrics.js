// Module-level resize metrics shared between index.js (which intercepts
// resize events at the emit level) and App.js's debug strip. This avoids
// prop-drilling or context overhead for what is a diagnostic-only concern.
//
// In production, index.js increments `events` on every raw resize event
// and `commits` when the debounce settles and the cleared frame is emitted.
// In tests (where index.js's emit interception isn't active), these stay
// at zero — the debug strip shows the hook's own `resizeCount` instead.
export const resizeMetrics = {
    events: 0,
    commits: 0,
    reset() {
        this.events = 0;
        this.commits = 0;
    }
};
