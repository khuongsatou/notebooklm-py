import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

type AuditEntry = {
  area: string;
  control: string;
  expectation: "backend" | "local-state" | "disabled-by-design";
  evidence: string;
  status: "PASS";
};

const notebooks = [
  { id: "nb-1", title: "AI Research OS" },
  { id: "nb-2", title: "Creator Pipeline Notes" },
];

const sources = [
  { id: "src-1", title: "Architecture reference", status: 3, url: "https://example.com/a" },
  { id: "src-2", title: "Runtime RPC auth pipeline", status: 3, url: "https://example.com/b" },
];

const artifacts = [{ id: "art-1", title: "Briefing report", status: "completed" }];
const notes = [{ id: "note-1", title: "Launch checklist", content: "One" }];

test.beforeEach(async ({ page }) => {
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
      };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as typeof window & { __copiedText?: string }).__copiedText = text;
          },
        },
      });
      (window as typeof window & { __backendRequests?: string[] }).__backendRequests = [];

      window.notebooklmDesktop = {
        async getAppInfo() {
          return {
            name: "notebooklm-pro-desktop",
            version: "0.1.0",
            backend: { baseUrl: "http://127.0.0.1:5173", port: 5173, status: "ready" },
          };
        },
        async backendRequest(request) {
          const pathValue = request.path;
          const method = request.method || "GET";
          (window as typeof window & { __backendRequests?: string[] }).__backendRequests?.push(
            `${method} ${pathValue}`,
          );

          if (pathValue === "/v1/status") {
            return { ok: true, server: "notebooklm-server", version: "0.8.0" };
          }
          if (pathValue === "/v1/notebooks" && method === "GET") {
            return { notebooks: state.notebooks };
          }
          if (pathValue === "/v1/notebooks" && method === "POST") {
            const title = String((request.body as { title?: string })?.title || "New notebook");
            const notebook = { id: `nb-${state.notebooks.length + 1}`, title };
            state.notebooks = [notebook, ...state.notebooks];
            return notebook;
          }
          if (/^\/v1\/notebooks\/[^/]+$/.test(pathValue) && method === "PATCH") {
            const id = pathValue.split("/").pop();
            const title = String((request.body as { title?: string })?.title || "");
            const notebook = state.notebooks.find((item) => item.id === id);
            if (!notebook) throw new Error("Notebook not found");
            notebook.title = title;
            return notebook;
          }
          if (/^\/v1\/notebooks\/[^/]+$/.test(pathValue) && method === "DELETE") {
            const id = pathValue.split("/").pop();
            state.notebooks = state.notebooks.filter((item) => item.id !== id);
            return {};
          }
          if (pathValue.includes("/summary")) {
            return {
              notebook_id: "nb-1",
              summary: "Backend summary returned through the renderer API bridge.",
            };
          }
          if (pathValue.includes("/sources") && method === "GET" && !pathValue.includes("/sources/")) {
            return { sources: state.sources };
          }
          if (pathValue.includes("/sources/") && method === "GET") {
            const sourceId = pathValue.split("/").pop();
            const source = state.sources.find((item) => item.id === sourceId);
            return source ? { ...source, status: 3 } : { source_id: sourceId, status: "pending" };
          }
          if (pathValue.includes("/sources/url") && method === "POST") {
            const source = { id: `src-${state.sources.length + 1}`, title: "New URL", status: 1 };
            state.sources = [...state.sources, source];
            return source;
          }
          if (pathValue.includes("/sources/text") && method === "POST") {
            const source = { id: `src-${state.sources.length + 1}`, title: "New Text", status: 1 };
            state.sources = [...state.sources, source];
            return source;
          }
          if (pathValue.includes("/sources/file") && method === "POST") {
            const upload = request.file as { name?: string } | undefined;
            const source = {
              id: `src-${state.sources.length + 1}`,
              title: upload?.name || "New File",
              status: 1,
            };
            state.sources = [...state.sources, source];
            return source;
          }
          if (pathValue.includes("/sources/drive") && method === "POST") {
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
          if (pathValue.includes("/sources/") && method === "DELETE") {
            const sourceId = pathValue.split("/").pop();
            state.sources = state.sources.filter((item) => item.id !== sourceId);
            return {};
          }
          if (pathValue.includes("/chat") && method === "POST") {
            return {
              answer: "Grounded backend answer returned from chat endpoint.",
              conversation_id: "conv-1",
              references: [],
            };
          }
          if (pathValue.includes("/artifacts/") && method === "GET") {
            const taskId = pathValue.split("/").pop() || "task-1";
            return { task_id: taskId, status: "completed", is_complete: true };
          }
          if (pathValue.includes("/artifacts") && method === "GET") {
            return { artifacts: state.artifacts };
          }
          if (pathValue.includes("/artifacts/download") && method === "POST") {
            return {
              canceled: false,
              path: "/tmp/notebooklm-report.md",
              filename: "notebooklm-report.md",
              bytes: 128,
            };
          }
          if (pathValue.includes("/artifacts") && method === "POST") {
            return { task_id: "task-1", status: "pending", kind: "report" };
          }
          if (pathValue.includes("/notes") && method === "GET") {
            return { notes: state.notes };
          }
          if (pathValue.includes("/notes") && method === "POST") {
            const body = request.body as { title?: string; content?: string };
            const note = {
              id: `note-${state.notes.length + 1}`,
              title: body.title || "New Note",
              content: body.content || "",
            };
            state.notes = [...state.notes, note];
            return note;
          }
          if (pathValue.includes("/share")) {
            return {
              notebook_id: "nb-1",
              is_public: false,
              access: "restricted",
              shared_users: [],
            };
          }
          if (pathValue.includes("/labels/generate") && method === "POST") {
            state.labels = [
              ...state.labels,
              { id: `label-${state.labels.length + 1}`, name: "Generated", emoji: "✨", source_ids: ["src-1"] },
            ];
            return { labels: state.labels, count: state.labels.length };
          }
          if (pathValue.includes("/labels") && method === "GET" && !pathValue.includes("/labels/")) {
            return { labels: state.labels };
          }
          if (pathValue.includes("/labels") && method === "POST" && !pathValue.includes("/sources")) {
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
          if (pathValue.includes("/labels/") && pathValue.includes("/emoji") && method === "PATCH") {
            const labelId = pathValue.split("/labels/")[1].split("/")[0];
            const body = request.body as { emoji?: string };
            const label = state.labels.find((item) => item.id === labelId);
            if (!label) throw new Error("Label not found");
            label.emoji = body.emoji || "";
            return label;
          }
          if (pathValue.includes("/labels/") && pathValue.includes("/sources") && method === "POST") {
            const labelId = pathValue.split("/labels/")[1].split("/")[0];
            const body = request.body as { source_ids?: string[] };
            const label = state.labels.find((item) => item.id === labelId);
            if (!label) throw new Error("Label not found");
            label.source_ids = Array.from(new Set([...label.source_ids, ...(body.source_ids || [])]));
            return { label, source_ids: body.source_ids || [] };
          }
          if (pathValue.includes("/labels/") && pathValue.includes("/sources") && method === "DELETE") {
            const labelId = pathValue.split("/labels/")[1].split("/")[0];
            const body = request.body as { source_ids?: string[] };
            const label = state.labels.find((item) => item.id === labelId);
            if (!label) throw new Error("Label not found");
            const remove = new Set(body.source_ids || []);
            label.source_ids = label.source_ids.filter((sourceId) => !remove.has(sourceId));
            return { label, source_ids: body.source_ids || [] };
          }
          if (pathValue.includes("/labels/") && method === "PATCH") {
            const labelId = pathValue.split("/labels/")[1];
            const body = request.body as { name?: string };
            const label = state.labels.find((item) => item.id === labelId);
            if (!label) throw new Error("Label not found");
            label.name = body.name || label.name;
            return label;
          }
          if (pathValue.includes("/labels/") && method === "DELETE") {
            const labelId = pathValue.split("/labels/")[1];
            state.labels = state.labels.filter((item) => item.id !== labelId);
            return {};
          }
          if (pathValue.includes("/research/status")) {
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
          if (pathValue.includes("/research/") && method === "DELETE") {
            return {};
          }
          if (pathValue.includes("/research") && method === "POST") {
            return {
              task_id: state.researchTaskId,
              report_id: null,
              notebook_id: "nb-1",
              query: String((request.body as { query?: string })?.query || ""),
              mode: String((request.body as { mode?: string })?.mode || "fast"),
            };
          }
          if (pathValue === "/v1/settings") {
            return {
              server: "notebooklm-server",
              version: "0.8.0",
              language: state.language,
              language_name: state.language === "vi" ? "Tiếng Việt" : "English",
              languages: { en: "English", vi: "Tiếng Việt" },
            };
          }
          if (pathValue === "/v1/settings/language" && method === "PATCH") {
            state.language = String((request.body as { code?: string })?.code || "en");
            return { language: state.language, language_name: state.language === "vi" ? "Tiếng Việt" : "English" };
          }
          if (pathValue === "/v1/settings/update") {
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
});

test("button audit: every enabled MVP control has backend or local-state evidence", async ({
  page,
}, testInfo) => {
  const audit: AuditEntry[] = [];
  const addEvidence = (entry: AuditEntry) => audit.push(entry);

  await expectBackend(page, audit, "Top bar", "Refresh notebooks", "GET /v1/notebooks", async () => {
    await page.getByTitle("Refresh notebooks").click();
  });

  await expectBackend(
    page,
    audit,
    "Sidebar",
    "Select notebook",
    "GET /v1/notebooks/nb-2/sources",
    async () => {
      await page.locator(".notebook-select", { hasText: "Creator Pipeline Notes" }).click();
      await expect(page.locator(".notebook-row.active", { hasText: "Creator Pipeline Notes" })).toBeVisible();
    },
  );
  await expectBackend(
    page,
    audit,
    "Sidebar",
    "Select notebook back",
    "GET /v1/notebooks/nb-1/sources",
    async () => {
      await page.locator(".notebook-select", { hasText: "AI Research OS" }).click();
      await expect(page.locator(".notebook-row.active", { hasText: "AI Research OS" })).toBeVisible();
    },
  );

  await expectBackend(page, audit, "Overview", "Load summary", "/summary", async () => {
    await page.getByTitle("Load summary").click();
    await expect(page.getByText("Backend summary returned")).toBeVisible();
  });

  for (const tab of ["Sources", "Chat", "Studio", "Artifacts", "Notes", "Verify", "Research", "Share", "Overview"]) {
    await expectLocal(page, audit, "Tabs", `${tab} tab`, `${tab} tab becomes active`, async () => {
      await clickTab(page, tab);
      await expect(page.locator(".tabs").getByRole("button", { name: tab, exact: true })).toHaveClass(/active/);
    });
  }
  await expectBackend(page, audit, "Tabs", "Labels tab", "GET /v1/notebooks/nb-1/labels", async () => {
    await clickTab(page, "Labels");
    await expect(page.locator(".tabs").getByRole("button", { name: "Labels", exact: true })).toHaveClass(/active/);
  });
  await expectBackend(page, audit, "Tabs", "Settings tab", "GET /v1/settings", async () => {
    await clickTab(page, "Settings");
    await expect(page.locator(".tabs").getByRole("button", { name: "Settings", exact: true })).toHaveClass(/active/);
  });
  await clickTab(page, "Overview");

  await expectLocal(page, audit, "Version", "Open version modal", "Update modal opens", async () => {
    await page.getByRole("button", { name: /Version/ }).click();
    await expect(page.locator(".modal .panel-title").getByText("Update", { exact: true })).toBeVisible();
  });
  await expectBackend(page, audit, "Version", "Check update", "GET /v1/settings/update", async () => {
    await page.getByRole("button", { name: "Check update" }).click();
    await expect(page.getByText("Local build is running")).toBeVisible();
  });
  await expectLocal(page, audit, "Version", "Close update modal", "dialog closes", async () => {
    await page.getByTitle("Close update dialog").click();
    await expect(page.locator(".modal")).toHaveCount(0);
  });

  await expectLocal(page, audit, "Notebook", "Close notebook dialog", "create dialog closes", async () => {
    await page.getByTitle("Create notebook").click();
    await page.getByTitle("Close notebook dialog").click();
    await expect(page.getByRole("dialog", { name: "Create notebook" })).toHaveCount(0);
  });

  await expectLocal(page, audit, "Notebook", "Cancel notebook dialog", "create dialog cancels", async () => {
    await page.getByTitle("Create notebook").click();
    await page.getByRole("dialog", { name: "Create notebook" }).getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog", { name: "Create notebook" })).toHaveCount(0);
  });

  await expectBackend(page, audit, "Notebook", "Create notebook", "POST /v1/notebooks", async () => {
    await page.getByTitle("Create notebook").click();
    await page.getByRole("dialog", { name: "Create notebook" }).getByPlaceholder("Notebook title").fill("Button Audit Notebook");
    await page.getByRole("dialog", { name: "Create notebook" }).getByRole("button", { name: "Create" }).click();
    await expect(page.locator(".notebook-row.active", { hasText: "Button Audit Notebook" })).toBeVisible();
  });

  await expectBackend(page, audit, "Notebook", "Rename notebook", "PATCH /v1/notebooks/nb-3", async () => {
    await page.getByTitle("Rename notebook").click();
    await page.getByRole("dialog", { name: "Rename notebook" }).getByPlaceholder("Notebook title").fill("Button Audit Renamed");
    await page.getByRole("dialog", { name: "Rename notebook" }).getByRole("button", { name: "Rename" }).click();
    await expect(page.locator(".notebook-row.active", { hasText: "Button Audit Renamed" })).toBeVisible();
  });

  await expectLocal(page, audit, "Notebook", "Cancel delete notebook", "delete dialog closes", async () => {
    await page.getByTitle("Delete notebook Button Audit Renamed").click();
    await page.getByRole("dialog", { name: "Delete notebook" }).getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  await expectLocal(page, audit, "Notebook", "Close delete dialog", "delete dialog closes", async () => {
    await page.getByTitle("Delete notebook Button Audit Renamed").click();
    await page.getByTitle("Close delete dialog").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  await expectBackend(page, audit, "Notebook", "Delete notebook", "DELETE /v1/notebooks/nb-3", async () => {
    await page.getByTitle("Delete notebook Button Audit Renamed").click();
    await page.getByRole("dialog", { name: "Delete notebook" }).getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Button Audit Renamed", { exact: true })).toHaveCount(0);
    await expect(page.locator(".notebook-row.active", { hasText: "AI Research OS" })).toBeVisible();
  });

  await expectBackend(page, audit, "Notebook", "Refresh notebook detail", "/sources", async () => {
    await page.getByTitle("Refresh notebook detail").click();
  });

  await clickTab(page, "Sources");
  await expectDisabled(page, audit, "Sources", "Add empty source", undefined, page.locator(".form-panel").getByRole("button", { name: "Add" }));
  await expectLocal(page, audit, "Sources", "URL mode", "URL field visible", async () => {
    await page.getByRole("button", { name: "URL", exact: true }).click();
    await expect(page.getByPlaceholder("https://...")).toBeVisible();
  });
  await expectLocal(page, audit, "Sources", "Text mode", "content textarea visible", async () => {
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await expect(page.locator(".form-panel textarea")).toBeVisible();
  });
  await expectLocal(page, audit, "Sources", "File mode", "file input visible", async () => {
    await page.getByRole("button", { name: "File", exact: true }).click();
    await expect(page.locator('input[type="file"]')).toBeVisible();
  });
  await expectLocal(page, audit, "Sources", "Drive mode", "Drive file id field visible", async () => {
    await page.getByRole("button", { name: "Drive", exact: true }).click();
    await expect(page.getByPlaceholder("Google Drive file id")).toBeVisible();
  });

  await expectBackend(page, audit, "Sources", "Add URL source", "POST /v1/notebooks/nb-1/sources/url", async () => {
    await page.getByRole("button", { name: "URL", exact: true }).click();
    await page.getByPlaceholder("https://...").fill("https://example.com/audit");
    await page.locator(".form-panel").getByRole("button", { name: "Add" }).click();
    await expect(page.locator(".data-row", { hasText: "New URL" })).toBeVisible();
  });

  await expectBackend(page, audit, "Sources", "Add text source", "POST /v1/notebooks/nb-1/sources/text", async () => {
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page.locator(".form-panel input").fill("Audit text source");
    await page.locator(".form-panel textarea").fill("Audit source content");
    await page.locator(".form-panel").getByRole("button", { name: "Add" }).click();
    await expect(page.locator(".data-row", { hasText: "New Text" })).toBeVisible();
  });

  await expectBackend(page, audit, "Sources", "Add file source", "POST /v1/notebooks/nb-1/sources/file", async () => {
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "button-audit.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("button audit file upload"),
    });
    await page.locator(".form-panel").getByRole("button", { name: "Add" }).click();
    await expect(page.locator(".data-row", { hasText: "button-audit.txt" })).toBeVisible();
  });

  await expectBackend(page, audit, "Sources", "Add Drive source", "POST /v1/notebooks/nb-1/sources/drive", async () => {
    await page.getByRole("button", { name: "Drive", exact: true }).click();
    await page.getByPlaceholder("Google Drive file id").fill("drive-file-1");
    await page.locator(".form-panel").getByRole("button", { name: "Add" }).click();
    await expect(page.locator(".data-row", { hasText: "Drive source" })).toBeVisible();
  });

  await expectBackend(page, audit, "Sources", "Delete source", "DELETE /v1/notebooks/nb-1/sources/", async () => {
    await page.getByTitle("Delete New Text").click();
    await expect(page.locator(".data-row", { hasText: "New Text" })).toHaveCount(0);
  });

  await clickTab(page, "Chat");
  await expectDisabled(page, audit, "Chat", "Ask empty question", undefined, page.getByRole("button", { name: "Ask" }));
  await expectDisabled(page, audit, "Chat", "Copy empty answer", undefined, page.getByTitle("Copy"));
  await expectDisabled(page, audit, "Chat", "Save empty answer to Verify", undefined, page.getByTitle("Save to Verify"));
  await expectBackend(page, audit, "Chat", "Ask", "POST /v1/notebooks/nb-1/chat", async () => {
    await page.getByPlaceholder("Ask this notebook...").fill("Summarize audit state");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByText("Grounded backend answer")).toBeVisible();
  });
  await expectLocal(page, audit, "Chat", "Copy answer", "clipboard receives answer text", async () => {
    await page.getByTitle("Copy").click();
    await expect(page.getByText("Copied", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __copiedText?: string }).__copiedText))
      .toContain("Grounded backend answer");
  });
  await expectLocal(page, audit, "Chat", "Save to Verify", "verification record appears", async () => {
    await page.getByTitle("Save to Verify").click();
    await expect(page.getByText("Saved to Verify")).toBeVisible();
  });

  await clickTab(page, "Verify");
  await expect(page.getByText("Summarize audit state", { exact: true })).toBeVisible();
  await expectBackend(page, audit, "Verify", "Verify again", "POST /v1/notebooks/nb-1/chat", async () => {
    await page.getByRole("button", { name: "Verify again" }).first().click();
    await expect(page.getByText("2 checks / needs review")).toBeVisible();
  });
  await expectLocal(page, audit, "Verify", "Mark as verified", "status toggles to verified", async () => {
    await page.getByTitle("Mark as verified").first().click();
    await expect(page.getByText("2 checks / verified")).toBeVisible();
  });
  await expectLocal(page, audit, "Verify", "Delete verification", "record removed", async () => {
    await page.getByTitle("Delete verification").first().click();
    await expect(page.getByText("Summarize audit state", { exact: true })).toHaveCount(0);
  });
  await expectLocal(page, audit, "Verify", "Save manual verification", "manual record appears", async () => {
    await page.getByPlaceholder("What should be verified again?").fill("Manual audit claim");
    await page.locator(".form-panel").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Manual audit claim", { exact: true })).toBeVisible();
  });

  await clickTab(page, "Studio");
  await expectBackend(page, audit, "Studio", "Generate artifact", "POST /v1/notebooks/nb-1/artifacts", async () => {
    await page.locator("select").first().selectOption("quiz");
    await page.getByRole("button", { name: "Generate" }).click();
    await expect(page.getByText("quiz generation")).toBeVisible();
  });

  await clickTab(page, "Artifacts");
  await expectBackend(page, audit, "Artifacts", "Download artifact", "POST /v1/notebooks/nb-1/artifacts/download", async () => {
    await page.locator("select").first().selectOption("report");
    await page.getByRole("button", { name: "Download" }).click();
    await expect(page.getByText("Saved notebooklm-report.md")).toBeVisible();
  });

  await clickTab(page, "Notes");
  await expectDisabled(page, audit, "Notes", "Save empty note", undefined, page.getByRole("button", { name: "Save" }));
  await expectBackend(page, audit, "Notes", "Save note", "POST /v1/notebooks/nb-1/notes", async () => {
    await page.locator("input").last().fill("Button audit note");
    await page.locator("textarea").fill("Button audit note body");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".data-row", { hasText: "Button audit note" })).toBeVisible();
  });

  await clickTab(page, "Share");
  await expectBackend(page, audit, "Share", "Refresh share status", "GET /v1/notebooks/nb-1/share", async () => {
    await page.locator(".panel-title .icon-btn").click();
    await expect(page.getByText("restricted")).toBeVisible();
  });

  await clickTab(page, "Research");
  await expectDisabled(page, audit, "Research", "Start empty research", undefined, page.getByRole("button", { name: "Start" }));
  await expectBackend(page, audit, "Research", "Start research", "POST /v1/notebooks/nb-1/research", async () => {
    await page.getByPlaceholder("Research topic or question").fill("Audit new sources");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.locator(".task-count", { hasText: "started" })).toBeVisible();
  });
  await expectBackend(page, audit, "Research", "Research status", "GET /v1/notebooks/nb-1/research/status", async () => {
    await page.getByRole("button", { name: "Status" }).click();
    await expect(page.getByText("Research completed")).toBeVisible();
  });
  await expectBackend(page, audit, "Research", "Cancel research", "DELETE /v1/notebooks/nb-1/research/", async () => {
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".task-count", { hasText: "cancelled" })).toBeVisible();
  });

  await clickTab(page, "Labels");
  await expectBackend(page, audit, "Labels", "Refresh labels", "GET /v1/notebooks/nb-1/labels", async () => {
    await page.locator(".panel-title .icon-btn").click();
    await expect(page.getByRole("button", { name: /Architecture 1 source/ })).toBeVisible();
  });
  await expectBackend(page, audit, "Labels", "Create label", "POST /v1/notebooks/nb-1/labels", async () => {
    await page.getByPlaceholder("New label").fill("Audit label");
    await page.locator(".form-panel").getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("button", { name: /Audit label 0 source/ })).toBeVisible();
  });
  await expectBackend(page, audit, "Labels", "Add source to label", "POST /v1/notebooks/nb-1/labels/", async () => {
    await page.getByRole("button", { name: "Add source" }).click();
    await expect(page.getByRole("button", { name: /Audit label 1 source/ })).toBeVisible();
  });
  await expectBackend(page, audit, "Labels", "Generate labels", "POST /v1/notebooks/nb-1/labels/generate", async () => {
    await page.getByRole("button", { name: "Generate" }).click();
    await expect(page.getByRole("button", { name: /Generated 1 source/ })).toBeVisible();
  });

  await clickTab(page, "Settings");
  await expectBackend(page, audit, "Settings", "Refresh settings", "GET /v1/settings", async () => {
    await page.locator(".panel-title .icon-btn").click();
    await expect(page.getByText("notebooklm-server")).toBeVisible();
  });
  await expectBackend(page, audit, "Settings", "Save language", "PATCH /v1/settings/language", async () => {
    await page.locator("select").selectOption("vi");
    await page.getByRole("button", { name: "Save language" }).click();
    await expect(page.locator(".json-preview", { hasText: '"language_name": "Tiếng Việt"' })).toBeVisible();
  });
  await expectBackend(page, audit, "Settings", "Check update", "GET /v1/settings/update", async () => {
    await page.getByRole("button", { name: "Check update" }).click();
    await expect(page.getByText("Local build is running")).toBeVisible();
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    total: audit.length,
    backendControls: audit.filter((entry) => entry.expectation === "backend").length,
    localStateControls: audit.filter((entry) => entry.expectation === "local-state").length,
    disabledByDesignControls: audit.filter((entry) => entry.expectation === "disabled-by-design").length,
    entries: audit,
  };
  const outputPath = path.join(process.cwd(), "test-results", "button-audit.json");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
  await testInfo.attach("button-audit.json", {
    body: Buffer.from(JSON.stringify(summary, null, 2)),
    contentType: "application/json",
  });

  expect(audit).toHaveLength(62);
});

