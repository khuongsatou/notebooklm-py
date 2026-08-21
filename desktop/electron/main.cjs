const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

let mainWindow = null;
let backend = null;
let backendConfig = null;
let backendRestart = null;

const DEFAULT_COOKIE_SYNC_ENDPOINT = "https://notebooklm.1nutnhan.com/sync/cookies";
const NOTEBOOKLM_COOKIE_SOURCE_URL = "https://notebooklm.google.com/";
const LOCAL_LOGIN_TIMEOUT_MS = 330_000;
const LOCAL_RESET_TIMEOUT_MS = 120_000;
const PLAYWRIGHT_INSTALL_TIMEOUT_MS = 330_000;
const APP_NAME = "NotebookLM Pro";
const APP_ICON_PATH = path.join(__dirname, "..", "assets", "notebooklm-pro-icon.png");

app.setName(APP_NAME);
app.setAppUserModelId("com.mtips5s.notebooklmpro");

function repoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function backendEnvironment(token) {
  const env = {
    ...process.env,
    NOTEBOOKLM_SERVER_TOKEN: token,
  };
  for (const key of ["NO_PROXY", "no_proxy"]) {
    if (!env[key]) continue;
    env[key] = env[key]
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry && entry !== "::1" && entry !== "::1/128")
      .join(",");
  }
  return env;
}

function sendBackendStatus(payload) {
  if (payload.status !== "log") {
    console.log("[backend]", JSON.stringify(payload));
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("backend:status", payload);
  }
}

function appInfo() {
  const pkgPath = path.join(__dirname, "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return {
    name: pkg.productName || APP_NAME,
    version: pkg.version,
    backend: backendConfig ? { ...backendConfig, token: undefined } : null,
  };
}

function waitForHealth(baseUrl, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`${baseUrl}/healthz`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });
      req.on("error", retry);
      req.setTimeout(1200, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Backend health check timed out"));
        return;
      }
      setTimeout(tick, 450);
    };
    tick();
  });
}

async function startBackend() {
  const port = await findFreePort();
  const token = crypto.randomBytes(24).toString("hex");
  const baseUrl = `http://127.0.0.1:${port}`;
  backendConfig = { baseUrl, token, port, status: "starting" };
  sendBackendStatus({ status: "starting", port });
  console.log(`[backend] starting notebooklm-server on ${baseUrl}`);

  backend = spawn(
    "uv",
    [
      "run",
      "--extra",
      "server",
      "notebooklm-server",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--token",
      token,
    ],
    {
      cwd: repoRoot(),
      env: backendEnvironment(token),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  backend.stdout.on("data", (chunk) => {
    const message = String(chunk).trim();
    if (message) console.log(`[backend stdout] ${message}`);
    sendBackendStatus({ status: "log", stream: "stdout", message });
  });
  backend.stderr.on("data", (chunk) => {
    const message = String(chunk).trim();
    if (message) console.error(`[backend stderr] ${message}`);
    sendBackendStatus({ status: "log", stream: "stderr", message });
  });
  const processRef = backend;
  backend.on("exit", (code) => {
    if (backend !== processRef) return;
    sendBackendStatus({ status: "stopped", code });
    backend = null;
    if (backendConfig) backendConfig.status = "stopped";
  });

  await waitForHealth(baseUrl);
  backendConfig.status = "ready";
  sendBackendStatus({ status: "ready", port });
  console.log(`[backend] ready on ${baseUrl}`);
}

function stopBackend({ notify = true } = {}) {
  const processRef = backend;
  if (!processRef) {
    if (backendConfig) backendConfig.status = "stopped";
    if (notify) sendBackendStatus({ status: "stopped" });
    return Promise.resolve();
  }

  backend = null;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceKill);
      if (backendConfig) backendConfig.status = "stopped";
      if (notify) sendBackendStatus({ status: "stopped" });
      resolve();
    };
    const forceKill = setTimeout(() => {
      try {
        processRef.kill("SIGKILL");
      } catch {
        // The process may already be gone; finish() handles both paths.
      }
    }, 3000);
    processRef.once("exit", finish);
    try {
      processRef.kill();
    } catch {
      finish();
    }
  });
}

function restartBackend() {
  if (backendRestart) return backendRestart;
  backendRestart = (async () => {
    sendBackendStatus({
      status: "starting",
      port: backendConfig?.port,
      message: "Restarting extension bridge...",
    });
    await stopBackend({ notify: false });
    await startBackend();
    return appInfo();
  })().finally(() => {
    backendRestart = null;
  });
  return backendRestart;
}

