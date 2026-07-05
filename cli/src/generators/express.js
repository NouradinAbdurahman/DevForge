// Express generator (v1.2.2 Tier 1 - full depth per the product brief):
// API structure, JWT auth, Prisma + PostgreSQL, Docker, Swagger, testing.
// Fully hand-written (no external scaffolding CLI) - an Express project
// is plain Node.js files, so generating them directly is both simpler
// and more reliable than shelling out to anything.
import { confirm } from "../lib/prompts.js";
import { mitLicense, EDITORCONFIG, vscodeSettings, vscodeExtensions, readme, ciNodeWorkflow, dockerignoreNode } from "./shared.js";

async function promptOptions(flags) {
    const auth = flags.auth ?? await confirm("Include JWT authentication (register/login)?", true);
    const prisma = flags.prisma ?? await confirm("Include Prisma + PostgreSQL?", true);
    const swagger = flags.swagger ?? await confirm("Include Swagger/OpenAPI docs?", true);
    const docker = flags.docker ?? await confirm("Include Docker + docker-compose (app + postgres)?", true);
    return { auth, prisma, swagger, docker };
}

function packageJson({ name, options }) {
    const dependencies = {
        express: "^5.2.1",
        cors: "^2.8.5",
        helmet: "^8.1.0",
        morgan: "^1.10.1",
        dotenv: "^17.2.3"
    };
    const devDependencies = {
        nodemon: "^3.1.10",
        jest: "^30.2.0",
        supertest: "^7.1.4",
        eslint: "^9.13.0",
        "@eslint/js": "^9.13.0",
        globals: "^15.12.0"
    };
    if (options.auth) {
        dependencies.jsonwebtoken = "^9.0.2";
        dependencies.bcryptjs = "^3.0.2";
    }
    if (options.prisma) {
        dependencies["@prisma/client"] = "^6.3.1";
        devDependencies.prisma = "^6.3.1";
    }
    if (options.swagger) {
        dependencies["swagger-jsdoc"] = "^6.2.8";
        dependencies["swagger-ui-express"] = "^5.0.1";
    }

    return `${JSON.stringify({
        name,
        version: "0.1.0",
        private: true,
        type: "module",
        main: "src/server.js",
        scripts: {
            start: "node src/server.js",
            dev: "nodemon src/server.js",
            test: "node --experimental-vm-modules node_modules/.bin/jest",
            lint: "eslint .",
            ...(options.prisma ? { "prisma:generate": "prisma generate", "prisma:migrate": "prisma migrate dev" } : {})
        },
        dependencies,
        devDependencies
    }, null, 2)}\n`;
}

// eslint@9 (pinned above) only reads a flat eslint.config.js by default
// - a legacy .eslintrc.json is silently ignored, which would make the
// generated `npm run lint` script fail immediately with "ESLint
// couldn't find an eslint.config.js file" on a freshly generated
// project. Caught by running `npm run lint` against a real generated
// project during development of this generator.
function eslintConfig() {
    return `import js from "@eslint/js";
import globals from "globals";

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: { ...globals.node, ...globals.jest }
        }
    },
    {
        ignores: ["node_modules/**", "coverage/**"]
    }
];
`;
}

// app.js only builds and exports the Express app - it never calls
// listen() itself, so importing it (e.g. from tests/health.test.js via
// Supertest) never opens a real socket. Only server.js (the actual
// entry point) starts listening - a real bug caught by this generator's
// own end-to-end test suite: with app.js and server.js merged into one
// file, Jest imported the app for Supertest and printed "Jest did not
// exit one second after the test run has completed" because the
// top-level app.listen() left an open handle.
function appJs(options) {
    return `import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import "dotenv/config";
import healthRouter from "./routes/health.routes.js";
${options.auth ? 'import authRouter from "./routes/auth.routes.js";\n' : ""}${options.swagger ? 'import { mountSwagger } from "./config/swagger.js";\n' : ""}import { errorHandler, notFound } from "./middleware/error.middleware.js";

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

app.use("/health", healthRouter);
${options.auth ? 'app.use("/api/auth", authRouter);\n' : ""}${options.swagger ? "mountSwagger(app);\n" : ""}
app.use(notFound);
app.use(errorHandler);

export default app;
`;
}

