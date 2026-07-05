import js from "@eslint/js";

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "module",
            globals: {
                process: "readonly",
                console: "readonly",
                URL: "readonly",
                __dirname: "readonly",
                fetch: "readonly",
                AbortController: "readonly",
                TextDecoder: "readonly",
                TextEncoder: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                setImmediate: "readonly",
                Buffer: "readonly",
                performance: "readonly",
                global: "readonly"
            }
        },
        rules: {
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }]
        }
    },
    {
        ignores: ["node_modules/**", "coverage/**"]
    }
];
