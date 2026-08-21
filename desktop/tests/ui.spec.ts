import { expect, test, type Page } from "@playwright/test";

const notebooks = [
  { id: "nb-1", title: "AI Research OS" },
  { id: "nb-2", title: "Creator Pipeline Notes With A Very Long Notebook Name That Must Truncate" },
  { id: "nb-3", title: "NotebookLM Backend Mapping" },
];

const sources = [
  { id: "src-1", title: "Architecture reference", status: 3, url: "https://example.com/a" },
  { id: "src-2", title: "Runtime RPC auth pipeline", status: 3, url: "https://example.com/b" },
  { id: "src-3", title: "Long pasted source title that should truncate cleanly", status: 1 },
];

const artifacts = [
  { id: "art-1", title: "Briefing report", status: "completed" },
  { id: "art-2", title: "Deep dive audio", status: "in_progress" },
];

const notes = [
  { id: "note-1", title: "Launch checklist", content: "One" },
  { id: "note-2", title: "Citation notes", content: "Two" },
];

test.beforeEach(async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await page.addInitScript(
    ({ notebooksSeed, sourcesSeed, artifactsSeed, notesSeed }) => {
      const listeners: Array<(payload: unknown) => void> = [];
      const state = {
        notebooks: [...notebooksSeed],
        sources: [...sourcesSeed],
        artifacts: [...artifactsSeed],
        notes: [...notesSeed],
        labels: [{ id: "label-1", name: "Architecture", emoji: "🏷️", source_ids: ["src-1"] }],
        researchTaskId: "research-1",
        language: "en",
        mcpKeys: [] as Array<{
          id: string;
          name: string;
          prefix: string;
          status: "active" | "revoked";
          createdAt: string;
          createdBy: string;
          lastUsedAt: string;
          revokedAt: string;
          legacy: boolean;
        }>,
      };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as typeof window & { __copiedText?: string }).__copiedText = text;
          },
        },
      });
      (window as typeof window & { __openedExternal?: string[] }).__openedExternal = [];
      window.open = ((url?: string | URL) => {
        (window as typeof window & { __openedExternal?: string[] }).__openedExternal?.push(
          String(url),
        );
        return null;
      }) as typeof window.open;
      (window as typeof window & { __extensionMessages?: string[] }).__extensionMessages = [];
      Object.defineProperty(window, "chrome", {
        configurable: true,
        value: {
          runtime: {
            sendMessage(
              _extensionId: string,
              message: { type?: string },
              callback: (response: Record<string, unknown>) => void,
            ) {
              (window as typeof window & { __extensionMessages?: string[] }).__extensionMessages?.push(
                message.type || "unknown",
              );
              callback(
                message.type === "connect"
                  ? { ok: true, status: "ready", extension_version: "0.7.3" }
                  : {
                      ok: true,
                      status: "ok",
                      cookie_count: 12,
                      received_count: 12,
                      persisted_count: 12,
                      client_reloaded: true,
                      auth_verified: true,
                    },
              );
            },
          },
        },
      });
      (window as typeof window & { __backendRequests?: string[]; __restartBackendCalls?: number }).__backendRequests = [];
      (window as typeof window & { __backendRequests?: string[]; __restartBackendCalls?: number }).__restartBackendCalls = 0;
      (window as typeof window & {
        __emitBackendStatus?: (payload: { status: string; message?: string }) => void;
      }).__emitBackendStatus = (payload) => {
        for (const listener of listeners) listener(payload);
      };

      const backendInfo = { baseUrl: "http://127.0.0.1:5173", port: 5173, status: "ready" as const };

      window.notebooklmDesktop = {
        async getAppInfo() {
          return {
            name: "notebooklm-pro-desktop",
            version: "0.1.0",
            backend: backendInfo,
          };
        },
        async restartBackend() {
          (window as typeof window & { __restartBackendCalls?: number }).__restartBackendCalls =
            ((window as typeof window & { __restartBackendCalls?: number }).__restartBackendCalls || 0) + 1;
          return {
            name: "notebooklm-pro-desktop",
            version: "0.1.0",
            backend: backendInfo,
          };
        },
        async backendRequest(request) {
          const path = request.path;
          const method = request.method || "GET";
          (window as typeof window & { __backendRequests?: string[] }).__backendRequests?.push(
            `${method} ${path}`,
          );

          if (path === "/v1/status") {
            return { ok: true, server: "notebooklm-server", version: "0.8.0" };
          }
          if (path === "/v1/notebooks" && method === "GET") {
            return { notebooks: state.notebooks };
          }
          if (path === "/v1/notebooks" && method === "POST") {
            const title = String((request.body as { title?: string })?.title || "New notebook");
            const notebook = { id: `nb-${state.notebooks.length + 1}`, title };
            state.notebooks = [notebook, ...state.notebooks];
            return notebook;
          }
          if (/^\/v1\/notebooks\/[^/]+$/.test(path) && method === "PATCH") {
            const id = path.split("/").pop();
            const title = String((request.body as { title?: string })?.title || "");
            const notebook = state.notebooks.find((item) => item.id === id);
            if (!notebook) throw new Error("Notebook not found");
            notebook.title = title;
            return notebook;
          }
          if (/^\/v1\/notebooks\/[^/]+$/.test(path) && method === "DELETE") {
            const id = path.split("/").pop();
            state.notebooks = state.notebooks.filter((item) => item.id !== id);
            return {};
          }
          if (path.includes("/summary")) {
            return {
              notebook_id: "nb-1",
              summary:
                "A compact workspace for sources, chat, studio generation, artifacts, notes, and sharing.",
            };
          }
          if (path.includes("/sources") && method === "GET" && !path.includes("/sources/")) {
            return { sources: state.sources };
          }
          if (path.includes("/sources/") && method === "GET") {
            const sourceId = path.split("/").pop();
            const source = state.sources.find((item) => item.id === sourceId);
            return source ? { ...source, status: 3 } : { source_id: sourceId, status: "pending" };
          }
          if (path.includes("/sources/url") && method === "POST") {
            const source = { id: `src-${state.sources.length + 1}`, title: "New URL", status: 1 };
            state.sources = [...state.sources, source];
            return source;
          }
          if (path.includes("/sources/text") && method === "POST") {
            const source = { id: `src-${state.sources.length + 1}`, title: "New Text", status: 1 };
            state.sources = [...state.sources, source];
            return source;
          }
          if (path.includes("/sources/file") && method === "POST") {
            const upload = request.file as { name?: string } | undefined;
            const form = request.form as { title?: string } | undefined;
            const source = {
              id: `src-${state.sources.length + 1}`,
              title: form?.title || upload?.name || "New File",
              status: 1,
            };
            state.sources = [...state.sources, source];
            return source;
          }
          if (path.includes("/sources/drive") && method === "POST") {
            const body = request.body as { title?: string; file_id?: string };
            const source = {
              id: `src-${state.sources.length + 1}`,
              title: body.title || "Drive source",
              status: 1,
              url: `https://drive.google.com/file/d/${body.file_id || "drive"}`,
            };
            state.sources = [...state.sources, source];
            return source;
          }
          if (path.includes("/sources/") && method === "DELETE") {
            const sourceId = path.split("/").pop();
            state.sources = state.sources.filter((item) => item.id !== sourceId);
            return {};
          }
          if (path.includes("/chat") && method === "POST") {
            return {
              answer:
                "This is a grounded answer with citations rendered in a stable text container.",
              conversation_id: "conv-1",
              references: [],
            };
          }
          if (path.includes("/artifacts/") && method === "GET") {
            const taskId = path.split("/").pop() || "task-1";
            return { task_id: taskId, status: "completed", is_complete: true };
          }
          if (path.includes("/artifacts") && method === "GET") {
            return { artifacts: state.artifacts };
          }
          if (path.includes("/artifacts/download") && method === "POST") {
            return {
              canceled: false,
              path: "/tmp/notebooklm-report.md",
              filename: "notebooklm-report.md",
              bytes: 128,
            };
          }
          if (path.includes("/artifacts") && method === "POST") {
            return { task_id: "task-1", status: "pending", kind: "report" };
          }
          if (path.includes("/notes") && method === "GET") {
            return { notes: state.notes };
          }
          if (path.includes("/notes") && method === "POST") {
            const body = request.body as { title?: string; content?: string };
            const note = {
              id: `note-${state.notes.length + 1}`,
              title: body.title || "New Note",
              content: body.content || "",
            };
            state.notes = [...state.notes, note];
            return note;
          }
          if (path.includes("/share")) {
            return {
              notebook_id: "nb-1",
              is_public: false,
              access: "restricted",
              shared_users: [],
            };
          }
          if (path.includes("/labels/generate") && method === "POST") {
            state.labels = [
              ...state.labels,
              { id: `label-${state.labels.length + 1}`, name: "Generated", emoji: "✨", source_ids: ["src-1"] },
            ];
            return { labels: state.labels, count: state.labels.length };
          }
          if (path.includes("/labels") && method === "GET" && !path.includes("/labels/")) {
            return { labels: state.labels };
          }
          if (path.includes("/labels") && method === "POST" && !path.includes("/sources")) {
            const body = request.body as { name?: string; emoji?: string };
            const label = {
              id: `label-${state.labels.length + 1}`,
              name: body.name || "New label",
              emoji: body.emoji || "",
              source_ids: [],
            };
            state.labels = [label, ...state.labels];
            return label;
          }
          if (path.includes("/labels/") && path.includes("/emoji") && method === "PATCH") {
            const labelId = path.split("/labels/")[1].split("/")[0];
            const body = request.body as { emoji?: string };
            const label = state.labels.find((item) => item.id === labelId);
            if (!label) throw new Error("Label not found");
            label.emoji = body.emoji || "";
            return label;
          }
          if (path.includes("/labels/") && path.includes("/sources") && method === "POST") {
            const labelId = path.split("/labels/")[1].split("/")[0];
            const body = request.body as { source_ids?: string[] };
            const label = state.labels.find((item) => item.id === labelId);
            if (!label) throw new Error("Label not found");
            label.source_ids = Array.from(new Set([...label.source_ids, ...(body.source_ids || [])]));
            return { label, source_ids: body.source_ids || [] };
          }
          if (path.includes("/labels/") && path.includes("/sources") && method === "DELETE") {
            const labelId = path.split("/labels/")[1].split("/")[0];
            const body = request.body as { source_ids?: string[] };
            const label = state.labels.find((item) => item.id === labelId);
            if (!label) throw new Error("Label not found");
            const remove = new Set(body.source_ids || []);
            label.source_ids = label.source_ids.filter((sourceId) => !remove.has(sourceId));
            return { label, source_ids: body.source_ids || [] };
          }
          if (path.includes("/labels/") && method === "PATCH") {
            const labelId = path.split("/labels/")[1];
            const body = request.body as { name?: string };
            const label = state.labels.find((item) => item.id === labelId);
            if (!label) throw new Error("Label not found");
            label.name = body.name || label.name;
            return label;
          }
          if (path.includes("/labels/") && method === "DELETE") {
            const labelId = path.split("/labels/")[1];
            state.labels = state.labels.filter((item) => item.id !== labelId);
            return {};
          }
          if (path.includes("/research/status")) {
            return {
              notebook_id: "nb-1",
              task_id: state.researchTaskId,
              kind: "completed",
              status: "completed",
              query: "audit",
              sources: [{ title: "Research result", url: "https://example.com/research" }],
              summary: "Research completed",
              report: "Research report",
            };
          }
          if (path.includes("/research/") && method === "DELETE") {
            return {};
          }
          if (path.includes("/research") && method === "POST") {
            return {
              task_id: state.researchTaskId,
              report_id: null,
              notebook_id: "nb-1",
              query: String((request.body as { query?: string })?.query || ""),
              mode: String((request.body as { mode?: string })?.mode || "fast"),
            };
          }
          if (path === "/v1/mcp/config") {
            return {
              ok: true,
              product: { name: "NotebookLM Pro", slug: "notebooklm-pro" },
              endpoint: "https://notebooklm.example.test/mcp",
              transport: "streamable-http",
              protocolVersion: "2025-03-26",
              auth: { type: "header", header: "Authorization", valuePrefix: "Bearer" },
              features: [{ id: "notebooks", label: "Notebooks", tools: ["notebook_list", "notebook_create"] }],
            };
          }
          if (path === "/v1/mcp/keys" && method === "GET") {
            return { ok: true, keys: state.mcpKeys };
          }
          if (path === "/v1/mcp/keys" && method === "POST") {
            const name = String((request.body as { name?: string })?.name || "MCP API key");
            const key = {
              id: `key-${state.mcpKeys.length + 1}`,
              name,
              prefix: "nlm_mcp_demo…1234",
              status: "active" as const,
              createdAt: "2026-08-14T06:00:00Z",
              createdBy: "dashboard",
              lastUsedAt: "",
              revokedAt: "",
              legacy: false,
            };
            state.mcpKeys = [key, ...state.mcpKeys];
            return { ok: true, apiKey: "nlm_mcp_test-secret-once", key };
          }
          if (path.startsWith("/v1/mcp/keys/") && method === "DELETE") {
            const id = path.split("/").pop();
            const key = state.mcpKeys.find((item) => item.id === id);
            if (!key) throw new Error("MCP key not found");
            key.status = "revoked";
            key.revokedAt = "2026-08-14T06:05:00Z";
            return { ok: true, key };
          }
          if (path.startsWith("/v1/mcp/usage") && method === "GET") {
            const period = path.includes("period=today") ? "today" : path.includes("period=30d") ? "30d" : "7d";
            return {
              ok: true,
              period: {
                name: period,
                from: period === "today" ? "2026-08-14" : "2026-08-08",
                to: "2026-08-14",
                timeZone: "Asia/Ho_Chi_Minh",
              },
              summary: {
                createRequested: 12,
                createSuccess: 9,
                createFailed: 3,
                downloadSuccess: 5,
                dailyLimit: 100,
                dailyUsed: 9,
                dailyReserved: 1,
                dailyRemaining: 90,
                dailyResetAt: "2026-08-14T17:00:00Z",
              },
              series: [
                { date: "2026-08-13", createRequested: 4, createSuccess: 3, createFailed: 1, downloadSuccess: 2 },
                { date: "2026-08-14", createRequested: 8, createSuccess: 6, createFailed: 2, downloadSuccess: 3 },
              ],
              recent: [
                {
                  id: "usage-1",
                  tool: "artifact_generate",
                  operation: "create",
                  status: "success",
                  keyId: "key-1",
                  keyPrefix: "nlm_mcp_demo…1234",
                  latencyMs: 842,
                  errorCode: "",
                  createdAt: "2026-08-14T06:10:00Z",
                  dateKey: "2026-08-14",
                },
                {
                  id: "usage-2",
                  tool: "note_create",
                  operation: "create",
                  status: "failed",
                  keyId: "key-1",
                  keyPrefix: "nlm_mcp_demo…1234",
                  latencyMs: 15,
                  errorCode: "ValidationError",
                  createdAt: "2026-08-14T06:05:00Z",
                  dateKey: "2026-08-14",
                },
              ],
            };
          }
          if (path === "/v1/settings") {
            return {
              server: "notebooklm-server",
              version: "0.8.0",
              language: state.language,
              language_name: state.language === "vi" ? "Tiếng Việt" : "English",
              languages: { en: "English", vi: "Tiếng Việt" },
            };
          }
          if (path === "/v1/settings/language" && method === "PATCH") {
            state.language = String((request.body as { code?: string })?.code || "en");
            return { language: state.language, language_name: state.language === "vi" ? "Tiếng Việt" : "English" };
          }
          if (path === "/v1/settings/update") {
            return {
              current_version: "0.1.0",
              latest_version: "0.1.0",
              update_available: false,
              channel: "local",
              message: "Local build is running; no remote update feed is configured.",
            };
          }
          return {};
        },
        onBackendStatus(callback) {
          listeners.push(callback);
          window.setTimeout(() => callback({ status: "ready", port: 5173 }), 0);
          return () => undefined;
        },
      };
    },
    {
      notebooksSeed: notebooks,
      sourcesSeed: sources,
      artifactsSeed: artifacts,
      notesSeed: notes,
    },
  );

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "NotebookLM Pro" })).toBeVisible();

  (page as Page & { consoleErrors?: string[] }).consoleErrors = consoleErrors;
});

