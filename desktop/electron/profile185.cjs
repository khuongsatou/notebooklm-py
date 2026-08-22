const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_CHROME_PROFILE_DIRECTORY = "Profile 185";
const DRIVE_DOWN_COOKIES_EXTENSION_ID = "cclelndahbckbenkjhflpdbgdldlbecc";
const DEFAULT_PROFILE_LOGIN_URL =
  "https://notebooklm.1nutnhan.com/profile-login?notebooklm_profile_login=1";
const DEFAULT_MAC_CHROME_PATH =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function chromeProfileDirectory(env = process.env) {
  const value = String(
    env.NOTEBOOKLM_CHROME_PROFILE_DIRECTORY || DEFAULT_CHROME_PROFILE_DIRECTORY,
  ).trim();
  if (!value || value === "." || value === ".." || /[\\/\0]/.test(value)) {
    throw new Error("NOTEBOOKLM_CHROME_PROFILE_DIRECTORY must be one Chrome profile directory name.");
  }
  return value;
}

function chromeUserDataDirectory({
  platform = process.platform,
  env = process.env,
  homeDirectory = os.homedir(),
} = {}) {
  if (env.NOTEBOOKLM_CHROME_USER_DATA_DIR) {
    return path.resolve(env.NOTEBOOKLM_CHROME_USER_DATA_DIR);
  }
  if (platform === "darwin") {
    return path.join(homeDirectory, "Library", "Application Support", "Google", "Chrome");
  }
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA;
    if (!localAppData) throw new Error("LOCALAPPDATA is unavailable; cannot locate Google Chrome.");
    return path.join(localAppData, "Google", "Chrome", "User Data");
  }
  return path.join(homeDirectory, ".config", "google-chrome");
}

function chromeExecutable({ platform = process.platform, env = process.env } = {}) {
  if (env.NOTEBOOKLM_CHROME_PATH) return path.resolve(env.NOTEBOOKLM_CHROME_PATH);
  if (platform === "darwin") return DEFAULT_MAC_CHROME_PATH;
  if (platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean);
    const candidate = roots
      .map((root) => path.join(root, "Google", "Chrome", "Application", "chrome.exe"))
      .find((item) => fs.existsSync(item));
    return candidate || "chrome.exe";
  }
  return env.CHROME_BIN || "google-chrome";
}

function profileLoginUrl(env = process.env, loginId = null) {
  const raw = String(env.NOTEBOOKLM_PROFILE_LOGIN_URL || DEFAULT_PROFILE_LOGIN_URL).trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("NOTEBOOKLM_PROFILE_LOGIN_URL must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("NOTEBOOKLM_PROFILE_LOGIN_URL must use HTTPS.");
  }
  if (parsed.searchParams.get("notebooklm_profile_login") !== "1") {
    parsed.searchParams.set("notebooklm_profile_login", "1");
  }
  if (loginId) parsed.searchParams.set("profile_login_id", loginId);
  return parsed.href;
}

function readProfileMetadata(userDataDirectory, profileDirectory) {
  const localStatePath = path.join(userDataDirectory, "Local State");
  if (!fs.existsSync(localStatePath)) return {};
  try {
    const localState = JSON.parse(fs.readFileSync(localStatePath, "utf8"));
    const metadata = localState?.profile?.info_cache?.[profileDirectory];
    if (!metadata || typeof metadata !== "object") return {};
    return {
      profile_name: typeof metadata.name === "string" ? metadata.name : undefined,
      profile_email:
        typeof metadata.user_name === "string" ? metadata.user_name : undefined,
    };
  } catch {
    return {};
  }
}

