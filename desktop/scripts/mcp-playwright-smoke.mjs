import { _electron as electron } from "playwright";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopDir, "..");
const endpoint = process.env.NOTEBOOKLM_MCP_SMOKE_ENDPOINT || "http://127.0.0.1:19420/mcp";
const outputDir = path.join(desktopDir, "test-results");
const keyName = `Playwright MCP smoke ${new Date().toISOString()}`;
const uiTimeout = Number(process.env.NOTEBOOKLM_MCP_SMOKE_UI_TIMEOUT || 30_000);

function parseMcpPayload(text, contentType) {
  if (!text.trim()) return null;
  if (contentType.includes("text/event-stream")) {
    const messages = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return messages.at(-1) || null;
  }
  return JSON.parse(text);
}

async function mcpRequest(apiKey, body, sessionId = "") {
  const headers = {
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    sessionId: response.headers.get("mcp-session-id") || sessionId,
    payload: parseMcpPayload(text, response.headers.get("content-type") || ""),
  };
}

let app;
let page;
let issuedKey = "";
let keyId = "";
let revoked = false;
let createdNotebookId = "";
let createdNotebookDeleted = false;
let mcpSessionId = "";

try {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, {
    NOTEBOOKLM_PROFILE: "default",
    NOTEBOOKLM_MCP_MANIFEST_BASE_URL: endpoint.replace(/\/mcp$/, ""),
    NOTEBOOKLM_MCP_MANAGED_KEYS_ENABLED: "1",
  });

  app = await electron.launch({
    args: [desktopDir],
    cwd: repoRoot,
    env,
  });
  page = await app.firstWindow();
  await fs.mkdir(outputDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 920 });
  try {
    await page.getByRole("button", { name: "MCP", exact: true }).waitFor({ timeout: uiTimeout });
  } catch (error) {
    await page.screenshot({ path: path.join(outputDir, "mcp-playwright-smoke-debug.png"), fullPage: true });
    process.stderr.write(`Page URL: ${page.url()}\n`);
    process.stderr.write(`Scripts: ${await page.locator("script").evaluateAll((items) => items.map((item) => item.getAttribute("src")))}\n`);
    process.stderr.write(`Tabs: ${await page.locator(".tabs button").allTextContents()}\n`);
    process.stderr.write(`${(await page.locator("body").innerText()).slice(0, 4_000)}\n`);
    throw error;
  }
  await page.getByRole("button", { name: "MCP", exact: true }).click();
  await page.getByRole("heading", { name: "MCP connections" }).waitFor();
  await page.getByText(endpoint, { exact: true }).waitFor();
  const usageDashboard = page.getByLabel("Thống kê sử dụng MCP");
  await usageDashboard.getByRole("heading", { name: "Usage Dashboard" }).waitFor();
  const createMetric = usageDashboard.locator("article", { hasText: "Lượt tạo" }).locator("strong");
  await createMetric.waitFor();
  const createRequestedBefore = Number((await createMetric.textContent())?.replace(/\D/g, "") || 0);

  await page.getByPlaceholder("Ví dụ: Claude Desktop").fill(keyName);
  await page.getByRole("button", { name: "Generate New Key" }).click();
  const issued = page.locator(".mcp-issued-key");
  await issued.waitFor();
  issuedKey = (await issued.locator("code").textContent())?.trim() || "";
  if (!/^nlm_mcp_[A-Za-z0-9_-]{40,}$/.test(issuedKey)) {
    throw new Error("UI did not return a valid one-time managed key");
  }

  const matchingRow = page.locator(".mcp-key-row", { hasText: keyName }).first();
  await matchingRow.waitFor();
  const revokeButton = matchingRow.getByRole("button", { name: `Thu hồi key ${keyName}` });
  const initialize = await mcpRequest(issuedKey, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "notebooklm-pro-playwright-smoke", version: "1.0.0" },
    },
  });
  if (initialize.status !== 200 || !initialize.sessionId || initialize.payload?.error) {
    throw new Error(`MCP initialize failed with HTTP ${initialize.status}`);
  }
  mcpSessionId = initialize.sessionId;

  const initialized = await mcpRequest(
    issuedKey,
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    initialize.sessionId,
  );
  if (![200, 202].includes(initialized.status)) {
    throw new Error(`MCP initialized notification failed with HTTP ${initialized.status}`);
  }

  const toolsList = await mcpRequest(
    issuedKey,
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    initialize.sessionId,
  );
  const tools = toolsList.payload?.result?.tools || [];
  if (toolsList.status !== 200 || !tools.some((tool) => tool.name === "server_info")) {
    throw new Error(`MCP tools/list failed with HTTP ${toolsList.status}`);
  }

  const toolCall = await mcpRequest(
    issuedKey,
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "server_info", arguments: {} },
    },
    initialize.sessionId,
  );
  if (
    toolCall.status !== 200 ||
    toolCall.payload?.error ||
    toolCall.payload?.result?.isError === true
  ) {
    throw new Error(`MCP tools/call failed with HTTP ${toolCall.status}`);
  }

  const smokeNotebookTitle = `MCP smoke ${new Date().toISOString()}`;
  const createCall = await mcpRequest(
    issuedKey,
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "notebook_create", arguments: { title: smokeNotebookTitle } },
    },
    initialize.sessionId,
  );
  createdNotebookId = createCall.payload?.result?.structuredContent?.notebook_id || "";
  if (
    createCall.status !== 200 ||
    createCall.payload?.error ||
    createCall.payload?.result?.isError === true ||
    !createdNotebookId
  ) {
    throw new Error(`MCP notebook_create smoke failed with HTTP ${createCall.status}`);
  }

  await usageDashboard.getByRole("button", { name: "Làm mới thống kê MCP" }).click();
  await page.waitForFunction(
    ({ selector, before }) => {
      const value = document.querySelector(selector)?.textContent || "";
      return Number(value.replace(/\D/g, "") || 0) > before;
    },
    { selector: ".mcp-kpi-grid article:first-child strong", before: createRequestedBefore },
  );

  const deleteCall = await mcpRequest(
    issuedKey,
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "notebook_delete", arguments: { notebook: createdNotebookId, confirm: true } },
    },
    initialize.sessionId,
  );
  if (
    deleteCall.status !== 200 ||
    deleteCall.payload?.error ||
    deleteCall.payload?.result?.isError === true
  ) {
    throw new Error(`MCP notebook_delete cleanup failed with HTTP ${deleteCall.status}`);
  }
  createdNotebookDeleted = true;

  // Keep the screenshot artifact safe: the live secret remains in memory for
  // the protocol/revoke checks but is hidden from the captured UI evidence.
  await page.getByRole("button", { name: "Đã lưu" }).click();
  await page.screenshot({
    path: path.join(outputDir, "mcp-playwright-smoke-active.png"),
    fullPage: true,
  });

  await revokeButton.click();
  await matchingRow.getByText("Revoked", { exact: true }).waitFor();
  revoked = true;
  keyId = "managed-key";

  const rejected = await mcpRequest(issuedKey, {
    jsonrpc: "2.0",
    id: 6,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "revoked-key-check", version: "1.0.0" },
    },
  });
  if (rejected.status !== 401) {
    throw new Error(`Revoked key was not rejected; received HTTP ${rejected.status}`);
  }

  await page.screenshot({
    path: path.join(outputDir, "mcp-playwright-smoke-revoked.png"),
    fullPage: true,
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    endpoint,
    keyName,
    keyId,
    initializeStatus: initialize.status,
    initializedStatus: initialized.status,
    toolsListStatus: toolsList.status,
    toolCount: tools.length,
    toolCallStatus: toolCall.status,
    createCallStatus: createCall.status,
    createTelemetryIncremented: true,
    smokeNotebookDeleted: createdNotebookDeleted,
    revokedStatus: rejected.status,
    secretRedacted: true,
  }, null, 2)}\n`);
} finally {
  if (issuedKey && createdNotebookId && !createdNotebookDeleted) {
    try {
      const cleanup = await mcpRequest(
        issuedKey,
        {
          jsonrpc: "2.0",
          id: 99,
          method: "tools/call",
          params: { name: "notebook_delete", arguments: { notebook: createdNotebookId, confirm: true } },
        },
        mcpSessionId,
      );
      createdNotebookDeleted = cleanup.status === 200 && !cleanup.payload?.error;
    } catch {
      process.stderr.write(`Smoke notebook cleanup required: ${createdNotebookId}\n`);
    }
  }
  if (page && issuedKey && !revoked) {
    try {
      const cleanupRow = page.locator(".mcp-key-row", { hasText: keyName }).first();
      await cleanupRow.getByRole("button", { name: `Thu hồi key ${keyName}` }).click({ timeout: 5_000 });
      await cleanupRow.getByText("Revoked", { exact: true }).waitFor({ timeout: 5_000 });
      revoked = true;
    } catch {
      process.stderr.write("Smoke stopped before the managed key could be revoked.\n");
    }
  }
  issuedKey = "";
  if (app) await app.close();
}
