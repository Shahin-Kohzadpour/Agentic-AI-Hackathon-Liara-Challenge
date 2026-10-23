import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpLeft,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  Cloud,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Layers,
  LoaderCircle,
  LockKeyhole,
  MessageSquare,
  MonitorPlay,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import type {
  ActionPlan,
  ChatMessage,
  Conversation,
  Evidence,
  Incident,
  Project,
  RunEvent,
  Verification,
} from "../types.ts";
import type { LiveSnapshot } from "../live.ts";
import "./style.css";

type State = {
  projects: Project[];
  incidents: Incident[];
  actions: ActionPlan[];
  events: RunEvent[];
  conversations: Conversation[];
  messages: ChatMessage[];
  capabilities: {
    liaraConfigured: boolean;
    teamConfigured: boolean;
    liveConsole?: boolean;
  };
};
type Panel = "evidence" | "changes" | "tests" | "activity" | "live" | "report";
type Detail = { tab: Panel; messageId?: string };
const labels: Record<string, string> = {
  collecting: "بررسی شواهد",
  patching: "آماده‌سازی اصلاح",
  testing: "اجرای آزمون‌ها",
  awaiting_approval: "منتظر تأیید شما",
  deploying: "در حال انتشار",
  verifying: "بررسی نسخهٔ منتشرشده",
  resolved: "رفع خطا تأیید شد",
  failed: "بررسی متوقف شد",
  rejected: "انتشار لغو شد",
};
const notes: Record<string, string> = {
  collecting: "وضعیت برنامه و درخواست مسئله‌دار را بررسی می‌کنم.",
  patching: "خطا بازتولید شد. اصلاح محدود را آماده می‌کنم.",
  testing: "اصلاح پیشنهادی با آزمون‌های مستقل بررسی می‌شود.",
  awaiting_approval:
    "اصلاح آزموده‌شده آماده است. برای انتشار، کارت زیر را بررسی کنید.",
  deploying: "منبع تأییدشده در حال انتشار است.",
  verifying: "انتشار انجام شد. پاسخ واقعی برنامه را بررسی می‌کنم.",
  resolved:
    "درخواست اصلی روی نسخهٔ منتشرشده پاسخ درست داد و بررسی کاربردی موفق بود.",
  failed:
    "عملیات به نتیجه نرسید. جزئیات ثبت شده و می‌توانید دربارهٔ آن سؤال کنید.",
  rejected: "پیشنهاد انتشار رد شد؛ سرویس تغییری نکرد.",
};
const actionLabels: Record<string, string> = {
  pending: "منتظر تأیید شما",
  approved: "تأیید شد",
  executing: "در حال اجرا",
  succeeded: "اجرا تکمیل شد",
  failed: "اجرا ناموفق بود",
  rejected: "لغو شد",
  expired: "مهلت تأیید تمام شد",
};
const tabs: { id: Panel; label: string; icon: typeof Layers }[] = [
  { id: "evidence", label: "شواهد", icon: Layers },
  { id: "changes", label: "تغییرات", icon: Code2 },
  { id: "tests", label: "آزمون‌ها", icon: CheckCheck },
  { id: "activity", label: "فعالیت", icon: Activity },
  { id: "live", label: "نمای زنده", icon: MonitorPlay },
  { id: "report", label: "گزارش", icon: FileText },
];
const running = (run?: Incident) =>
  Boolean(
    run &&
      ["collecting", "patching", "testing", "deploying", "verifying"].includes(
        run.status,
      ),
  );
const number = (n: number) => n.toLocaleString("fa-IR");
const time = (s: string) =>
  new Date(s).toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
  });
const stored = (key: string) => {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage is optional; conversations live on the server. */
  }
};