async function clickTab(page: Page, name: string) {
  await page.locator(".tabs").getByRole("button", { name, exact: true }).click();
}

async function requests(page: Page) {
  return page.evaluate(() => (window as typeof window & { __backendRequests?: string[] }).__backendRequests || []);
}

async function expectBackend(
  page: Page,
  audit: AuditEntry[],
  area: string,
  control: string,
  expectedRequest: string,
  action: () => Promise<void>,
) {
  const before = await requests(page);
  await action();
  await expect.poll(async () => (await requests(page)).length).toBeGreaterThan(before.length);
  const after = await requests(page);
  const delta = after.slice(before.length);
  expect(delta.some((request) => request.includes(expectedRequest))).toBe(true);
  audit.push({
    area,
    control,
    expectation: "backend",
    evidence: delta.join("; "),
    status: "PASS",
  });
}

async function expectLocal(
  page: Page,
  audit: AuditEntry[],
  area: string,
  control: string,
  evidence: string,
  action: () => Promise<void>,
) {
  const before = await requests(page);
  await action();
  const after = await requests(page);
  expect(after.slice(before.length)).toEqual([]);
  audit.push({
    area,
    control,
    expectation: "local-state",
    evidence,
    status: "PASS",
  });
}

async function expectDisabled(
  page: Page,
  audit: AuditEntry[],
  area: string,
  control: string,
  title?: string,
  locator = page.locator(".tabs").getByRole("button", { name: control.replace(" tab", ""), exact: true }),
) {
  await expect(locator).toBeDisabled();
  if (title) await expect(locator).toHaveAttribute("title", title);
  audit.push({
    area,
    control,
    expectation: "disabled-by-design",
    evidence: title || "disabled control is visible and intentionally unavailable",
    status: "PASS",
  });
}
