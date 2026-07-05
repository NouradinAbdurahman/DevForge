import { test } from "node:test";
import assert from "node:assert/strict";
import { expressGenerator } from "../src/generators/express.js";
import { fastapiGenerator } from "../src/generators/fastapi.js";
import { goFiberGenerator } from "../src/generators/go-fiber.js";
import { rustAxumGenerator } from "../src/generators/rust-axum.js";
import { electronGenerator } from "../src/generators/electron.js";
import { flutterGenerator } from "../src/generators/flutter.js";

function findFile(files, filePath) {
    return files.find((f) => f.path === filePath);
}

test("express generator: minimal options omit auth/prisma/swagger/docker files", () => {
    const files = expressGenerator.generate({ name: "my-api", options: { auth: false, prisma: false, swagger: false, docker: false } });
    assert.ok(findFile(files, "src/app.js"));
    assert.ok(findFile(files, "src/server.js"));
    assert.ok(findFile(files, "src/routes/health.routes.js"));
    assert.ok(!findFile(files, "src/routes/auth.routes.js"));
    assert.ok(!findFile(files, "prisma/schema.prisma"));
    assert.ok(!findFile(files, "src/config/swagger.js"));
    assert.ok(!findFile(files, "Dockerfile"));

    const pkg = JSON.parse(findFile(files, "package.json").content);
    assert.equal(pkg.name, "my-api");
    assert.ok(pkg.dependencies.express);
    assert.ok(!pkg.dependencies.jsonwebtoken);
});

test("express generator: full options include auth, Prisma, Swagger, and Docker", () => {
    const files = expressGenerator.generate({ name: "my-api", options: { auth: true, prisma: true, swagger: true, docker: true } });
    assert.ok(findFile(files, "src/routes/auth.routes.js"));
    assert.ok(findFile(files, "src/controllers/auth.controller.js"));
    assert.ok(findFile(files, "src/middleware/auth.middleware.js"));
    assert.ok(findFile(files, "prisma/schema.prisma").content.includes("postgresql"));
    assert.ok(findFile(files, "src/config/swagger.js"));
    assert.ok(findFile(files, "Dockerfile"));
    assert.ok(findFile(files, "docker-compose.yml"));

    const pkg = JSON.parse(findFile(files, "package.json").content);
    assert.ok(pkg.dependencies.jsonwebtoken);
    assert.ok(pkg.dependencies.bcryptjs);
    assert.ok(pkg.dependencies["@prisma/client"]);
    assert.ok(pkg.dependencies["swagger-ui-express"]);
});

test("fastapi generator: package layout and optional Docker", () => {
    const withoutDocker = fastapiGenerator.generate({ name: "my-service", options: { docker: false } });
    assert.ok(findFile(withoutDocker, "app/main.py"));
    assert.ok(findFile(withoutDocker, "tests/test_health.py"));
    assert.ok(!findFile(withoutDocker, "Dockerfile"));

    const withDocker = fastapiGenerator.generate({ name: "my-service", options: { docker: true } });
    assert.ok(findFile(withDocker, "Dockerfile"));
    assert.ok(findFile(withDocker, "docker-compose.yml"));
});

test("go-fiber generator: go.mod declares the project as its module name", () => {
    const files = goFiberGenerator.generate({ name: "my-go-api", dir: "/tmp/whatever" });
    const goMod = findFile(files, "go.mod").content;
    assert.match(goMod, /^module my-go-api$/m);
    assert.ok(findFile(files, "main.go").content.includes("gofiber/fiber"));
    assert.ok(findFile(files, "main_test.go"));
});

test("rust-axum generator: Cargo.toml uses an underscored crate name", () => {
    const files = rustAxumGenerator.generate({ name: "my-rust-api" });
    const cargoToml = findFile(files, "Cargo.toml").content;
    assert.match(cargoToml, /name = "my_rust_api"/);
    assert.ok(findFile(files, "src/main.rs").content.includes("axum"));
});

test("electron generator: produces a valid package.json and main/preload/renderer files", () => {
    const files = electronGenerator.generate({ name: "my-desktop-app" });
    const pkg = JSON.parse(findFile(files, "package.json").content);
    assert.equal(pkg.main, "src/main.js");
    assert.ok(pkg.devDependencies.electron);
    assert.ok(findFile(files, "src/main.js"));
    assert.ok(findFile(files, "src/preload.js"));
    assert.ok(findFile(files, "src/renderer/index.html"));
});

test("flutter generator: pubspec.yaml reflects the chosen state management and backend", () => {
    const riverpodSupabase = flutterGenerator.generate({ name: "my-app", options: { state: "riverpod", backend: "supabase", docker: false } });
    const pubspec1 = findFile(riverpodSupabase, "pubspec.yaml").content;
    assert.match(pubspec1, /flutter_riverpod/);
    assert.match(pubspec1, /supabase_flutter/);
    assert.ok(findFile(riverpodSupabase, "lib/presentation/providers/counter_provider.dart"));
    assert.ok(!findFile(riverpodSupabase, "lib/presentation/blocs/counter_bloc.dart"));

    const blocFirebase = flutterGenerator.generate({ name: "my-app", options: { state: "bloc", backend: "firebase", docker: true } });
    const pubspec2 = findFile(blocFirebase, "pubspec.yaml").content;
    assert.match(pubspec2, /flutter_bloc/);
    assert.match(pubspec2, /firebase_core/);
    assert.ok(findFile(blocFirebase, "lib/presentation/blocs/counter_bloc.dart"));
    assert.ok(findFile(blocFirebase, "Dockerfile"));
});

test("flutter generator: 'none' state/backend produce a plain StatefulWidget with no extra deps", () => {
    const files = flutterGenerator.generate({ name: "plain-app", options: { state: "none", backend: "none", docker: false } });
    const pubspec = findFile(files, "pubspec.yaml").content;
    assert.ok(!pubspec.includes("riverpod"));
    assert.ok(!pubspec.includes("bloc"));
    assert.ok(!pubspec.includes("supabase"));
    assert.ok(!pubspec.includes("firebase"));
    assert.ok(findFile(files, "lib/presentation/pages/home_page.dart").content.includes("StatefulWidget"));
});
