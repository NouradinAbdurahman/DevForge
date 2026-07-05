// Next.js generator (v1.2.2 Tier 1): scaffolds with the official
// `create-next-app` (TypeScript + Tailwind + ESLint + App Router - the
// combination it's built to produce correctly), then layers shadcn/ui,
// Prettier, Husky, Docker, GitHub Actions, and an .env.example by hand -
// things create-next-app itself doesn't offer flags for.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runShellCommand } from "../core/shell.js";
import { confirm } from "../lib/prompts.js";
import { EDITORCONFIG, vscodeSettings, vscodeExtensions, ciNodeWorkflow, dockerignoreNode } from "./shared.js";

async function promptOptions(flags) {
    const shadcn = flags.shadcn ?? await confirm("Add shadcn/ui (Button component + lib/utils.ts)?", true);
    const husky = flags.husky ?? await confirm("Add Husky + lint-staged (pre-commit lint/format)?", true);
    const docker = flags.docker ?? await confirm("Include a production Dockerfile?", true);
    return { shadcn, husky, docker };
}

function utilsTs() {
    return `import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
`;
}

function componentsJson() {
    return `${JSON.stringify({
        $schema: "https://ui.shadcn.com/schema.json",
        style: "default",
        rsc: true,
        tsx: true,
        tailwind: { config: "tailwind.config.ts", css: "app/globals.css", baseColor: "slate", cssVariables: true },
        aliases: { components: "@/components", utils: "@/lib/utils" }
    }, null, 2)}\n`;
}

function buttonComponent() {
    return `import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "default" | "outline" | "ghost";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant = "default", ...props }, ref) => {
        const variants: Record<string, string> = {
            default: "bg-slate-900 text-white hover:bg-slate-700",
            outline: "border border-slate-300 hover:bg-slate-100",
            ghost: "hover:bg-slate-100"
        };
        return (
            <button
                ref={ref}
                className={cn(
                    "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50",
                    variants[variant],
                    className
                )}
                {...props}
            />
        );
    }
);
Button.displayName = "Button";
`;
}

function prettierrc() {
    return `${JSON.stringify({ semi: true, singleQuote: false, trailingComma: "es5", tabWidth: 2, plugins: ["prettier-plugin-tailwindcss"] }, null, 2)}\n`;
}

function huskyPreCommit() {
    return `#!/usr/bin/env sh
npx lint-staged
`;
}

function dockerfile() {
    // `npm install`, not `npm ci`: scaffold() below passes --skip-install
    // so no package-lock.json exists right after generation - `npm ci`
    // would fail on a fresh project's first `docker build`.
    return `FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
`;
}

export const nextjsGenerator = {
    id: "nextjs",
    label: "Next.js",
    description: "TypeScript + Tailwind + shadcn/ui, ESLint, Prettier, Husky, Docker, GitHub Actions",
    requiresTool: { command: "npx", hint: "Install Node.js (e.g. `devforgekit component install node`), which ships npx." },
    promptOptions,
    skipGitInit: false,

    async scaffold({ name, parentDir, options }) {
        void options;
        return runShellCommand(
            `npx --yes create-next-app@latest "${name}" --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --skip-install --yes`,
            { cwd: parentDir }
        );
    },

    generate({ name, options }) {
        const files = [
            { path: ".editorconfig", content: EDITORCONFIG },
            { path: ".env.example", content: "# Copy to .env.local\nNEXT_PUBLIC_APP_URL=http://localhost:3000\n" },
            { path: ".vscode/settings.json", content: vscodeSettings({ "editor.defaultFormatter": "esbenp.prettier-vscode" }) },
            { path: ".vscode/extensions.json", content: vscodeExtensions(["dbaeumer.vscode-eslint", "esbenp.prettier-vscode", "bradlc.vscode-tailwindcss"]) },
            { path: ".github/workflows/ci.yml", content: ciNodeWorkflow() },
            { path: ".prettierrc.json", content: prettierrc() }
        ];

        if (options.shadcn) {
            files.push(
                { path: "components.json", content: componentsJson() },
                { path: "src/lib/utils.ts", content: utilsTs() },
                { path: "src/components/ui/button.tsx", content: buttonComponent() }
            );
        }

        if (options.husky) {
            files.push(
                { path: ".husky/pre-commit", content: huskyPreCommit(), mode: 0o755 }
            );
        }

        if (options.docker) {
            files.push(
                { path: "Dockerfile", content: dockerfile() },
                { path: ".dockerignore", content: dockerignoreNode() }
            );
        }

        files.push({
            path: "README.md",
            content: `# ${name}\n\nA Next.js app generated by \`devforgekit new nextjs\` - TypeScript, Tailwind${options.shadcn ? ", shadcn/ui" : ""}, ESLint, Prettier${options.husky ? ", Husky" : ""}${options.docker ? ", Docker" : ""}.\n\n## Getting started\n\n\`\`\`bash\nnpm install\ncp .env.example .env.local\nnpm run dev\n\`\`\`\n\nOpen [http://localhost:3000](http://localhost:3000).\n\n## Scripts\n\n| Command | What it does |\n| --- | --- |\n| \`npm run dev\` | Start the dev server |\n| \`npm run build\` | Production build |\n| \`npm start\` | Run the production build |\n| \`npm run lint\` | ESLint |\n\n---\n\nGenerated by \`devforgekit new\` (DevForgeKit's Project Generator).\n`
        });

        return files;
    },

    postGenerate({ dir, options }) {
        // package.json exists (from create-next-app); add the extra
        // dependencies the layered files above need, so `npm install`
        // pulls everything in one pass instead of the user hand-editing
        // package.json themselves.
        const pkgPath = path.join(dir, "package.json");
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        pkg.dependencies = pkg.dependencies || {};
        pkg.devDependencies = pkg.devDependencies || {};

        if (options.shadcn) {
            Object.assign(pkg.dependencies, {
                clsx: "^2.1.1",
                "tailwind-merge": "^3.0.2",
                "class-variance-authority": "^0.7.1",
                "lucide-react": "^0.469.0"
            });
        }
        Object.assign(pkg.devDependencies, { prettier: "^3.4.2" });
        if (options.shadcn) pkg.devDependencies["prettier-plugin-tailwindcss"] = "^0.6.9";
        if (options.husky) {
            Object.assign(pkg.devDependencies, { husky: "^9.1.7", "lint-staged": "^15.3.0" });
            pkg.scripts = { ...pkg.scripts, prepare: "husky" };
            pkg["lint-staged"] = { "*.{js,jsx,ts,tsx}": ["eslint --fix", "prettier --write"], "*.{json,css,md}": ["prettier --write"] };
        }

        writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    },

    nextSteps({ name }) {
        return [`cd ${name}`, "npm install", "cp .env.example .env.local", "npm run dev"];
    }
};