function readEnvFile(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function cookieSyncConfig() {
  const envFile = readEnvFile(path.join(repoRoot(), ".env.vps"));
  const endpoint =
    process.env.NOTEBOOKLM_COOKIE_SYNC_ENDPOINT ||
    envFile.NOTEBOOKLM_COOKIE_SYNC_ENDPOINT ||
    DEFAULT_COOKIE_SYNC_ENDPOINT;
  const token = process.env.NOTEBOOKLM_COOKIE_SYNC_TOKEN || envFile.NOTEBOOKLM_COOKIE_SYNC_TOKEN || "";
  return { endpoint, token };
}

function localNotebookLmProfile() {
  return process.env.NOTEBOOKLM_LOCAL_PROFILE || "default";
}

function localNotebookLmHome() {
  return process.env.NOTEBOOKLM_LOCAL_HOME || path.join(os.homedir(), ".notebooklm");
}

function localStoragePath(profile = localNotebookLmProfile()) {
  return path.join(localNotebookLmHome(), "profiles", profile, "storage_state.json");
}

function localBrowserProfilePath(profile = localNotebookLmProfile()) {
  return path.join(localNotebookLmHome(), "profiles", profile, "browser_profile");
}

function runLocalLoginCommand(profile = localNotebookLmProfile(), { fresh = false } = {}) {
  const args = ["run", "--extra", "browser", "notebooklm"];
  if (profile && profile !== "default") {
    args.push("--profile", profile);
  }
  args.push("login");
  if (fresh) {
    args.push("--fresh");
  }
  return runCommand("uv", args, {
    cwd: repoRoot(),
    timeoutMs: LOCAL_LOGIN_TIMEOUT_MS,
    env: {
      ...process.env,
      NOTEBOOKLM_HOME: localNotebookLmHome(),
    },
  });
}

function runLocalAuthLogoutCommand(profile = localNotebookLmProfile()) {
  const args = ["run", "notebooklm"];
  if (profile && profile !== "default") {
    args.push("--profile", profile);
  }
  args.push("auth", "logout");
  return runCommand("uv", args, {
    cwd: repoRoot(),
    timeoutMs: LOCAL_RESET_TIMEOUT_MS,
    env: {
      ...process.env,
      NOTEBOOKLM_HOME: localNotebookLmHome(),
    },
  });
}

function commandOutput(result) {
  return `${result?.stderr || ""}\n${result?.stdout || ""}`.toLowerCase();
}

function runPlaywrightInstallCommand() {
  return runCommand("uv", ["run", "playwright", "install", "chromium"], {
    cwd: repoRoot(),
    timeoutMs: PLAYWRIGHT_INSTALL_TIMEOUT_MS,
    env: process.env,
  });
}

function loginFailureNeedsPlaywrightInstall(result) {
  const output = commandOutput(result);
  return (
    output.includes("playwright install") ||
    output.includes("executable doesn't exist") ||
    output.includes("executable does not exist") ||
    output.includes("browserType.launch_persistent_context".toLowerCase())
  );
}

function loginFailureNeedsFreshProfile(result) {
  const output = commandOutput(result);
  return (
    output.includes("browser window was closed during login") ||
    output.includes("switching google accounts in a persistent browser session") ||
    output.includes("notebooklm login --fresh") ||
    output.includes("notebooklm auth logout && notebooklm login")
  );
}

async function runLocalLoginWithBrowserBootstrap(profile = localNotebookLmProfile()) {
  const firstLogin = await runLocalLoginCommand(profile);
  let login = firstLogin;
  let setup = null;
  let retried = false;
  let freshRetried = false;

  if (!login.ok && loginFailureNeedsPlaywrightInstall(login)) {
    setup = await runPlaywrightInstallCommand();
    if (!setup.ok) {
      return { login, setup, retried, fresh_retried: freshRetried };
    }
    login = await runLocalLoginCommand(profile);
    retried = true;
  }

  if (!login.ok && loginFailureNeedsFreshProfile(login)) {
    login = await runLocalLoginCommand(profile, { fresh: true });
    retried = true;
    freshRetried = true;
  }

  return { login, setup, retried, fresh_retried: freshRetried };
}

function runCommand(command, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        command: [command, ...args].join(" "),
        returncode: null,
        timed_out: false,
        timeout_seconds: Math.round(timeoutMs / 1000),
        stdout,
        stderr: stderr || error.message,
      });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        command: [command, ...args].join(" "),
        returncode: code,
        timed_out: timedOut,
        timeout_seconds: Math.round(timeoutMs / 1000),
        stdout,
        stderr,
      });
    });
  });
}

async function readJsonResponse(response, label) {
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.toLowerCase().includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const message =
      body && typeof body === "object" && body.error ? body.error.message : String(body || label);
    throw new Error(`${label} failed: ${message}`);
  }
  return body;
}

function syncAuthHeaders(token) {
  return token ? { Authorization: `Bearer ${token.trim()}` } : {};
}

