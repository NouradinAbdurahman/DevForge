// Layered configuration loader (see docs/PlatformArchitecture.md section
// 7): defaults < repo .devforgekit.yml < user
// ~/.config/devforgekit/config.yaml < env vars (DEVFORGEKIT_*) < CLI
// flags (applied by callers, not here).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { repoRoot, userConfigDir } from "./paths.js";
import { DevForgeError } from "./errors.js";
import { getPlatform } from "./platform/index.js";

// Every field the v1.1.2 configuration system defines, plus `aiModel`/
// `aiEndpoint` (v1.3.0 - see core/ai/). `mirrors`, `registryUrl`, and
// `updateSchedule` are stored/settable today but not yet *consumed* by
// anything - no remote registry fetch or scheduler exists yet - stated
// here rather than left to look wired up when it isn't. `aiProvider`/
// `aiModel`/`aiEndpoint` ARE consumed now: `commands/ai.js` reads them as
// the default provider/model/endpoint when a command doesn't override
// them with an explicit flag.
// shell/packageManager below are resolved from the current platform
// adapter (see core/platform/) rather than hardcoded - "zsh"/"brew" are
// still what a fresh macOS machine gets by default (the only platform
// DevForgeKit actually drives today), but this keeps the one place that
// decision is made honest instead of assuming macOS everywhere `DEFAULTS`
// is read.
function platformDefaults() {
    const platform = getPlatform();
    return { shell: platform.defaultShell(), packageManager: platform.packageManagerId() || "unknown" };
}

const DEFAULTS = {
    editor: "vscode",
    ...platformDefaults(),
    fonts: [],
    browser: "chrome",
    aiProvider: "none",
    aiModel: null,
    aiEndpoint: null,
    aiFavoriteModels: [],
    aiRecentModels: [],
    defaultProfile: "minimal",
    updateSchedule: "manual",
    telemetry: false,
    mirrors: [],
    registryUrl: null,
    colorOutput: true,
    startupAnimation: true,
    startupAnimationSpeed: "normal",
    onboardingSeen: false,
    reducedMotion: false
};

function repoConfigPath() {
    return path.join(repoRoot(), ".devforgekit.yml");
}

function userConfigPath() {
    return path.join(userConfigDir(), "config.yaml");
}

function readYamlIfExists(filePath) {
    if (!existsSync(filePath)) return {};
    try {
        return yaml.load(readFileSync(filePath, "utf8")) || {};
    } catch (err) {
        throw new DevForgeError(`Invalid YAML in ${filePath}: ${err.message}`);
    }
}

function readEnvOverrides() {
    const overrides = {};
    const prefix = "DEVFORGEKIT_";
    for (const [key, value] of Object.entries(process.env)) {
        if (!key.startsWith(prefix)) continue;
        const configKey = key
            .slice(prefix.length)
            .toLowerCase()
            .replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
        overrides[configKey] = value;
    }
    // Layer 1's assume-yes env var is honored across both languages so a
    // single flag/env has the same meaning regardless of which layer
    // handles a given command.
    if (process.env.DEV_SETUP_ASSUME_YES === "1") {
        overrides.assumeYes = true;
    }
    return overrides;
}

// loadConfig() -> merged plain object, defaults through env vars (layers
// 1-4 of section 7; CLI flags are layer 5 and applied by the caller on
// top of this result, since they're per-command, not global).
export function loadConfig() {
    return {
        ...DEFAULTS,
        ...readYamlIfExists(repoConfigPath()),
        ...readYamlIfExists(userConfigPath()),
        ...readEnvOverrides()
    };
}

export function getConfigValue(key) {
    const config = loadConfig();
    return config[key];
}

export function setConfigValue(key, value) {
    const filePath = userConfigPath();
    mkdirSync(path.dirname(filePath), { recursive: true });
    const current = readYamlIfExists(filePath);
    current[key] = value;
    writeFileSync(filePath, yaml.dump(current));
    return current;
}

export function listConfig() {
    return loadConfig();
}
