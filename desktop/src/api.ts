import type { Artifact, ChatAnswer, Note, Notebook, Source } from "./types";

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}) {
  if (!window.notebooklmDesktop) {
    throw new Error("Open this renderer through Electron to connect the local backend");
  }
  return window.notebooklmDesktop.backendRequest<T>({
    path,
    method: options.method,
    body: options.body,
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
  deleteSource: (notebookId: string, sourceId: string) =>
    request<void>(
      `/v1/notebooks/${encodeURIComponent(notebookId)}/sources/${encodeURIComponent(sourceId)}`,
      { method: "DELETE" },
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
    request<Record<string, unknown>>(`/v1/notebooks/${encodeURIComponent(notebookId)}/artifacts`, {
      method: "POST",
      body,
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
};
