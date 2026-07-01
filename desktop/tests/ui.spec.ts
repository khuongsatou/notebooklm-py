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
      };

      window.notebooklmDesktop = {
        async getAppInfo() {
          return {
            name: "notebooklm-pro-desktop",
            version: "0.1.0",
            backend: { baseUrl: "http://127.0.0.1:5173", port: 5173, status: "ready" },
          };
        },
        async backendRequest(request) {
          const path = request.path;
          const method = request.method || "GET";

          if (path === "/v1/status") {
            return { ok: true, server: "notebooklm-server", version: "0.8.0" };
          }
          if (path === "/v1/notebooks" && method === "GET") {
            return { notebooks: state.notebooks };
          }
          if (path === "/v1/notebooks" && method === "POST") {
            const title = String((request.body as { title?: string })?.title || "New notebook");
            const notebook = { id: `nb-${state.notebooks.length + 1}`, title };
            state.notebooks.unshift(notebook);
            return notebook;
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
          if (path.includes("/sources/url") && method === "POST") {
            const source = { id: `src-${state.sources.length + 1}`, title: "New URL", status: 1 };
            state.sources.push(source);
            return source;
          }
          if (path.includes("/sources/text") && method === "POST") {
            const source = { id: `src-${state.sources.length + 1}`, title: "New Text", status: 1 };
            state.sources.push(source);
            return source;
          }
          if (path.includes("/chat") && method === "POST") {
            return {
              answer:
                "This is a grounded answer with citations rendered in a stable text container.",
              conversation_id: "conv-1",
              references: [],
            };
          }
          if (path.includes("/artifacts") && method === "GET") {
            return { artifacts: state.artifacts };
          }
          if (path.includes("/artifacts") && method === "POST") {
            return { task_id: "task-1", status: "pending", kind: "report" };
          }
          if (path.includes("/notes") && method === "GET") {
            return { notes: state.notes };
          }
          if (path.includes("/notes") && method === "POST") {
            const note = { id: `note-${state.notes.length + 1}`, title: "New Note", content: "" };
            state.notes.push(note);
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
  await expectSidebarContained(page);
  await expect(page.locator(".tabs").getByRole("button", { name: "Sources", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Version/ }).click();
  await expect(page.locator(".modal .panel-title").getByText("Update", { exact: true })).toBeVisible();
  await expectElementInsideViewport(page, ".modal");
});

test("all workspace tabs render without layout overflow", async ({ page }) => {
  const tabs = [
    "Overview",
    "Sources",
    "Chat",
    "Studio",
    "Artifacts",
    "Notes",
    "Research",
    "Labels",
    "Share",
    "Settings",
  ];

  for (const tab of tabs) {
    await clickTab(page, tab);
    await expect(page.locator(".content")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectSidebarContained(page);
    await expectNoVisibleOverlap(page);
  }
});

test("sidebar notebook selection opens visible detail", async ({ page }) => {
  await page.locator(".notebook-row", { hasText: "Very Long Notebook Name" }).click();
  await expect(page.locator(".notebook-row.active", { hasText: "Very Long Notebook Name" })).toBeVisible();
  await expect(page.locator(".notebook-detail", { hasText: "Very Long Notebook Name" })).toBeVisible();
  await expect(page.locator(".tabs").getByRole("button", { name: "Overview", exact: true })).toHaveClass(/active/);
  await expectSidebarContained(page);
  await expectNoHorizontalOverflow(page);
});

test("source, chat, studio, notes, and share flows keep panels stable", async ({ page }) => {
  await clickTab(page, "Sources");
  await page.getByPlaceholder("https://...").fill("https://example.com/new");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("New URL")).toBeVisible();

  await clickTab(page, "Chat");
  await page.getByPlaceholder("Ask this notebook...").fill("Summarize the source map");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText("grounded answer")).toBeVisible();

  await clickTab(page, "Studio");
  await page.locator("select").first().selectOption("quiz");
  await page.getByRole("button", { name: "Generate" }).click();

  await clickTab(page, "Notes");
  await page.locator("input").last().fill("Playwright note");
  await page.locator("textarea").fill("UI QA note body");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".data-row", { hasText: "New Note" })).toBeVisible();

  await clickTab(page, "Share");
  await page.locator(".panel-title .icon-btn").click();
  await expect(page.getByText("restricted")).toBeVisible();

  await expectNoHorizontalOverflow(page);
  await expectNoVisibleOverlap(page);
});

test("browser-only locked state is readable when preload bridge is missing", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  await page.goto("/");
  await expect(page.getByText("Open with Electron")).toBeVisible();
  await expectNoHorizontalOverflow(page);
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

async function expectStableClickableControls(page: Page) {
  const badControls = await page.locator("button:not([hidden]), input:not([hidden]), select:not([hidden])")
    .evaluateAll((elements) =>
      elements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = element.textContent?.trim() || element.getAttribute("aria-label") || "";
          return { text, width: rect.width, height: rect.height };
        })
        .filter((item) => item.width > 0 && item.height > 0 && item.height < 34),
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