function readExtensionMetadata(userDataDirectory) {
  for (const filename of ["Secure Preferences", "Preferences"]) {
    const preferencesPath = path.join(userDataDirectory, filename);
    if (!fs.existsSync(preferencesPath)) continue;
    try {
      const preferences = JSON.parse(fs.readFileSync(preferencesPath, "utf8"));
      const settings = preferences?.extensions?.settings?.[DRIVE_DOWN_COOKIES_EXTENSION_ID];
      if (!settings || typeof settings !== "object") continue;
      const extensionPath = typeof settings.path === "string" ? settings.path : undefined;
      const extensionVersion =
        typeof settings.service_worker_registration_info?.version === "string"
          ? settings.service_worker_registration_info.version
          : undefined;
      let extensionSourceVersion;
      if (extensionPath && path.isAbsolute(extensionPath)) {
        const manifestPath = path.join(extensionPath, "manifest.json");
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          if (typeof manifest.version === "string") extensionSourceVersion = manifest.version;
        } catch {
          // Packaged extensions need not expose a readable source manifest.
        }
      }
      return {
        extension_configured: true,
        extension_id: DRIVE_DOWN_COOKIES_EXTENSION_ID,
        extension_path: extensionPath,
        extension_version: extensionVersion,
        extension_source_version: extensionSourceVersion,
        extension_reload_required: Boolean(
          extensionVersion && extensionSourceVersion && extensionVersion !== extensionSourceVersion,
        ),
        extension_service_worker_started: settings.has_started_service_worker === true,
      };
    } catch {
      // Try the other preferences file before reporting the extension absent.
    }
  }
  return {
    extension_configured: false,
    extension_id: DRIVE_DOWN_COOKIES_EXTENSION_ID,
  };
}

function inspectChromeProfile(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const homeDirectory = options.homeDirectory || os.homedir();
  const profile_directory = chromeProfileDirectory(env);
  const user_data_directory = chromeUserDataDirectory({ platform, env, homeDirectory });
  const profile_path = path.join(user_data_directory, profile_directory);
  const chrome_path = chromeExecutable({ platform, env });
  const chrome_path_is_named_command = !path.isAbsolute(chrome_path);
  const chrome_exists = chrome_path_is_named_command || fs.existsSync(chrome_path);
  const profile_exists = fs.existsSync(profile_path) && fs.statSync(profile_path).isDirectory();
  const extensionMetadata = readExtensionMetadata(profile_path);
  return {
    ok: chrome_exists && profile_exists && extensionMetadata.extension_configured,
    chrome_path,
    chrome_exists,
    profile_directory,
    user_data_directory,
    profile_path,
    profile_exists,
    ...readProfileMetadata(user_data_directory, profile_directory),
    ...extensionMetadata,
  };
}

function spawnDetached(command, args, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function openProfileLogin(options = {}) {
  const env = options.env || process.env;
  const inspection = inspectChromeProfile(options);
  if (!inspection.chrome_exists) {
    return {
      ...inspection,
      ok: false,
      status: "chrome_missing",
      error: `Google Chrome was not found at ${inspection.chrome_path}.`,
    };
  }
  if (!inspection.profile_exists) {
    return {
      ...inspection,
      ok: false,
      status: "profile_missing",
      error: `Chrome profile ${inspection.profile_directory} was not found at ${inspection.profile_path}.`,
    };
  }
  if (!inspection.extension_configured) {
    return {
      ...inspection,
      ok: false,
      status: "extension_missing",
      error: `Drive Down Cookies (${inspection.extension_id}) is not configured in ${inspection.profile_directory}.`,
    };
  }

  const login_id = options.loginId || crypto.randomUUID();
  const url = profileLoginUrl(env, login_id);
  try {
    await spawnDetached(
      inspection.chrome_path,
      [`--profile-directory=${inspection.profile_directory}`, url],
      options.spawnImpl,
    );
  } catch (error) {
    return {
      ...inspection,
      ok: false,
      status: "launch_failed",
      login_id,
      url,
      error: error instanceof Error ? error.message : "Could not open Google Chrome.",
    };
  }
  return {
    ...inspection,
    ok: true,
    status: "opened",
    login_id,
    url,
  };
}

module.exports = {
  DEFAULT_CHROME_PROFILE_DIRECTORY,
  DEFAULT_PROFILE_LOGIN_URL,
  DRIVE_DOWN_COOKIES_EXTENSION_ID,
  chromeExecutable,
  chromeProfileDirectory,
  chromeUserDataDirectory,
  inspectChromeProfile,
  openProfileLogin,
  profileLoginUrl,
};
