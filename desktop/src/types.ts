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
  modified_at?: string;
  sources_count?: number;
  is_owner?: boolean;
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

export type Label = {
  id: string;
  name: string;
  notebook_id?: string | null;
  emoji?: string | null;
  source_ids: string[];
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

export type ResearchStart = {
  task_id: string;
  report_id?: string | null;
  notebook_id: string;
  query: string;
  mode: string;
};

export type ResearchStatus = {
  notebook_id: string;
  task_id: string;
  kind: string;
  status: string;
  query: string;
  sources: Array<{ url?: string; title?: string; result_type?: string | number }>;
  summary: string;
  report: string;
};

export type SettingsState = {
  server: string;
  version: string;
  language?: string | null;
  language_name?: string | null;
  languages: Record<string, string>;
};

export type McpFeature = {
  id: string;
  label: string;
  description?: string;
  tools: string[];
};

export type McpConfigEndpoints = {
  appBaseUrl?: string;
  authBaseUrl?: string;
  apiBaseUrl?: string;
  mcpBaseUrl?: string;
  mediaBaseUrl?: string;
  docsBaseUrl?: string;
};

export type McpConfigPermissions = {
  manageKey?: string;
  viewUsage?: string;
  callTools?: string;
};

export type McpConfig = {
  ok: boolean;
  product: {
    name: string;
    slug: string;
    description?: string;
  };
  endpoint: string;
  endpoints?: McpConfigEndpoints;
  transport: string;
  protocolVersion: string;
  auth: {
    type: string;
    header: string;
    valuePrefix?: string;
  };
  permissions?: McpConfigPermissions;
  features: McpFeature[];
};

export type McpApiKey = {
  id: string;
  name: string;
  prefix: string;
  status: "active" | "revoked";
  createdAt: string;
  createdBy: string;
  lastUsedAt: string;
  revokedAt: string;
  legacy: boolean;
};

export type McpKeyList = {
  ok: boolean;
  keys: McpApiKey[];
};

export type McpKeyIssued = {
  ok: boolean;
  apiKey: string;
  key: McpApiKey;
};

export type McpUsagePeriodName = "today" | "7d" | "30d";

export type McpUsageEvent = {
  id: string;
  tool: string;
  operation: "create" | "download" | "other";
  status: "success" | "failed";
  keyId: string;
  keyPrefix: string;
  latencyMs: number;
  errorCode: string;
  createdAt: string;
  dateKey: string;
};

export type McpUsagePoint = {
  date: string;
  createRequested: number;
  createSuccess: number;
  createFailed: number;
  downloadSuccess: number;
};

export type McpUsage = {
  ok: boolean;
  period: {
    name: McpUsagePeriodName;
    from: string;
    to: string;
    timeZone: string;
  };
  summary: {
    createRequested: number;
    createSuccess: number;
    createFailed: number;
    downloadSuccess: number;
    dailyLimit: number;
    dailyUsed: number;
    dailyReserved: number;
    dailyRemaining: number;
    dailyResetAt: string;
  };
  series: McpUsagePoint[];
  recent: McpUsageEvent[];
};

export type UpdateStatus = {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  channel: string;
  message: string;
};

export type LoginCommandResult = {
  ok: boolean;
  status: string;
  command: string;
  returncode: number | null;
  timed_out: boolean;
  timeout_seconds?: number;
  stdout: string;
  stderr: string;
};

export type LocalCommandResult = {
  ok: boolean;
  command: string;
  returncode: number | null;
  timed_out: boolean;
  timeout_seconds: number;
  stdout: string;
  stderr: string;
};

export type VpsConnectionStatus = {
  ok: boolean;
  status: string;
  connected: boolean;
  profile_ready?: boolean;
  cookie_count?: number;
  notebook_count?: number | null;
  repaired?: boolean;
  repair_sync?: DriveDownCookiesResponse | null;
  error?: string | null;
};

export type ProfileLoginOpenResult = {
  ok: boolean;
  status: string;
  login_id?: string;
  url?: string;
  chrome_path?: string;
  chrome_exists?: boolean;
  profile_directory?: string;
  profile_path?: string;
  profile_exists?: boolean;
  profile_name?: string;
  profile_email?: string;
  extension_configured?: boolean;
  extension_id?: string;
  extension_path?: string;
  extension_version?: string;
  extension_source_version?: string;
  extension_reload_required?: boolean;
  extension_service_worker_started?: boolean;
  error?: string;
};

export type HostedProfileLoginTransaction = {
  ok: boolean;
  login_id: string;
  status: "waiting_for_extension" | "syncing" | "connected" | "error" | "expired";
  connected: boolean;
  bridge_url?: string;
  created_at: string;
  expires_at: string;
  cookie_count?: number | null;
  notebook_count?: number | null;
  error?: string | null;
};

export type LocalLoginSyncResult = {
  ok: boolean;
  status: string;
  profile?: string;
  storage_path?: string;
  setup?: LocalCommandResult | null;
  retried?: boolean;
  fresh_retried?: boolean;
  login?: LocalCommandResult;
  sync?: DriveDownCookiesResponse | null;
  connected?: VpsConnectionStatus | null;
  error?: string;
};

export type LocalLoginResetResult = {
  ok: boolean;
  status: string;
  profile?: string;
  storage_path?: string;
  browser_profile_path?: string;
  storage_exists?: boolean;
  browser_profile_existed?: boolean;
  browser_profile_deleted?: boolean;
  browser_profile_error?: string | null;
  logout?: LocalCommandResult;
  error?: string;
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
  restartBackend?(): Promise<AppInfo>;
  openProfileLogin?(): Promise<ProfileLoginOpenResult>;
  profileLoginStatus?(loginId: string): Promise<VpsConnectionStatus>;
  finalizeProfileLogin?(): Promise<LocalLoginSyncResult>;
  localLoginAndSync?(): Promise<LocalLoginSyncResult>;
  resetLocalLogin?(): Promise<LocalLoginResetResult>;
  checkVpsConnected?(): Promise<VpsConnectionStatus>;
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

export type DriveDownCookiesResponse = {
  ok: boolean;
  error?: string;
  status?: string;
  server?: string;
  extension_version?: string;
  cookie_count?: number;
  received_count?: number;
  persisted_count?: number;
  client_reloaded?: boolean;
  auth_verified?: boolean;
  restart_required?: boolean;
  profile_login_id?: string | null;
  profile_login_matched?: boolean;
  capabilities?: {
    profile_login_correlation?: boolean;
  };
};

export type ExternalExtensionRuntime = {
  lastError?: { message?: string };
  sendMessage(
    extensionId: string,
    message: Record<string, unknown>,
    callback: (response?: DriveDownCookiesResponse) => void,
  ): void;
};

declare global {
  interface Window {
    notebooklmDesktop?: DesktopBridge;
    chrome?: {
      runtime?: ExternalExtensionRuntime;
    };
  }
}
