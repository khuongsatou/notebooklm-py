import type {
  Artifact,
  ArtifactGeneration,
  ArtifactPollResult,
  ChatAnswer,
  DownloadResult,
  Label,
  Note,
  Notebook,
  ResearchStart,
  ResearchStatus,
  SettingsState,
  Source,
  SourcePollResult,
  UpdateStatus,
} from "./types";

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
) {
  if (!window.notebooklmDesktop) {
    throw new Error("Open this renderer through Electron to connect the local backend");
  }
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

export const api = {
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