test.afterEach(async ({ page }, testInfo) => {
  const errors = (page as Page & { consoleErrors?: string[] }).consoleErrors || [];
  expect(errors, `Console/page errors:\n${errors.join("\n")}`).toEqual([]);
  await expectNoHorizontalOverflow(page);
  await expectStableClickableControls(page);
  await testInfo.attach("screenshot", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("overview and version modal stay inside viewport", async ({ page }) => {
  await expect(page.locator(".notebook-row.active", { hasText: "AI Research OS" })).toBeVisible();
  await expect(page.locator(".notebook-detail", { hasText: "AI Research OS" })).toBeVisible();
  const dockOrder = await page.locator(".status-dock").evaluate((dock) =>
    Array.from(dock.children).map((node) => {
      const element = node as HTMLElement;
      return element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent?.trim() || "";
    }),
  );
  expect(dockOrder.indexOf("Connect Drive Down Cookies")).toBeLessThan(
    dockOrder.indexOf("Get cookies from extension"),
  );
  expect(dockOrder.indexOf("Get cookies from extension")).toBeLessThan(
    dockOrder.findIndex((item) => item.startsWith("Drive Down Cookies:")),
  );
  expect(dockOrder.findIndex((item) => item.startsWith("Drive Down Cookies:"))).toBeLessThan(
    dockOrder.findIndex((item) => item.includes("ready")),
  );
  await expectSidebarContained(page);
  await expect(page.locator(".tabs").getByRole("button", { name: "Sources", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Version/ }).click();
  await expect(page.locator(".modal .panel-title").getByText("Update", { exact: true })).toBeVisible();
  await expectElementInsideViewport(page, ".modal");
});

test("notebook open buttons launch Google NotebookLM URL", async ({ page }) => {
  await page
    .locator(".notebook-row.active")
    .getByTitle("Open AI Research OS in Google NotebookLM")
    .click();
  await page.locator(".notebook-detail").getByTitle("Open with NotebookLM").click();

  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { __openedExternal?: string[] }).__openedExternal),
    )
    .toEqual([
      "https://notebooklm.google.com/notebook/nb-1",
      "https://notebooklm.google.com/notebook/nb-1",
    ]);
});

test("status code 16 automatically syncs cookies and retries the failed request once", async ({
  page,
}) => {
  await page.evaluate(() => {
    const bridge = window.notebooklmDesktop;
    if (!bridge) throw new Error("Desktop bridge mock is unavailable");
    const originalRequest = bridge.backendRequest.bind(bridge);
    let rejectNotebookListOnce = true;
    bridge.backendRequest = async (request) => {
      if (request.path === "/v1/notebooks" && (request.method || "GET") === "GET") {
        const testWindow = window as typeof window & { __authRecoveryNotebookAttempts?: number };
        testWindow.__authRecoveryNotebookAttempts =
          (testWindow.__authRecoveryNotebookAttempts || 0) + 1;
      }
      if (
        rejectNotebookListOnce &&
        request.path === "/v1/notebooks" &&
        (request.method || "GET") === "GET"
      ) {
        rejectNotebookListOnce = false;
        throw new Error(
          "RPC wXbhsf returned null result with status code 16 (Unauthenticated). Found IDs: ['wXbhsf'].",
        );
      }
      return originalRequest(request);
    };
    (window as typeof window & { __extensionMessages?: string[] }).__extensionMessages = [];
  });

  await page.getByTitle("Refresh notebooks").click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __extensionMessages?: string[] }).__extensionMessages,
      ),
    )
    .toEqual(["sync-now"]);
  await expect(page.getByTitle("Drive Down Cookies: 12 cookies verified from local Chrome")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __authRecoveryNotebookAttempts?: number })
            .__authRecoveryNotebookAttempts,
      ),
    )
    .toBe(2);
  await expect(page.locator(".error-banner")).toHaveCount(0);
});

