import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BookOpen,
  Bot,
  CheckCircle2,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Database,
  DownloadCloud,
  ExternalLink,
  FilePlus2,
  FileText,
  FlaskConical,
  Globe2,
  Link2,
  KeyRound,
  Layers3,
  Loader2,
  Lock,
  LogIn,
  MessageSquareText,
  NotebookTabs,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Share2,
  Sparkles,
  Tags,
  Trash2,
  Unplug,
  Wand2,
  X,
} from "lucide-react";

import {
  api,
  isApiAuthenticationError,
  setAuthenticationRecoveryHandler,
} from "./api";
import type {
  AppInfo,
  Artifact,
  BackendStatus,
  ChatAnswer,
  Job,
  Label,
  LoginCommandResult,
  LocalLoginResetResult,
  LocalLoginSyncResult,
  Note,
  Notebook,
  McpApiKey,
  McpConfig,
  McpUsage,
  McpUsagePeriodName,
  ResearchStatus,
  SettingsState,
  Source,
  UpdateStatus,
  VpsConnectionStatus,
  VerificationRecord,
  DriveDownCookiesResponse,
} from "./types";
import "./styles.css";

type View =
  | "overview"
  | "sources"
  | "chat"
  | "studio"
  | "artifacts"
  | "notes"
  | "verify"
  | "research"
  | "labels"
  | "share"
  | "mcp"
  | "settings";

type NotebookDialogState = {
  mode: "create" | "rename";
  title: string;
};

const views: Array<{
  id: View;
  label: string;
  icon: React.ElementType;
  available?: boolean;
}> = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "sources", label: "Sources", icon: FilePlus2 },
  { id: "chat", label: "Chat", icon: MessageSquareText },
  { id: "studio", label: "Studio", icon: Wand2 },
  { id: "artifacts", label: "Artifacts", icon: Layers3 },
  { id: "notes", label: "Notes", icon: FileText },
  { id: "verify", label: "Verify", icon: ShieldCheck },
  { id: "research", label: "Research", icon: FlaskConical },
  { id: "labels", label: "Labels", icon: Tags },
  { id: "share", label: "Share", icon: Share2 },
  { id: "mcp", label: "MCP", icon: KeyRound },
  { id: "settings", label: "Settings", icon: Settings },
];

const artifactTypes = [
  "audio",
  "video",
  "cinematic-video",
  "report",
  "quiz",
  "flashcards",
  "infographic",
  "slide-deck",
  "data-table",
  "mind-map",
];

const downloadTypes = [
  "audio",
  "video",
  "report",
  "quiz",
  "flashcards",
  "infographic",
  "slide-deck",
  "data-table",
  "mind-map",
];

const verificationStorageKey = "notebooklm-pro.verifications.v1";
const driveDownCookiesExtensionId = "cclelndahbckbenkjhflpdbgdldlbecc";
const googleNotebookLMBaseUrl = "https://notebooklm.google.com";

function notebookDisplayName(notebook: Pick<Notebook, "id" | "title">): string {
  const title = typeof notebook.title === "string" ? notebook.title.trim() : "";
  return title || `Untitled notebook · ${notebook.id.slice(0, 8)}`;
}

function notebookGoogleUrl(notebookId: string): string {
  return `${googleNotebookLMBaseUrl}/notebook/${encodeURIComponent(notebookId)}`;
}

function openNotebookInGoogle(notebookId: string) {
  window.open(notebookGoogleUrl(notebookId), "_blank", "noopener,noreferrer");
}

type ExtensionStatus = "idle" | "connecting" | "connected" | "syncing" | "error";

type LogEntry = {
  id: string;
  timestamp: number;
  level: "info" | "success" | "warning" | "error";
  source: "backend" | "extension" | "local" | "ui";
  message: string;
};

function requestDriveDownCookies(
  type: "connect" | "sync-now",
): Promise<DriveDownCookiesResponse> {
  return new Promise((resolve, reject) => {
    const runtime = window.chrome?.runtime;
    if (!runtime?.sendMessage) {
      reject(new Error("Drive Down Cookies extension was not detected in this browser."));
      return;
    }
    runtime.sendMessage(
      driveDownCookiesExtensionId,
      { target: "drive-down-cookies", type },
      (response) => {
        const runtimeError = runtime.lastError?.message;
        if (runtimeError) {
          reject(new Error(`Cannot connect to Drive Down Cookies: ${runtimeError}`));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || "Drive Down Cookies did not respond."));
          return;
        }
        resolve(response);
      },
    );
  });
}

function BrowserPasswordGate({
  error,
  running,
  onSubmit,
}: {
  error: string;
  running: boolean;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");

  return (
    <main className="browser-auth-shell">
      <form
        className="browser-auth-card"
        aria-label="Connect NotebookLM production"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(password).catch(() => undefined);
        }}
      >
        <span className="browser-auth-mark"><NotebookTabs size={24} /></span>
        <div>
          <span className="browser-auth-kicker">Production workspace</span>
          <h1>NotebookLM Pro</h1>
          <p>
            Đăng nhập dashboard để truy cập workspace NotebookLM trên VPS.
            Phiên đăng nhập được bảo vệ bằng cookie HttpOnly.
          </p>
        </div>
        <label className="field">
          <span>Mật khẩu</span>
          <input
            autoFocus
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Nhập mật khẩu dashboard"
          />
        </label>
        {error ? <div className="banner bad">{error}</div> : null}
        <button
          className="btn-primary browser-auth-submit"
          type="submit"
          disabled={!password || running}
        >
          {running ? <Loader2 size={16} className="spin" /> : <Lock size={16} />}
          {running ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
        <span className="browser-auth-hint">
          Endpoint: notebooklm.1nutnhan.com · HTTPS
        </span>
      </form>
    </main>
  );
}

