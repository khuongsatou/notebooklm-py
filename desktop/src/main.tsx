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
  Share2,
  Sparkles,
  Tags,
  Trash2,
  Wand2,
} from "lucide-react";

import { api } from "./api";
import type { AppInfo, Artifact, BackendStatus, ChatAnswer, Note, Notebook, Source } from "./types";
import "./styles.css";

type View = "overview" | "sources" | "chat" | "studio" | "artifacts" | "notes" | "research" | "labels" | "share" | "settings";

const views: Array<{ id: View; label: string; icon: React.ElementType }> = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "sources", label: "Sources", icon: FilePlus2 },
  { id: "chat", label: "Chat", icon: MessageSquareText },
  { id: "studio", label: "Studio", icon: Wand2 },
  { id: "artifacts", label: "Artifacts", icon: Layers3 },
  { id: "notes", label: "Notes", icon: FileText },
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

function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [backend, setBackend] = useState<BackendStatus>({ status: "starting" });
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [activeNotebookId, setActiveNotebookId] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [answer, setAnswer] = useState<ChatAnswer | null>(null);
  const [view, setView] = useState<View>("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [versionOpen, setVersionOpen] = useState(false);

  const activeNotebook = useMemo(
    () => notebooks.find((notebook) => notebook.id === activeNotebookId) || null,
    [notebooks, activeNotebookId],
  );

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

  async function createNotebook() {
    const title = window.prompt("Notebook title", "New research notebook");
    if (!title) return;
    await run(async () => {
      const created = await api.createNotebook(title);
      setNotebooks((items) => [created, ...items]);
      setActiveNotebookId(created.id);
    });
  }

  function selectNotebook(id: string) {
    setActiveNotebookId(id);
    setView("overview");
    setAnswer(null);
  }

  async function renameNotebook() {
    if (!activeNotebook) return;
    const title = window.prompt("Notebook title", activeNotebook.title);
    if (!title || title === activeNotebook.title) return;
    await run(async () => {
      const renamed = await api.renameNotebook(activeNotebook.id, title);
      setNotebooks((items) => items.map((item) => (item.id === renamed.id ? renamed : item)));
    });
  }

  async function deleteNotebook(id: string) {
    if (!window.confirm("Delete this notebook?")) return;
    await run(async () => {
      await api.deleteNotebook(id);
      setNotebooks((items) => items.filter((item) => item.id !== id));
      if (activeNotebookId === id) setActiveNotebookId("");
    });
  }

  const ready = backend.status === "ready";

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
          <button className="metric" title="Notebooks">
            <BookOpen size={16} />
            <strong>{notebooks.length}</strong>
          </button>
          <button className="metric" title="Sources">
            <Database size={16} />
            <strong>{sources.length}</strong>
          </button>
          <button className="metric" title="Artifacts">
            <Sparkles size={16} />
            <strong>{artifacts.length}</strong>
          </button>
          <span className={`status-pill ${ready ? "ok" : backend.status === "error" ? "bad" : ""}`}>
            {ready ? <CheckCircle2 size={14} /> : <Loader2 size={14} className="spin" />}
            {backend.status}
          </span>
          <button className="icon-btn" onClick={refreshNotebooks} title="Refresh">
            <RefreshCw size={17} />
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="side-tools">
            <label className="search">
              <Search size={15} />
              <input placeholder="Search notebook" />
            </label>
            <button className="icon-btn primary" onClick={createNotebook} title="Create notebook">
              <Plus size={18} />
            </button>
          </div>
          <div className="sidebar-label">
            <span>Notebooks</span>
            <strong>{notebooks.length}</strong>
          </div>
          <div className="notebook-list">
            {notebooks.map((notebook) => (
              <button
                key={notebook.id}
                title={notebook.title}
                className={`notebook-row ${notebook.id === activeNotebookId ? "active" : ""}`}
                onClick={() => selectNotebook(notebook.id)}
              >
                <BookOpen size={16} />
                <span className="notebook-title">{notebook.title}</span>
                <Trash2
                  size={15}
                  className="row-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteNotebook(notebook.id);
                  }}
                />
              </button>
            ))}
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
                onRename={renameNotebook}
              />
              <nav className="tabs">
                {views.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      className={view === item.id ? "active" : ""}
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
                answer={answer}
                busy={busy}
                setAnswer={setAnswer}
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
  onRename: () => Promise<void>;
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
  answer: ChatAnswer | null;
  busy: boolean;
  setAnswer: (answer: ChatAnswer | null) => void;
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
    case "share":
      return <SharePanel {...props} />;
    case "research":
    case "labels":
    case "settings":
      return <ComingSoon view={props.view} />;
    default:
      return <OverviewPanel {...props} />;
  }
}