test("research binds Cancel to the replacement task, never the previous task", async ({
  page,
}) => {
  await page.evaluate(() => {
    const bridge = window.notebooklmDesktop;
    if (!bridge) throw new Error("Desktop bridge mock is unavailable");
    const originalRequest = bridge.backendRequest.bind(bridge);
    let startCount = 0;

    bridge.backendRequest = async (request) => {
      const method = request.method || "GET";
      if (request.path.endsWith("/research") && method === "POST") {
        const testWindow = window as typeof window & {
          __backendRequests?: string[];
          __resolveResearchStart?: () => void;
        };
        testWindow.__backendRequests?.push(`${method} ${request.path}`);
        startCount += 1;
        if (startCount === 1) {
          return { task_id: "research-old", report_id: null, status: "started" };
        }
        return new Promise((resolve) => {
          testWindow.__resolveResearchStart = () =>
            resolve({ task_id: "research-new", report_id: null, status: "started" });
        });
      }
      return originalRequest(request);
    };
  });

  await clickTab(page, "Research");
  const query = page.getByPlaceholder("Research topic or question");
  const start = page.getByRole("button", { name: "Start", exact: true });
  const status = page.getByRole("button", { name: "Status", exact: true });
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });

  await query.fill("First research task");
  await start.click();
  await expect(page.locator(".json-preview")).toContainText('"task_id": "research-old"');

  await query.fill("Replacement research task");
  await start.click();
  await expect.soft(start).toBeDisabled();
  await expect.soft(status).toBeDisabled();
  await expect.soft(cancel).toBeDisabled();
  await expect.soft(page.locator(".task-count")).toHaveText("starting");

  await page.evaluate(() => {
    const testWindow = window as typeof window & { __resolveResearchStart?: () => void };
    testWindow.__resolveResearchStart?.();
  });
  await expect(page.locator(".json-preview")).toContainText('"task_id": "research-new"');
  await expect(cancel).toBeEnabled();
  await cancel.click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as typeof window & { __backendRequests?: string[] }).__backendRequests || [])
          .filter((request) => request.startsWith("DELETE ")),
      ),
    )
    .toEqual(["DELETE /v1/notebooks/nb-1/research/research-new"]);
});

