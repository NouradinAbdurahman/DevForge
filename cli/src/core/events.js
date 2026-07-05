// The plugin event bus (see docs/PlatformArchitecture.md's Plugin API
// section): a single process-wide EventEmitter that core operations
// publish to, and that core/plugins.js subscribes discovered plugins'
// `events` hooks to. New event names are additive - emitting one nobody
// has hooked yet is a silent no-op, so adding events never breaks
// existing plugins.
import { EventEmitter } from "node:events";

export const pluginEvents = new EventEmitter();

// emitInstallEvent("before"|"after", payload) - the two events
// core/installer.js's installPlan() fires around every package it
// processes: `install.beforeInstall` ({ name, category }) and
// `install.afterInstall` ({ name, category, status, code, durationMs }).
export function emitInstallEvent(phase, payload) {
    pluginEvents.emit(`install.${phase === "before" ? "beforeInstall" : "afterInstall"}`, payload);
}