async function uploadStorageStateToVps(storageState) {
  const { endpoint, token } = cookieSyncConfig();
  if (!token) {
    throw new Error("NOTEBOOKLM_COOKIE_SYNC_TOKEN is missing in .env.vps.");
  }
  if (!storageState || !Array.isArray(storageState.cookies) || storageState.cookies.length === 0) {
    throw new Error("Local storage_state.json does not contain NotebookLM cookies.");
  }
  const parsedEndpoint = new URL(endpoint);
  const challengeUrl = new URL("/sync/challenge", parsedEndpoint.origin);
  const challenge = await readJsonResponse(
    await fetch(challengeUrl, {
      method: "GET",
      headers: syncAuthHeaders(token),
      cache: "no-store",
    }),
    "Cookie sync challenge",
  );
  if (!challenge || typeof challenge.challenge !== "string") {
    throw new Error("VPS did not issue a valid cookie-sync challenge.");
  }
  const result = await readJsonResponse(
    await fetch(parsedEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...syncAuthHeaders(token),
      },
      body: JSON.stringify({
        source: "drive-down-cookies",
        scope: "local-notebooklm-login",
        source_url: NOTEBOOKLM_COOKIE_SOURCE_URL,
        captured_at: new Date().toISOString(),
        challenge: challenge.challenge,
        cookies: storageState.cookies,
      }),
    }),
    "Cookie sync",
  );
  return result;
}

async function checkVpsConnected() {
  const { endpoint, token } = cookieSyncConfig();
  if (!token) {
    throw new Error("NOTEBOOKLM_COOKIE_SYNC_TOKEN is missing in .env.vps.");
  }
  const connectedUrl = new URL("/sync/connected", new URL(endpoint).origin);
  return readJsonResponse(
    await fetch(connectedUrl, {
      method: "GET",
      headers: syncAuthHeaders(token),
      cache: "no-store",
    }),
    "VPS connected check",
  );
}

async function checkVpsConnectedWithLocalRepair() {
  const firstCheck = await checkVpsConnected();
  if (firstCheck?.connected === true || firstCheck?.status !== "missing") {
    return firstCheck;
  }

  const storagePath = localStoragePath();
  if (!fs.existsSync(storagePath)) {
    return firstCheck;
  }

  const storageState = JSON.parse(fs.readFileSync(storagePath, "utf8"));
  const sync = await uploadStorageStateToVps(storageState);
  const repairedCheck = await checkVpsConnected();
  return {
    ...repairedCheck,
    repaired: repairedCheck?.connected === true,
    repair_sync: sync,
  };
}

async function resetLocalNotebookLmLogin() {
  const profile = localNotebookLmProfile();
  const storagePath = localStoragePath(profile);
  const browserProfilePath = localBrowserProfilePath(profile);
  const logout = await runLocalAuthLogoutCommand(profile);
  let browser_profile_deleted = false;
  let browser_profile_error = null;
  const browser_profile_existed = fs.existsSync(browserProfilePath);

  try {
    fs.rmSync(browserProfilePath, { recursive: true, force: true });
    browser_profile_deleted = browser_profile_existed && !fs.existsSync(browserProfilePath);
  } catch (error) {
    browser_profile_error =
      error instanceof Error ? error.message : "Could not remove local browser profile.";
  }

  const storage_exists = fs.existsSync(storagePath);
  const ok = logout.ok && !browser_profile_error && !storage_exists;
  return {
    ok,
    status: ok ? "reset" : "reset_incomplete",
    profile,
    storage_path: storagePath,
    browser_profile_path: browserProfilePath,
    storage_exists,
    browser_profile_existed,
    browser_profile_deleted,
    browser_profile_error,
    logout,
  };
}

async function localLoginAndSyncToVps() {
  const profile = localNotebookLmProfile();
  const storagePath = localStoragePath(profile);
  const { login, setup, retried, fresh_retried: freshRetried } =
    await runLocalLoginWithBrowserBootstrap(profile);
  if (!login.ok) {
    return {
      ok: false,
      status: login.timed_out ? "login_timeout" : "login_failed",
      profile,
      storage_path: storagePath,
      setup,
      retried,
      fresh_retried: freshRetried,
      login,
      sync: null,
      connected: null,
    };
  }
  if (!fs.existsSync(storagePath)) {
    return {
      ok: false,
      status: "storage_missing",
      profile,
      storage_path: storagePath,
      setup,
      retried,
      fresh_retried: freshRetried,
      login,
      sync: null,
      connected: null,
      error: "Local login completed, but storage_state.json was not found.",
    };
  }
  const storageState = JSON.parse(fs.readFileSync(storagePath, "utf8"));
  const sync = await uploadStorageStateToVps(storageState);
  const connected = await checkVpsConnected();
  return {
    ok: sync?.ok === true && connected?.connected === true,
    status: connected?.connected === true ? "connected" : "sync_failed",
    profile,
    storage_path: storagePath,
    setup,
    retried,
    fresh_retried: freshRetried,
    login,
    sync,
    connected,
  };
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#1a1a1a",
    title: APP_NAME,
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (message.includes("Electron Security Warning")) return;
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`[window] failed to load ${url}: ${code} ${description}`);
  });

  const devUrl = process.env.NOTEBOOKLM_DESKTOP_DEV_URL;
  if (devUrl) {
    console.log(`[window] loading ${devUrl}`);
    await mainWindow.loadURL(devUrl);
  } else {
    const filePath = path.join(__dirname, "..", "dist", "index.html");
    console.log(`[window] loading ${filePath}`);
    await mainWindow.loadFile(filePath);
  }
  const bridgeType = await mainWindow.webContents.executeJavaScript(
    "typeof window.notebooklmDesktop",
  );
  console.log(`[window] preload bridge: ${bridgeType}`);
}

