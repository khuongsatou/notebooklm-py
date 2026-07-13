const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

let mainWindow = null;
let backend = null;
let backendConfig = null;

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
  backend.on("exit", (code) => {
    sendBackendStatus({ status: "stopped", code });
    backend = null;
    if (backendConfig) backendConfig.status = "stopped";
  });

  await waitForHealth(baseUrl);
  backendConfig.status = "ready";
  sendBackendStatus({ status: "ready", port });
  console.log(`[backend] ready on ${baseUrl}`);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#1a1a1a",
    title: "NotebookLM Pro",
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
  const pkgPath = path.join(__dirname, "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return {
    name: pkg.name,
    version: pkg.version,
    backend: backendConfig ? { ...backendConfig, token: undefined } : null,
  };
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
