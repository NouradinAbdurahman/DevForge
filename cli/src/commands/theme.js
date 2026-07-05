// Theme management command: list, preview, use, random, export, import,
// and gallery. Operates on the same ~/.config/devforgekit/config.yaml
// `tuiTheme` key the Configuration page uses — no separate state.
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";
import { setConfigValue, getConfigValue } from "../core/config.js";

export function registerThemeCommand(program) {
    const theme = program
        .command("theme")
        .description("Manage TUI themes (list, preview, use, export, import, gallery)");

    theme
        .command("list")
        .description("List all available themes")
        .action(withErrorHandling(async function () {
            const { listThemes } = await import("../tui/theme.js");
            const current = getConfigValue("tuiTheme") || "dark";
            const themes = listThemes();

            logger.section("DevForgeKit Themes");
            console.log(`\n  Current: ${current}\n`);
            console.log("  Available:");
            for (const t of themes) {
                const marker = t.id === current ? " ✓ " : "   ";
                const tag = t.isCustom ? " (custom)" : "";
                const health = t.validation.warnings.length > 0
                    ? ` [${t.validation.warnings.length} contrast warning(s)]`
                    : "";
                console.log(`${marker}${t.name.padEnd(28)} ${t.id.padEnd(20)}${tag}${health}`);
            }
            console.log(`\n  ${themes.length} theme(s) — use 'devforgekit theme use <id>' to switch.`);
        }));

    theme
        .command("use <id>")
        .description("Switch to a theme immediately (persists to config)")
        .action(withErrorHandling(async (id) => {
            const { getTheme, invalidateThemeCache } = await import("../tui/theme.js");
            invalidateThemeCache();
            const t = getTheme(id);
            if (!t || t.id !== id) {
                throw usageError(`Theme '${id}' not found. Run 'devforgekit theme list' to see available themes.`);
            }
            setConfigValue("tuiTheme", id);
            logger.success(`Theme set to '${t._meta?.name || id}' (${id}). It will apply on next dashboard launch.`);
        }));

    theme
        .command("preview <id>")
        .description("Preview a theme in the dashboard without saving")
        .action(withErrorHandling(async function (id) {
            const { getTheme, invalidateThemeCache } = await import("../tui/theme.js");
            invalidateThemeCache();
            const t = getTheme(id);
            if (!t || t.id !== id) {
                throw usageError(`Theme '${id}' not found. Run 'devforgekit theme list' to see available themes.`);
            }
            const previous = getConfigValue("tuiTheme");
            setConfigValue("tuiTheme", id);
            logger.info(`Previewing '${t._meta?.name || id}' — press q to exit (your saved theme will be restored).`);
            try {
                const { isTuiCapable, launchDashboard } = await import("../tui/index.js");
                if (!isTuiCapable()) {
                    logger.warn("This terminal can't run the dashboard (no TTY or DEVFORGEKIT_NO_TUI=1).");
                    process.exitCode = 1;
                    return;
                }
                await launchDashboard({});
            } finally {
                if (previous !== undefined) {
                    setConfigValue("tuiTheme", previous);
                }
            }
        }));

    theme
        .command("random")
        .description("Switch to a random theme")
        .action(withErrorHandling(async function () {
            const { randomThemeId, getTheme, invalidateThemeCache } = await import("../tui/theme.js");
            invalidateThemeCache();
            const current = getConfigValue("tuiTheme") || "dark";
            const id = randomThemeId(current);
            const t = getTheme(id);
            setConfigValue("tuiTheme", id);
            logger.success(`Random theme: '${t._meta?.name || id}' (${id}).`);
        }));

    theme
        .command("export [id]")
        .description("Export a theme to YAML (defaults to current theme)")
        .option("-o, --output <file>", "write to file instead of stdout")
        .action(withErrorHandling(async function (id) {
            const opts = this.opts();
            const { exportThemeYaml, invalidateThemeCache } = await import("../tui/theme.js");
            invalidateThemeCache();
            const themeId = id || getConfigValue("tuiTheme") || "dark";
            const yaml = exportThemeYaml(themeId);
            if (!yaml) {
                throw usageError(`Theme '${themeId}' not found.`);
            }
            if (opts.output) {
                writeFileSync(opts.output, yaml + "\n");
                logger.success(`Theme '${themeId}' exported to ${opts.output}`);
            } else {
                console.log(yaml);
            }
        }));

    theme
        .command("import <file>")
        .description("Import a custom theme from a YAML file")
        .action(withErrorHandling(async (file) => {
            if (!existsSync(file)) {
                throw usageError(`File not found: ${file}`);
            }
            const content = readFileSync(file, "utf8");
            const dir = path.join(os.homedir(), ".config", "devforgekit", "themes");
            mkdirSync(dir, { recursive: true });
            // Extract theme id from the YAML (or use the filename)
            const idMatch = /^id:\s*(.+)$/m.exec(content);
            const id = idMatch ? idMatch[1].trim() : path.basename(file, path.extname(file));
            const dest = path.join(dir, `${id}.yaml`);
            writeFileSync(dest, content);
            // Validate the imported theme
            const { invalidateThemeCache, listThemes } = await import("../tui/theme.js");
            invalidateThemeCache();
            const themes = listThemes();
            const imported = themes.find((t) => t.id === id);
            if (imported) {
                if (imported.validation.valid) {
                    logger.success(`Theme '${imported.name}' (${id}) imported successfully.`);
                    if (imported.validation.warnings.length > 0) {
                        logger.warn(`Contrast warnings:`);
                        for (const w of imported.validation.warnings) {
                            console.log(`    ${w.token}: ${w.ratio}:1 (${w.level})`);
                        }
                    }
                } else {
                    logger.warn(`Theme imported but has missing tokens: ${imported.validation.missing.join(", ")}`);
                }
            } else {
                logger.warn(`Theme file saved to ${dest} but could not be loaded. Check the YAML format.`);
            }
            logger.info(`Use 'devforgekit theme use ${id}' to apply it.`);
        }));

    theme
        .command("gallery")
        .description("Show a scrollable gallery of all themes in the dashboard")
        .action(withErrorHandling(async function () {
            const { isTuiCapable, launchDashboard } = await import("../tui/index.js");
            if (!isTuiCapable()) {
                logger.warn("This terminal can't run the dashboard (no TTY or DEVFORGEKIT_NO_TUI=1).");
                process.exitCode = 1;
                return;
            }
            // The gallery is a special page in the dashboard that shows
            // all themes. We launch with a special env var that the
            // dashboard reads to open the gallery page.
            process.env.DEVFORGEKIT_THEME_GALLERY = "1";
            try {
                await launchDashboard({ initialPage: "config" });
            } finally {
                delete process.env.DEVFORGEKIT_THEME_GALLERY;
            }
        }));
}