test("blank notebook titles render a stable accessible fallback", async ({ page }) => {
  await page.evaluate(() => {
    const bridge = window.notebooklmDesktop;
    if (!bridge) throw new Error("Desktop bridge mock is unavailable");
    const originalRequest = bridge.backendRequest.bind(bridge);
    bridge.backendRequest = async (request) => {
      if (request.path === "/v1/notebooks" && (request.method || "GET") === "GET") {
        const result = await originalRequest(request) as {
          notebooks: Array<{ id: string; title: string }>;
        };
        return {
          notebooks: [
            ...result.notebooks,
            { id: "nb-empty-1234", title: "   " },
          ],
        };
      }
      return originalRequest(request);
    };
  });

  await page.getByTitle("Refresh notebooks").click();
  const fallbackName = "Untitled notebook · nb-empty";
  await expect(page.getByRole("button", { name: fallbackName, exact: true })).toBeVisible();
  await expect(page.getByTitle(`Delete notebook ${fallbackName}`)).toBeVisible();

  await page.getByPlaceholder("Search notebook").fill("nb-empty");
  await expect(page.locator(".notebook-row")).toHaveCount(1);
  await expect(page.getByRole("button", { name: fallbackName, exact: true })).toBeVisible();
});

test("all workspace tabs render without layout overflow", async ({ page }) => {
  const tabs = [
    "Overview",
    "Sources",
    "Chat",
    "Studio",
    "Artifacts",
    "Notes",
    "Verify",
    "Share",
    "MCP",
  ];

  for (const tab of tabs) {
    await clickTab(page, tab);
    await expect(page.locator(".content")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectSidebarContained(page);
    await expectNoVisibleOverlap(page);
  }

  for (const tab of ["Research", "Labels", "Settings"]) {
    const button = page.locator(".tabs").getByRole("button", { name: tab, exact: true });
    await expect(button).toBeEnabled();
  }
});

test("late backend log events do not hide ready workspace tabs", async ({ page }) => {
  await expect(page.locator(".tabs").getByRole("button", { name: "MCP", exact: true })).toBeVisible();

  await page.evaluate(() => {
    (window as typeof window & {
      __emitBackendStatus?: (payload: { status: string; message?: string }) => void;
    }).__emitBackendStatus?.({ status: "log", message: "late stdout line" });
  });

  await expect(page.locator(".status-pill.ok", { hasText: "ready" })).toBeVisible();
  await expect(page.locator(".tabs").getByRole("button", { name: "MCP", exact: true })).toBeVisible();
});

test("MCP tab creates a one-time key, copies setup and revokes it", async ({ page }) => {
  await clickTab(page, "MCP");
  await expect(page.getByRole("heading", { name: "MCP connections" })).toBeVisible();
  await expect(page.getByText("https://notebooklm.example.test/mcp", { exact: true })).toBeVisible();

  await page.getByPlaceholder("Ví dụ: Claude Desktop").fill("Claude Desktop");
  await page.getByRole("button", { name: "Generate New Key" }).click();
  await expect(page.getByText("nlm_mcp_test-secret-once")).toBeVisible();

  await page.getByRole("button", { name: "Sao chép key" }).click();
  await expect.poll(() =>
    page.evaluate(() => (window as typeof window & { __copiedText?: string }).__copiedText),
  ).toBe("nlm_mcp_test-secret-once");

  await page.getByRole("button", { name: "Copy config" }).click();
  await expect.poll(() =>
    page.evaluate(() => (window as typeof window & { __copiedText?: string }).__copiedText),
  ).toContain("YOUR_MCP_API_KEY");

  await page.getByRole("button", { name: "Thu hồi key Claude Desktop" }).click();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("MCP usage dashboard shows gateway metrics, quota and period controls", async ({ page }) => {
  await clickTab(page, "MCP");
  const dashboard = page.getByLabel("Thống kê sử dụng MCP");
  await expect(dashboard.getByRole("heading", { name: "Usage Dashboard" })).toBeVisible();
  await expect(dashboard.locator("article", { hasText: "Lượt tạo" }).getByText("12", { exact: true })).toBeVisible();
  await expect(dashboard.locator("article", { hasText: "Lượt tải về" }).getByText("5", { exact: true })).toBeVisible();
  await expect(dashboard.locator("article", { hasText: "Tạo thành công" }).getByText("9", { exact: true })).toBeVisible();
  await expect(dashboard.locator("article", { hasText: "Tạo thất bại" }).getByText("3", { exact: true })).toBeVisible();
  await expect(dashboard.getByRole("progressbar", { name: "Quota tạo MCP hôm nay" })).toHaveAttribute("aria-valuemax", "100");
  await expect(dashboard.getByText("90 còn lại", { exact: true })).toBeVisible();
  await expect(dashboard.getByText("artifact_generate", { exact: true })).toBeVisible();
  await expect(dashboard.getByText("ValidationError", { exact: true })).toBeVisible();

  await dashboard.getByRole("tab", { name: "Hôm nay" }).click();
  await expect.poll(() =>
    page.evaluate(() => (window as typeof window & { __backendRequests?: string[] }).__backendRequests),
  ).toContain("GET /v1/mcp/usage?period=today");
  await expectNoHorizontalOverflow(page);
});

test("sidebar notebook selection opens visible detail", async ({ page }) => {
  await page.locator(".notebook-select", { hasText: "Very Long Notebook Name" }).click();
  await expect(page.locator(".notebook-row.active", { hasText: "Very Long Notebook Name" })).toBeVisible();
  await expect(page.locator(".notebook-detail", { hasText: "Very Long Notebook Name" })).toBeVisible();
  await expect(page.locator(".tabs").getByRole("button", { name: "Overview", exact: true })).toHaveClass(/active/);
  await expectSidebarContained(page);
  await expectNoHorizontalOverflow(page);
});

test("notebook search and create rename delete dialogs work without native prompts", async ({ page }) => {
  const search = page.getByPlaceholder("Search notebook");
  await search.fill("Backend Mapping");
  await expect(page.locator(".notebook-row")).toHaveCount(1);
  await expect(page.getByText("1/3", { exact: true })).toBeVisible();
  await search.clear();

  await page.getByTitle("Create notebook").click();
  const createDialog = page.getByRole("dialog", { name: "Create notebook" });
  await expect(createDialog).toBeVisible();
  await createDialog.getByPlaceholder("Notebook title").fill("MVP QA Notebook");
  await createDialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".notebook-row.active", { hasText: "MVP QA Notebook" })).toBeVisible();

  await page.getByTitle("Rename notebook").click();
  const renameDialog = page.getByRole("dialog", { name: "Rename notebook" });
  await renameDialog.getByPlaceholder("Notebook title").fill("MVP QA Renamed");
  await renameDialog.getByRole("button", { name: "Rename" }).click();
  await expect(page.locator(".notebook-row.active", { hasText: "MVP QA Renamed" })).toBeVisible();

  await page.getByTitle("Delete notebook MVP QA Renamed").click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete notebook" });
  await expect(deleteDialog.getByText("MVP QA Renamed", { exact: true })).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("MVP QA Renamed", { exact: true })).toHaveCount(0);
  await expect(page.locator(".notebook-row.active")).toHaveCount(1);
});