function OverviewPanel({ notebook, sources, artifacts, notes, run }: Parameters<typeof ViewPanel>[0]) {
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

function SourcesPanel({ notebook, sources, refresh, run }: Parameters<typeof ViewPanel>[0]) {
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  return (
    <section className="panel-grid">
      <div className="panel form-panel">
        <div className="panel-title"><span><FilePlus2 size={16} /> Add Source</span></div>
        <div className="segmented">
          <button className={mode === "url" ? "active" : ""} onClick={() => setMode("url")}><Globe2 size={15} /> URL</button>
          <button className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}><FileText size={15} /> Text</button>
          <button disabled><FilePlus2 size={15} /> File</button>
          <button disabled><Database size={15} /> Drive</button>
        </div>
        {mode === "url" ? (
          <label className="field"><span>URL</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." /></label>
        ) : (
          <>
            <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="field"><span>Content</span><textarea value={text} onChange={(e) => setText(e.target.value)} /></label>
          </>
        )}
        <button
          className="btn-primary"
          onClick={() =>
            run(async () => {
              if (mode === "url") await api.addUrlSource(notebook.id, url);
              else await api.addTextSource(notebook.id, title || "Text source", text);
              setUrl("");
              setText("");
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

function ChatPanel({ notebook, answer, setAnswer, run }: Parameters<typeof ViewPanel>[0]) {
  const [question, setQuestion] = useState("");
  return (
    <section className="panel-grid single">
      <div className="panel chat-panel">
        <div className="panel-title"><span><Bot size={16} /> Chat</span></div>
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask this notebook..." />
        <div className="toolbar-row">
          <button
            className="btn-primary"
            onClick={() =>
              run(async () => {
                const result = await api.ask(notebook.id, question, answer?.conversation_id);
                setAnswer(result);
              })
            }
          >
            <MessageSquareText size={16} /> Ask
          </button>
          <button className="icon-btn" title="Copy" disabled={!answer?.answer}>
            <Copy size={16} />
          </button>
        </div>
        {answer ? <article className="answer">{answer.answer}</article> : null}
      </div>
    </section>
  );
}

function StudioPanel({ notebook, sources, refresh, run }: Parameters<typeof ViewPanel>[0]) {
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
              await api.generateArtifact(notebook.id, {
                type,
                source_ids: sourceIds,
                instructions,
                difficulty,
                quantity,
                audio_format: audioFormat,
                audio_length: audioLength,
              });
              await refresh();
            })
          }
        >
          <Sparkles size={16} /> Generate
        </button>
      </div>
    </section>
  );
}

function ArtifactsPanel({ artifacts }: Parameters<typeof ViewPanel>[0]) {
  return <ListPanel title="Artifacts" icon={Sparkles} rows={artifacts.map((artifact) => ({ id: artifact.id, title: artifact.title || artifact.id, meta: `status ${artifact.status ?? "unknown"}` }))} />;
}

function NotesPanel({ notebook, notes, refresh, run }: Parameters<typeof ViewPanel>[0]) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  return (
    <section className="panel-grid">
      <div className="panel form-panel">
        <div className="panel-title"><span><FileText size={16} /> New Note</span></div>
        <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field"><span>Content</span><textarea value={content} onChange={(e) => setContent(e.target.value)} /></label>
        <button className="btn-primary" onClick={() => run(async () => { await api.createNote(notebook.id, title || "New Note", content); setTitle(""); setContent(""); await refresh(); })}><Plus size={16} /> Save</button>
      </div>
      <ListPanel title="Notes" icon={FileText} rows={notes.map((note) => ({ id: note.id, title: note.title || note.id, meta: note.created_at || "note" }))} />
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

function ListPanel({ title, icon: Icon, rows }: { title: string; icon: React.ElementType; rows: Array<{ id: string; title: string; meta: string; onDelete?: () => void }> }) {
  return (
    <div className="panel list-panel">
      <div className="panel-title"><span><Icon size={16} /> {title}</span><ChevronDown size={16} /></div>
      <div className="rows">
        {rows.length ? rows.map((row) => (
          <div className="data-row" key={row.id}>
            <span className="row-dot" />
            <div><strong>{row.title}</strong><span>{row.meta}</span></div>
            {row.onDelete ? <button className="icon-btn danger" onClick={row.onDelete}><Trash2 size={15} /></button> : null}
          </div>
        )) : <div className="empty-row">No items</div>}
      </div>
    </div>
  );
}

function VersionModal({ appInfo, onClose }: { appInfo: AppInfo | null; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="panel-title"><span><RefreshCw size={16} /> Update</span><button className="icon-btn" onClick={onClose}>×</button></div>
        <div className="update-grid">
          <span>Current</span><strong>{appInfo?.version || "0.1.0"}</strong>
          <span>Backend</span><strong>{appInfo?.backend?.status || "starting"}</strong>
          <span>Channel</span><strong>local</strong>
        </div>
        <button className="btn-primary" disabled><RefreshCw size={16} /> Check update</button>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