function serverJs() {
    return `import app from "./app.js";

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(\`Server listening on http://localhost:\${PORT}\`);
});
`;
}

function healthRoutes() {
    return `import { Router } from "express";

const router = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/", (req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
});

export default router;
`;
}

function authRoutes() {
    return `import { Router } from "express";
import { register, login } from "../controllers/auth.controller.js";

const router = Router();

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     responses:
 *       201:
 *         description: Created
 */
router.post("/register", register);

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: Log in and receive a JWT
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/login", login);

export default router;
`;
}

function authController(options) {
    const persistence = options.prisma
        ? `import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();`
        : `// No database configured - swap this in-memory store for Prisma (or any
// ORM) once you're ready. See prisma/schema.prisma if you generated this
// project with Prisma enabled.
const users = new Map();`;

    const findUser = options.prisma
        ? `prisma.user.findUnique({ where: { email } })`
        : `Promise.resolve(users.get(email))`;
    const createUser = options.prisma
        ? `prisma.user.create({ data: { email, password: hashed } })`
        : `Promise.resolve(users.set(email, { email, password: hashed }) && { email })`;

    return `import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
${persistence}

export async function register(req, res, next) {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "email and password are required" });
        }
        const existing = await ${findUser};
        if (existing) {
            return res.status(409).json({ error: "user already exists" });
        }
        const hashed = await bcrypt.hash(password, 10);
        await ${createUser};
        res.status(201).json({ email });
    } catch (err) {
        next(err);
    }
}

export async function login(req, res, next) {
    try {
        const { email, password } = req.body;
        const user = await ${findUser};
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: "invalid credentials" });
        }
        const token = jwt.sign({ sub: email }, process.env.JWT_SECRET || "dev-secret", { expiresIn: "1h" });
        res.json({ token });
    } catch (err) {
        next(err);
    }
}
`;
}

function authMiddleware() {
    return `import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
        return res.status(401).json({ error: "missing bearer token" });
    }
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
        next();
    } catch {
        res.status(401).json({ error: "invalid or expired token" });
    }
}
`;
}

function errorMiddleware() {
    return `export function notFound(req, res) {
    res.status(404).json({ error: \`Not found: \${req.method} \${req.originalUrl}\` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
}
`;
}

function swaggerConfig(name) {
    return `import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

const spec = swaggerJsdoc({
    definition: {
        openapi: "3.0.0",
        info: { title: "${name}", version: "0.1.0" }
    },
    apis: ["./src/routes/*.js"]
});

export function mountSwagger(app) {
    app.use("/docs", swaggerUi.serve, swaggerUi.setup(spec));
}
`;
}

function prismaSchema() {
    return `// See https://pris.ly/d/prisma-schema
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  password  String
  createdAt DateTime @default(now())
}
`;
}

function dockerfile(options) {
    // `npm install` rather than `npm ci`: this generator never runs an
    // install itself, so no package-lock.json exists yet immediately
    // after `devforgekit new express` - `npm ci` requires one and would
    // fail on a fresh project's very first `docker build`/`docker
    // compose up --build`. Caught by inspecting the Dockerfile alongside
    // a real `docker compose config` run against a freshly generated
    // project. Once a lockfile is committed, `npm install` still
    // respects it.
    //
    // `npx prisma generate` (when Prisma is enabled) is required too:
    // @prisma/client throws "did not initialize yet" at import time
    // until the generated client exists - auth.controller.js imports
    // PrismaClient at module load, so without this the container
    // crash-loops on startup. That also means devDependencies can't be
    // omitted here: the `prisma` CLI package generate needs lives there,
    // not in `dependencies`. Caught by actually running the built image
    // with `docker run` during development of this generator.
    return `FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm install${options.prisma ? "" : " --omit=dev"}
COPY . .
${options.prisma ? "RUN npx prisma generate\n" : ""}EXPOSE 3000
CMD ["node", "src/server.js"]
`;
}

function dockerCompose(name, options) {
    return `services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      ${options.prisma ? "- DATABASE_URL=postgresql://postgres:postgres@db:5432/" + name.replace(/-/g, "_") : ""}
      ${options.auth ? "- JWT_SECRET=dev-secret" : ""}
    depends_on:
      ${options.prisma ? "- db" : "[]"}
${options.prisma ? `
  db:
    image: postgres:17-alpine
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=${name.replace(/-/g, "_")}
    ports:
      - "5432:5432"
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
` : ""}`;
}

