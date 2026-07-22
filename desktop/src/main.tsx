import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronDown,
  Copy,
  Database,
  FilePlus2,
  FileText,
  FlaskConical,
  Globe2,
  Layers3,
  Loader2,
  Lock,
  MessageSquareText,
  NotebookTabs,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Share2,
  Sparkles,
  Tags,
  Trash2,
  Wand2,
  X,
} from "lucide-react";

import { api } from "./api";
import type {
  AppInfo,
  Artifact,
  BackendStatus,
  ChatAnswer,
  Job,
  Label,
  Note,
  Notebook,
  ResearchStatus,
  SettingsState,
  Source,
  UpdateStatus,
  VerificationRecord,
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

function App() {
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
    return notebooks.filter((notebook) => notebook.title.toLocaleLowerCase().includes(query));
  }, [notebooks, notebookSearch]);
  const ready = backend.status === "ready";

  useEffect(() => {
    if (!window.notebooklmDesktop) {
      setBackend({
        status: "error",
        message: "Open with Electron to start the local backend bridge.",
      });
      return undefined;
    }
    let didRefreshReady = false;
    const syncAppInfo = async () => {
      const info = await window.notebooklmDesktop?.getAppInfo();
      if (!info) return;
      setAppInfo(info);
      if (info.backend) {
        setBackend({ status: info.backend.status as BackendStatus["status"], port: info.backend.port });
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
  }, []);

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

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function refreshNotebooks() {
    await run(async () => {
      await api.status();
      const list = await api.listNotebooks();
      setNotebooks(list);
      if (!activeNotebookId && list[0]) setActiveNotebookId(list[0].id);
    });
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
    setNotebookDialog({ mode: "rename", title: activeNotebook.title });
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><NotebookTabs size={19} /></span>
          <div>
            <h1>NotebookLM Pro</h1>
            <span>{activeNotebook ? activeNotebook.title : "Local research workspace"}</span>
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
            {filteredNotebooks.length ? filteredNotebooks.map((notebook) => (
              <div
                key={notebook.id}
                className={`notebook-row ${notebook.id === activeNotebookId ? "active" : ""}`}
              >
                <button
                  className="notebook-select"
                  title={notebook.title}
                  onClick={() => selectNotebook(notebook.id)}
                >
                  <BookOpen size={16} />
                  <span className="notebook-title">{notebook.title}</span>
                </button>
                <button
                  className="notebook-delete"
                  title={`Delete notebook ${notebook.title}`}
                  onClick={() => setDeleteTarget(notebook)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )) : <div className="empty-row">No matching notebooks</div>}
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
              />
            </>
          ) : null}
        </section>
      </section>

      <button className="version-pill" onClick={() => setVersionOpen(true)}>
        Version {appInfo?.version || "0.1.0"}
      </button>
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
  return (
    <section className="notebook-detail">
      <div className="notebook-detail-main">
        <span className="detail-icon"><BookOpen size={18} /></span>
        <div>
          <strong title={notebook.title}>{notebook.title}</strong>
          <span title={notebook.id}>{notebook.id.slice(0, 8)}...{notebook.id.slice(-4)}</span>
        </div>
      </div>
      <div className="detail-stats">
        <span><Database size={14} />{sources.length}</span>
        <span><Sparkles size={14} />{artifacts.length}</span>
        <span><FileText size={14} />{notes.length}</span>
      </div>
      <div className="detail-actions">
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
  run: (action: () => Promise<void>) => Promise<void>;
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
          <span><Activity size={16} /> {notebook.title}</span>
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

function ResearchPanel({ notebook, run }: Parameters<typeof ViewPanel>[0]) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("web");
  const [mode, setMode] = useState("fast");
  const [taskId, setTaskId] = useState("");
  const [status, setStatus] = useState<ResearchStatus | null>(null);
  const canStart = query.trim().length > 0 && !(source === "drive" && mode === "deep");
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
            onClick={() => run(async () => {
              const result = await api.startResearch(notebook.id, { query, source, mode });
              setTaskId(result.report_id || result.task_id);
              setStatus(null);
            })}
          >
            <Sparkles size={16} /> Start
          </button>
          <button
            className="btn-secondary"
            disabled={!taskId}
            onClick={() => run(async () => setStatus(await api.getResearchStatus(notebook.id, taskId)))}
          >
            <RefreshCw size={15} /> Status
          </button>
          <button
            className="btn-secondary"
            disabled={!taskId}
            onClick={() => run(async () => { await api.cancelResearch(notebook.id, taskId); setStatus({ notebook_id: notebook.id, task_id: taskId, kind: "cancelled", status: "cancelled", query, sources: [], summary: "Cancelled", report: "" }); })}
          >
            <X size={15} /> Cancel
          </button>
        </div>
      </div>
      <div className="panel list-panel">
        <div className="panel-title"><span><FlaskConical size={16} /> Research status</span><strong className="task-count">{status?.status || (taskId ? "started" : "idle")}</strong></div>
        {taskId ? <pre className="json-preview">{JSON.stringify(status || { task_id: taskId, status: "started" }, null, 2)}</pre> : <div className="empty-row">No research task yet</div>}
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
        <div className="panel-title"><span><Tags size={16} /> Labels</span><button className="icon-btn" onClick={() => run(loadLabels)}><RefreshCw size={16} /></button></div>
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

function SettingsPanel({ run }: Parameters<typeof ViewPanel>[0]) {
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [language, setLanguage] = useState("en");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);

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
        <div className="panel-title"><span><Settings size={16} /> Settings</span><button className="icon-btn" onClick={() => run(loadSettings)}><RefreshCw size={16} /></button></div>
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
      </div>
      <div className="panel list-panel">
        <div className="panel-title"><span><Settings size={16} /> Local state</span></div>
        <pre className="json-preview">{JSON.stringify({ settings, updateStatus }, null, 2)}</pre>
      </div>
    </section>
  );
}

function SharePanel({ notebook, run }: Parameters<typeof ViewPanel>[0]) {
  const [share, setShare] = useState<Record<string, unknown> | null>(null);
  return (
    <section className="panel-grid single">
      <div className="panel">
        <div className="panel-title"><span><Share2 size={16} /> Share</span><button className="icon-btn" onClick={() => run(async () => setShare(await api.getShare(notebook.id)))}><RefreshCw size={16} /></button></div>
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
          Delete <strong>{notebook.title}</strong>? This action cannot be undone.
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
