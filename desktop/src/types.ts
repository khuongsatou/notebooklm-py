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

export type DesktopBridge = {
  getAppInfo(): Promise<AppInfo>;
  backendRequest<T = unknown>(request: {
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  }): Promise<T>;
  onBackendStatus(callback: (payload: BackendStatus) => void): () => void;
};

declare global {
  interface Window {
    notebooklmDesktop?: DesktopBridge;
  }
}