test("remaining MVP buttons produce visible state changes or backend calls", async ({ page }) => {
  await page.getByTitle("Load summary").click();
  await expect(page.getByText("A compact workspace for sources")).toBeVisible();

  await page.getByRole("button", { name: "Connect Drive Down Cookies" }).click();
  const loginDialog = page.getByRole("dialog", { name: "NotebookLM login" });
  await expect(loginDialog).toBeVisible();
  await loginDialog.getByLabel("Link xác thực").fill("https://notebooklm.google.com/notebook/verify-test");
  await loginDialog.getByRole("button", { name: "Mở link xác thực" }).click();
  await expect.poll(() =>
    page.evaluate(() => (window as typeof window & { __openedExternal?: string[] }).__openedExternal),
  ).toContain("https://notebooklm.google.com/notebook/verify-test");
  await loginDialog.getByRole("button", { name: "Kiểm tra" }).click();
  await expect.poll(() =>
    page.evaluate(() => (window as typeof window & { __extensionMessages?: string[] }).__extensionMessages),
  ).toContain("connect");
  await expect(page.getByTitle("Drive Down Cookies: v0.7.3")).toBeVisible();
  await loginDialog.getByRole("button", { name: "Đồng bộ cookie" }).click();
  await expect.poll(() =>
    page.evaluate(() => (window as typeof window & { __extensionMessages?: string[] }).__extensionMessages),
  ).toContain("sync-now");
  await expect(page.getByTitle("Drive Down Cookies: 12 cookies verified from local Chrome")).toBeVisible();
  await loginDialog.getByRole("button", { name: "Close login dialog" }).click();
  await page.getByRole("button", { name: "Restart backend" }).click();
  await expect.poll(() =>
    page.evaluate(() => (window as typeof window & { __restartBackendCalls?: number }).__restartBackendCalls),
  ).toBe(1);

  const notebookListCallsBefore = await backendRequestCount(page, "GET /v1/notebooks");
  await page.getByTitle("Refresh notebooks").click();
  await expect.poll(() => backendRequestCount(page, "GET /v1/notebooks"))
    .toBeGreaterThan(notebookListCallsBefore);

  const sourceListCallsBefore = await backendRequestCount(page, "/sources");
  await page.getByTitle("Refresh notebook detail").click();
  await expect.poll(() => backendRequestCount(page, "/sources"))
    .toBeGreaterThan(sourceListCallsBefore);

  await clickTab(page, "Sources");
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.locator(".form-panel input").fill("Disposable source");
  await page.locator(".form-panel textarea").fill("Temporary source body");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator(".data-row", { hasText: "New Text" })).toBeVisible();
  await page.getByTitle("Delete New Text").click();
  await expect(page.locator(".data-row", { hasText: "New Text" })).toHaveCount(0);

  await clickTab(page, "Verify");
  await page.getByPlaceholder("What should be verified again?").fill("Check this claim later");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Check this claim later", { exact: true })).toBeVisible();
  await page.getByTitle("Delete verification").click();
  await expect(page.getByText("Check this claim later", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: /Version/ }).click();
  await page.getByRole("button", { name: "Check update" }).click();
  await expect(page.getByText("Local build is running")).toBeVisible();
  await page.getByTitle("Close update dialog").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("source, chat, studio, notes, and share flows keep panels stable", async ({ page }) => {
  await clickTab(page, "Sources");
  await page.getByPlaceholder("https://...").fill("https://example.com/new");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("New URL")).toBeVisible();
  await page.getByRole("button", { name: "File" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "brief.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("NotebookLM upload smoke"),
  });
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("brief.txt")).toBeVisible();
  await page.getByRole("button", { name: "Drive", exact: true }).click();
  await page.getByPlaceholder("Google Drive file id").fill("drive-file-1");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Drive source")).toBeVisible();

  await clickTab(page, "Chat");
  await page.getByPlaceholder("Ask this notebook...").fill("Summarize the source map");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText("grounded answer")).toBeVisible();
  await page.getByTitle("Copy").click();
  await expect(page.getByText("Copied", { exact: true })).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => (window as typeof window & { __copiedText?: string }).__copiedText),
  ).toContain("grounded answer");
  await page.getByTitle("Save to Verify").click();
  await expect(page.getByText("Saved to Verify")).toBeVisible();

  await clickTab(page, "Verify");
  await expect(page.getByText("Summarize the source map", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Verify again" }).click();
  await expect(page.getByText("2 checks / needs review")).toBeVisible();
  await page.getByTitle("Mark as verified").click();
  await expect(page.getByText("2 checks / verified")).toBeVisible();

  await page.reload();
  await clickTab(page, "Verify");
  await expect(page.getByText("Summarize the source map", { exact: true })).toBeVisible();
  await expect(page.getByText("2 checks / verified")).toBeVisible();

  await clickTab(page, "Studio");
  await page.locator("select").first().selectOption("quiz");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByText("quiz generation")).toBeVisible();

  await clickTab(page, "Artifacts");
  await page.locator("select").first().selectOption("report");
  await page.getByRole("button", { name: "Download" }).click();
  await expect(page.getByText("Saved notebooklm-report.md")).toBeVisible();

  await clickTab(page, "Notes");
  await page.locator("input").last().fill("Playwright note");
  await page.locator("textarea").fill("UI QA note body");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".data-row", { hasText: "Playwright note" })).toBeVisible();

  await clickTab(page, "Share");
  await page.locator(".panel-title .icon-btn").click();
  await expect(page.getByText("restricted")).toBeVisible();

  await clickTab(page, "Research");
  await page.getByPlaceholder("Research topic or question").fill("Find source gaps");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.locator(".task-count", { hasText: "started" })).toBeVisible();
  await page.getByRole("button", { name: "Status" }).click();
  await expect(page.getByText("Research completed")).toBeVisible();

  await clickTab(page, "Labels");
  await page.getByPlaceholder("New label").fill("QA label");
  await page.locator(".form-panel").getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("button", { name: /QA label 0 source/ })).toBeVisible();
  await page.getByRole("button", { name: "Add source" }).click();
  await expect(page.getByRole("button", { name: /QA label 1 source/ })).toBeVisible();

  await clickTab(page, "Settings");
  await page.locator("select").selectOption("vi");
  await page.getByRole("button", { name: "Save language" }).click();
  await expect(page.locator(".json-preview", { hasText: '"language_name": "Tiếng Việt"' })).toBeVisible();
  await page.getByRole("button", { name: "Check update" }).click();
  await expect(page.getByText("Local build is running")).toBeVisible();

  await expectNoHorizontalOverflow(page);
  await expectNoVisibleOverlap(page);
});

