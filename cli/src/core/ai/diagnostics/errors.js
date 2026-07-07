// Provider-specific error diagnosis: turns a generic AIProviderError into
// a human-readable explanation with a specific recovery command. Every
// failure message includes exactly what went wrong and what to do next.
import { envVarForProvider } from "../providers/index.js";
import { providerLabel } from "../credentials/manager.js";

// diagnoseProviderError(providerId, error) -> { message, recovery, isKey, isServer, isNetwork }
export function diagnoseProviderError(providerId, error) {
    const label = providerLabel(providerId);
    const msg = error?.message || String(error);
    const status = extractHttpStatus(msg);
    const code = error?.code;

    // --- Key-related errors ---
    if (status === 401 || status === 403 || code === "auth_error") {
        return {
            message: `Authentication failed. Your ${label} API key appears invalid or expired.`,
            recovery: `devforgekit ai key add ${providerId}`,
            isKey: true,
            isServer: false,
            isNetwork: false
        };
    }

    // --- Rate limit / quota / billing ---
    if (status === 429) {
        return {
            message: `Your ${label} request was rate-limited. You may have exceeded your quota or your account has insufficient credits.`,
            recovery: `Check your ${label} account usage, or wait and retry. Run 'devforgekit ai key test ${providerId}' to verify.`,
            isKey: false,
            isServer: false,
            isNetwork: false
        };
    }

    // --- Server errors ---
    if (status >= 500) {
        return {
            message: `${label}'s servers returned an error (HTTP ${status}). This is a provider-side issue, not a problem with your configuration.`,
            recovery: `Retry in a few minutes. If the problem persists, check ${label}'s status page.`,
            isKey: false,
            isServer: true,
            isNetwork: false
        };
    }

    // --- Network errors (connection refused, timeout, DNS) ---
    if (code === "http_error" && !status) {
        if (providerId === "ollama") {
            return {
                message: "Ollama is not running. DevForgeKit cannot connect to the local Ollama server.",
                recovery: "Start it with 'ollama serve', then run 'devforgekit ai key test ollama'.",
                isKey: false,
                isServer: false,
                isNetwork: true
            };
        }
        if (providerId === "lmstudio") {
            return {
                message: "LM Studio server is not running. DevForgeKit cannot connect to the local LM Studio server.",
                recovery: "Start the LM Studio server (Developer tab → Start Server), then run 'devforgekit ai key test lmstudio'.",
                isKey: false,
                isServer: false,
                isNetwork: true
            };
        }
        return {
            message: `Cannot connect to ${label}. There may be a network issue or the endpoint is unreachable.`,
            recovery: `Check your network connection. Run 'devforgekit ai key test ${providerId}' to diagnose.`,
            isKey: false,
            isServer: false,
            isNetwork: true
        };
    }

    // --- Bad response ---
    if (code === "bad_response") {
        return {
            message: `${label} returned an unexpected response format. This may indicate an API version mismatch.`,
            recovery: `Try updating your model setting, or run 'devforgekit ai model list' to see available models.`,
            isKey: false,
            isServer: false,
            isNetwork: false
        };
    }

    // --- Generic fallback ---
    return {
        message: `${label} request failed: ${msg}`,
        recovery: `Run 'devforgekit ai key test ${providerId}' for a full diagnosis.`,
        isKey: false,
        isServer: false,
        isNetwork: false
    };
}

// diagnoseNotConfigured(providerId) -> { message, recovery }
export function diagnoseNotConfigured(providerId) {
    if (!providerId) {
        return {
            message: "No AI provider configured.",
            recovery: "Run 'devforgekit ai setup' to get started in under a minute."
        };
    }
    const label = providerLabel(providerId);
    const envVar = envVarForProvider(providerId);
    if (!envVar) {
        // Local provider (ollama/lmstudio) — no key needed, just needs the server running
        return {
            message: `${label} is configured but the server is not reachable.`,
            recovery: providerId === "ollama"
                ? "Start it with 'ollama serve', then run 'devforgekit ai key test ollama'."
                : "Start the LM Studio server, then run 'devforgekit ai key test lmstudio'."
        };
    }
    return {
        message: `${label} is configured but no API key was found.`,
        recovery: `Run 'devforgekit ai key add ${providerId}' to add your key, or set the ${envVar} environment variable.`
    };
}

function extractHttpStatus(msg) {
    const m = /HTTP (\d+)/.exec(msg);
    return m ? Number(m[1]) : null;
}
