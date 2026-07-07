// The generator registry - one entry per supported stack (v1.2.2, see
// docs/ProjectGenerator.md). Adding a new stack means adding one file
// under cli/src/generators/ implementing the shared contract (label,
// description, optional requiresTool/promptOptions/scaffold/generate/
// postGenerate/nextSteps - see core/projectGenerator.js) and one line
// here - nothing else needs to change.
import { flutterGenerator } from "./flutter.js";
import { nextjsGenerator } from "./nextjs.js";
import { sveltekitGenerator } from "./sveltekit.js";
import { expressGenerator } from "./express.js";
import { reactGenerator } from "./react.js";
import { reactNativeGenerator } from "./react-native.js";
import { expoGenerator } from "./expo.js";
import { nestjsGenerator } from "./nestjs.js";
import { fastapiGenerator } from "./fastapi.js";
import { djangoGenerator } from "./django.js";
import { laravelGenerator } from "./laravel.js";
import { springBootGenerator } from "./spring-boot.js";
import { aspnetGenerator } from "./aspnet.js";
import { goFiberGenerator } from "./go-fiber.js";
import { rustAxumGenerator } from "./rust-axum.js";
import { tauriGenerator } from "./tauri.js";
import { electronGenerator } from "./electron.js";

export const GENERATORS = [
    flutterGenerator,
    nextjsGenerator,
    sveltekitGenerator,
    expressGenerator,
    reactGenerator,
    reactNativeGenerator,
    expoGenerator,
    nestjsGenerator,
    fastapiGenerator,
    djangoGenerator,
    laravelGenerator,
    springBootGenerator,
    aspnetGenerator,
    goFiberGenerator,
    rustAxumGenerator,
    tauriGenerator,
    electronGenerator
];

export function listGenerators() {
    return GENERATORS;
}

export function getGenerator(id) {
    return GENERATORS.find((g) => g.id === id || g.aliases?.includes(id));
}