test("log manager expands, collapses and clears captured logs", async ({ page }) => {
  const toggle = page.getByRole("button", { name: /Log manager/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("log")).toContainText("Log manager initialized");

  await page.getByTitle("Clear logs").click();
  await expect(page.getByRole("log")).toContainText("Logs cleared");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("browser-only password gate is readable when preload bridge is missing", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "NotebookLM Pro" })).toBeVisible();
  await expect(page.getByPlaceholder("Nhập mật khẩu dashboard")).toBeVisible();
  await expect(page.getByRole("button", { name: "Đăng nhập" })).toBeDisabled();
  await expectNoHorizontalOverflow(page);
  await page.close();
});

test("browser-only frontend persists an HttpOnly dashboard session", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const authHeaders: string[] = [];
  let authenticated = false;
  await page.route("**/auth/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/auth/session") {
      await route.fulfill({ json: { authenticated } });
      return;
    }
    if (path === "/auth/login") {
      expect(request.postDataJSON()).toEqual({ password: "123" });
      authenticated = true;
      await route.fulfill({
        headers: {
          "content-type": "application/json",
          "set-cookie": "notebooklm_dashboard_session=test-session; Path=/; HttpOnly; SameSite=Strict",
        },
        body: JSON.stringify({ ok: true, authenticated: true }),
      });
      return;
    }
    if (path === "/auth/logout") {
      authenticated = false;
      await route.fulfill({ json: { ok: true, authenticated: false } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { message: "not found" } } });
  });
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    authHeaders.push(request.headers().authorization || "");
    const path = new URL(request.url()).pathname;
    if (path === "/v1/status") {
      await route.fulfill({ json: { ok: true, server: "notebooklm-server", version: "0.8.0" } });
      return;
    }
    if (path === "/v1/notebooks") {
      await route.fulfill({
        json: {
          notebooks: [
            {
              id: "nb-web-1",
              title: "Production smoke notebook",
              created_at: "2026-08-14T00:00:00Z",
              sources_count: 0,
              is_owner: true,
            },
          ],
        },
      });
      return;
    }
    if (path.endsWith("/sources")) {
      await route.fulfill({ json: { sources: [] } });
      return;
    }
    if (path.endsWith("/artifacts")) {
      await route.fulfill({ json: { artifacts: [] } });
      return;
    }
    if (path.endsWith("/notes")) {
      await route.fulfill({ json: { notes: [] } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { message: "not found" } } });
  });

  await page.goto("/");
  await page.getByPlaceholder("Nhập mật khẩu dashboard").fill("123");
  await page.getByRole("button", { name: "Đăng nhập" }).click();

  await expect(page.getByText("Production smoke notebook").first()).toBeVisible();
  await expect(page.locator(".status-pill.ok", { hasText: "ready" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Drive Down Cookies" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Login locally and sync to VPS" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create notebook" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Đăng xuất" })).toBeEnabled();
  expect(authHeaders.length).toBeGreaterThanOrEqual(2);
  expect(authHeaders.every((value) => value === "")).toBe(true);
  await expectNoHorizontalOverflow(page);

  await page.reload();
  await expect(page.getByText("Production smoke notebook").first()).toBeVisible();

  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page.getByPlaceholder("Nhập mật khẩu dashboard")).toBeVisible();
  await page.close();
});

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    doc: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(Math.max(metrics.body, metrics.doc)).toBeLessThanOrEqual(metrics.viewport + 1);
}

