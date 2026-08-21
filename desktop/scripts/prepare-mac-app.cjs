#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const sourceApp = path.join(
  desktopRoot,
  "node_modules",
  "electron",
  "dist",
  "Electron.app",
);
const targetApp = path.join(desktopRoot, "build", "NotebookLM Pro.app");
const iconSource = path.join(desktopRoot, "assets", "notebooklm-pro-icon.icns");
const iconTarget = path.join(
  targetApp,
  "Contents",
  "Resources",
  "notebooklm-pro-icon.icns",
);
const plistPath = path.join(targetApp, "Contents", "Info.plist");

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || `${command} failed`).trim();
    throw new Error(message);
  }
  return result.stdout.trim();
}

function setPlist(key, type, value) {
  const plistBuddy = "/usr/libexec/PlistBuddy";
  const setResult = spawnSync(plistBuddy, ["-c", `Set :${key} ${value}`, plistPath], {
    encoding: "utf8",
  });
  if (setResult.status === 0) return;
  run(plistBuddy, ["-c", `Add :${key} ${type} ${value}`, plistPath]);
}

if (process.platform !== "darwin") {
  console.log(sourceApp);
  process.exit(0);
}

if (!fs.existsSync(sourceApp)) {
  throw new Error(`Electron.app is missing at ${sourceApp}. Run npm install in desktop/.`);
}
if (!fs.existsSync(iconSource)) {
  throw new Error(`NotebookLM Pro icon is missing at ${iconSource}.`);
}

fs.rmSync(targetApp, { recursive: true, force: true });
fs.mkdirSync(path.dirname(targetApp), { recursive: true });
run("ditto", [sourceApp, targetApp]);
fs.copyFileSync(iconSource, iconTarget);

// Electron's Chromium runtime expects the internal framework layout that ships
// with Electron.app. Keep CFBundleName as Electron and use display/runtime names
// for the user-facing brand.
setPlist("CFBundleDisplayName", "string", "NotebookLM Pro");
setPlist("CFBundleIdentifier", "string", "com.mtips5s.notebooklmpro");
setPlist("CFBundleIconFile", "string", "notebooklm-pro-icon");
setPlist("NSHumanReadableCopyright", "string", "NotebookLM Pro");

run("touch", [targetApp]);
console.log(targetApp);
