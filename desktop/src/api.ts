import type {
  Artifact,
  ArtifactGeneration,
  ArtifactPollResult,
  ChatAnswer,
  DownloadResult,
  Label,
  LoginCommandResult,
  McpConfig,
  McpKeyIssued,
  McpKeyList,
  McpUsage,
  McpUsagePeriodName,
  McpApiKey,
  Note,
  Notebook,
  ResearchStart,
  ResearchStatus,
  SettingsState,
  Source,
  SourcePollResult,
  UpdateStatus,
} from "./types";

const browserApiBase = (import.meta.env.VITE_NOTEBOOKLM_API_BASE || "").replace(/\/$/, "");

type AuthenticationRecoveryHandler = () => Promise<void>;

class ApiRequestError extends Error {
  category?: string;
  status?: number;

  constructor(message: string, category?: string, status?: number) {
    super(message);
    this.name = "ApiRequestError";
    this.category = category;
    this.status = status;
  }
}

export function isApiAuthenticationError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    (error.status === 401 || error.status === 403)
  );
}

let authenticationRecoveryHandler: AuthenticationRecoveryHandler | null = null;
let authenticationRecoveryPromise: Promise<void> | null = null;
let authenticationGeneration = 0;

export function setAuthenticationRecoveryHandler(
  handler: AuthenticationRecoveryHandler | null,
): () => void {
  authenticationRecoveryHandler = handler;
  return () => {
    if (authenticationRecoveryHandler === handler) authenticationRecoveryHandler = null;
  };
}

function isNotebookLMUnauthenticated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    (error instanceof ApiRequestError && error.category === "auth") ||
    /RPC\s+\S+\s+returned null result with status code 16\s*\(Unauthenticated\)/i.test(message) ||
    (/\bUnauthenticated\b/i.test(message) && /\bRPC\b/i.test(message))
  );
}

async function recoverAuthentication(failedGeneration: number): Promise<boolean> {
  if (authenticationGeneration > failedGeneration) return true;
  if (!authenticationRecoveryHandler) return false;
  if (!authenticationRecoveryPromise) {
    authenticationRecoveryPromise = authenticationRecoveryHandler()
      .then(() => {
        authenticationGeneration += 1;
      })
      .finally(() => {
        authenticationRecoveryPromise = null;
      });
  }
  await authenticationRecoveryPromise;
  return true;
}

async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    form?: Record<string, string | null | undefined>;
    file?: { name: string; type?: string; data: ArrayBuffer };
    download?: boolean;
    suggestedName?: string;
  } = {},
  allowAuthenticationRecovery = true,
) {
  const requestAuthenticationGeneration = authenticationGeneration;
  try {
    return await requestOnce<T>(path, options);
  } catch (error) {
    if (
      allowAuthenticationRecovery &&
      isNotebookLMUnauthenticated(error) &&
      (await recoverAuthentication(requestAuthenticationGeneration))
    ) {
      return request<T>(path, options, false);
    }
    throw error;
  }
}

async function requestOnce<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    form?: Record<string, string | null | undefined>;
    file?: { name: string; type?: string; data: ArrayBuffer };
    download?: boolean;
    suggestedName?: string;
  },
) {
  if (window.notebooklmDesktop) {
    return window.notebooklmDesktop.backendRequest<T>({
      path,
      method: options.method,
      body: options.body,
      form: options.form,
      file: options.file,
      download: options.download,
      suggestedName: options.suggestedName,
    });
  }

  const url = `${browserApiBase}${path}`;
  const headers: Record<string, string> = {};
  const init: RequestInit = {
    method: options.method || "GET",
    headers,
    credentials: "same-origin",
  };

  if (options.file) {
    const form = new FormData();
    const bytes = options.file.data;
    const blob = new Blob([bytes], {
      type: options.file.type || "application/octet-stream",
    });
    form.append("file", blob, options.file.name || "upload");
    for (const [key, value] of Object.entries(options.form || {})) {
      if (value !== undefined && value !== null && value !== "") {
        form.append(key, String(value));
      }
    }
    init.body = form;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, init);
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    const errorBody = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    const detail =
      typeof errorBody === "object" && errorBody && "error" in errorBody
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (errorBody as any).error?.message
        : errorBody;
    const category =
      typeof errorBody === "object" && errorBody && "error" in errorBody
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (errorBody as any).error?.category
        : response.status === 401 || response.status === 403
          ? "auth"
          : undefined;
    throw new ApiRequestError(
      typeof detail === "string" ? detail : `Request failed: ${path}`,
      typeof category === "string" ? category : undefined,
      response.status,
    );
  }

  if (options.download) {
    const blob = await response.blob();
    const filename =
      options.suggestedName ||
      response.headers.get("content-disposition")?.match(/filename="?([^"]+)"?/)?.[1] ||
      "download.bin";
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    return {
      canceled: false,
      filename,
      bytes: blob.size,
    } as T;
  }

  return (contentType.includes("application/json") ? await response.json() : await response.text()) as T;
}

