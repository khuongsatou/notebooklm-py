export type BackendStatus = {
  status: "starting" | "ready" | "stopped" | "error" | "log";
  port?: number;
  code?: number;
  stream?: "stdout" | "stderr";
  message?: string;
};

export type AppInfo = {
  name: string;
  version: string;
  backend: {
    baseUrl: string;
    port: number;
    status: string;
  } | null;
};

export type Notebook = {
  id: string;
  title: string;
  created_at?: string;
  updated_at?: string;
};

export type Source = {
  id: string;
  title?: string | null;
  url?: string | null;
  status?: number | string;
  source_type?: number;
};

export type Artifact = {
  id: string;
  title?: string | null;
  status?: number | string;
  type?: string;
  kind?: string;
  created_at?: string;
};

export type Note = {
  id: string;
  title?: string | null;
  content?: string | null;
  created_at?: string;
};

export type ChatAnswer = {
  answer: string;
  conversation_id?: string;
  references?: unknown[];
};

export type SourcePollResult = Source & {
  source_id?: string;
};

export type ArtifactGeneration = {
  task_id?: string;
  artifact_id?: string;
  status?: string;
  type?: string;
  message?: string;
};

export type ArtifactPollResult = {
  task_id: string;
  status: string;
  url?: string | null;
  error?: string | null;
  error_code?: string | null;
  is_complete?: boolean;
  metadata?: Record<string, unknown> | null;
};

export type DownloadResult = {
  canceled: boolean;
  path?: string;
  filename?: string;
  bytes?: number;
};

export type Job = {
  id: string;
  notebookId: string;
  kind: "source" | "artifact";
  title: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  message?: string;
  artifactType?: string;
  updatedAt: number;
};

export type VerificationAttempt = {
  answer: string;
  checkedAt: number;
};

export type VerificationRecord = {
  id: string;
  notebookId: string;
  question: string;
  attempts: VerificationAttempt[];
  createdAt: number;
  verified: boolean;
};

export type DesktopBridge = {
  getAppInfo(): Promise<AppInfo>;
  backendRequest<T = unknown>(request: {
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    form?: Record<string, string | null | undefined>;
    file?: {
      name: string;
      type?: string;
      data: ArrayBuffer;
    };
    download?: boolean;
    suggestedName?: string;
  }): Promise<T>;
  onBackendStatus(callback: (payload: BackendStatus) => void): () => void;
};

declare global {
  interface Window {
    notebooklmDesktop?: DesktopBridge;
  }
}
