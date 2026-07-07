// Reduced-motion preference (v2.0.5): a dedicated, single-purpose
// context - the same pattern useTerminalSize.js already established -
// rather than threading this through the full store.js reducer. Motion
// preference and app state are different concerns updated by different
// triggers (a config file read at launch vs. user actions), and
// components/ui.js's presentational components (Spinner) deliberately
// have zero dependency on store.js today; adding one just for this
// would break that separation for every consumer of ui.js, not just
// the one component that needs it.
//
// Read once at launch, like `startupAnimationSpeed` already is (see
// tui/startup/startupAnimation.js) - toggling it on the Configuration
// page takes effect on the next launch, not live. That's consistent
// with this codebase's existing precedent for animation-related
// settings, not a shortcut unique to this flag.
import React, { createContext, useContext } from "react";
import { loadConfig } from "../../core/config.js";

const h = React.createElement;
const ReducedMotionContext = createContext(false);

function readReducedMotion() {
    try {
        return loadConfig().reducedMotion === true;
    } catch {
        // An unreadable config file must not stop the dashboard from
        // launching - fall back to full motion (the existing default
        // experience) rather than guessing.
        return false;
    }
}

export function ReducedMotionProvider({ children }) {
    return h(ReducedMotionContext.Provider, { value: readReducedMotion() }, children);
}

export function useReducedMotion() {
    return useContext(ReducedMotionContext);
}