export const api = {
  dashboardSession: () =>
    request<{ authenticated: boolean }>("/auth/session", {}, false),
  dashboardLogin: (password: string) =>
    request<{ ok: boolean; authenticated: boolean }>(
      "/auth/login",
      { method: "POST", body: { password } },
      false,
    ),
  dashboardLogout: () =>
    request<{ ok: boolean; authenticated: boolean }>(
      "/auth/logout",
      { method: "POST", body: {} },
      false,
    ),
  status: () => request<{ ok: boolean; server: string; version: string }>("/v1/status"),
  listNotebooks: async () => {
    const result = await request<{ notebooks: Notebook[] }>("/v1/notebooks");
    return result.notebooks;
  },
  createNotebook: (title: string) =>
    request<Notebook>("/v1/notebooks", { method: "POST", body: { title } }),
  renameNotebook: (id: string, title: string) =>
    request<Notebook>(`/v1/notebooks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { title },
    }),
  deleteNotebook: (id: string) =>
    request<void>(`/v1/notebooks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getNotebookSummary: (id: string) =>
    request<{ notebook_id: string; summary: string }>(
      `/v1/notebooks/${encodeURIComponent(id)}/summary`,
    ),
  listSources: async (notebookId: string) => {
    const result = await request<{ sources: Source[] }>(
      `/v1/notebooks/${encodeURIComponent(notebookId)}/sources`,
    );
    return result.sources;
  },
  addUrlSource: (notebookId: string, url: string, allowInternal = false) =>
    request<Source>(`/v1/notebooks/${encodeURIComponent(notebookId)}/sources/url`, {
      method: "POST",
      body: { url, allow_internal: allowInternal },
    }),
  addTextSource: (notebookId: string, title: string, text: string) =>
    request<Source>(`/v1/notebooks/${encodeURIComponent(notebookId)}/sources/text`, {
      method: "POST",
      body: { title, text },
    }),
  addFileSource: async (notebookId: string, file: File, title?: string) => {
    const data = await file.arrayBuffer();
    return request<Source>(`/v1/notebooks/${encodeURIComponent(notebookId)}/sources/file`, {
      method: "POST",
      form: { title: title?.trim() || undefined },
      file: { name: file.name, type: file.type, data },
    });
  },
  addDriveSource: (notebookId: string, fileId: string, title: string, mimeType: string) =>
    request<Source>(`/v1/notebooks/${encodeURIComponent(notebookId)}/sources/drive`, {
      method: "POST",
      body: { file_id: fileId, title, mime_type: mimeType },
    }),
  deleteSource: (notebookId: string, sourceId: string) =>
    request<void>(
      `/v1/notebooks/${encodeURIComponent(notebookId)}/sources/${encodeURIComponent(sourceId)}`,
      { method: "DELETE" },
    ),
  pollSource: (notebookId: string, sourceId: string) =>
    request<SourcePollResult>(
      `/v1/notebooks/${encodeURIComponent(notebookId)}/sources/${encodeURIComponent(sourceId)}`,
    ),
  ask: (notebookId: string, question: string, conversationId?: string) =>
    request<ChatAnswer>(`/v1/notebooks/${encodeURIComponent(notebookId)}/chat`, {
      method: "POST",
      body: { question, conversation_id: conversationId || null },
    }),
  getHistory: (notebookId: string) =>
    request<{ notebook_id: string; history: Array<{ question: string; answer: string }> }>(
      `/v1/notebooks/${encodeURIComponent(notebookId)}/chat/history`,
    ),
  listArtifacts: async (notebookId: string) => {
    const result = await request<{ artifacts: Artifact[] }>(
      `/v1/notebooks/${encodeURIComponent(notebookId)}/artifacts`,
    );
    return result.artifacts;
  },
  generateArtifact: (notebookId: string, body: Record<string, unknown>) =>
    request<ArtifactGeneration>(`/v1/notebooks/${encodeURIComponent(notebookId)}/artifacts`, {
      method: "POST",
      body,
    }),
  pollArtifact: (notebookId: string, taskId: string) =>
    request<ArtifactPollResult>(
      `/v1/notebooks/${encodeURIComponent(notebookId)}/artifacts/${encodeURIComponent(taskId)}`,
    ),
  downloadArtifact: (notebookId: string, type: string, outputFormat?: string) =>
    request<DownloadResult>(`/v1/notebooks/${encodeURIComponent(notebookId)}/artifacts/download`, {
      method: "POST",
      body: { type, output_format: outputFormat || null },
      download: true,
      suggestedName: artifactFilename(type, outputFormat),
    }),
  listNotes: async (notebookId: string) => {
    const result = await request<{ notes: Note[] }>(
      `/v1/notebooks/${encodeURIComponent(notebookId)}/notes`,
    );
    return result.notes;
  },
  createNote: (notebookId: string, title: string, content: string) =>
    request<Note>(`/v1/notebooks/${encodeURIComponent(notebookId)}/notes`, {
      method: "POST",
      body: { title, content },
    }),
  getShare: (notebookId: string) =>
    request<Record<string, unknown>>(`/v1/notebooks/${encodeURIComponent(notebookId)}/share`),
  listLabels: async (notebookId: string) => {
    const result = await request<{ labels: Label[] }>(
      `/v1/notebooks/${encodeURIComponent(notebookId)}/labels`,
    );
    return result.labels;
  },
  createLabel: (notebookId: string, name: string, emoji: string) =>
    request<Label>(`/v1/notebooks/${encodeURIComponent(notebookId)}/labels`, {
      method: "POST",
      body: { name, emoji },
    }),
  renameLabel: (notebookId: string, labelId: string, name: string) =>
    request<Label>(
      `/v1/notebooks/${encodeURIComponent(notebookId)}/labels/${encodeURIComponent(labelId)}`,
      { method: "PATCH", body: { name } },
    ),
  setLabelEmoji: (notebookId: string, labelId: string, emoji: string) =>
    request<Label>(
      `/v1/notebooks/${encodeURIComponent(notebookId)}/labels/${encodeURIComponent(labelId)}/emoji`,
      { method: "PATCH", body: { emoji } },
    ),
  generateLabels: (notebookId: string, scope: string) =>
    request<{ labels: Label[]; count: number }>(
      `/v1/notebooks/${encodeURIComponent(notebookId)}/labels/generate`,
      { method: "POST", body: { scope } },
    ),
  addLabelSources: (notebookId: string, labelId: string, sourceIds: string[]) =>
    request<{ label: Label; source_ids: string[] }>(
      `/v1/notebooks/${encodeURIComponent(notebookId)}/labels/${encodeURIComponent(labelId)}/sources`,
      { method: "POST", body: { source_ids: sourceIds } },
    ),
  removeLabelSources: (notebookId: string, labelId: string, sourceIds: string[]) =>
    request<{ label: Label; source_ids: string[] }>(
      `/v1/notebooks/${encodeURIComponent(notebookId)}/labels/${encodeURIComponent(labelId)}/sources`,
      { method: "DELETE", body: { source_ids: sourceIds } },
    ),
  deleteLabel: (notebookId: string, labelId: string) =>
    request<void>(
      `/v1/notebooks/${encodeURIComponent(notebookId)}/labels/${encodeURIComponent(labelId)}`,
      { method: "DELETE" },
    ),
  startResearch: (notebookId: string, body: { query: string; source: string; mode: string }) =>
    request<ResearchStart>(`/v1/notebooks/${encodeURIComponent(notebookId)}/research`, {
      method: "POST",
      body,
    }),
  getResearchStatus: (notebookId: string, taskId?: string) =>
    request<ResearchStatus>(
      `/v1/notebooks/${encodeURIComponent(notebookId)}/research/status${
        taskId ? `?task_id=${encodeURIComponent(taskId)}` : ""
      }`,
    ),
  cancelResearch: (notebookId: string, taskId: string) =>
    request<void>(
      `/v1/notebooks/${encodeURIComponent(notebookId)}/research/${encodeURIComponent(taskId)}`,
      { method: "DELETE" },
    ),
  getSettings: () => request<SettingsState>("/v1/settings"),
  setLanguage: (code: string) =>
    request<{ language: string; language_name?: string | null }>("/v1/settings/language", {
      method: "PATCH",
      body: { code },
    }),
  checkUpdate: () => request<UpdateStatus>("/v1/settings/update"),
  runLogin: () =>
    request<LoginCommandResult>("/v1/settings/login", {
      method: "POST",
      body: {},
    }),
  getMcpConfig: () => request<McpConfig>("/v1/mcp/config"),
  listMcpKeys: () => request<McpKeyList>("/v1/mcp/keys"),
  createMcpKey: (name: string) =>
    request<McpKeyIssued>("/v1/mcp/keys", {
      method: "POST",
      body: { name },
    }),
  revokeMcpKey: (keyId: string) =>
    request<{ ok: boolean; key: McpApiKey }>(`/v1/mcp/keys/${encodeURIComponent(keyId)}`, {
      method: "DELETE",
    }),
  getMcpUsage: (period: McpUsagePeriodName = "7d") =>
    request<McpUsage>(`/v1/mcp/usage?period=${encodeURIComponent(period)}`),
};

function artifactFilename(type: string, outputFormat?: string) {
  const extensionByType: Record<string, string> = {
    audio: "mp3",
    video: "mp4",
    report: "md",
    quiz: outputFormat || "json",
    flashcards: outputFormat || "json",
    infographic: "png",
    "slide-deck": outputFormat || "pdf",
    "data-table": "csv",
    "mind-map": "json",
  };
  return `notebooklm-${type}.${extensionByType[type] || "artifact"}`;
}