function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? "small" : ""}`}>
      <Cloud size={small ? 18 : 26} strokeWidth={1.7} />
      <span className="mark-star">
        <Sparkles size={small ? 9 : 13} />
      </span>
    </span>
  );
}
function IconButton({
  label,
  children,
  onClick,
  active = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "selected" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function App() {
  const [auth, setAuth] = useState<"loading" | "ready" | "locked">("loading");
  const [csrf, setCsrf] = useState(""),
    [key, setKey] = useState("");
  const [state, setState] = useState<State | null>(null),
    [projectId, setProjectId] = useState(stored("negahban-project") || "local");
  const [selected, setSelected] = useState(stored("negahban-conversation"));
  const [draft, setDraft] = useState(""),
    [search, setSearch] = useState("");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const [connected, setConnected] = useState(false),
    [sidebar, setSidebar] = useState(innerWidth > 900);
  const [compact, setCompact] = useState(innerWidth <= 900);
  const [detail, setDetail] = useState<Detail | null>(null),
    [settings, setSettings] = useState(false);
  const [nearBottom, setNearBottom] = useState(true),
    [copied, setCopied] = useState("");
  const scroller = useRef<HTMLDivElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null),
    searchInput = useRef<HTMLInputElement>(null);
  const sending = useRef(false),
    pendingRequest = useRef<{
      content: string;
      conversationId: string;
      requestId: string;
    } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    detailElement = useRef<HTMLElement>(null);

  const api = useCallback(
    async (path: string, body?: unknown) => {
      const r = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        headers:
          body === undefined
            ? {}
            : { "content-type": "application/json", "x-csrf-token": csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await r.json();
      if (r.status === 401) setAuth("locked");
      if (!r.ok) throw new Error(result.error || "دریافت نتیجه ناموفق بود.");
      return result;
    },
    [csrf],
  );
  const load = useCallback(async () => {
    const result: State = await api("/api/state");
    setState(result);
    return result;
  }, [api]);
  const login = async (token: string) => {
    const r = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: token }),
    });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error || "ورود ناموفق بود.");
    setCsrf(result.csrf);
    setAuth("ready");
    setKey("");
    setError("");
  };
  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  useEffect(() => {
    void (async () => {
      try {
        const token = new URLSearchParams(location.hash.slice(1)).get("key");
        if (token) {
          history.replaceState(null, "", location.pathname);
          await login(token);
        } else {
          const r = await fetch("/api/session");
          if (!r.ok) {
            setAuth("locked");
            return;
          }
          setCsrf((await r.json()).csrf);
          setAuth("ready");
        }
      } catch (e) {
        setError((e as Error).message);
        setAuth("locked");
      }
    })();
  }, []);
  useEffect(() => {
    if (auth !== "ready") return;
    void load().catch((e) => setError(e.message));
    const source = new EventSource("/api/events");
    source.onopen = () => {
      setConnected(true);
      void load().catch((e) => setError(e.message));
    };
    source.onerror = () => setConnected(false);
    source.addEventListener(
      "update",
      () => void load().catch((e) => setError(e.message)),
    );
    const interval = setInterval(
      () => void load().catch((e) => setError(e.message)),
      6000,
    );
    return () => {
      source.close();
      clearInterval(interval);
    };
  }, [auth, load]);
  useEffect(() => {
    remember("negahban-conversation", selected);
  }, [selected]);
  useEffect(() => {
    remember("negahban-project", projectId);
  }, [projectId]);
  useEffect(() => {
    const media = matchMedia("(max-width: 900px)");
    const resize = (event: MediaQueryListEvent) => {
      setCompact(event.matches);
      setSidebar(!event.matches);
    };
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    if (sidebar && compact) searchInput.current?.focus();
  }, [sidebar, compact]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDetail(null);
        setSettings(false);
        if (innerWidth <= 900) setSidebar(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSidebar(true);
        requestAnimationFrame(() => searchInput.current?.focus());
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (settings) dialog.current?.showModal();
    else dialog.current?.close();
  }, [settings]);
  const conversation = state?.conversations.find((c) => c.id === selected);
  const actualProjectId = conversation?.projectId ?? projectId;
  const project = state?.projects.find((p) => p.id === actualProjectId);
  const messages =
    state?.messages.filter((m) => m.conversationId === selected) ?? [];
  const latestRunId = [...messages]
    .reverse()
    .find((m) => m.incidentId)?.incidentId;
  const latestRun = state?.incidents.find((r) => r.id === latestRunId);
  const working =
    messages.some((m) => m.status === "working") || running(latestRun);
  const empty = messages.length === 0;
  const filtered =
    state?.conversations.filter(
      (c) =>
        !search ||
        c.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    ) ?? [];
  const detailMessage =
    messages.find((m) => m.id === detail?.messageId) ??
    [...messages]
      .reverse()
      .find((m) => m.incidentId || m.evidence || m.actionId);
  const detailRun = state?.incidents.find(
    (r) => r.id === detailMessage?.incidentId,
  );
  const detailAction = state?.actions.find(
    (a) => a.id === (detailMessage?.actionId ?? detailRun?.actionId),
  );
  const selectedEvidence = detailMessage?.evidence ?? detailRun?.evidence ?? [];
  const events =
    state?.events.filter(
      (e) => e.runId === detailRun?.id || e.runId === detailAction?.id,
    ) ?? [];
  const scrollBottom = (behavior: ScrollBehavior = "smooth") => {
    const node = scroller.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior });
  };
  useEffect(() => {
    setNearBottom(true);
    requestAnimationFrame(() => scrollBottom("instant"));
  }, [selected]);
  useEffect(() => {
    if (nearBottom) requestAnimationFrame(() => scrollBottom());
  }, [state, nearBottom]);
  useEffect(() => {
    const node = textarea.current;
    if (node) {
      node.style.height = "auto";
      node.style.height = `${Math.min(180, node.scrollHeight)}px`;
    }
  }, [draft]);
  useEffect(() => {
    if (detail) detailElement.current?.focus();
  }, [detail?.tab]);

  const newChat = () => {
    pendingRequest.current = null;
    setSelected("");
    setDraft("");
    setDetail(null);
    setError("");
    if (innerWidth <= 900) setSidebar(false);
    requestAnimationFrame(() => textarea.current?.focus());
  };
  const choose = (c: Conversation) => {
    setSelected(c.id);
    setProjectId(c.projectId);
    setDraft("");
    setError("");
    setDetail(null);
    if (innerWidth <= 900) setSidebar(false);
  };
  const openDetail = (tab: Panel, messageId?: string) =>
    setDetail({ tab, messageId });
  const send = async (e: FormEvent) => {
    e.preventDefault();
    const content = draft.trim();
    if (
      !content ||
      content.length > 2000 ||
      sending.current ||
      working ||
      !project ||
      !state
    )
      return;
    sending.current = true;
    setBusy("send");
    setError("");
    try {
      let conversationId =
        conversation?.id ??
        (pendingRequest.current?.content === content
          ? pendingRequest.current.conversationId
          : undefined);
      if (!conversationId) {
        const created: Conversation = await api("/api/conversations", {
          projectId: actualProjectId,
        });
        conversationId = created.id;
        setSelected(created.id);
      }
      if (
        pendingRequest.current?.content !== content ||
        pendingRequest.current?.conversationId !== conversationId
      )
        pendingRequest.current = {
          content,
          conversationId,
          requestId: crypto.randomUUID(),
        };
      await api(
        `/api/conversations/${conversationId}/messages`,
        pendingRequest.current,
      );
      pendingRequest.current = null;
      setDraft("");
      setNearBottom(true);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      sending.current = false;
      setBusy("");
      textarea.current?.focus();
    }
  };
  const copy = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(message.id);
      setTimeout(() => setCopied(""), 1600);
    } catch {
      setError("کپی در کلیپ‌بورد در دسترس نیست.");
    }
  };
  const suggest = (content: string) => {
    setDraft(content);
    textarea.current?.focus();
  };

  if (auth === "loading")
    return (
      <div className="boot">
        <Mark />
        <LoaderCircle className="spin" size={18} />
        <span>در حال بازکردن فضای کار…</span>
      </div>
    );
  if (auth === "locked")
    return (
      <main className="gate">
        <div className="gate-card">
          <Mark />
          <span className="eyebrow">NEGAHBAN / LIARA</span>
          <h1>فضای خصوصی نگهبان</h1>
          <p>
            برای ادامه، لینک خصوصی را باز کنید یا کلید ورود محلی را وارد کنید.
          </p>
          <code dir="ltr">npm run access</code>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim().length >= 10 && !busy)
                void act("login", () => login(key.trim()));
            }}
          >
            <label htmlFor="key">کلید ورود</label>
            <input
              id="key"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              aria-invalid={key.trim().length > 0 && key.trim().length < 10}
              aria-describedby="key-hint"
            />
            <small id="key-hint">
              {key.trim().length > 0 && key.trim().length < 10
                ? "کلید کوتاه است؛ حداقل ۱۰ نویسه وارد کنید."
                : "کلید کامل را از لینک ترمینال کپی کنید."}
            </small>
            <button
              className="button primary"
              disabled={key.trim().length < 10 || Boolean(busy)}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <ArrowLeft size={16} />
              )}{" "}
              ورود به فضای کار
            </button>
          </form>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <span className="gate-note">
            <LockKeyhole size={12} /> نشست خصوصی روی همین دستگاه
          </span>
        </div>
      </main>
    );

  return (
    <div
      className={`app ${sidebar ? "sidebar-open" : ""} ${detail ? "detail-open" : ""}`}
    >
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="بستن فهرست گفتگوها"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className="sidebar" aria-label="گفتگوها" inert={!sidebar}>
        <div className="sidebar-brand">
          <button className="brand" onClick={newChat}>
            <Mark small />
            <span>
              نگهبان<span className="brand-by">برای لیارا</span>
            </span>
          </button>
          <IconButton
            label="بستن فهرست گفتگوها"
            onClick={() => setSidebar(false)}
          >
            <PanelRightClose size={17} />
          </IconButton>
        </div>
        <button className="new-chat" onClick={newChat} aria-label="گفتگوی تازه">
          <Plus size={17} />
          <span>گفتگوی تازه</span>
          <kbd>＋</kbd>
        </button>
        <div className="history-search">
          <Search size={15} />
          <input
            ref={searchInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجو در گفتگوها"
            aria-label="جستجو در گفتگوها"
          />
          <kbd>⌘ K</kbd>
        </div>
        <div className="history-heading">
          گفتگوهای شما <span>{number(filtered.length)}</span>
        </div>
        <nav className="history">
          {!state ? (
            <p className="sidebar-empty">در حال دریافت گفتگوها…</p>
          ) : !filtered.length ? (
            <p className="sidebar-empty">
              {search
                ? "گفتگویی پیدا نشد."
                : "اولین گفتگو از همین‌جا شروع می‌شود."}
            </p>
          ) : (
            filtered.map((c) => {
              const cm = state.messages.filter(
                (m) => m.conversationId === c.id,
              );
              const hasPending = cm.some((m) =>
                state.actions.some(
                  (a) =>
                    a.status === "pending" &&
                    Date.parse(a.expiresAt) > Date.now() &&
                    (a.id === m.actionId || a.runId === m.incidentId),
                ),
              );
              const inProgress = cm.some(
                (m) =>
                  m.status === "working" ||
                  state.incidents.some(
                    (r) => r.id === m.incidentId && running(r),
                  ),
              );
              return (
                <button
                  key={c.id}
                  onClick={() => choose(c)}
                  className={`history-item ${selected === c.id ? "active" : ""}`}
                  aria-current={selected === c.id ? "page" : undefined}
                >
                  <MessageSquare size={14} />
                  <span>
                    <b>{c.title}</b>
                    <small>
                      {state.projects.find((p) => p.id === c.projectId)?.name ??
                        "پروژه"}
                      {hasPending ? " · منتظر تأیید" : ""}
                    </small>
                  </span>
                  {inProgress ? (
                    <LoaderCircle size={12} className="spin" />
                  ) : hasPending ? (
                    <span className="dot amber" />
                  ) : null}
                </button>
              );
            })
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-note">
            <span className="workspace-icon">
              <Cloud size={17} />
            </span>
            <span>
              <b>فضای کار لیارا</b>
              <small>
                <span className={`dot ${connected ? "green" : "amber"}`} />
                {connected ? "متصل به فضای کار" : "در حال اتصال دوباره"}
              </small>
            </span>
          </div>
          <button className="settings-link" onClick={() => setSettings(true)}>
            <Settings2 size={16} />
            <span>تنظیمات و اتصال</span>
            <ChevronLeft size={14} />
          </button>
          <div className="sidebar-credit">
            <span>NEGAHBAN</span>
            <span>همکار ابری شما</span>
          </div>
        </div>
      </aside>

      <div className="workspace" inert={compact && sidebar}>
        <header className="topbar">
          <div className="topbar-start">
            {!sidebar && (
              <IconButton
                label="نمایش گفتگوها"
                onClick={() => setSidebar(true)}
              >
                <PanelRightOpen size={18} />
              </IconButton>
            )}
            <span className="topbar-title">
              {conversation?.title ?? "گفتگوی تازه"}
            </span>
            <span className="topbar-divider" />
            <div className="project-select">
              <Cloud size={14} />
              <select
                aria-label="پروژهٔ فعال"
                value={actualProjectId}
                disabled={!state}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  newChat();
                }}
              >
                {state?.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} />
            </div>
            <span
              className={`environment ${project?.mode === "liara" ? "production" : ""}`}
            >
              <span className="dot" />
              {project?.mode === "liara" ? "Liara" : "محلی"}
            </span>
          </div>
          <div className="topbar-end">
            <IconButton
              label="نمای زنده"
              active={detail?.tab === "live"}
              onClick={() =>
                detail?.tab === "live" ? setDetail(null) : openDetail("live")
              }
            >
              <MonitorPlay size={17} />
            </IconButton>
            <IconButton
              label="جزئیات گفتگو"
              active={Boolean(detail)}
              onClick={() =>
                detail ? setDetail(null) : openDetail("activity")
              }
            >
              <Layers size={17} />
            </IconButton>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <TriangleAlert size={16} />
            <span>{error}</span>
            <IconButton label="بستن خطا" onClick={() => setError("")}>
              <X size={15} />
            </IconButton>
          </div>
        )}
        {!connected && state && (
          <div className="connection-banner" role="status">
            اتصال زنده قطع شده است؛ برای اتصال دوباره تلاش می‌کنم.
          </div>
        )}
        <div className="work-area">
          <main className={`conversation-stage ${empty ? "is-empty" : ""}`}>
            <div
              className="chat-scroll"
              ref={scroller}
              onScroll={(e) => {
                const n = e.currentTarget;
                setNearBottom(
                  n.scrollHeight - n.scrollTop - n.clientHeight < 110,
                );
              }}
            >
              {empty ? (
                <section className="welcome">
                  <div className="welcome-emblem">
                    <Mark />
                  </div>
                  <span className="eyebrow">یک گفتگو. یک قدم جلوتر.</span>
                  <h1>روی لیارا، چه کاری انجام بدهیم؟</h1>
                  <p>
                    مسئله را بگویید؛ با هم بررسی می‌کنیم و تغییر را جلو می‌بریم.
                  </p>
                </section>
              ) : (
                <div className="thread">
                  <div className="thread-date">
                    {conversation
                      ? new Date(conversation.createdAt).toLocaleDateString(
                          "fa-IR",
                          { day: "numeric", month: "long" },
                        )
                      : ""}
                    <span>شروع گفتگو</span>
                  </div>
                  {messages.map((message) => {
                    const run = state?.incidents.find(
                      (r) => r.id === message.incidentId,
                    );
                    const action = state?.actions.find(
                      (a) => a.id === (message.actionId ?? run?.actionId),
                    );
                    return message.role === "user" ? (
                      <article className="user-message" key={message.id}>
                        <div>
                          <p dir="auto">{message.content}</p>
                          <time>{time(message.createdAt)}</time>
                        </div>
                      </article>
                    ) : (
                      <article className="assistant-message" key={message.id}>
                        <div className="assistant-heading">
                          <Mark small />
                          <b>نگهبان</b>
                          <span>{time(message.createdAt)}</span>
                        </div>
                        <div className="assistant-body">
                          {message.status === "working" ? (
                            <div className="thinking" role="status">
                              <span className="thinking-dots">
                                <i />
                                <i />
                                <i />
                              </span>
                              <span>
                                {message.intent === "verify"
                                  ? "در حال بررسی نسخه…"
                                  : "در حال بررسی درخواست…"}
                              </span>
                            </div>
                          ) : (
                            <p
                              className={
                                message.status === "failed"
                                  ? "message-error"
                                  : "message-prose"
                              }
                              dir="auto"
                            >
                              {message.status === "failed" && (
                                <TriangleAlert size={15} />
                              )}
                              {message.content}
                            </p>
                          )}
                          {run && (
                            <RunCard
                              run={run}
                              onOpen={(tab) => openDetail(tab, message.id)}
                            />
                          )}
                          {message.evidence && (
                            <button
                              className="artifact-card"
                              onClick={() => openDetail("evidence", message.id)}
                            >
                              <span className="artifact-icon">
                                <Layers size={19} />
                              </span>
                              <span>
                                <b>شواهد تازهٔ پروژه</b>
                                <small>
                                  {number(
                                    message.evidence.filter((e) => e.available)
                                      .length,
                                  )}{" "}
                                  منبع دریافت شد · مشاهدهٔ نتیجه‌ها
                                </small>
                              </span>
                              <ChevronLeft size={16} />
                            </button>
                          )}
                          {action && (
                            <Approval
                              action={action}
                              project={project}
                              busy={busy}
                              onDecide={(decision) =>
                                void act(action.id, () =>
                                  api(`/api/actions/${action.id}/decision`, {
                                    decision,
                                  }),
                                )
                              }
                            />
                          )}
                          {message.status !== "working" && (
                            <div className="message-tools">
                              <IconButton
                                label="کپی پاسخ"
                                onClick={() => void copy(message)}
                              >
                                {copied === message.id ? (
                                  <Check size={13} />
                                ) : (
                                  <Copy size={13} />
                                )}
                              </IconButton>
                              {run && (
                                <button
                                  onClick={() =>
                                    openDetail("report", message.id)
                                  }
                                >
                                  <FileText size={13} />
                                  گزارش
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
            {!nearBottom && !empty && (
              <button
                className="jump-bottom"
                onClick={() => {
                  setNearBottom(true);
                  scrollBottom();
                }}
              >
                <ArrowDown size={16} />
                آخرین پیام
              </button>
            )}
            <div className="composer-dock">
              <form
                className={`composer ${working ? "is-working" : ""}`}
                onSubmit={(e) => void send(e)}
              >
                <label htmlFor="prompt" className="sr-only">
                  پیام به نگهبان
                </label>
                <textarea
                  ref={textarea}
                  id="prompt"
                  dir="auto"
                  placeholder={
                    working
                      ? "نگهبان در حال انجام درخواست شماست…"
                      : "از نگهبان بخواهید…"
                  }
                  value={draft}
                  maxLength={2000}
                  rows={2}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <div className="composer-bottom">
                  <div className="composer-context">
                    <span
                      className={`dot ${working ? "amber pulse" : "accent"}`}
                    />
                    {working ? "در حال انجام درخواست" : "دستیار لیارا"}
                    <span className="context-separator">/</span>
                    <span dir="ltr">{project?.name ?? "در حال اتصال"}</span>
                  </div>
                  <div className="composer-controls">
                    {draft.length > 1800 && (
                      <small>{number(draft.length)}/۲۰۰۰</small>
                    )}
                    <button
                      type="submit"
                      className="send-button"
                      disabled={
                        !draft.trim() || Boolean(busy) || working || !project
                      }
                      aria-label="ارسال پیام"
                    >
                      {busy === "send" || working ? (
                        <LoaderCircle size={18} className="spin" />
                      ) : (
                        <ArrowUp size={19} />
                      )}
                    </button>
                  </div>
                </div>
              </form>
              {empty ? (
                <div className="suggestions">
                  <button
                    onClick={() =>
                      suggest(
                        "خلاصهٔ سفارش خطای ۵۰۰ دارد. علت را پیدا کن و اصلاح را برای تأیید من آماده کن.",
                      )
                    }
                  >
                    <Code2 size={15} />
                    <span>خطا را پیدا و اصلاح کن</span>
                    <ArrowUpLeft size={14} />
                  </button>
                  <button
                    onClick={() =>
                      suggest("وضعیت فعلی پروژه و شواهد سرویس را بررسی کن.")
                    }
                  >
                    <Activity size={15} />
                    <span>وضعیت پروژه را بررسی کن</span>
                    <ArrowUpLeft size={14} />
                  </button>
                  <button
                    onClick={() =>
                      suggest("چه کارهایی می‌توانی روی این پروژه انجام بدهی؟")
                    }
                  >
                    <Sparkles size={15} />
                    <span>از کجا شروع کنیم؟</span>
                    <ArrowUpLeft size={14} />
                  </button>
                </div>
              ) : (
                <div className="composer-hint">
                  <ShieldCheck size={12} />
                  <span>تغییرات سرویس با تأیید شما اجرا می‌شوند.</span>
                  <span className="keyboard-hint">
                    Enter ارسال · Shift + Enter خط جدید
                  </span>
                </div>
              )}
            </div>
            {empty && (
              <div className="welcome-foot">
                <ShieldCheck size={13} />
                شما تصمیم می‌گیرید. نگهبان انجام می‌دهد.
              </div>
            )}
          </main>
          {detail && (
            <aside
              className="detail-panel"
              ref={detailElement}
              tabIndex={-1}
              aria-label="جزئیات گفتگو"
            >
              <div className="detail-heading">
                <div>
                  <span className="eyebrow">فضای بررسی</span>
                  <b>{project?.name}</b>
                </div>
                <IconButton
                  label="بستن جزئیات"
                  onClick={() => {
                    setDetail(null);
                    textarea.current?.focus();
                  }}
                >
                  <X size={18} />
                </IconButton>
              </div>
              <div className="detail-tabs" role="tablist">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    id={`tab-${t.id}`}
                    aria-controls={`panel-${t.id}`}
                    aria-selected={detail.tab === t.id}
                    tabIndex={detail.tab === t.id ? 0 : -1}
                    onKeyDown={(e) => {
                      if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
                        e.preventDefault();
                        const index = tabs.findIndex(
                          (t) => t.id === detail.tab,
                        );
                        const next =
                          tabs[
                            (index +
                              (e.key === "ArrowLeft" ? 1 : tabs.length - 1)) %
                              tabs.length
                          ];
                        setDetail({ ...detail, tab: next.id });
                        requestAnimationFrame(() =>
                          document.getElementById(`tab-${next.id}`)?.focus(),
                        );
                      }
                    }}
                    onClick={() => setDetail({ ...detail, tab: t.id })}
                  >
                    <t.icon size={14} />
                    {t.label}
                  </button>
                ))}
              </div>
              <div
                className="detail-content"
                role="tabpanel"
                id={`panel-${detail.tab}`}
                aria-labelledby={`tab-${detail.tab}`}
              >
                {detail.tab === "evidence" && (
                  <>
                    <PanelIntro
                      title="شواهد سرویس"
                      description="داده‌های ثبت‌شده همراه با زمان دریافت و محدودیت هر منبع."
                    />
                    <EvidenceList items={selectedEvidence} />
                  </>
                )}
                {detail.tab === "changes" && (
                  <>
                    <PanelIntro
                      title="تغییر پیشنهادی"
                      description={
                        detailRun?.change ??
                        "تغییرات آماده‌شده برای همین درخواست اینجا نمایش داده می‌شوند."
                      }
                    />
                    {detailRun?.diff ? (
                      <Diff value={detailRun.diff} />
                    ) : (
                      <Empty icon={Code2}>
                        تغییری برای این پیام ثبت نشده است.
                      </Empty>
                    )}
                  </>
                )}
                {detail.tab === "tests" && (
                  <>
                    <PanelIntro
                      title="نتیجهٔ آزمون‌ها"
                      description="آزمون اصلاح و بررسی نسخهٔ منتشرشده به‌صورت جداگانه ثبت می‌شوند."
                    />
                    <Checks
                      title="آزمون مستقل اصلاح"
                      verification={detailRun?.candidate}
                    />
                    <Checks
                      title="بررسی پس از انتشار"
                      verification={detailRun?.verification}
                    />
                  </>
                )}
                {detail.tab === "activity" && (
                  <>
                    <PanelIntro
                      title="مسیر انجام درخواست"
                      description="رویدادهای واقعی این عملیات؛ از جمع‌آوری شواهد تا بررسی نتیجه."
                    />
                    {events.length ? (
                      <ol className="event-list">
                        {events.map((e) => (
                          <li key={e.id}>
                            <span
                              className={`dot ${e.status === "failed" ? "red" : e.status === "resolved" ? "green" : ""}`}
                            />
                            <div>
                              <p>{e.message}</p>
                              <time>{time(e.at)}</time>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <Empty icon={Activity}>
                        برای این پیام هنوز رویدادی ثبت نشده است.
                      </Empty>
                    )}
                  </>
                )}
                {detail.tab === "live" && (
                  <LiveView
                    project={project}
                    csrf={csrf}
                    conversationId={conversation?.id}
                    onConversation={(id) => {
                      setSelected(id);
                      void load().catch((e) => setError(e.message));
                    }}
                  />
                )}
                {detail.tab === "report" && (
                  <>
                    <PanelIntro
                      title="گزارش درخواست"
                      description="نتیجه، نسخهٔ منتشرشده و شواهد مرتبط با این بررسی."
                    />
                    {detailRun ? (
                      <>
                        <div className="report-status">
                          <span
                            className={`dot ${detailRun.status === "resolved" ? "green" : "amber"}`}
                          />
                          {labels[detailRun.status]}
                        </div>
                        <dl className="report-facts">
                          <dt>درخواست</dt>
                          <dd>{detailRun.request}</dd>
                          <dt>تشخیص</dt>
                          <dd>
                            {detailRun.diagnosis ?? "هنوز تکمیل نشده است."}
                          </dd>
                          <dt>شناسهٔ نسخه</dt>
                          <dd dir="ltr">
                            {detailRun.releaseId ?? "هنوز منتشر نشده است"}
                          </dd>
                        </dl>
                        {detailRun.error && (
                          <p className="message-error">{detailRun.error}</p>
                        )}
                        <a
                          className="button secondary"
                          href={`/api/reports/${detailRun.id}`}
                          download
                        >
                          <Download size={15} />
                          دریافت گزارش JSON
                        </a>
                        {detailRun.releaseId &&
                          ["failed", "resolved"].includes(detailRun.status) && (
                            <button
                              className="button secondary"
                              disabled={Boolean(busy)}
                              onClick={() =>
                                void act("verify", () =>
                                  api(
                                    `/api/incidents/${detailRun.id}/verify`,
                                    {},
                                  ),
                                )
                              }
                            >
                              <RefreshCw size={14} />
                              بررسی دوبارهٔ همین نسخه
                            </button>
                          )}
                      </>
                    ) : (
                      <Empty icon={FileText}>
                        پس از اولین بررسی، گزارش اینجا آماده می‌شود.
                      </Empty>
                    )}
                  </>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
      <dialog
        ref={dialog}
        className="settings-dialog"
        onCancel={() => setSettings(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSettings(false);
        }}
      >
        <div className="settings-inner">
          <div className="settings-heading">
            <h2>تنظیمات و اتصال</h2>
            <IconButton label="بستن تنظیمات" onClick={() => setSettings(false)}>
              <X size={18} />
            </IconButton>
          </div>
          <p>نگهبان به پروژه‌های ثبت‌شده در این فضای کار دسترسی دارد.</p>
          <div className="settings-row">
            <span>اتصال لیارا</span>
            <span
              className={`status-pill ${state?.capabilities.liaraConfigured && state?.capabilities.teamConfigured ? "green" : ""}`}
            >
              {state?.capabilities.liaraConfigured &&
              state?.capabilities.teamConfigured
                ? "پیکربندی شده"
                : "تنظیمات محلی لازم است"}
            </span>
          </div>
          <div className="settings-row">
            <span>محیط انتخاب‌شده</span>
            <b>
              {project?.mode === "liara" ? "سرویس واقعی لیارا" : "تمرین محلی"}
            </b>
          </div>
          <div className="settings-info">
            <ShieldCheck size={18} />
            <p>
              هر تغییر سرویس ابتدا به شکل پیشنهاد نمایش داده می‌شود. تأیید
              عملیات فقط از کارت همین فضای کار انجام می‌شود.
            </p>
          </div>
          <p>
            این نسخه بررسی و اصلاح نمونهٔ ثبت‌شده، دریافت شواهد، پیشنهاد
            ری‌استارت لیارا و بررسی انتشار را پشتیبانی می‌کند.
          </p>
          <a
            className="settings-docs"
            href="https://developers.liara.ir/"
            target="_blank"
            rel="noreferrer"
          >
            مستندات لیارا
            <ExternalLink size={14} />
          </a>
        </div>
      </dialog>
    </div>
  );
}

function PanelIntro({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="panel-intro">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
function Empty({
  icon: Icon,
  children,
}: {
  icon: typeof Cloud;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon size={25} strokeWidth={1.3} />
      <p>{children}</p>
    </div>
  );
}
function RunCard({
  run,
  onOpen,
}: {
  run: Incident;
  onOpen: (tab: Panel) => void;
}) {
  const active = running(run),
    good = run.status === "resolved";
  const stages = [
    "collecting",
    "patching",
    "testing",
    "awaiting_approval",
    "deploying",
    "verifying",
    "resolved",
  ];
  const index = stages.indexOf(run.status);
  return (
    <div
      className={`run-card ${good ? "is-success" : run.status === "failed" ? "is-failed" : ""}`}
    >
      <div className="run-heading">
        {active ? (
          <LoaderCircle size={16} className="spin" />
        ) : good ? (
          <CheckCheck size={17} />
        ) : run.status === "failed" ? (
          <TriangleAlert size={16} />
        ) : (
          <ShieldCheck size={16} />
        )}
        <b>{labels[run.status]}</b>
        {run.candidate && (
          <span className="status-pill">
            {number(run.candidate.checks.filter((c) => c.passed).length)} /{" "}
            {number(run.candidate.checks.length)} آزمون
          </span>
        )}
      </div>
      <p>{run.error ?? notes[run.status]}</p>
      {active || run.status === "awaiting_approval" ? (
        <div className="run-progress" aria-label={labels[run.status]}>
          {stages.slice(0, 6).map((s, i) => (
            <span
              key={s}
              className={i < index ? "done" : i === index ? "current" : ""}
            />
          ))}
        </div>
      ) : null}
      {run.diagnosis && (
        <div className="run-finding">
          <b>نتیجهٔ بررسی</b>
          <p>{run.diagnosis}</p>
        </div>
      )}
      <div className="run-links">
        <button onClick={() => onOpen("evidence")}>
          <Layers size={13} />
          {number(run.evidence.length)} شاهد
        </button>
        {run.diff && (
          <button onClick={() => onOpen("changes")}>
            <Code2 size={13} />
            مشاهدهٔ تغییر
          </button>
        )}
        {run.candidate && (
          <button onClick={() => onOpen("tests")}>
            <CheckCheck size={13} />
            آزمون‌ها
          </button>
        )}
        <button onClick={() => onOpen("activity")}>
          <Activity size={13} />
          فعالیت
        </button>
      </div>
    </div>
  );
}
function Approval({
  action,
  project,
  busy,
  onDecide,
}: {
  action: ActionPlan;
  project?: Project;
  busy: string;
  onDecide: (d: "approve" | "reject") => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const expired = Date.parse(action.expiresAt) <= now;
  const pending = action.status === "pending" && !expired;
  const status =
    action.status === "pending" && expired ? "expired" : action.status;
  return (
    <section
      className={`approval-card ${pending ? "pending" : ""}`}
      aria-label="پیشنهاد عملیات"
    >
      <div className="approval-label">
        <ShieldCheck size={15} />
        <span>{actionLabels[status]}</span>
        {pending && <span className="approval-badge">نیاز به تصمیم شما</span>}
      </div>
      <h3>{action.title}</h3>
      <p>{action.summary}</p>
      <dl className="approval-facts">
        <div>
          <dt>پروژه</dt>
          <dd dir="ltr">{project?.name ?? action.projectId}</dd>
        </div>
        <div>
          <dt>اثر هزینه</dt>
          <dd>{action.cost}</dd>
        </div>
      </dl>
      <div className="approval-risk">
        <TriangleAlert size={14} />
        <span>{action.risk}</span>
      </div>
      {pending ? (
        <div className="approval-buttons">
          <button
            className="button primary"
            disabled={Boolean(busy)}
            onClick={() => onDecide("approve")}
          >
            {busy === action.id ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Check size={15} />
            )}
            تأیید و اجرا
          </button>
          <button
            className="button secondary"
            disabled={Boolean(busy)}
            onClick={() => onDecide("reject")}
          >
            انصراف
          </button>
        </div>
      ) : (
        <div
          className={`action-result ${status === "failed" ? "message-error" : ""}`}
        >
          {status === "executing" && (
            <LoaderCircle className="spin" size={14} />
          )}
          {action.error ?? actionLabels[status]}
        </div>
      )}
      <details className="approval-details">
        <summary>
          جزئیات مجوز
          <ChevronDown size={12} />
        </summary>
        <span>معتبر تا {time(action.expiresAt)} · مجوز یک‌بارمصرف</span>
        <code dir="ltr">{action.digest}</code>
      </details>
    </section>
  );
}
function EvidenceList({ items }: { items: Evidence[] }) {
  return items.length ? (
    <div className="evidence-list">
      {items.map((e) => (
        <details key={e.id} className="evidence-item">
          <summary>
            <span
              className={`evidence-icon ${e.available ? "" : "unavailable"}`}
            >
              <FileText size={16} />
            </span>
            <span>
              <b>{e.title}</b>
              <small>
                {e.available ? "دریافت شد" : "در دسترس نیست"} ·{" "}
                {time(e.observedAt)}
              </small>
            </span>
            <ChevronDown size={13} />
          </summary>
          {e.limitation && <p>{e.limitation}</p>}
          <pre dir="ltr">
            {typeof e.data === "string"
              ? e.data
              : JSON.stringify(e.data, null, 2)}
          </pre>
        </details>
      ))}
    </div>
  ) : (
    <Empty icon={Layers}>برای این پیام هنوز شاهدی ثبت نشده است.</Empty>
  );
}
function Diff({ value }: { value: string }) {
  return (
    <pre className="diff" dir="ltr">
      {value.split("\n").map((line, i) => (
        <span
          key={i}
          className={
            line.startsWith("+")
              ? "added"
              : line.startsWith("-")
                ? "removed"
                : ""
          }
        >
          {line || " "}
          <br />
        </span>
      ))}
    </pre>
  );
}
function Checks({
  title,
  verification,
}: {
  title: string;
  verification?: Verification;
}) {
  return (
    <section className="checks-section">
      <h3>
        {title}
        {verification && (
          <span className={`status-pill ${verification.passed ? "green" : ""}`}>
            {number(verification.checks.filter((c) => c.passed).length)} /{" "}
            {number(verification.checks.length)}
          </span>
        )}
      </h3>
      {verification ? (
        <div className="check-list">
          {verification.checks.map((c, i) => (
            <details key={i}>
              <summary>
                {c.passed ? (
                  <Check size={15} className="text-green" />
                ) : (
                  <X size={15} className="text-red" />
                )}
                <span>{c.name}</span>
                <ChevronDown size={12} />
              </summary>
              <pre dir="ltr">
                {JSON.stringify(
                  { expected: c.expected, actual: c.actual },
                  null,
                  2,
                )}
              </pre>
            </details>
          ))}
        </div>
      ) : (
        <p className="muted-note">هنوز اجرا نشده است.</p>
      )}
    </section>
  );
}

function LiveView({
  project,
  csrf,
  conversationId,
  onConversation,
}: {
  project?: Project;
  csrf: string;
  conversationId?: string;
  onConversation: (id: string) => void;
}) {
  const [live, setLive] = useState<LiveSnapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    void fetch("/api/live/state")
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (v) setLive(v.live);
      })
      .catch(() => {});
    const source = new EventSource("/api/live/stream");
    const update = (e: Event) => {
      try {
        setLive(JSON.parse((e as MessageEvent).data));
      } catch {
        /* Reconnect will fetch a fresh snapshot. */
      }
    };
    source.addEventListener("state", update);
    return () => source.close();
  }, []);
  const call = async (path: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ projectId: project?.id, conversationId }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setLive(result.live);
      if (result.conversationId) onConversation(result.conversationId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const active =
    live &&
    ["running", "awaiting_fix", "verifying", "verified"].includes(live.status);
  const sameProject = live?.projectId === project?.id;
  return (
    <>
      <PanelIntro
        title="نمای زندهٔ عامل"
        description="جلسهٔ مرورگر برای بازتولید خطای نمونه و دنبال‌کردن بازیابی. شروع جلسه، بررسی نمونه را هم آغاز می‌کند."
      />
      {active && sameProject ? (
        <div className="live-screen">
          <img src="/api/live/mjpeg" alt="نمای زندهٔ مرورگر عامل" />
          <span>
            <span className="dot green" />
            LIVE
          </span>
        </div>
      ) : (
        <div className="live-placeholder">
          <MonitorPlay size={35} strokeWidth={1.2} />
          <b>
            {active
              ? "جلسه‌ای برای پروژهٔ دیگر فعال است."
              : "یک پنجره به کارِ در حال انجام"}
          </b>
          <p>با شروع جلسه، مسیر واقعی مرورگر را اینجا دنبال کنید.</p>
        </div>
      )}
      <div className="live-buttons">
        <button
          className="button primary"
          disabled={busy || !project || Boolean(active)}
          onClick={() => void call("/api/live/start")}
        >
          {busy && <LoaderCircle size={14} className="spin" />}شروع جلسهٔ زنده
        </button>
        {active && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void call("/api/live/stop")}
          >
            توقف جلسه
          </button>
        )}
        {sameProject && live?.status === "verified" && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void call("/api/live/verify")}
          >
            بررسی دوباره
          </button>
        )}
      </div>
      {error && (
        <p className="message-error" role="alert">
          {error}
        </p>
      )}
      {sameProject && live?.error && (
        <p className="message-error">{live.error}</p>
      )}
      {sameProject && (
        <ol className="event-list">
          {live?.steps.map((s) => (
            <li key={s.id}>
              {s.state === "done" ? (
                <Check size={14} className="text-green" />
              ) : s.state === "failed" ? (
                <X size={14} className="text-red" />
              ) : (
                <LoaderCircle className="spin" size={14} />
              )}
              <div>
                <b>{s.title}</b>
                {s.detail && <p>{s.detail}</p>}
                <time>{time(s.at)}</time>
              </div>
            </li>
          ))}
        </ol>
      )}
      <a
        href={project?.mode === "liara" ? "/demo?target=liara" : "/demo"}
        target="_blank"
        rel="noreferrer"
        className="preview-link"
      >
        بازکردن برنامهٔ نمونه
        <ArrowUpLeft size={14} />
      </a>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