function healthTest() {
    return `import request from "supertest";
import app from "../src/app.js";

describe("GET /health", () => {
    it("returns status ok", async () => {
        const res = await request(app).get("/health");
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("ok");
    });
});
`;
}

export const expressGenerator = {
    id: "express",
    label: "Express",
    description: "Node.js API with JWT auth, Prisma + PostgreSQL, Docker, and Swagger",
    promptOptions,

    generate({ name, options }) {
        const files = [
            { path: "package.json", content: packageJson({ name, options }) },
            { path: "src/app.js", content: appJs(options) },
            { path: "src/server.js", content: serverJs() },
            { path: "src/routes/health.routes.js", content: healthRoutes() },
            { path: "src/middleware/error.middleware.js", content: errorMiddleware() },
            { path: "tests/health.test.js", content: healthTest() },
            { path: ".editorconfig", content: EDITORCONFIG },
            { path: ".gitignore", content: "node_modules/\n.env\n*.log\n.DS_Store\ncoverage/\n" },
            { path: "LICENSE", content: mitLicense() },
            { path: ".env.example", content: `PORT=3000\n${options.auth ? "JWT_SECRET=change-me\n" : ""}${options.prisma ? `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/${name.replace(/-/g, "_")}\n` : ""}` },
            { path: "eslint.config.js", content: eslintConfig() },
            { path: ".vscode/settings.json", content: vscodeSettings() },
            { path: ".vscode/extensions.json", content: vscodeExtensions(["dbaeumer.vscode-eslint", "esbenp.prettier-vscode"]) },
            { path: ".github/workflows/ci.yml", content: ciNodeWorkflow() },
            {
                path: "README.md",
                content: readme({
                    name,
                    description: "An Express API generated by `devforgekit new express`.",
                    prerequisites: ["Node.js 18+", ...(options.prisma ? ["PostgreSQL (or `docker compose up db`)"] : [])],
                    gettingStarted: [
                        "npm install",
                        ...(options.prisma ? ["cp .env.example .env", "npm run prisma:migrate"] : ["cp .env.example .env"]),
                        "npm run dev"
                    ],
                    scripts: [
                        ["npm run dev", "Start with nodemon (auto-restart)"],
                        ["npm start", "Start once, no watcher"],
                        ["npm test", "Run the Jest test suite"],
                        ["npm run lint", "Run ESLint"],
                        ...(options.prisma ? [["npm run prisma:migrate", "Apply Prisma migrations"]] : [])
                    ],
                    structure: [
                        "src/",
                        "  app.js              # Express app (exported, no listen() - safe to import in tests)",
                        "  server.js           # entry point: imports app.js, calls listen()",
                        "  routes/             # Express routers",
                        "  controllers/        # route handlers",
                        "  middleware/         # auth/error middleware",
                        ...(options.swagger ? ["  config/swagger.js   # OpenAPI setup, served at /docs"] : []),
                        "tests/                # Jest + Supertest",
                        ...(options.prisma ? ["prisma/schema.prisma  # PostgreSQL schema"] : [])
                    ]
                })
            }
        ];

        if (options.auth) {
            files.push(
                { path: "src/routes/auth.routes.js", content: authRoutes() },
                { path: "src/controllers/auth.controller.js", content: authController(options) },
                { path: "src/middleware/auth.middleware.js", content: authMiddleware() }
            );
        }
        if (options.swagger) {
            files.push({ path: "src/config/swagger.js", content: swaggerConfig(name) });
        }
        if (options.prisma) {
            files.push({ path: "prisma/schema.prisma", content: prismaSchema() });
        }
        if (options.docker) {
            files.push(
                { path: "Dockerfile", content: dockerfile(options) },
                { path: ".dockerignore", content: dockerignoreNode() },
                { path: "docker-compose.yml", content: dockerCompose(name, options) }
            );
        }

        return files;
    },

    nextSteps({ name, options }) {
        return [
            `cd ${name}`,
            "npm install",
            "cp .env.example .env",
            ...(options.prisma ? ["npm run prisma:migrate"] : []),
            "npm run dev"
        ];
    }
};