ipcMain.handle("app:info", () => {
  return appInfo();
});

ipcMain.handle("backend:restart", async () => {
  try {
    return await restartBackend();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backend restart failed";
    sendBackendStatus({ status: "error", message });
    throw error;
  }
});

ipcMain.handle("notebooklm:local-login-sync", async () => {
  try {
    return await localLoginAndSyncToVps();
  } catch (error) {
    return {
      ok: false,
      status: "sync_failed",
      error: error instanceof Error ? error.message : "Local login sync failed",
    };
  }
});

ipcMain.handle("notebooklm:reset-local-login", async () => {
  try {
    return await resetLocalNotebookLmLogin();
  } catch (error) {
    return {
      ok: false,
      status: "reset_failed",
      error: error instanceof Error ? error.message : "Local login reset failed",
    };
  }
});

ipcMain.handle("notebooklm:check-vps-connected", async () => {
  try {
    return await checkVpsConnectedWithLocalRepair();
  } catch (error) {
    return {
      ok: false,
      status: "check_failed",
      connected: false,
      error: error instanceof Error ? error.message : "VPS connected check failed",
    };
  }
});

ipcMain.handle("backend:request", async (_event, request) => {
  if (!backendConfig || backendConfig.status !== "ready") {
    throw new Error("Backend is not ready");
  }
  const url = new URL(request.path, backendConfig.baseUrl);
  console.log(`[backend request] ${request.method || "GET"} ${url.pathname}${url.search}`);
  const headers = {
    Authorization: `Bearer ${backendConfig.token}`,
    ...(request.headers || {}),
  };
  let requestBody;
  if (request.file) {
    const form = new FormData();
    const bytes = Buffer.from(request.file.data);
    const blob = new Blob([bytes], {
      type: request.file.type || "application/octet-stream",
    });
    form.append("file", blob, request.file.name || "upload");
    for (const [key, value] of Object.entries(request.form || {})) {
      if (value !== undefined && value !== null && value !== "") {
        form.append(key, String(value));
      }
    }
    requestBody = form;
  } else if (request.body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(request.body);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetch(url, {
      method: request.method || "GET",
      headers,
      body: requestBody,
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`Backend request timed out: ${request.path}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    const errorBody = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    const detail =
      typeof errorBody === "object" && errorBody && errorBody.error
        ? errorBody.error.message
        : errorBody;
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  if (request.download) {
    const suggestedName =
      request.suggestedName || filenameFromDisposition(response.headers.get("content-disposition"));
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: suggestedName || "notebooklm-artifact",
    });
    if (canceled || !filePath) {
      return { canceled: true };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, bytes);
    return {
      canceled: false,
      path: filePath,
      filename: path.basename(filePath),
      bytes: bytes.length,
    };
  }
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  console.log(`[backend response] ${response.status} ${request.path}`);
  return body;
});

function filenameFromDisposition(value) {
  if (!value) return null;
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) return decodeURIComponent(utf8Match[1].replace(/"/g, ""));
  const asciiMatch = value.match(/filename="?([^";]+)"?/i);
  return asciiMatch ? asciiMatch[1] : null;
}

app.whenReady().then(async () => {
  console.log("[app] ready");
  if (process.platform === "darwin" && fs.existsSync(APP_ICON_PATH)) {
    app.dock.setIcon(APP_ICON_PATH);
  }
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: appInfo().version,
    iconPath: APP_ICON_PATH,
  });
  await createWindow();
  startBackend().catch((error) => {
    console.error("[backend] failed", error);
    sendBackendStatus({ status: "error", message: error.message });
  });
});

app.on("window-all-closed", () => {
  if (backend) backend.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (backend) backend.kill();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (backend) backend.kill();
    app.quit();
  });
}
