#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const path = require("node:path");

delete process.env.ELECTRON_RUN_AS_NODE;

const desktopRoot = path.resolve(__dirname, "..");

if (process.platform !== "darwin") {
  const result = spawnSync("electron", ["."], {
    cwd: desktopRoot,
    env: process.env,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

const prepare = spawnSync(process.execPath, [path.join(__dirname, "prepare-mac-app.cjs")], {
  cwd: desktopRoot,
  env: process.env,
  encoding: "utf8",
});
if (prepare.status !== 0) {
  process.stderr.write(prepare.stderr || prepare.stdout || "Could not prepare NotebookLM Pro.app\n");
  process.exit(prepare.status ?? 1);
}

const appPath = prepare.stdout.trim().split(/\r?\n/).at(-1);
const result = spawnSync("open", ["-na", appPath, "--args", desktopRoot], {
  cwd: desktopRoot,
  env: process.env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