async function clickTab(page: Page, name: string) {
  await page.locator(".tabs").getByRole("button", { name, exact: true }).click();
}

async function backendRequestCount(page: Page, pattern: string) {
  return page.evaluate((value) => {
    const requests =
      (window as typeof window & { __backendRequests?: string[] }).__backendRequests || [];
    return requests.filter((request) => request.includes(value)).length;
  }, pattern);
}

async function expectStableClickableControls(page: Page) {
  const badControls = await page.locator("button:not([hidden]), input:not([hidden]), select:not([hidden]), textarea:not([hidden])")
    .evaluateAll((elements) =>
      elements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const control = element as HTMLInputElement;
          const name =
            element.textContent?.trim() ||
            element.getAttribute("aria-label") ||
            element.getAttribute("title") ||
            control.placeholder ||
            Array.from(control.labels || []).map((label) => label.textContent?.trim()).join(" ");
          return { name, width: rect.width, height: rect.height };
        })
        .filter(
          (item) =>
            item.width > 0 && item.height > 0 && (item.height < 34 || !item.name),
        ),
    );
  expect(badControls).toEqual([]);
}

async function expectSidebarContained(page: Page) {
  const overflow = await page.locator(".sidebar").evaluate((sidebar) => {
    const sidebarBox = sidebar.getBoundingClientRect();
    return Array.from(sidebar.querySelectorAll(".notebook-row")).map((row) => {
      const rowBox = row.getBoundingClientRect();
      return {
        text: row.textContent?.trim() || "",
        left: rowBox.left - sidebarBox.left,
        right: rowBox.right - sidebarBox.right,
        width: rowBox.width,
      };
    }).filter((item) => item.left < -1 || item.right > 1);
  });
  expect(overflow).toEqual([]);
}

async function expectElementInsideViewport(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

async function expectNoVisibleOverlap(page: Page) {
  const overlaps = await page.locator(".panel-title, .data-row, .notebook-row, .field")
    .evaluateAll((elements) => {
      const rects = elements
        .map((element, index) => ({ index, element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);
      const bad: string[] = [];
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i];
          const b = rects[j];
          if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
          const x = Math.max(0, Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left));
          const y = Math.max(0, Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top));
          if (x * y > 24) {
            bad.push(`${a.index}:${b.index}`);
          }
        }
      }
      return bad.slice(0, 10);
    });
  expect(overlaps).toEqual([]);
}
