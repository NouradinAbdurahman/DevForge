// Colored logging for the Node CLI - the Node counterpart of
// scripts/colors.sh + the log_* functions in scripts/common.sh. Mirrors
// the same vocabulary (info/success/warn/error/section/step) so output
// reads consistently whether a command was handled by bash or Node.
import chalk from "chalk";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { userStateDir } from "./paths.js";

let verbose = false;
let debug = false;

export function setLogLevel({ verbose: v = false, debug: d = false } = {}) {
    verbose = v || d;
    debug = d;
}

function writeLogFile(line) {
    try {
        const dir = path.join(userStateDir(), "logs");
        mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `devforgekit-${new Date().toISOString().slice(0, 10)}.log`);
        appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
    } catch {
        // Logging must never crash the CLI - a read-only $HOME or missing
        // permissions just means no file log this run.
    }
}

function emit(prefix, message) {
    writeLogFile(`${prefix} ${message}`);
}

export const logger = {
    info(message) {
        console.log(`${chalk.cyan("i")} ${message}`);
        emit("INFO", message);
    },
    success(message) {
        console.log(`${chalk.green("✓")} ${message}`);
        emit("PASS", message);
    },
    warn(message) {
        console.error(`${chalk.yellow("!")} ${message}`);
        emit("WARN", message);
    },
    error(message) {
        console.error(`${chalk.red("✗")} ${message}`);
        emit("FAIL", message);
    },
    step(message) {
        console.log(`${chalk.dim("→")} ${message}`);
    },
    section(title) {
        console.log(`\n${chalk.bold.magenta(`=== ${title} ===`)}`);
    },
    debug(message) {
        if (debug) {
            console.log(chalk.dim(`[debug] ${message}`));
        }
        emit("DEBUG", message);
    },
    verbose(message) {
        if (verbose) {
            console.log(chalk.dim(message));
        }
    }
};
