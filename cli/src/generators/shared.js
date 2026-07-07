// Shared, stack-agnostic file content every generator in this directory
// composes from, so the MIT license text, .editorconfig, and
// .vscode/settings.json shape only exist in one place. Mirrors this
// repo's own root LICENSE/.editorconfig-equivalent conventions (see
// templates/*/LICENSE) rather than inventing a second style.
export function mitLicense(author = "Your Name", year = new Date().getFullYear()) {
    return `MIT License

Copyright (c) ${year} ${author}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

// apache2License(author, year) - the standard Apache-2.0 short-form
// notice most real-world projects actually ship in their LICENSE file
// (full legal text plus a project-specific NOTICE section), not a
// truncated summary.
function apache2License(author, year) {
    return `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

Copyright ${year} ${author}

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
`;
}

// gpl3License(author, year) - the FSF's own recommended short-form
// notice (see https://www.gnu.org/licenses/gpl-howto.html) rather than
// reproducing the full ~700-line GPLv3 text inline, which real GPL
// projects rarely embed verbatim in LICENSE either - they state the
// notice and point to the canonical text, exactly as the FSF suggests.
function gpl3License(author, year) {
    return `${author} - Copyright (C) ${year}

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. The full text is available at
<https://www.gnu.org/licenses/gpl-3.0.txt>.
`;
}

// licenseText(license, author, year) -> file content for a project's
// LICENSE file, or null for "none" (Project Generator Excellence,
// v2.1.2) - the one place license choice is resolved, so every
// generator gets the user's actual choice instead of 5 of them
// hardcoding MIT regardless of what was asked for.
export function licenseText(license, author = "Your Name", year = new Date().getFullYear()) {
    if (license === "apache-2.0") return apache2License(author, year);
    if (license === "gpl-3.0") return gpl3License(author, year);
    if (license === "none") return null;
    return mitLicense(author, year);
}

export const EDITORCONFIG = `root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.md]
trim_trailing_whitespace = false
`;

// vscodeSettings(extra) -> JSON string for .vscode/settings.json. Cursor
// reads the same .vscode/ directory a generated project ships (it's a
// VS Code fork), so one file serves both editors - unlike this repo's
// own root vscode//cursor/ pair, which are two independent global-editor
// configs, not something a generated end-user project needs to
// duplicate.
export function vscodeSettings(extra = {}) {
    return `${JSON.stringify({
        "editor.formatOnSave": true,
        "editor.codeActionsOnSave": { "source.fixAll": "explicit" },
        "files.insertFinalNewline": true,
        "files.trimTrailingWhitespace": true,
        ...extra
    }, null, 2)}\n`;
}

export function vscodeExtensions(recommendations) {
    return `${JSON.stringify({ recommendations }, null, 2)}\n`;
}

// readme(opts) -> Markdown string. Every generator's README follows the
// same shape (title, description, prerequisites, getting-started
// commands, project structure, scripts table) so switching stacks
// doesn't mean relearning a different doc layout.
export function readme({ name, description, prerequisites = [], gettingStarted = [], structure = [], scripts = [] }) {
    const lines = [`# ${name}`, "", description, ""];

    if (prerequisites.length > 0) {
        lines.push("## Prerequisites", "");
        for (const p of prerequisites) lines.push(`- ${p}`);
        lines.push("");
    }

    lines.push("## Getting started", "", "```bash");
    for (const c of gettingStarted) lines.push(c);
    lines.push("```", "");

    if (scripts.length > 0) {
        lines.push("## Scripts", "", "| Command | What it does |", "| --- | --- |");
        for (const [cmd, desc] of scripts) lines.push(`| \`${cmd}\` | ${desc} |`);
        lines.push("");
    }

    if (structure.length > 0) {
        lines.push("## Project structure", "", "```text");
        for (const s of structure) lines.push(s);
        lines.push("```", "");
    }

    lines.push(
        "---",
        "",
        `Generated by \`devforgekit new\` (DevForgeKit's Project Generator - see [docs/ProjectGenerator.md](https://github.com/NouradinAbdurahman/DevForgeKit/blob/main/docs/ProjectGenerator.md)).`
    );

    return lines.join("\n");
}

// ciNode(opts) -> a GitHub Actions workflow YAML string for Node-based
// stacks (Next.js, Express, NestJS, React, React Native, Expo, Tauri,
// Electron) - install, lint (if present), test (if present), build (if
// present). Steps whose script doesn't exist in package.json are
// deliberately still listed with `if: false`-free plain commands guarded
// by `--if-present` (npm's own flag for "skip silently if the script
// isn't defined") rather than being omitted per-stack, so every Node
// generator's CI is identical and easy to reason about.
export function ciNodeWorkflow({ nodeVersion = "lts/*", packageManager = "npm" } = {}) {
    const install = packageManager === "npm" ? "npm ci" : `${packageManager} install --frozen-lockfile`;
    return `name: CI

on:
  push:
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "${nodeVersion}"

      - name: Install dependencies
        run: ${install}

      - name: Lint
        run: npm run lint --if-present

      - name: Test
        run: npm test --if-present

      - name: Build
        run: npm run build --if-present
`;
}

export function dockerignoreNode() {
    return `node_modules
npm-debug.log
.git
.gitignore
.env
dist
build
coverage
`;
}