function App() {
  const browserHosted = !window.notebooklmDesktop;
  const [browserSessionReady, setBrowserSessionReady] = useState(() => !browserHosted);
  const [browserSessionError, setBrowserSessionError] = useState("");
  const [browserLoginRunning, setBrowserLoginRunning] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [backend, setBackend] = useState<BackendStatus>({ status: "starting" });
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [activeNotebookId, setActiveNotebookId] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [verifications, setVerifications] = useState<VerificationRecord[]>(loadVerifications);
  const [answer, setAnswer] = useState<ChatAnswer | null>(null);
  const [view, setView] = useState<View>("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [versionOpen, setVersionOpen] = useState(false);
  const [restartingBackend, setRestartingBackend] = useState(false);
  const [loginRunning, setLoginRunning] = useState(false);
  const [loginMessage, setLoginMessage] = useState("Idle");
  const [localLoginRunning, setLocalLoginRunning] = useState(false);
  const [localResetRunning, setLocalResetRunning] = useState(false);
  const [localSyncMessage, setLocalSyncMessage] = useState("Not checked");
  const [vpsChecking, setVpsChecking] = useState(false);
  const [vpsConnection, setVpsConnection] = useState<VpsConnectionStatus | null>(null);
  const [extensionStatus, setExtensionStatus] = useState<ExtensionStatus>("idle");
  const [extensionMessage, setExtensionMessage] = useState("Not connected");
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [logManagerOpen, setLogManagerOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>(() => [
    {
      id: `log-${Date.now()}-init`,
      timestamp: Date.now(),
      level: "info",
      source: "ui",
      message: "Log manager initialized",
    },
  ]);
  const lastBackendStatusLog = useRef("");
  const [notebookSearch, setNotebookSearch] = useState("");
  const [notebookDialog, setNotebookDialog] = useState<NotebookDialogState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Notebook | null>(null);

  const activeNotebook = useMemo(
    () => notebooks.find((notebook) => notebook.id === activeNotebookId) || null,
    [notebooks, activeNotebookId],
  );
  const filteredNotebooks = useMemo(() => {
    const query = notebookSearch.trim().toLocaleLowerCase();
    if (!query) return notebooks;
    return notebooks.filter((notebook) =>
      `${notebookDisplayName(notebook)} ${notebook.id}`.toLocaleLowerCase().includes(query),
    );
  }, [notebooks, notebookSearch]);
  const ready = backend.status === "ready";
  const canUseDriveExtension = Boolean(window.chrome?.runtime?.sendMessage);
  const canRestartExtension = Boolean(window.notebooklmDesktop?.restartBackend);
  const canLocalLoginSync = Boolean(window.notebooklmDesktop?.localLoginAndSync);
  const canResetLocalLogin = Boolean(window.notebooklmDesktop?.resetLocalLogin);
  const canCheckVps = Boolean(window.notebooklmDesktop?.checkVpsConnected);
  const extensionPillClass =
    extensionStatus === "connected"
      ? "ok"
      : extensionStatus === "error"
        ? "bad"
        : "";
  const vpsPillClass = vpsConnection?.connected ? "ok" : vpsConnection ? "bad" : "";

  const appendLog = useCallback(
    (entry: Omit<LogEntry, "id" | "timestamp">) => {
      setLogs((items) => [
        {
          ...entry,
          id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
        },
        ...items,
      ].slice(0, 300));
    },
    [],
  );

  useEffect(
    () => setAuthenticationRecoveryHandler(canUseDriveExtension ? syncCookiesFromExtension : null),
    [canUseDriveExtension],
  );

  useEffect(() => {
    if (!browserHosted) return undefined;
    let cancelled = false;
    api.dashboardSession()
      .then((result) => {
        if (!cancelled) setBrowserSessionReady(result.authenticated);
      })
      .catch(() => {
        if (!cancelled) setBrowserSessionReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [browserHosted]);

  useEffect(() => {
    if (!window.notebooklmDesktop) {
      if (!browserSessionReady) {
        setBackend({ status: "stopped", message: "Dashboard login required" });
        return undefined;
      }
      let cancelled = false;
      const syncWebApp = async () => {
        try {
          const info = await api.status();
          if (!info || typeof info !== "object" || info.ok !== true || typeof info.version !== "string") {
            throw new Error("Open with Electron or start a REST backend.");
          }
          const list = await api.listNotebooks();
          if (cancelled) return;
          setAppInfo({
            name: "notebooklm-pro-web",
            version: info.version,
            backend: {
              baseUrl: window.location.origin,
              port: Number(window.location.port || "443") || 443,
              status: "ready",
            },
          });
          setNotebooks(list);
          if (!activeNotebookId && list[0]) setActiveNotebookId(list[0].id);
          setBackend({ status: "ready", port: Number(window.location.port || "443") || 443 });
        } catch (err) {
          if (cancelled) return;
          if (isApiAuthenticationError(err)) {
            setBrowserSessionError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
            setBrowserSessionReady(false);
            return;
          }
          setBackend({
            status: "error",
            message: err instanceof Error ? err.message : "Backend unavailable",
          });
        }
      };
      syncWebApp().catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }
    let didRefreshReady = false;
    const syncAppInfo = async () => {
      const info = await window.notebooklmDesktop?.getAppInfo();
      if (!info) return;
      setAppInfo(info);
      if (info.backend) {
        setBackend({ status: info.backend.status as BackendStatus["status"], port: info.backend.port });
        const statusKey = `${info.backend.status}:${info.backend.port || ""}`;
        if (lastBackendStatusLog.current !== statusKey) {
          lastBackendStatusLog.current = statusKey;
          appendLog({
            level: info.backend.status === "ready" ? "success" : "info",
            source: "backend",
            message: `Backend status: ${info.backend.status}${info.backend.port ? ` on ${info.backend.port}` : ""}`,
          });
        }
        if (info.backend.status === "ready" && !didRefreshReady) {
          didRefreshReady = true;
          refreshNotebooks();
        }
      }
    };
    syncAppInfo().catch(() => undefined);
    const poll = window.setInterval(() => {
      if (!didRefreshReady) syncAppInfo().catch(() => undefined);
    }, 1000);
    const unsubscribe = window.notebooklmDesktop.onBackendStatus((payload) => {
      // Backend stdout/stderr is useful diagnostics, but a late log line must
      // not downgrade an already healthy backend back to the non-ready state.
      if (payload.status === "log") {
        appendLog({
          level: payload.stream === "stderr" ? "warning" : "info",
          source: "backend",
          message: `[${payload.stream || "log"}] ${payload.message || ""}`,
        });
        setBackend((current) => (current.status === "ready" ? current : payload));
        return;
      }
      const statusKey = `${payload.status}:${payload.port || ""}:${payload.message || ""}`;
      if (lastBackendStatusLog.current !== statusKey) {
        lastBackendStatusLog.current = statusKey;
        appendLog({
          level: payload.status === "ready" ? "success" : payload.status === "error" ? "error" : "info",
          source: "backend",
          message: `Backend ${payload.status}${payload.message ? `: ${payload.message}` : ""}`,
        });
      }
      setBackend(payload);
      if (payload.status === "ready") {
        didRefreshReady = true;
        refreshNotebooks();
      }
      if (payload.status === "stopped" || payload.status === "error") {
        window.clearInterval(poll);
      }
    });
    return () => {
      window.clearInterval(poll);
      unsubscribe();
    };
  }, [browserSessionReady, appendLog]);

  useEffect(() => {
    if (activeNotebookId) {
      refreshWorkspace(activeNotebookId);
    }
  }, [activeNotebookId]);

  useEffect(() => {
    window.localStorage.setItem(verificationStorageKey, JSON.stringify(verifications));
  }, [verifications]);

  useEffect(() => {
    if (!ready || !jobs.some((job) => isActiveJob(job))) return undefined;
    const poll = window.setInterval(() => {
      for (const job of jobs.filter(isActiveJob)) {
        pollJob(job);
      }
    }, 2500);
    return () => window.clearInterval(poll);
  }, [ready, jobs]);

  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      await action();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      appendLog({ level: "error", source: "ui", message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function refreshNotebooks() {
    appendLog({ level: "info", source: "ui", message: "Refreshing notebooks" });
    const ok = await run(async () => {
      await api.status();
      const list = await api.listNotebooks();
      setNotebooks(list);
      if (!activeNotebookId && list[0]) setActiveNotebookId(list[0].id);
    });
    if (browserHosted) {
      setBackend(
        ok
          ? { status: "ready", port: Number(window.location.port || "443") || 443 }
          : { status: "error", message: "NotebookLM authentication is unavailable" },
      );
    }
  }

  async function refreshWorkspace(notebookId = activeNotebookId) {
    if (!notebookId) return;
    await run(async () => {
      const [sourceList, artifactList, noteList] = await Promise.all([
        api.listSources(notebookId),
        api.listArtifacts(notebookId),
        api.listNotes(notebookId),
      ]);
      setSources(sourceList);
      setArtifacts(artifactList);
      setNotes(noteList);
    });
  }

  function upsertJob(job: Job) {
    setJobs((items) => [job, ...items.filter((item) => item.id !== job.id)]);
  }

  function patchJob(id: string, patch: Partial<Job>) {
    setJobs((items) =>
      items.map((job) => (job.id === id ? { ...job, ...patch, updatedAt: Date.now() } : job)),
    );
  }

  function addVerification(question: string, savedAnswer?: string) {
    const cleanQuestion = question.trim();
    if (!activeNotebookId || !cleanQuestion) return;
    const now = Date.now();
    setVerifications((items) => [
      {
        id: makeVerificationId(),
        notebookId: activeNotebookId,
        question: cleanQuestion,
        attempts: savedAnswer?.trim() ? [{ answer: savedAnswer.trim(), checkedAt: now }] : [],
        createdAt: now,
        verified: false,
      },
      ...items,
    ]);
  }

  function patchVerification(id: string, patch: Partial<VerificationRecord>) {
    setVerifications((items) =>
      items.map((record) => (record.id === id ? { ...record, ...patch } : record)),
    );
  }

  function deleteVerification(id: string) {
    setVerifications((items) => items.filter((record) => record.id !== id));
  }

  async function pollJob(job: Job) {
    try {
      if (job.kind === "source") {
        const result = await api.pollSource(job.notebookId, job.id);
        if (isSourceReady(result.status)) {
          patchJob(job.id, { status: "completed", message: "ready" });
          await refreshWorkspace(job.notebookId);
        } else {
          patchJob(job.id, { status: "in_progress", message: `status ${result.status ?? "pending"}` });
        }
        return;
      }
      const result = await api.pollArtifact(job.notebookId, job.id);
      if (isArtifactComplete(result.status, result.is_complete)) {
        patchJob(job.id, { status: "completed", message: result.status });
        await refreshWorkspace(job.notebookId);
      } else if (isArtifactFailed(result.status)) {
        patchJob(job.id, { status: "failed", message: result.error || result.status });
      } else {
        patchJob(job.id, { status: "in_progress", message: result.status });
      }
    } catch (err) {
      patchJob(job.id, {
        status: "failed",
        message: err instanceof Error ? err.message : "Poll failed",
      });
    }
  }

  async function submitNotebookDialog() {
    if (!notebookDialog) return;
    const title = notebookDialog.title.trim();
    if (!title) return;
    await run(async () => {
      if (notebookDialog.mode === "create") {
        const created = await api.createNotebook(title);
        setNotebooks((items) => [created, ...items]);
        setActiveNotebookId(created.id);
        setView("overview");
      } else if (activeNotebook) {
        const renamed = await api.renameNotebook(activeNotebook.id, title);
        setNotebooks((items) => items.map((item) => (item.id === renamed.id ? renamed : item)));
      }
      setNotebookDialog(null);
    });
  }

  function selectNotebook(id: string) {
    setActiveNotebookId(id);
    setView("overview");
    setAnswer(null);
  }

  function openRenameNotebook() {
    if (!activeNotebook) return;
    setNotebookDialog({ mode: "rename", title: activeNotebook.title.trim() });
  }

  async function connectNotebookLM() {
    setExtensionStatus("connecting");
    setExtensionMessage("Checking...");
    setError("");
    appendLog({ level: "info", source: "extension", message: "Checking Drive Down Cookies connection" });
    try {
      const result = await requestDriveDownCookies("connect");
      setExtensionStatus("connected");
      const message = result.extension_version ? `v${result.extension_version}` : result.status || "Connected";
      setExtensionMessage(message);
      appendLog({ level: "success", source: "extension", message: `Extension connected: ${message}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Extension connection failed";
      setExtensionStatus("error");
      setExtensionMessage("Connection failed");
      setError(message);
      appendLog({ level: "error", source: "extension", message });
    }
  }

  async function getCookiesFromExtension() {
    try {
      await syncCookiesFromExtension();
      await refreshNotebooks();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not get cookies from extension";
      setError(message);
      appendLog({ level: "error", source: "extension", message });
    }
  }

  async function syncCookiesFromExtension() {
    setExtensionStatus("syncing");
    setExtensionMessage("Getting cookies...");
    setError("");
    appendLog({ level: "info", source: "extension", message: "Syncing cookies from extension" });
    try {
      const result = await requestDriveDownCookies("sync-now");
      if (
        result.restart_required ||
        result.client_reloaded !== true ||
        result.auth_verified !== true ||
        typeof result.persisted_count !== "number"
      ) {
        throw new Error(
          "Cookies were received, but the NotebookLM backend did not verify the local session.",
        );
      }
      setExtensionStatus("connected");
      const message = `${result.persisted_count} cookies verified from local Chrome`;
      setExtensionMessage(message);
      appendLog({ level: "success", source: "extension", message });
    } catch (err) {
      setExtensionStatus("error");
      setExtensionMessage("Cookie sync failed");
      appendLog({
        level: "error",
        source: "extension",
        message: err instanceof Error ? err.message : "Cookie sync failed",
      });
      throw err;
    }
  }

  async function restartDesktopBackend() {
    const restartBackend = window.notebooklmDesktop?.restartBackend;
    if (!restartBackend) return;
    setRestartingBackend(true);
    setError("");
    appendLog({ level: "info", source: "backend", message: "Restarting backend" });
    try {
      const info = await restartBackend();
      setAppInfo(info);
      if (info.backend) {
        setBackend({
          status: info.backend.status as BackendStatus["status"],
          port: info.backend.port,
        });
      }
      await refreshNotebooks();
      appendLog({ level: "success", source: "backend", message: "Backend restart requested" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Backend restart failed";
      setError(message);
      appendLog({ level: "error", source: "backend", message });
    } finally {
      setRestartingBackend(false);
    }
  }

  async function runNotebookLMLogin() {
    setLoginRunning(true);
    setLoginMessage("Running notebooklm login...");
    setError("");
    appendLog({ level: "info", source: "backend", message: "Running notebooklm login command" });
    try {
      const result = await api.runLogin();
      const nextMessage =
        result.status === "ok"
          ? "Login command completed"
          : result.timed_out
            ? "Login command timed out"
            : `Login command failed (${result.returncode ?? "start"})`;
      setLoginMessage(nextMessage);
      if (!result.ok) {
        const detail = result.stderr.trim() || result.stdout.trim() || nextMessage;
        setError(detail);
        appendLog({ level: "error", source: "backend", message: detail });
      } else {
        appendLog({ level: "success", source: "backend", message: "NotebookLM login command completed" });
        await refreshNotebooks();
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not run notebooklm login";
      setLoginMessage("Login command failed");
      setError(message);
      appendLog({ level: "error", source: "backend", message });
      throw err;
    } finally {
      setLoginRunning(false);
    }
  }

  function localSyncError(result: LocalLoginSyncResult): string {
    if (result.error) return result.error;
    if (result.connected?.error) return result.connected.error;
    if (result.setup && !result.setup.ok) {
      return (
        result.setup.stderr.trim() ||
        result.setup.stdout.trim() ||
        "Playwright Chromium install failed"
      );
    }
    if (result.login && !result.login.ok) {
      return result.login.stderr.trim() || result.login.stdout.trim() || "Local notebooklm login failed";
    }
    return "Local login sync did not verify the VPS connection.";
  }

  function localResetError(result: LocalLoginResetResult): string {
    if (result.error) return result.error;
    if (result.browser_profile_error) return result.browser_profile_error;
    if (result.logout && !result.logout.ok) {
      return result.logout.stderr.trim() || result.logout.stdout.trim() || "Local notebooklm logout failed";
    }
    if (result.storage_exists) return "Local auth storage still exists after reset.";
    return "Local login reset did not complete.";
  }

  async function resetLocalLogin() {
    const resetLogin = window.notebooklmDesktop?.resetLocalLogin;
    if (!resetLogin) {
      setError("Open the desktop app to reset local notebooklm login.");
      return;
    }
    setLocalResetRunning(true);
    setLocalSyncMessage("Resetting local login...");
    setError("");
    appendLog({ level: "info", source: "local", message: "Resetting local NotebookLM login" });
    try {
      const result = await resetLogin();
      setVpsConnection(null);
      if (!result.ok) {
        const message = localResetError(result);
        setLocalSyncMessage(result.status || "Reset failed");
        setError(message);
        appendLog({ level: "error", source: "local", message });
        return;
      }
      setLocalSyncMessage("Local login reset");
      appendLog({ level: "success", source: "local", message: "Local login reset" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Local login reset failed";
      setLocalSyncMessage("Reset failed");
      setError(message);
      appendLog({ level: "error", source: "local", message });
    } finally {
      setLocalResetRunning(false);
    }
  }

  async function runLocalLoginAndSync() {
    const localLoginAndSync = window.notebooklmDesktop?.localLoginAndSync;
    if (!localLoginAndSync) {
      setError("Open the desktop app to run local notebooklm login.");
      return;
    }
    setLocalLoginRunning(true);
    setLocalSyncMessage("Running local login...");
    setError("");
    appendLog({ level: "info", source: "local", message: "Running local login and VPS sync" });
    try {
      const result = await localLoginAndSync();
      setVpsConnection(result.connected || null);
      if (!result.ok) {
        const message = localSyncError(result);
        setLocalSyncMessage(result.status || "Sync failed");
        setError(message);
        appendLog({ level: "error", source: "local", message });
        return;
      }
      const count =
        typeof result.connected?.notebook_count === "number"
          ? `${result.connected.notebook_count} notebooks`
          : "verified";
      setLocalSyncMessage(`VPS connected: ${count}`);
      appendLog({ level: "success", source: "local", message: `VPS connected: ${count}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Local login sync failed";
      setLocalSyncMessage("Sync failed");
      setError(message);
      appendLog({ level: "error", source: "local", message });
    } finally {
      setLocalLoginRunning(false);
    }
  }

  async function checkVpsConnected() {
    const checkConnected = window.notebooklmDesktop?.checkVpsConnected;
    if (!checkConnected) {
      setError("Open the desktop app to check the VPS connection.");
      return;
    }
    setVpsChecking(true);
    setError("");
    appendLog({ level: "info", source: "local", message: "Checking VPS connection" });
    try {
      const result = await checkConnected();
      setVpsConnection(result);
      const message =
        result.connected
          ? `VPS connected${typeof result.notebook_count === "number" ? `: ${result.notebook_count} notebooks` : ""}`
          : result.error || result.status || "VPS not connected";
      setLocalSyncMessage(message);
      appendLog({ level: result.connected ? "success" : "warning", source: "local", message });
      if (!result.connected && result.error) setError(result.error);
    } catch (err) {
      const message = err instanceof Error ? err.message : "VPS connected check failed";
      setLocalSyncMessage("Check failed");
      setError(message);
      appendLog({ level: "error", source: "local", message });
    } finally {
      setVpsChecking(false);
    }
  }

  async function confirmDeleteNotebook() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    await run(async () => {
      await api.deleteNotebook(id);
      setNotebooks((items) => items.filter((item) => item.id !== id));
      if (activeNotebookId === id) {
        const nextNotebook = notebooks.find((item) => item.id !== id);
        setActiveNotebookId(nextNotebook?.id || "");
      }
      setDeleteTarget(null);
    });
  }

  if (browserHosted && !browserSessionReady) {
    return (
      <BrowserPasswordGate
        error={browserSessionError}
        running={browserLoginRunning}
        onSubmit={async (password) => {
          setBrowserLoginRunning(true);
          setBrowserSessionError("");
          try {
            await api.dashboardLogin(password);
            setBrowserSessionReady(true);
          } catch (err) {
            setBrowserSessionError(
              err instanceof Error ? err.message : "Không thể đăng nhập dashboard.",
            );
          } finally {
            setBrowserLoginRunning(false);
          }
        }}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><NotebookTabs size={19} /></span>
          <div>
            <h1>NotebookLM Pro</h1>
            <span>{activeNotebook ? notebookDisplayName(activeNotebook) : "Local research workspace"}</span>
          </div>
        </div>
        <div className="status-dock">
          <span className="metric" title="Notebooks">
            <BookOpen size={16} />
            <strong>{notebooks.length}</strong>
          </span>
          <span className="metric" title="Sources">
            <Database size={16} />
            <strong>{sources.length}</strong>
          </span>
          <span className="metric" title="Artifacts">
            <Sparkles size={16} />
            <strong>{artifacts.length}</strong>
          </span>
          <span className="metric" title="Active tasks">
            <Loader2 size={16} className={jobs.some(isActiveJob) ? "spin" : ""} />
            <strong>{jobs.filter(isActiveJob).length}</strong>
          </span>
          {canUseDriveExtension ? (
            <>
              <button
                className="icon-btn connect-btn"
                onClick={() => setConnectDialogOpen(true)}
                disabled={extensionStatus === "connecting"}
                title="Connect Drive Down Cookies"
                aria-label="Connect Drive Down Cookies"
              >
                {extensionStatus === "connecting" ? <Loader2 size={17} className="spin" /> : <Link2 size={17} />}
                <span>{extensionStatus === "connected" ? "Connected" : "Connect"}</span>
              </button>
              <button
                className="icon-btn cookie-btn"
                onClick={getCookiesFromExtension}
                disabled={extensionStatus === "syncing"}
                title="Get cookies from extension"
                aria-label="Get cookies from extension"
              >
                {extensionStatus === "syncing" ? <Loader2 size={16} className="spin" /> : <DownloadCloud size={16} />}
                <span>Get cookie</span>
              </button>
            </>
          ) : null}
          {!browserHosted ? (
            <>
              <button
                className="icon-btn login-btn"
                onClick={() => runNotebookLMLogin().catch(() => undefined)}
                disabled
                title="VPS browser login is disabled. Use Reset login, Local login, then Check VPS."
                aria-label="VPS browser login disabled"
              >
                {loginRunning ? <Loader2 size={16} className="spin" /> : <LogIn size={16} />}
                <span>VPS login</span>
              </button>
              <button
                className="icon-btn reset-local-login-btn"
                onClick={() => resetLocalLogin().catch(() => undefined)}
                disabled={!canResetLocalLogin || localResetRunning || localLoginRunning}
                title={canResetLocalLogin ? `Reset local login: ${localSyncMessage}` : "Open the desktop app to reset local login"}
                aria-label="Reset local notebooklm login"
              >
                {localResetRunning ? <Loader2 size={16} className="spin" /> : <RotateCcw size={16} />}
                <span>Reset login</span>
              </button>
              <button
                className="icon-btn local-login-btn"
                onClick={() => runLocalLoginAndSync().catch(() => undefined)}
                disabled={!canLocalLoginSync || localLoginRunning || localResetRunning}
                title={canLocalLoginSync ? `Login locally and sync to VPS: ${localSyncMessage}` : "Open the desktop app to login locally"}
                aria-label="Login locally and sync to VPS"
              >
                {localLoginRunning ? <Loader2 size={16} className="spin" /> : <LogIn size={16} />}
                <span>Local login</span>
              </button>
              <button
                className="icon-btn check-vps-btn"
                onClick={() => checkVpsConnected().catch(() => undefined)}
                disabled={!canCheckVps || vpsChecking}
                title={canCheckVps ? `Check VPS connection: ${localSyncMessage}` : "Open the desktop app to check VPS"}
                aria-label="Check VPS connection"
              >
                {vpsChecking ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
                <span>Check VPS</span>
              </button>
              <span className={`status-pill vps-pill ${vpsPillClass}`} title={`VPS: ${localSyncMessage}`}>
                <ShieldCheck size={14} />
                <span>VPS</span>
                <strong>{vpsConnection?.connected ? "Connected" : localSyncMessage}</strong>
              </span>
            </>
          ) : (
            <button
              className="icon-btn"
              onClick={() => {
                api.dashboardLogout()
                  .catch(() => undefined)
                  .finally(() => setBrowserSessionReady(false));
              }}
              title="Đăng xuất dashboard"
            >
              <Lock size={16} />
              <span>Đăng xuất</span>
            </button>
          )}
          {canUseDriveExtension ? (
            <span
              className={`status-pill extension-pill ${extensionPillClass}`}
              title={`Drive Down Cookies: ${extensionMessage}`}
            >
              <Link2 size={14} />
              <span>Extension</span>
              <strong>{extensionMessage}</strong>
            </span>
          ) : null}
          {canRestartExtension ? (
            <button
              className="icon-btn restart-btn"
              onClick={restartDesktopBackend}
              disabled={restartingBackend}
              title="Restart backend"
              aria-label="Restart backend"
            >
              <RotateCcw size={16} className={restartingBackend ? "spin" : ""} />
              <span>Backend</span>
            </button>
          ) : null}
          <span className={`status-pill ${ready ? "ok" : backend.status === "error" ? "bad" : ""}`}>
            {ready ? <CheckCircle2 size={14} /> : <Loader2 size={14} className="spin" />}
            {backend.status}
          </span>
          <button className="icon-btn" onClick={refreshNotebooks} title="Refresh notebooks">
            <RefreshCw size={17} />
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="side-tools">
            <label className="search">
              <Search size={15} />
              <input
                value={notebookSearch}
                onChange={(event) => setNotebookSearch(event.target.value)}
                placeholder="Search notebook"
              />
            </label>
            <button
              className="icon-btn primary"
              onClick={() => setNotebookDialog({ mode: "create", title: "New research notebook" })}
              disabled={!ready}
              title="Create notebook"
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="sidebar-label">
            <span>Notebooks</span>
            <strong>{notebookSearch.trim() ? `${filteredNotebooks.length}/${notebooks.length}` : notebooks.length}</strong>
          </div>
          <div className="notebook-list">
            {filteredNotebooks.length ? filteredNotebooks.map((notebook) => {
              const displayName = notebookDisplayName(notebook);
              return (
                <div
                  key={notebook.id}
                  className={`notebook-row ${notebook.id === activeNotebookId ? "active" : ""}`}
                >
                  <button
                    className="notebook-select"
                    title={displayName}
                    onClick={() => selectNotebook(notebook.id)}
                  >
                    <BookOpen size={16} />
                    <span className="notebook-title">{displayName}</span>
                  </button>
                  <button
                    className="notebook-open"
                    title={`Open ${displayName} in Google NotebookLM`}
                    aria-label={`Open ${displayName} in Google NotebookLM`}
                    onClick={() => openNotebookInGoogle(notebook.id)}
                  >
                    <ExternalLink size={15} />
                  </button>
                  <button
                    className="notebook-delete"
                    title={`Delete notebook ${displayName}`}
                    onClick={() => setDeleteTarget(notebook)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            }) : <div className="empty-row">No matching notebooks</div>}
          </div>
        </aside>

        <section className="content">
          {error ? <div className="banner bad">{error}</div> : null}
          {!ready ? <LockedPanel status={backend} /> : null}
          {ready && activeNotebook ? (
            <>
              <NotebookDetailBar
                notebook={activeNotebook}
                sources={sources}
                artifacts={artifacts}
                notes={notes}
                busy={busy}
                onRefresh={() => refreshWorkspace(activeNotebook.id)}
                onRename={openRenameNotebook}
              />
              <nav className="tabs">
                {views.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      className={view === item.id ? "active" : ""}
                      disabled={item.available === false}
                      title={item.available === false ? "Not available in MVP" : undefined}
                      onClick={() => setView(item.id)}
                    >
                      <Icon size={16} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
              <ViewPanel
                view={view}
                notebook={activeNotebook}
                sources={sources}
                artifacts={artifacts}
                notes={notes}
                jobs={jobs.filter((job) => job.notebookId === activeNotebook.id)}
                verifications={verifications.filter(
                  (record) => record.notebookId === activeNotebook.id,
                )}
                answer={answer}
                busy={busy}
                setAnswer={setAnswer}
                upsertJob={upsertJob}
                addVerification={addVerification}
                patchVerification={patchVerification}
                deleteVerification={deleteVerification}
                refresh={() => refreshWorkspace(activeNotebook.id)}
                run={run}
                runLogin={runNotebookLMLogin}
              />
            </>
          ) : null}
        </section>
      </section>

      <LogManager
        open={logManagerOpen}
        logs={logs}
        onToggle={() => setLogManagerOpen((value) => !value)}
        onClear={() => {
          setLogs([]);
          appendLog({ level: "info", source: "ui", message: "Logs cleared" });
        }}
      />

      <button className="version-pill" onClick={() => setVersionOpen(true)}>
        Version {appInfo?.version || "0.1.0"}
      </button>
      {connectDialogOpen ? (
        <ConnectLoginModal
          status={extensionStatus}
          message={extensionMessage}
          onClose={() => setConnectDialogOpen(false)}
          onOpenNotebookLM={(url) => window.open(url, "_blank", "noopener,noreferrer")}
          onCheck={connectNotebookLM}
          onSync={getCookiesFromExtension}
        />
      ) : null}
      {versionOpen ? <VersionModal appInfo={appInfo} onClose={() => setVersionOpen(false)} /> : null}
      {notebookDialog ? (
        <NotebookEditorModal
          dialog={notebookDialog}
          busy={busy}
          onChange={(title) => setNotebookDialog((current) => current ? { ...current, title } : null)}
          onClose={() => setNotebookDialog(null)}
          onSubmit={submitNotebookDialog}
        />
      ) : null}
      {deleteTarget ? (
        <ConfirmDeleteModal
          notebook={deleteTarget}
          busy={busy}
          onClose={() => setDeleteTarget(null)}
          onConfirm={confirmDeleteNotebook}
        />
      ) : null}
    </main>
  );
}

function NotebookDetailBar({
  notebook,
  sources,
  artifacts,
  notes,
  busy,
  onRefresh,
  onRename,
}: {
  notebook: Notebook;
  sources: Source[];
  artifacts: Artifact[];
  notes: Note[];
  busy: boolean;
  onRefresh: () => Promise<void>;
  onRename: () => void;
}) {
  const displayName = notebookDisplayName(notebook);
  return (
    <section className="notebook-detail">
      <div className="notebook-detail-main">
        <span className="detail-icon"><BookOpen size={18} /></span>
        <div>
          <strong title={displayName}>{displayName}</strong>
          <span title={notebook.id}>{notebook.id.slice(0, 8)}...{notebook.id.slice(-4)}</span>
        </div>
      </div>
      <div className="detail-stats">
        <span><Database size={14} />{sources.length}</span>
        <span><Sparkles size={14} />{artifacts.length}</span>
        <span><FileText size={14} />{notes.length}</span>
      </div>
      <div className="detail-actions">
        <button
          className="icon-btn open-external-btn"
          onClick={() => openNotebookInGoogle(notebook.id)}
          title="Open with NotebookLM"
          aria-label={`Open ${displayName} in Google NotebookLM`}
        >
          <ExternalLink size={16} />
        </button>
        <button className="icon-btn" onClick={onRename} title="Rename notebook"><FileText size={16} /></button>
        <button className="icon-btn" onClick={onRefresh} title="Refresh notebook detail" disabled={busy}>
          <RefreshCw size={16} className={busy ? "spin" : ""} />
        </button>
      </div>
    </section>
  );
}

function LockedPanel({ status }: { status: BackendStatus }) {
  return (
    <section className="locked-panel">
      <Lock size={28} />
      <strong>Backend {status.status}</strong>
      <span>{status.message || "Starting local NotebookLM server..."}</span>
    </section>
  );
}

function ViewPanel(props: {
  view: View;
  notebook: Notebook;
  sources: Source[];
  artifacts: Artifact[];
  notes: Note[];
  jobs: Job[];
  verifications: VerificationRecord[];
  answer: ChatAnswer | null;
  busy: boolean;
  setAnswer: (answer: ChatAnswer | null) => void;
  upsertJob: (job: Job) => void;
  addVerification: (question: string, answer?: string) => void;
  patchVerification: (id: string, patch: Partial<VerificationRecord>) => void;
  deleteVerification: (id: string) => void;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<boolean>;
  runLogin: () => Promise<LoginCommandResult>;
}) {
  switch (props.view) {
    case "sources":
      return <SourcesPanel {...props} />;
    case "chat":
      return <ChatPanel {...props} />;
    case "studio":
      return <StudioPanel {...props} />;
    case "artifacts":
      return <ArtifactsPanel {...props} />;
    case "notes":
      return <NotesPanel {...props} />;
    case "verify":
      return <VerifyPanel {...props} />;
    case "research":
      return <ResearchPanel {...props} />;
    case "labels":
      return <LabelsPanel {...props} />;
    case "share":
      return <SharePanel {...props} />;
    case "mcp":
      return <McpPanel />;
    case "settings":
      return <SettingsPanel {...props} />;
    default:
      return <OverviewPanel {...props} />;
  }
}

function OverviewPanel({ notebook, sources, artifacts, notes, jobs, run }: Parameters<typeof ViewPanel>[0]) {
  const [summary, setSummary] = useState("");
  return (
    <section className="panel-grid">
      <div className="panel wide">
        <div className="panel-title">
          <span><Activity size={16} /> {notebookDisplayName(notebook)}</span>
          <button
            className="icon-btn"
            title="Load summary"
            onClick={() =>
              run(async () => {
                const result = await api.getNotebookSummary(notebook.id);
                setSummary(result.summary || "No summary yet.");
              })
            }
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <p className="summary-text">{summary || "Open Sources, Chat, or Studio to start working."}</p>
        <div className="overview-meta">
          <span title={notebook.id}>ID {notebook.id}</span>
          <span>{sources.length} sources</span>
          <span>{artifacts.length} artifacts</span>
          <span>{notes.length} notes</span>
        </div>
      </div>
      <MetricPanel icon={FilePlus2} label="Sources" value={sources.length} />
      <MetricPanel icon={Sparkles} label="Artifacts" value={artifacts.length} />
      <MetricPanel icon={FileText} label="Notes" value={notes.length} />
      <JobsPanel jobs={jobs} />
    </section>
  );
}

function MetricPanel({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <div className="panel metric-panel">
      <Icon size={22} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function JobsPanel({ jobs }: { jobs: Job[] }) {
  const visibleJobs = jobs.slice(0, 8);
  return (
    <div className="panel list-panel">
      <div className="panel-title">
        <span><Loader2 size={16} className={jobs.some(isActiveJob) ? "spin" : ""} /> Tasks</span>
        <strong className="task-count">{jobs.filter(isActiveJob).length}</strong>
      </div>
      <div className="rows">
        {visibleJobs.length ? visibleJobs.map((job) => (
          <div className="data-row" key={`${job.kind}-${job.id}`}>
            <span className={`row-dot ${job.status}`} />
            <div>
              <strong>{job.title}</strong>
              <span>{job.kind} / {job.message || job.status}</span>
            </div>
            <span className={`job-pill ${job.status}`}>{job.status}</span>
          </div>
        )) : <div className="empty-row">No tasks</div>}
      </div>
    </div>
  );
}

function SourcesPanel({ notebook, sources, upsertJob, refresh, run }: Parameters<typeof ViewPanel>[0]) {
  const [mode, setMode] = useState<"url" | "text" | "file" | "drive">("url");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [driveId, setDriveId] = useState("");
  const [driveMime, setDriveMime] = useState("google-doc");
  const canAdd =
    (mode === "url" && url.trim().length > 0) ||
    (mode === "text" && text.trim().length > 0) ||
    (mode === "file" && file !== null) ||
    (mode === "drive" && driveId.trim().length > 0);
  return (
    <section className="panel-grid">
      <div className="panel form-panel">
        <div className="panel-title"><span><FilePlus2 size={16} /> Add Source</span></div>
        <div className="segmented">
          <button className={mode === "url" ? "active" : ""} onClick={() => setMode("url")}><Globe2 size={15} /> URL</button>
          <button className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}><FileText size={15} /> Text</button>
          <button className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}><FilePlus2 size={15} /> File</button>
          <button className={mode === "drive" ? "active" : ""} onClick={() => setMode("drive")}><Database size={15} /> Drive</button>
        </div>
        {mode === "url" ? (
          <label className="field"><span>URL</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." /></label>
        ) : null}
        {mode === "text" ? (
          <>
            <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="field"><span>Content</span><textarea value={text} onChange={(e) => setText(e.target.value)} /></label>
          </>
        ) : null}
        {mode === "file" ? (
          <>
            <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional override" /></label>
            <label className="field">
              <span>File</span>
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            <span className="file-hint">{file ? `${file.name} (${Math.ceil(file.size / 1024)} KB)` : "Choose a document to upload."}</span>
          </>
        ) : null}
        {mode === "drive" ? (
          <>
            <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Drive source" /></label>
            <label className="field"><span>Drive file ID</span><input value={driveId} onChange={(e) => setDriveId(e.target.value)} placeholder="Google Drive file id" /></label>
            <label className="field">
              <span>Document type</span>
              <select value={driveMime} onChange={(e) => setDriveMime(e.target.value)}>
                <option value="google-doc">Google Doc</option>
                <option value="google-slides">Google Slides</option>
                <option value="google-sheets">Google Sheets</option>
                <option value="pdf">PDF</option>
              </select>
            </label>
          </>
        ) : null}
        <button
          className="btn-primary"
          disabled={!canAdd}
          onClick={() =>
            run(async () => {
              let created: Source | null = null;
              if (mode === "url") created = await api.addUrlSource(notebook.id, url);
              else if (mode === "text") created = await api.addTextSource(notebook.id, title || "Text source", text);
              else if (mode === "file" && file) created = await api.addFileSource(notebook.id, file, title);
              else if (mode === "drive") created = await api.addDriveSource(notebook.id, driveId, title || "Drive source", driveMime);
              if (created?.id) {
                upsertJob({
                  id: created.id,
                  notebookId: notebook.id,
                  kind: "source",
                  title: created.title || created.url || title || file?.name || "Source",
                  status: isSourceReady(created.status) ? "completed" : "pending",
                  message: `status ${created.status ?? "pending"}`,
                  updatedAt: Date.now(),
                });
              }
              setUrl("");
              setTitle("");
              setText("");
              setFile(null);
              setDriveId("");
              await refresh();
            })
          }
        >
          <Plus size={16} /> Add
        </button>
      </div>
      <ListPanel
        title="Sources"
        icon={Database}
        rows={sources.map((source) => ({
          id: source.id,
          title: source.title || source.url || source.id,
          meta: `status ${source.status ?? "unknown"}`,
          onDelete: () =>
            run(async () => {
              await api.deleteSource(notebook.id, source.id);
              await refresh();
            }),
        }))}
      />
    </section>
  );
}

function ChatPanel({
  notebook,
  answer,
  setAnswer,
  addVerification,
  busy,
  run,
}: Parameters<typeof ViewPanel>[0]) {
  const [question, setQuestion] = useState("");
  const [answeredQuestion, setAnsweredQuestion] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  return (
    <section className="panel-grid single">
      <div className="panel chat-panel">
        <div className="panel-title"><span><Bot size={16} /> Chat</span></div>
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask this notebook..." />
        <div className="toolbar-row">
          <button
            className="btn-primary"
            disabled={!question.trim() || busy}
            onClick={() =>
              run(async () => {
                const result = await api.ask(notebook.id, question, answer?.conversation_id);
                setAnswer(result);
                setAnsweredQuestion(question.trim());
                setSavedMessage("");
              })
            }
          >
            <MessageSquareText size={16} /> Ask
          </button>
          <button
            className="icon-btn"
            title="Copy"
            disabled={!answer?.answer}
            onClick={async () => {
              if (!answer?.answer) return;
              try {
                await navigator.clipboard.writeText(answer.answer);
                setSavedMessage("Copied");
              } catch {
                setSavedMessage("Copy failed");
              }
            }}
          >
            <Copy size={16} />
          </button>
          <button
            className="icon-btn"
            title="Save to Verify"
            disabled={!answer?.answer || !answeredQuestion}
            onClick={() => {
              addVerification(answeredQuestion, answer?.answer);
              setSavedMessage("Saved to Verify");
            }}
          >
            <ShieldCheck size={16} />
          </button>
          {savedMessage ? <span className="toolbar-message">{savedMessage}</span> : null}
        </div>
        {answer ? <article className="answer">{answer.answer}</article> : null}
      </div>
    </section>
  );
}

function StudioPanel({ notebook, sources, jobs, upsertJob, refresh, run }: Parameters<typeof ViewPanel>[0]) {
  const [type, setType] = useState("report");
  const [instructions, setInstructions] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [quantity, setQuantity] = useState("standard");
  const [audioFormat, setAudioFormat] = useState("deep-dive");
  const [audioLength, setAudioLength] = useState("default");
  const sourceIds = sources.map((source) => source.id);
  return (
    <section className="panel-grid single">
      <div className="panel form-panel">
        <div className="panel-title"><span><Wand2 size={16} /> Studio</span></div>
        <label className="field">
          <span>Artifact</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {artifactTypes.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Sources</span>
          <select disabled>
            <option>{sourceIds.length ? `${sourceIds.length} ready sources` : "All sources"}</option>
          </select>
        </label>
        {type === "audio" ? (
          <div className="inline-grid">
            <label className="field"><span>Format</span><select value={audioFormat} onChange={(e) => setAudioFormat(e.target.value)}><option value="deep-dive">Deep dive</option><option value="brief">Brief</option><option value="critique">Critique</option><option value="debate">Debate</option></select></label>
            <label className="field"><span>Length</span><select value={audioLength} onChange={(e) => setAudioLength(e.target.value)}><option value="short">Short</option><option value="default">Default</option><option value="long">Long</option></select></label>
          </div>
        ) : null}
        {type === "quiz" || type === "flashcards" ? (
          <div className="inline-grid">
            <label className="field"><span>Quantity</span><select value={quantity} onChange={(e) => setQuantity(e.target.value)}><option value="fewer">Fewer</option><option value="standard">Standard</option><option value="more">More</option></select></label>
            <label className="field"><span>Difficulty</span><select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
          </div>
        ) : null}
        <label className="field">
          <span>Instructions</span>
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </label>
        <button
          className="btn-primary"
          onClick={() =>
            run(async () => {
              const result = await api.generateArtifact(notebook.id, {
                type,
                source_ids: sourceIds,
                instructions,
                difficulty,
                quantity,
                audio_format: audioFormat,
                audio_length: audioLength,
              });
              if (result.task_id) {
                upsertJob({
                  id: result.task_id,
                  notebookId: notebook.id,
                  kind: "artifact",
                  title: `${type} generation`,
                  status: "pending",
                  message: result.status || "pending",
                  artifactType: type,
                  updatedAt: Date.now(),
                });
              }
              await refresh();
            })
          }
        >
          <Sparkles size={16} /> Generate
        </button>
      </div>
      <JobsPanel jobs={jobs.filter((job) => job.kind === "artifact")} />
    </section>
  );
}

function ArtifactsPanel({ notebook, artifacts, run }: Parameters<typeof ViewPanel>[0]) {
  const [downloadType, setDownloadType] = useState("report");
  const [outputFormat, setOutputFormat] = useState("json");
  const [downloadMessage, setDownloadMessage] = useState("");
  const formatChoices = getDownloadFormatChoices(downloadType);
  useEffect(() => {
    if (formatChoices.length && !formatChoices.includes(outputFormat)) {
      setOutputFormat(formatChoices[0]);
    }
  }, [downloadType, formatChoices, outputFormat]);
  return (
    <section className="panel-grid">
      <div className="panel form-panel">
        <div className="panel-title"><span><Sparkles size={16} /> Download</span></div>
        <label className="field">
          <span>Artifact type</span>
          <select value={downloadType} onChange={(e) => setDownloadType(e.target.value)}>
            {downloadTypes.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        {formatChoices.length ? (
          <label className="field">
            <span>Format</span>
            <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)}>
              {formatChoices.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        ) : null}
        <button
          className="btn-primary"
          onClick={() =>
            run(async () => {
              const result = await api.downloadArtifact(
                notebook.id,
                downloadType,
                formatChoices.length ? outputFormat : undefined,
              );
              setDownloadMessage(
                result.canceled ? "Download canceled" : `Saved ${result.filename || result.path}`,
              );
            })
          }
        >
          <Copy size={16} /> Download
        </button>
        {downloadMessage ? <span className="file-hint">{downloadMessage}</span> : null}
      </div>
      <ListPanel
        title="Artifacts"
        icon={Sparkles}
        rows={artifacts.map((artifact) => ({
          id: artifact.id,
          title: artifact.title || artifact.id,
          meta: `status ${artifact.status ?? "unknown"}`,
        }))}
      />
    </section>
  );
}

function NotesPanel({ notebook, notes, busy, refresh, run }: Parameters<typeof ViewPanel>[0]) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  return (
    <section className="panel-grid">
      <div className="panel form-panel">
        <div className="panel-title"><span><FileText size={16} /> New Note</span></div>
        <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field"><span>Content</span><textarea value={content} onChange={(e) => setContent(e.target.value)} /></label>
        <button
          className="btn-primary"
          disabled={busy || (!title.trim() && !content.trim())}
          onClick={() => run(async () => { await api.createNote(notebook.id, title || "New Note", content); setTitle(""); setContent(""); await refresh(); })}
        >
          <Plus size={16} /> Save
        </button>
      </div>
      <ListPanel title="Notes" icon={FileText} rows={notes.map((note) => ({ id: note.id, title: note.title || note.id, meta: note.created_at || "note" }))} />
    </section>
  );
}

function VerifyPanel({
  notebook,
  verifications,
  addVerification,
  patchVerification,
  deleteVerification,
  run,
}: Parameters<typeof ViewPanel>[0]) {
  const [question, setQuestion] = useState("");
  return (
    <section className="panel-grid">
      <div className="panel form-panel">
        <div className="panel-title"><span><ShieldCheck size={16} /> Save for verification</span></div>
        <label className="field">
          <span>Claim or question</span>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What should be verified again?"
          />
        </label>
        <button
          className="btn-primary"
          disabled={!question.trim()}
          onClick={() => {
            addVerification(question);
            setQuestion("");
          }}
        >
          <Plus size={16} /> Save
        </button>
      </div>
      <div className="panel list-panel verification-panel">
        <div className="panel-title">
          <span><ShieldCheck size={16} /> Saved verifications</span>
          <strong className="task-count">{verifications.length}</strong>
        </div>
        <div className="verification-list">
          {verifications.length ? verifications.map((record) => {
            const latest = record.attempts[record.attempts.length - 1];
            return (
              <article className="verification-row" key={record.id}>
                <div className="verification-head">
                  <span className={`row-dot ${record.verified ? "completed" : "pending"}`} />
                  <div>
                    <strong>{record.question}</strong>
                    <span>
                      {record.attempts.length} checks / {record.verified ? "verified" : "needs review"}
                    </span>
                  </div>
                </div>
                <div className="verification-answer">
                  {latest?.answer || "No verification result yet."}
                </div>
                <div className="verification-actions">
                  <button
                    className="btn-secondary"
                    onClick={() =>
                      run(async () => {
                        const result = await api.ask(notebook.id, record.question);
                        patchVerification(record.id, {
                          attempts: [
                            ...record.attempts,
                            { answer: result.answer, checkedAt: Date.now() },
                          ],
                          verified: false,
                        });
                      })
                    }
                  >
                    <RefreshCw size={15} /> Verify again
                  </button>
                  <button
                    className={`icon-btn ${record.verified ? "verified" : ""}`}
                    title={record.verified ? "Mark as needs review" : "Mark as verified"}
                    onClick={() => patchVerification(record.id, { verified: !record.verified })}
                  >
                    <CheckCircle2 size={16} />
                  </button>
                  <button
                    className="icon-btn danger"
                    title="Delete verification"
                    onClick={() => deleteVerification(record.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            );
          }) : <div className="empty-row">No saved verifications</div>}
        </div>
      </div>
    </section>
  );
}

type ResearchOperation = "idle" | "starting" | "polling" | "cancelling";

type ActiveResearchRun = {
  taskId: string;
  query: string;
  source: string;
  mode: string;
};

function ResearchPanel({ notebook, run }: Parameters<typeof ViewPanel>[0]) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("web");
  const [mode, setMode] = useState("fast");
  const [activeRun, setActiveRun] = useState<ActiveResearchRun | null>(null);
  const [status, setStatus] = useState<ResearchStatus | null>(null);
  const [operation, setOperation] = useState<ResearchOperation>("idle");
  const operationRef = useRef<ResearchOperation>("idle");
  const requestGeneration = useRef(0);
  const canStart =
    query.trim().length > 0 &&
    !(source === "drive" && mode === "deep") &&
    operation === "idle";

  useEffect(() => {
    requestGeneration.current += 1;
    operationRef.current = "idle";
    setOperation("idle");
    setActiveRun(null);
    setStatus(null);
  }, [notebook.id]);

  function beginOperation(next: ResearchOperation): boolean {
    if (operationRef.current !== "idle") return false;
    operationRef.current = next;
    setOperation(next);
    return true;
  }

  function finishOperation(generation: number) {
    if (generation !== requestGeneration.current) return;
    operationRef.current = "idle";
    setOperation("idle");
  }

  async function startResearch() {
    if (!canStart || !beginOperation("starting")) return;
    const payload = { query: query.trim(), source, mode };
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setActiveRun(null);
    setStatus(null);
    try {
      await run(async () => {
        const result = await api.startResearch(notebook.id, payload);
        if (generation !== requestGeneration.current) return;
        const nextTaskId = result.report_id || result.task_id;
        if (!nextTaskId) throw new Error("Research start returned no task id.");
        setActiveRun({ taskId: nextTaskId, ...payload });
      });
    } finally {
      finishOperation(generation);
    }
  }

  async function pollResearch() {
    if (!activeRun || !beginOperation("polling")) return;
    const runSnapshot = activeRun;
    const generation = requestGeneration.current;
    try {
      await run(async () => {
        const result = await api.getResearchStatus(notebook.id, runSnapshot.taskId);
        if (generation === requestGeneration.current) setStatus(result);
      });
    } finally {
      finishOperation(generation);
    }
  }

  async function cancelResearch() {
    if (!activeRun || !beginOperation("cancelling")) return;
    const runSnapshot = activeRun;
    const generation = requestGeneration.current;
    try {
      await run(async () => {
        await api.cancelResearch(notebook.id, runSnapshot.taskId);
        if (generation !== requestGeneration.current) return;
        setStatus({
          notebook_id: notebook.id,
          task_id: runSnapshot.taskId,
          kind: "cancelled",
          status: "cancelled",
          query: runSnapshot.query,
          sources: [],
          summary: "Cancelled",
          report: "",
        });
      });
    } finally {
      finishOperation(generation);
    }
  }

  const statusLabel =
    operation !== "idle"
      ? operation
      : status?.status || (activeRun ? "started" : "idle");
  return (
    <section className="panel-grid">
      <div className="panel form-panel">
        <div className="panel-title"><span><FlaskConical size={16} /> Research</span></div>
        <label className="field"><span>Query</span><textarea value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Research topic or question" /></label>
        <div className="inline-grid">
          <label className="field"><span>Source</span><select value={source} onChange={(e) => setSource(e.target.value)}><option value="web">Web</option><option value="drive">Drive</option></select></label>
          <label className="field"><span>Mode</span><select value={mode} onChange={(e) => setMode(e.target.value)}><option value="fast">Fast</option><option value="deep">Deep</option></select></label>
        </div>
        {source === "drive" && mode === "deep" ? <span className="file-hint">Deep research supports Web only.</span> : null}
        <div className="toolbar-row">
          <button
            className="btn-primary"
            disabled={!canStart}
            aria-busy={operation === "starting"}
            onClick={startResearch}
          >
            <Sparkles size={16} /> Start
          </button>
          <button
            className="btn-secondary"
            disabled={!activeRun || operation !== "idle"}
            aria-busy={operation === "polling"}
            onClick={pollResearch}
          >
            <RefreshCw size={15} /> Status
          </button>
          <button
            className="btn-secondary"
            disabled={!activeRun || operation !== "idle"}
            aria-busy={operation === "cancelling"}
            onClick={cancelResearch}
          >
            <X size={15} /> Cancel
          </button>
        </div>
      </div>
      <div className="panel list-panel">
        <div className="panel-title"><span><FlaskConical size={16} /> Research status</span><strong className="task-count">{statusLabel}</strong></div>
        {activeRun ? <pre className="json-preview">{JSON.stringify(status || { task_id: activeRun.taskId, status: "started" }, null, 2)}</pre> : operation === "starting" ? <pre className="json-preview">{JSON.stringify({ status: "starting" }, null, 2)}</pre> : <div className="empty-row">No research task yet</div>}
      </div>
    </section>
  );
}

function LabelsPanel({ notebook, sources, run }: Parameters<typeof ViewPanel>[0]) {
  const [labels, setLabels] = useState<Label[]>([]);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const [selectedSource, setSelectedSource] = useState("");
  const activeLabel = labels.find((label) => label.id === selectedLabel) || labels[0] || null;
  const sourceId = selectedSource || sources[0]?.id || "";

  async function loadLabels() {
    const list = await api.listLabels(notebook.id);
    setLabels(list);
    if (!selectedLabel && list[0]) setSelectedLabel(list[0].id);
  }

  useEffect(() => {
    run(loadLabels);
  }, [notebook.id]);

  return (
    <section className="panel-grid">
      <div className="panel form-panel">
        <div className="panel-title"><span><Tags size={16} /> Labels</span><button className="icon-btn" aria-label="Refresh labels" title="Refresh labels" onClick={() => run(loadLabels)}><RefreshCw size={16} /></button></div>
        <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="New label" /></label>
        <label className="field"><span>Emoji</span><input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="Optional" /></label>
        <button
          className="btn-primary"
          disabled={!name.trim()}
          onClick={() => run(async () => {
            const created = await api.createLabel(notebook.id, name.trim(), emoji.trim());
            setLabels((items) => [created, ...items]);
            setSelectedLabel(created.id);
            setName("");
            setEmoji("");
          })}
        >
          <Plus size={16} /> Create
        </button>
        <button className="btn-secondary" onClick={() => run(async () => setLabels((await api.generateLabels(notebook.id, "unlabeled")).labels))}>
          <Sparkles size={16} /> Generate
        </button>
        <label className="field"><span>Selected label</span><select value={activeLabel?.id || ""} onChange={(e) => setSelectedLabel(e.target.value)}>{labels.map((label) => <option key={label.id} value={label.id}>{label.emoji ? `${label.emoji} ` : ""}{label.name}</option>)}</select></label>
        <label className="field"><span>Selected source</span><select value={sourceId} onChange={(e) => setSelectedSource(e.target.value)}>{sources.map((sourceItem) => <option key={sourceItem.id} value={sourceItem.id}>{sourceItem.title || sourceItem.id}</option>)}</select></label>
        <div className="toolbar-row">
          <button className="btn-secondary" disabled={!activeLabel || !name.trim()} onClick={() => run(async () => { const updated = await api.renameLabel(notebook.id, activeLabel!.id, name.trim()); setLabels((items) => items.map((item) => item.id === updated.id ? updated : item)); setName(""); })}><FileText size={15} /> Rename</button>
          <button className="btn-secondary" disabled={!activeLabel || !emoji.trim()} onClick={() => run(async () => { const updated = await api.setLabelEmoji(notebook.id, activeLabel!.id, emoji.trim()); setLabels((items) => items.map((item) => item.id === updated.id ? updated : item)); setEmoji(""); })}><Tags size={15} /> Emoji</button>
        </div>
        <div className="toolbar-row">
          <button className="btn-secondary" disabled={!activeLabel || !sourceId} onClick={() => run(async () => { const result = await api.addLabelSources(notebook.id, activeLabel!.id, [sourceId]); setLabels((items) => items.map((item) => item.id === result.label.id ? result.label : item)); })}><Plus size={15} /> Add source</button>
          <button className="btn-secondary" disabled={!activeLabel || !sourceId} onClick={() => run(async () => { const result = await api.removeLabelSources(notebook.id, activeLabel!.id, [sourceId]); setLabels((items) => items.map((item) => item.id === result.label.id ? result.label : item)); })}><X size={15} /> Remove source</button>
          <button className="icon-btn danger" disabled={!activeLabel} title="Delete label" onClick={() => run(async () => { if (!activeLabel) return; await api.deleteLabel(notebook.id, activeLabel.id); const next = labels.filter((label) => label.id !== activeLabel.id); setLabels(next); setSelectedLabel(next[0]?.id || ""); })}><Trash2 size={15} /></button>
        </div>
      </div>
      <div className="panel list-panel">
        <div className="panel-title"><span><Tags size={16} /> Label list</span><strong className="task-count">{labels.length}</strong></div>
        <div className="rows">
          {labels.length ? labels.map((label) => (
            <button className={`data-row ${label.id === activeLabel?.id ? "active" : ""}`} key={label.id} onClick={() => setSelectedLabel(label.id)}>
              <span className="row-dot" />
              <div><strong>{label.emoji ? `${label.emoji} ` : ""}{label.name}</strong><span>{label.source_ids.length} source(s)</span></div>
            </button>
          )) : <div className="empty-row">No labels</div>}
        </div>
      </div>
    </section>
  );
}

type McpClientId = "claude" | "chatgpt" | "cursor" | "vscode" | "gemini";

const mcpClients: Array<{ id: McpClientId; label: string }> = [
  { id: "claude", label: "Claude" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "cursor", label: "Cursor" },
  { id: "vscode", label: "VS Code" },
  { id: "gemini", label: "Gemini CLI" },
];

function mcpHeaderValue(config: McpConfig): string {
  const prefix = config.auth.valuePrefix?.trim();
  return prefix ? `${prefix} YOUR_MCP_API_KEY` : "YOUR_MCP_API_KEY";
}

function mcpSetupSnippet(config: McpConfig, client: McpClientId): string {
  const remote = {
    url: config.endpoint,
    headers: { [config.auth.header]: mcpHeaderValue(config) },
  };
  if (client === "vscode") {
    return JSON.stringify(
      { servers: { [config.product.slug]: { type: "http", ...remote } } },
      null,
      2,
    );
  }
  if (client === "chatgpt" || client === "gemini") {
    return [
      `Server URL: ${config.endpoint}`,
      `Transport: ${config.transport}`,
      `Authentication: Custom header`,
      `${config.auth.header}: ${mcpHeaderValue(config)}`,
    ].join("\n");
  }
  return JSON.stringify({ mcpServers: { [config.product.slug]: remote } }, null, 2);
}

function formatMcpDate(value: string): string {
  if (!value) return "Chưa sử dụng";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function McpPanel() {
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [keys, setKeys] = useState<McpApiKey[]>([]);
  const [keyName, setKeyName] = useState("");
  const [issuedKey, setIssuedKey] = useState("");
  const [client, setClient] = useState<McpClientId>("claude");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [usage, setUsage] = useState<McpUsage | null>(null);
  const [usagePeriod, setUsagePeriod] = useState<McpUsagePeriodName>("7d");
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState("");

  async function loadPortal() {
    setLoading(true);
    setError("");
    try {
      const [nextConfig, result] = await Promise.all([
        api.getMcpConfig(),
        api.listMcpKeys(),
      ]);
      setConfig(nextConfig);
      setKeys(result.keys);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải cấu hình MCP.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPortal().catch(() => undefined);
  }, []);

  async function loadUsage(period: McpUsagePeriodName) {
    setUsageLoading(true);
    setUsageError("");
    try {
      setUsage(await api.getMcpUsage(period));
    } catch (err) {
      setUsageError(err instanceof Error ? err.message : "Không thể tải thống kê MCP.");
    } finally {
      setUsageLoading(false);
    }
  }

  useEffect(() => {
    loadUsage(usagePeriod).catch(() => undefined);
  }, [usagePeriod]);

  async function copyText(value: string, success: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(success);
      setError("");
    } catch {
      setError("Không thể sao chép tự động. Hãy chọn và sao chép thủ công.");
    }
  }

  async function createKey(event: React.FormEvent) {
    event.preventDefault();
    const name = keyName.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const result = await api.createMcpKey(name);
      setIssuedKey(result.apiKey);
      setKeys((items) => [result.key, ...items.filter((item) => item.id !== result.key.id)]);
      setKeyName("");
      setMessage("Đã cấp API key. Hãy sao chép và lưu ngay.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tạo MCP API key.");
    } finally {
      setSubmitting(false);
    }
  }

  async function revokeKey(keyId: string) {
    setError("");
    setMessage("");
    try {
      const result = await api.revokeMcpKey(keyId);
      setKeys((items) => items.map((item) => (item.id === keyId ? result.key : item)));
      setMessage("Đã thu hồi key. Request MCP tiếp theo dùng key này sẽ bị từ chối.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể thu hồi MCP API key.");
    }
  }

  const activeKeys = keys.filter((item) => item.status === "active");
  const tools = config?.features.reduce((total, feature) => total + feature.tools.length, 0) || 0;
  const snippet = config ? mcpSetupSnippet(config, client) : "Đang tải cấu hình…";
  const quotaPercent = usage?.summary.dailyLimit
    ? Math.min(100, (usage.summary.dailyUsed / usage.summary.dailyLimit) * 100)
    : 0;
  const seriesMax = Math.max(
    1,
    ...(usage?.series.map((point) => point.createRequested + point.downloadSuccess) || []),
  );

  return (
    <section className="mcp-portal">
      <header className="mcp-portal-header">
        <div>
          <span className="mcp-eyebrow">ACCOUNT SETTINGS / MCP</span>
          <h2>MCP connections</h2>
          <p>Kết nối NotebookLM Pro với trợ lý AI bằng managed API key có thể thu hồi.</p>
        </div>
        <span className={`mcp-ready-badge ${error ? "bad" : ""}`}>
          {loading ? <Loader2 size={14} className="spin" /> : error ? <Unplug size={14} /> : <Check size={14} />}
          {loading ? "Đang kiểm tra" : error ? "Chưa sẵn sàng" : "Sẵn sàng"}
        </span>
      </header>

      {error ? <div className="banner bad">{error}</div> : null}
      {message ? <div className="mcp-message"><CheckCircle2 size={15} />{message}</div> : null}

      <section className="panel mcp-key-panel">
        <div className="mcp-section-head">
          <div>
            <h3><KeyRound size={18} /> API Keys</h3>
            <p>
              Tạo key để xác thực request tới MCP endpoint
              {config ? <code>{config.endpoint}</code> : <code>Đang tải…</code>}.
            </p>
          </div>
          <div className="mcp-section-actions">
            <button
              className="btn-secondary compact"
              type="button"
              disabled={!config}
              onClick={() => config && copyText(config.endpoint, "Đã sao chép MCP endpoint.")}
            >
              <Copy size={14} /> Copy endpoint
            </button>
            <button
              className="icon-btn"
              type="button"
              aria-label="Làm mới MCP API keys"
              title="Làm mới MCP API keys"
              onClick={() => {
                loadPortal().catch(() => undefined);
                loadUsage(usagePeriod).catch(() => undefined);
              }}
              disabled={loading}
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} />
            </button>
          </div>
        </div>

        <form className="mcp-key-create" onSubmit={createKey}>
          <div>
            <span className="mcp-form-kicker">ONE-TIME SECRET</span>
            <strong>Tạo key mới cho client của bạn</strong>
            <small>Secret đầy đủ chỉ hiển thị một lần và hệ thống chỉ lưu SHA-256 hash.</small>
          </div>
          <label className="field">
            <span>Tên key</span>
            <input
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
              maxLength={80}
              autoComplete="off"
              placeholder="Ví dụ: Claude Desktop"
            />
          </label>
          <button className="btn-primary" type="submit" disabled={!keyName.trim() || submitting}>
            {submitting ? <Loader2 size={16} className="spin" /> : <KeyRound size={16} />}
            {submitting ? "Đang tạo…" : "Generate New Key"}
          </button>
        </form>

        {issuedKey ? (
          <div className="mcp-issued-key" role="status">
            <div>
              <strong>API key vừa tạo</strong>
              <span>Sao chép ngay; sau khi ẩn, key này không thể hiển thị lại.</span>
            </div>
            <code>{issuedKey}</code>
            <button
              type="button"
              className="btn-secondary compact"
              onClick={() => copyText(issuedKey, "Đã sao chép API key.")}
            >
              <Copy size={14} /> Sao chép key
            </button>
            <button type="button" className="mcp-text-button" onClick={() => setIssuedKey("")}>
              Đã lưu
            </button>
          </div>
        ) : null}

        <div className="mcp-key-list" aria-label="Danh sách MCP API keys">
          {keys.length ? keys.map((key) => (
            <article className={`mcp-key-row ${key.status}`} key={key.id}>
              <span className="mcp-key-icon"><KeyRound size={16} /></span>
              <div className="mcp-key-name">
                <strong>{key.name}</strong>
                <code>{key.prefix}</code>
              </div>
              <div className="mcp-key-meta">
                <span>Tạo lúc</span>
                <strong>{formatMcpDate(key.createdAt)}</strong>
              </div>
              <div className="mcp-key-meta">
                <span>Dùng gần nhất</span>
                <strong>{formatMcpDate(key.lastUsedAt)}</strong>
              </div>
              <span className={`mcp-key-status ${key.status}`}>{key.status === "active" ? "Active" : "Revoked"}</span>
              <button
                type="button"
                className="mcp-revoke-button"
                disabled={key.status !== "active"}
                onClick={() => revokeKey(key.id)}
                aria-label={`Thu hồi key ${key.name}`}
              >
                <Trash2 size={15} /> Thu hồi
              </button>
            </article>
          )) : (
            <div className="empty-row">Chưa có managed key. Hãy tạo key đầu tiên ở phía trên.</div>
          )}
        </div>
      </section>

      <section className="panel mcp-usage-panel" aria-label="Thống kê sử dụng MCP">
        <div className="mcp-section-head">
          <div>
            <h3><Activity size={18} /> Usage Dashboard</h3>
            <p>Thống kê trực tiếp từ các tool call đã đi qua MCP gateway.</p>
          </div>
          <div className="mcp-period-tabs" role="tablist" aria-label="Khoảng thời gian thống kê MCP">
            {([
              ["today", "Hôm nay"],
              ["7d", "7 ngày"],
              ["30d", "30 ngày"],
            ] as Array<[McpUsagePeriodName, string]>).map(([value, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={usagePeriod === value}
                className={usagePeriod === value ? "active" : ""}
                key={value}
                onClick={() => setUsagePeriod(value)}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="mcp-usage-refresh"
              aria-label="Làm mới thống kê MCP"
              title="Làm mới thống kê MCP"
              onClick={() => loadUsage(usagePeriod).catch(() => undefined)}
              disabled={usageLoading}
            >
              <RefreshCw size={14} className={usageLoading ? "spin" : ""} />
            </button>
          </div>
        </div>

        {usageError ? <div className="banner bad">{usageError}</div> : null}
        {usageLoading && !usage ? (
          <div className="mcp-usage-empty"><Loader2 size={17} className="spin" /> Đang tải telemetry…</div>
        ) : usage ? (
          <>
            <div className="mcp-kpi-grid">
              <article>
                <span>Lượt tạo</span>
                <strong>{usage.summary.createRequested.toLocaleString("vi-VN")}</strong>
                <small>tổng yêu cầu tạo</small>
              </article>
              <article>
                <span>Lượt tải về</span>
                <strong>{usage.summary.downloadSuccess.toLocaleString("vi-VN")}</strong>
                <small>download thành công</small>
              </article>
              <article className="success">
                <span>Tạo thành công</span>
                <strong>{usage.summary.createSuccess.toLocaleString("vi-VN")}</strong>
                <small>đã tính vào quota</small>
              </article>
              <article className="failed">
                <span>Tạo thất bại</span>
                <strong>{usage.summary.createFailed.toLocaleString("vi-VN")}</strong>
                <small>kể cả bị chặn quota</small>
              </article>
            </div>

            <div className="mcp-usage-grid">
              <article className="mcp-quota-card">
                <div className="mcp-quota-head">
                  <div>
                    <span>GIỚI HẠN TẠO / NGÀY</span>
                    <strong>{usage.summary.dailyUsed} / {usage.summary.dailyLimit}</strong>
                  </div>
                  <span>{usage.summary.dailyRemaining} còn lại</span>
                </div>
                <div
                  className="mcp-quota-track"
                  role="progressbar"
                  aria-label="Quota tạo MCP hôm nay"
                  aria-valuemin={0}
                  aria-valuemax={usage.summary.dailyLimit}
                  aria-valuenow={usage.summary.dailyUsed}
                >
                  <span style={{ width: `${quotaPercent}%` }} />
                </div>
                <small>
                  Reset {formatMcpDate(usage.summary.dailyResetAt)} · {usage.period.timeZone}
                  {usage.summary.dailyReserved ? ` · ${usage.summary.dailyReserved} đang xử lý` : ""}
                </small>
              </article>

              <article className="mcp-series-card">
                <div className="mcp-series-head">
                  <strong>Hoạt động theo ngày</strong>
                  <span><i className="create" /> Tạo <i className="download" /> Tải</span>
                </div>
                <div className="mcp-series" aria-label="Biểu đồ hoạt động MCP theo ngày">
                  {usage.series.map((point) => (
                    <div className="mcp-series-day" key={point.date} title={`${point.date}: ${point.createRequested} tạo, ${point.downloadSuccess} tải`}>
                      <div>
                        <span className="download" style={{ height: `${Math.max(3, (point.downloadSuccess / seriesMax) * 58)}px` }} />
                        <span className="create" style={{ height: `${Math.max(3, (point.createRequested / seriesMax) * 58)}px` }} />
                      </div>
                      <small>{point.date.slice(5)}</small>
                    </div>
                  ))}
                </div>
              </article>
            </div>

            <div className="mcp-activity">
              <div className="mcp-activity-head">
                <strong>Hoạt động gần đây</strong>
                <span>{usage.period.from} → {usage.period.to}</span>
              </div>
              {usage.recent.length ? usage.recent.map((event) => (
                <div className="mcp-activity-row" key={event.id}>
                  <span className={`mcp-activity-status ${event.status}`} />
                  <code>{event.tool}</code>
                  <span>{event.operation === "create" ? "Tạo" : event.operation === "download" ? "Tải về" : "Tool call"}</span>
                  <span>{event.keyPrefix || event.keyId || "local"}</span>
                  <span>{event.latencyMs.toLocaleString("vi-VN")} ms</span>
                  <span>{formatMcpDate(event.createdAt)}</span>
                  {event.errorCode ? <small>{event.errorCode}</small> : null}
                </div>
              )) : (
                <div className="mcp-usage-empty">Chưa có MCP tool call trong khoảng thời gian này.</div>
              )}
            </div>
          </>
        ) : null}
      </section>

      <section className="panel mcp-setup-panel">
        <div className="mcp-section-head">
          <div>
            <h3><Code2 size={18} /> Setup Guide</h3>
            <p>Chọn client rồi copy cấu hình được sinh từ manifest đang chạy.</p>
          </div>
          <span className="mcp-step">02 / CONNECT</span>
        </div>
        <div className="mcp-client-tabs" role="tablist" aria-label="MCP client">
          {mcpClients.map((item) => (
            <button
              type="button"
              role="tab"
              aria-selected={client === item.id}
              className={client === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setClient(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="mcp-setup-grid">
          <div className="mcp-setup-copy">
            <span>{mcpClients.find((item) => item.id === client)?.label}</span>
            <h4>Kết nối {config?.product.name || "NotebookLM Pro"}</h4>
            <p>
              Dán cấu hình vào phần MCP của client, thay <code>YOUR_MCP_API_KEY</code> bằng key vừa tạo,
              sau đó chạy <code>tools/list</code> để kiểm tra kết nối.
            </p>
            <div className="mcp-stats">
              <span><strong>{activeKeys.length}</strong> active keys</span>
              <span><strong>{config?.features.length || 0}</strong> feature groups</span>
              <span><strong>{tools}</strong> tools</span>
            </div>
          </div>
          <div className="mcp-config-box">
            <div>
              <span>Configuration</span>
              <button
                type="button"
                className="mcp-text-button"
                disabled={!config}
                onClick={() => copyText(snippet, "Đã sao chép cấu hình MCP.")}
              >
                <Copy size={14} /> Copy config
              </button>
            </div>
            <pre>{snippet}</pre>
          </div>
        </div>
      </section>

      <section className="mcp-security-note">
        <ShieldCheck size={18} />
        <div>
          <strong>Key được bảo vệ theo nguyên tắc least-secret</strong>
          <span>Secret không được ghi log hoặc trả lại khi list. Revoke có hiệu lực ở request MCP tiếp theo.</span>
        </div>
        <span>{config?.transport || "streamable-http"} · {config?.protocolVersion || "2025-03-26"}</span>
      </section>
    </section>
  );
}

function SettingsPanel({ run, runLogin }: Parameters<typeof ViewPanel>[0]) {
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [language, setLanguage] = useState("en");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [loginStatus, setLoginStatus] = useState<LoginCommandResult | null>(null);

  async function loadSettings() {
    const result = await api.getSettings();
    setSettings(result);
    setLanguage(result.language || "en");
  }

  useEffect(() => {
    run(loadSettings);
  }, []);

  return (
    <section className="panel-grid">
      <div className="panel form-panel">
        <div className="panel-title"><span><Settings size={16} /> Settings</span><button className="icon-btn" aria-label="Refresh settings" title="Refresh settings" onClick={() => run(loadSettings)}><RefreshCw size={16} /></button></div>
        <label className="field">
          <span>Output language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {Object.entries(settings?.languages || { en: "English" }).map(([code, label]) => <option key={code} value={code}>{label} ({code})</option>)}
          </select>
        </label>
        <button className="btn-primary" onClick={() => run(async () => { await api.setLanguage(language); await loadSettings(); })}>
          <CheckCircle2 size={16} /> Save language
        </button>
        <button className="btn-secondary" onClick={() => run(async () => setUpdateStatus(await api.checkUpdate()))}>
          <RefreshCw size={16} /> Check update
        </button>
        <button
          className="btn-secondary login-action"
          onClick={() => run(async () => setLoginStatus(await runLogin()))}
          disabled
          title="VPS browser login is disabled. Use Reset login, Local login, then Check VPS."
        >
          <LogIn size={16} /> Run VPS login
        </button>
      </div>
      <div className="panel list-panel">
        <div className="panel-title"><span><Settings size={16} /> Local state</span></div>
        <pre className="json-preview">{JSON.stringify({ settings, updateStatus, loginStatus }, null, 2)}</pre>
      </div>
    </section>
  );
}

function SharePanel({ notebook, run }: Parameters<typeof ViewPanel>[0]) {
  const [share, setShare] = useState<Record<string, unknown> | null>(null);
  return (
    <section className="panel-grid single">
      <div className="panel">
        <div className="panel-title"><span><Share2 size={16} /> Share</span><button className="icon-btn" aria-label="Refresh share status" title="Refresh share status" onClick={() => run(async () => setShare(await api.getShare(notebook.id)))}><RefreshCw size={16} /></button></div>
        <pre className="json-preview">{share ? JSON.stringify(share, null, 2) : "Load share status"}</pre>
      </div>
    </section>
  );
}

function ComingSoon({ view }: { view: View }) {
  return (
    <section className="locked-panel">
      <Sparkles size={28} />
      <strong>{view}</strong>
      <span>Backend hooks are planned for this module.</span>
    </section>
  );
}

function isActiveJob(job: Job) {
  return job.status === "pending" || job.status === "in_progress";
}

function isSourceReady(status: Source["status"]) {
  return status === 3 || status === "ready" || status === "READY" || status === "completed";
}

function isArtifactComplete(status: string | undefined, isComplete: boolean | undefined) {
  return isComplete === true || status === "completed" || status === "COMPLETED";
}

function isArtifactFailed(status: string | undefined) {
  return status === "failed" || status === "FAILED" || status === "removed" || status === "REMOVED";
}

function getDownloadFormatChoices(type: string) {
  if (type === "slide-deck") return ["pdf", "pptx"];
  if (type === "quiz" || type === "flashcards") return ["json", "markdown", "html"];
  return [];
}

function loadVerifications(): VerificationRecord[] {
  try {
    const value = window.localStorage.getItem(verificationStorageKey);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isVerificationRecord);
  } catch {
    return [];
  }
}

function isVerificationRecord(value: unknown): value is VerificationRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<VerificationRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.notebookId === "string" &&
    typeof record.question === "string" &&
    typeof record.createdAt === "number" &&
    typeof record.verified === "boolean" &&
    Array.isArray(record.attempts) &&
    record.attempts.every(
      (attempt) =>
        attempt &&
        typeof attempt === "object" &&
        typeof attempt.answer === "string" &&
        typeof attempt.checkedAt === "number",
    )
  );
}

function makeVerificationId() {
  return globalThis.crypto?.randomUUID?.() || `verify-${Date.now()}-${Math.random()}`;
}

function ListPanel({ title, icon: Icon, rows }: { title: string; icon: React.ElementType; rows: Array<{ id: string; title: string; meta: string; onDelete?: () => void }> }) {
  return (
    <div className="panel list-panel">
      <div className="panel-title"><span><Icon size={16} /> {title}</span><ChevronDown size={16} /></div>
      <div className="rows">
        {rows.length ? rows.map((row) => (
          <div className="data-row" key={row.id}>
            <span className="row-dot" />
            <div><strong>{row.title}</strong><span>{row.meta}</span></div>
            {row.onDelete ? (
              <button
                className="icon-btn danger"
                title={`Delete ${row.title}`}
                onClick={row.onDelete}
              >
                <Trash2 size={15} />
              </button>
            ) : null}
          </div>
        )) : <div className="empty-row">No items</div>}
      </div>
    </div>
  );
}

function VersionModal({ appInfo, onClose }: { appInfo: AppInfo | null; onClose: () => void }) {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  async function checkUpdate() {
    setChecking(true);
    setMessage("");
    try {
      setUpdateStatus(await api.checkUpdate());
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Update check failed");
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="panel-title">
          <span><RefreshCw size={16} /> Update</span>
          <button className="icon-btn" title="Close update dialog" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="update-grid">
          <span>Current</span><strong>{appInfo?.version || "0.1.0"}</strong>
          <span>Backend</span><strong>{appInfo?.backend?.status || "starting"}</strong>
          <span>Channel</span><strong>local</strong>
        </div>
        <button className="btn-primary" disabled={checking} onClick={checkUpdate}>
          <RefreshCw size={16} className={checking ? "spin" : ""} /> Check update
        </button>
        {updateStatus ? <span className="file-hint">{updateStatus.message}</span> : null}
        {message ? <span className="file-hint">{message}</span> : null}
      </section>
    </div>
  );
}

function LogManager({
  open,
  logs,
  onToggle,
  onClear,
}: {
  open: boolean;
  logs: LogEntry[];
  onToggle: () => void;
  onClear: () => void;
}) {
  const latest = logs[0];
  return (
    <section className={`log-manager ${open ? "open" : "collapsed"}`} aria-label="Log manager">
      <button
        className="log-manager-toggle"
        type="button"
        onClick={onToggle}
        aria-expanded={open}
      >
        <Activity size={15} />
        <span>Log manager</span>
        <strong>{logs.length}</strong>
        <ChevronDown size={15} className={open ? "open" : ""} />
      </button>
      {open ? (
        <div className="log-manager-body">
          <div className="log-manager-head">
            <span>{latest ? latest.message : "No logs yet"}</span>
            <button className="icon-btn" type="button" title="Clear logs" onClick={onClear}>
              <Trash2 size={15} />
            </button>
          </div>
          <div className="log-list" role="log" aria-live="polite">
            {logs.length ? logs.map((item) => (
              <article className={`log-row ${item.level}`} key={item.id}>
                <time>{new Date(item.timestamp).toLocaleTimeString()}</time>
                <span>{item.source}</span>
                <p>{item.message}</p>
              </article>
            )) : <div className="empty-row">No logs captured</div>}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ConnectLoginModal({
  status,
  message,
  onClose,
  onOpenNotebookLM,
  onCheck,
  onSync,
}: {
  status: ExtensionStatus;
  message: string;
  onClose: () => void;
  onOpenNotebookLM: (url: string) => void;
  onCheck: () => Promise<void>;
  onSync: () => Promise<void>;
}) {
  const [verificationUrl, setVerificationUrl] = useState(googleNotebookLMBaseUrl);
  const [verificationUrlError, setVerificationUrlError] = useState("");
  const checking = status === "connecting";
  const syncing = status === "syncing";
  const connected = status === "connected";

  function openVerificationLink() {
    const rawUrl = verificationUrl.trim() || googleNotebookLMBaseUrl;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("Link phải bắt đầu bằng http:// hoặc https://");
      }
      setVerificationUrlError("");
      onOpenNotebookLM(parsed.href);
    } catch (err) {
      setVerificationUrlError(err instanceof Error ? err.message : "Link xác thực không hợp lệ.");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="NotebookLM login"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-title">
          <span><LogIn size={16} /> NotebookLM login</span>
          <button className="icon-btn" title="Close login dialog" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p className="modal-copy">
          Mở NotebookLM trong Chrome, đăng nhập Google nếu được yêu cầu, rồi đồng bộ cookie về VPS.
        </p>
        <label className="field">
          <span>Link xác thực</span>
          <input
            value={verificationUrl}
            onChange={(event) => {
              setVerificationUrl(event.target.value);
              if (verificationUrlError) setVerificationUrlError("");
            }}
            placeholder="https://notebooklm.google.com/"
            type="url"
          />
        </label>
        {verificationUrlError ? <div className="banner bad">{verificationUrlError}</div> : null}
        <span className={`status-pill extension-pill ${connected ? "ok" : status === "error" ? "bad" : ""}`}>
          <Link2 size={14} />
          <span>Extension</span>
          <strong>{message}</strong>
        </span>
        <div className="modal-actions">
          <button className="btn-secondary" type="button" onClick={openVerificationLink}>
            <ExternalLink size={16} /> Mở link xác thực
          </button>
          <button className="btn-secondary" type="button" disabled={checking || syncing} onClick={() => onCheck()}>
            {checking ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}
            Kiểm tra
          </button>
          <button className="btn-primary" type="button" disabled={checking || syncing} onClick={() => onSync()}>
            {syncing ? <Loader2 size={16} className="spin" /> : <DownloadCloud size={16} />}
            Đồng bộ cookie
          </button>
        </div>
      </section>
    </div>
  );
}

function NotebookEditorModal({
  dialog,
  busy,
  onChange,
  onClose,
  onSubmit,
}: {
  dialog: NotebookDialogState;
  busy: boolean;
  onChange: (title: string) => void;
  onClose: () => void;
  onSubmit: () => Promise<void>;
}) {
  const isCreate = dialog.mode === "create";
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={isCreate ? "Create notebook" : "Rename notebook"}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="panel-title">
          <span><BookOpen size={16} /> {isCreate ? "Create notebook" : "Rename notebook"}</span>
          <button className="icon-btn" type="button" title="Close notebook dialog" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <label className="field">
          <span>Notebook title</span>
          <input
            autoFocus
            value={dialog.title}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Notebook title"
          />
        </label>
        <div className="modal-actions">
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" disabled={busy || !dialog.title.trim()}>
            {isCreate ? <Plus size={16} /> : <FileText size={16} />}
            {isCreate ? "Create" : "Rename"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDeleteModal({
  notebook,
  busy,
  onClose,
  onConfirm,
}: {
  notebook: Notebook;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Delete notebook"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-title">
          <span><Trash2 size={16} /> Delete notebook</span>
          <button className="icon-btn" title="Close delete dialog" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p className="modal-copy">
          Delete <strong>{notebookDisplayName(notebook)}</strong>? This action cannot be undone.
        </p>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-danger" disabled={busy} onClick={onConfirm}>
            <Trash2 size={16} /> Delete
          </button>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
