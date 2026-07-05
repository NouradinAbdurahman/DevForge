// Thin wrapper over `prompts` for consistent styling and a single place
// to handle Ctrl-C (the library resolves with `undefined` on cancel by
// default; we normalize that into an explicit null so callers don't have
// to special-case it themselves every time).
import prompts from "prompts";

const onCancel = () => {
    process.exitCode = 130; // matches shell's SIGINT convention
};

export async function select(message, choices) {
    const result = await prompts(
        { type: "select", name: "value", message, choices },
        { onCancel }
    );
    return result.value ?? null;
}

export async function multiselect(message, choices) {
    const result = await prompts(
        { type: "multiselect", name: "value", message, choices, instructions: false },
        { onCancel }
    );
    return result.value ?? null;
}

export async function confirm(message, initial = false) {
    const result = await prompts(
        { type: "confirm", name: "value", message, initial },
        { onCancel }
    );
    return result.value ?? false;
}

export async function text(message, initial = "") {
    const result = await prompts(
        { type: "text", name: "value", message, initial },
        { onCancel }
    );
    return result.value ?? null;
}
