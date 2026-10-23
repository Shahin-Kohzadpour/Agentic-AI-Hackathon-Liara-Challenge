import { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, ArrowLeft, ArrowUpLeft, Check, CheckCheck, ChevronLeft, Clock3, Cloud,
  Code2, Download, ExternalLink, Eye, FileText, FlaskConical, Layers, LoaderCircle,
  LockKeyhole, MonitorPlay, MoreHorizontal, Play, Radio, RefreshCw, Search, Server, Shield,
  ShieldCheck, Square, Terminal, TriangleAlert, X,
} from 'lucide-react';
import type { Project, Incident, ActionPlan, Evidence, RunEvent } from '../types.ts';
import type { LiveSnapshot } from '../live.ts';
import './style.css';

type State = { projects: Project[]; incidents: Incident[]; actions: ActionPlan[]; events: RunEvent[]; capabilities: { liaraConfigured: boolean; teamConfigured: boolean; agent: string; scope: string; liveConsole?: boolean } };
const liveLabels: Record<string, string> = { idle: 'آمادهٔ شروع', running: 'در حال اجرا', awaiting_fix: 'در انتظار اصلاح', verifying: 'بررسی زنده', verified: 'بررسی زنده موفق', failed: 'متوقف با خطا', stopped: 'متوقف' };
const labels: Record<string, string> = { collecting: 'جمع‌آوری شواهد', patching: 'آماده‌سازی اصلاح', testing: 'آزمون مستقل', awaiting_approval: 'منتظر تأیید شما', deploying: 'انتشار نسخه', verifying: 'بررسی نتیجه', resolved: 'رفع خطا تأیید شد', failed: 'نیازمند بررسی', rejected: 'انتشار لغو شد' };
const notes: Record<string, string> = {
  collecting: 'شواهد برنامه، لاگ‌ها و وضعیت سرویس جمع‌آوری می‌شود.',
  patching: 'خطا در محیط جدا بازتولید شد؛ اصلاح محدود در حال آماده‌سازی است.',
  testing: 'اصلاح پیشنهادی با آزمون‌های مستقل بررسی می‌شود.',
  awaiting_approval: 'اصلاح آماده است. انتشار تا تأیید شما انجام نمی‌شود.',
  deploying: 'نسخهٔ تأییدشده در حال انتشار است.',
  verifying: 'پاسخ واقعی سرویس پس از انتشار بررسی می‌شود.',
  resolved: 'درخواست اصلی روی نسخهٔ منتشرشده با پاسخ درست تأیید شد.',
  failed: 'این رخداد به نتیجه نرسید؛ خطا و شواهد را بررسی کنید.',
  rejected: 'انتشار لغو شد. سرویس تغییری نکرد.',
};
const minKeyLength = 10;
const number = (value: number) => value.toLocaleString('fa-IR');
const time = (value: string) => new Date(value).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

function App() {
  const [csrf, setCsrf] = useState(''), [auth, setAuth] = useState<'loading' | 'ready' | 'locked'>('loading');
  const [state, setState] = useState<State | null>(null), [projectId, setProjectId] = useState('local');
  const [request, setRequest] = useState('سایت باز می‌شود، اما خلاصهٔ سفارش خطای ۵۰۰ دارد. علت را پیدا کن و اصلاح را برای تأیید من آماده کن.');
  const [error, setError] = useState(''), [busy, setBusy] = useState(''), [view, setView] = useState('overview');
  const [evidence, setEvidence] = useState<Evidence[] | null>(null), [key, setKey] = useState('');
  const [connection, setConnection] = useState(true);

  const api = useCallback(async (path: string, body?: unknown) => {
    const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json', 'x-csrf-token': csrf } : {}, body: body ? JSON.stringify(body) : undefined });
    const result = await r.json(); if (!r.ok) throw new Error(result.error || 'دریافت نتیجه ناموفق بود.'); return result;
  }, [csrf]);
  const load = useCallback(async () => { try { setState(await api('/api/state')); } catch (e) { setError(String((e as Error).message)); } }, [api]);
  const login = async (token: string) => {
    const r = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: token }) });
    const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(body.error || 'ورود ناموفق بود؛ کلید ورود را دوباره بررسی کنید.');
    setCsrf(body.csrf); setAuth('ready'); setKey('');
  };
  useEffect(() => { void (async () => {
    try {
      const fragment = new URLSearchParams(location.hash.slice(1)), token = fragment.get('key');
      if (token) { history.replaceState(null, '', location.pathname); await login(token); }
      else { const r = await fetch('/api/session'); if (!r.ok) { setAuth('locked'); return; } setCsrf((await r.json()).csrf); setAuth('ready'); }
    } catch (e) { setError((e as Error).message); setAuth('locked'); }
  })(); }, []);
  useEffect(() => {
    if (auth !== 'ready') return; void load();
    const source = new EventSource('/api/events');
    source.onopen = () => setConnection(true); source.onerror = () => setConnection(false);
    source.addEventListener('update', () => void load());
    const interval = setInterval(() => void load(), 6000);
    return () => { source.close(); clearInterval(interval); };
  }, [auth, load]);

  const act = async (name: string, fn: () => Promise<unknown>) => { setBusy(name); setError(''); try { await fn(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } };
  const project = state?.projects.find(p => p.id === projectId);
  const incident = state?.incidents.find(r => r.projectId === projectId);
  const pending = state?.actions.filter(a => a.projectId === projectId && a.status === 'pending') ?? [];
  const active = incident && ['collecting', 'patching', 'testing', 'deploying', 'verifying'].includes(incident.status);
  const events = state?.events.filter(e => e.runId === incident?.id) ?? [];
  const allEvidence = evidence ?? incident?.evidence ?? [];
  const tests = incident?.verification ?? incident?.candidate;
  const healthy = incident?.status === 'resolved';
  const typedKey = key.trim(), keyShort = typedKey.length > 0 && typedKey.length < minKeyLength;

  if (auth === 'loading') return <div className="boot"><LoaderCircle className="spin" size={20} /><span>در حال بازیابی نشست خصوصی…</span></div>;
  if (auth === 'locked') return <main className="gate">
    <div className="gate-card">
      <div className="gate-brand"><span className="brand-mark"><ShieldCheck size={18} /></span><b>نگهبان</b></div>
      <h1>فضای خصوصی نگهبان</h1>
      <p>برای تأیید عملیات، لینک خصوصی نمایش‌داده‌شده در ترمینال را باز کنید. ابزارهای MCP به کلید این صفحه دسترسی ندارند.</p>
      <code dir="ltr">npm run access</code>
      <form onSubmit={e => { e.preventDefault(); if (typedKey.length < minKeyLength || busy) return; void act('login', () => login(typedKey)); }}>
        <label htmlFor="key">یا کلید ورود محلی را وارد کنید</label>
        <input id="key" type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" aria-invalid={keyShort} aria-describedby="key-hint" />
        <small id="key-hint" className={keyShort ? 'field-hint warn' : 'field-hint'}>{keyShort ? `کلید کوتاه است: ${number(typedKey.length)} نویسه از حداقل ${number(minKeyLength)} نویسه.` : 'برای ورود، کلید کامل را از لینک ترمینال کپی کنید (حداقل ۱۰ نویسه).'}</small>
        <button className="btn btn-primary btn-block" disabled={typedKey.length < minKeyLength || Boolean(busy)}>ورود به فضای کار <ArrowLeft size={16} /></button>
      </form>
      {error && <p role="alert" className="error-text">{error}</p>}
      <p className="gate-foot"><LockKeyhole size={13} /> فقط روی ۱۲۷٫۰٫۰٫۱ و در همین نشست</p>
    </div>
  </main>;

  return <div className="app">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="نگهبان">
        <span className="brand-mark"><ShieldCheck size={17} /></span>
        <span className="brand-text"><b>نگهبان</b><small>SRE برای لیارا</small></span>
      </a>
      <nav className="nav">
        {([['overview', 'اتاق عملیات', Activity], ['live', 'اتاق زنده', MonitorPlay], ['evidence', 'شواهد', Layers], ['report', 'گزارش بازیابی', FileText]] as const).map(([name, label, Icon]) =>
          <button key={name} className={view === name ? 'nav-item active' : 'nav-item'} onClick={() => setView(name)}><Icon size={17} /><span>{label}</span></button>)}
      </nav>
      <div className="side-section">
        <div className="side-label"><span>پروژه‌ها</span><span className="count">{number(state?.projects.length ?? 0)}</span></div>
        {state?.projects.map(p => <button key={p.id} className={projectId === p.id ? 'project active' : 'project'} onClick={() => { setProjectId(p.id); setEvidence(null); setView('overview'); }}>
          <span className="project-icon">{p.mode === 'liara' ? <Cloud size={15} /> : <FlaskConical size={15} />}</span>
          <span className="project-text"><b dir="ltr">{p.name}</b><small>{p.mode === 'liara' ? 'سرویس واقعی لیارا' : 'تمرین محلی'}</small></span>
        </button>)}
      </div>
      <div className="side-footer">
        <div className="side-status"><span className={`dot ${connection ? 'ok' : 'warn'}`} />{connection ? 'جریان رویدادها متصل است' : 'اتصال دوباره…'}</div>
        <a href="https://developers.liara.ir/" target="_blank" rel="noreferrer">مستندات لیارا <ExternalLink size={12} /></a>
        <p><LockKeyhole size={12} /> کلیدها به مدل و گزارش نمی‌رسند.</p>
      </div>
    </aside>

    <div className="workspace">
      <header className="topbar">
        <div className="top-project">
          <span className={`dot ${project?.mode === 'liara' ? 'accent' : 'muted'}`} />
          <b dir="ltr">{project?.name ?? '—'}</b>
          <span className="chip">{project?.mode === 'liara' ? 'LIVE' : 'LOCAL'}</span>
        </div>
        <div className="top-actions">
          <span className="chip chip-quiet"><Shield size={13} /> تأیید انسانی</span>
          <a className="icon-btn" href={project?.mode === 'liara' ? '/demo?target=liara' : '/demo'} target="_blank" rel="noreferrer" aria-label="مشاهدهٔ برنامه" title="مشاهدهٔ برنامه"><ArrowUpLeft size={16} /></a>
          <details className="menu">
            <summary className="icon-btn" aria-label="ابزارهای پروژه" title="ابزارهای پروژه"><MoreHorizontal size={18} /></summary>
            <div className="menu-pop">
              <button disabled={Boolean(busy) || Boolean(active)} onClick={() => void act('prepare', () => api('/api/actions/prepare', { projectId, kind: 'reset' }))}><Code2 size={15} /><span><b>آماده‌سازی نسخهٔ نمونه</b><small>شروع یا تکرار سناریوی خطا</small></span></button>
              {project?.mode === 'liara' && <button disabled={Boolean(busy) || Boolean(active)} onClick={() => void act('restart', () => api('/api/actions/prepare', { projectId, kind: 'restart' }))}><RefreshCw size={15} /><span><b>پیشنهاد ری‌استارت</b><small>بدون تغییر پلن یا سورس</small></span></button>}
            </div>
          </details>
          <span className="avatar">ن</span>
        </div>
      </header>

      {error && <div className="alert" role="alert"><TriangleAlert size={16} /><span>{error}</span><button aria-label="بستن خطا" onClick={() => setError('')}><X size={15} /></button></div>}

      <main className="scroll">
        {view === 'overview' && <div className="thread">
          <div className="thread-head">
            <div className="eyebrow">NEGAHBAN / OPERATIONS</div>
            <h1>از خطا تا اطمینان.</h1>
            <p>انتشار، تشخیص و اصلاح؛ با شواهد واقعی و تصمیم شما.</p>
            <div className="meta-row">
              <span className="meta"><Server size={13} />{project?.mode === 'liara' ? 'سرویس واقعی' : 'تمرین محلی'}</span>
              {project?.remoteRelease && <span className="meta mono" dir="ltr">{project.remoteRelease.slice(-12)}</span>}
              <span className="meta"><CheckCheck size={13} />{tests ? `${number(tests.checks.filter(c => c.passed).length)} از ${number(tests.checks.length)} آزمون` : 'آزمون اجرا نشده'}</span>
              {incident && <span className={`meta ${healthy ? 'ok' : ''}`}><span className={`dot ${healthy ? 'ok' : 'warn'}`} />{labels[incident.status]}</span>}
            </div>
          </div>

          <div className="msg">
            <div className="msg-avatar">ن</div>
            <div className="msg-body">
              <div className="msg-head"><b>نگهبان</b><span>عامل عملیات</span></div>
              <p className="msg-text">مسئله را بنویسید. شواهد واقعی سرویس را جمع می‌کنم، خطا را در محیط جدا بازتولید می‌کنم و فقط اصلاح آزموده‌شده را برای تأیید شما آماده می‌کنم.</p>
              <div className="chips"><span><Code2 size={13} /> Codex</span><span><ShieldCheck size={13} /> تأیید انسانی</span><span><Activity size={13} /> شواهد زنده</span></div>
            </div>
          </div>

          {incident && <div className="msg user"><div className="msg-body"><div className="msg-head"><b>شما</b><span>{time(incident.createdAt)}</span></div><p className="msg-text">{incident.request}</p></div></div>}

          {incident && <div className="msg">
            <div className="msg-avatar">ن</div>
            <div className="msg-body">
              <div className="msg-head"><b>نگهبان</b><span>{labels[incident.status]}</span></div>
              <div className={`run-state ${healthy ? 'ok' : incident.status === 'failed' ? 'bad' : ''}`}>
                <span className={`dot ${healthy ? 'ok' : incident.status === 'failed' ? 'bad' : 'warn'}`} />
                <b>{labels[incident.status]}</b>
                <span>{notes[incident.status]}</span>
              </div>

              <Timeline incident={incident} />

              {incident.diagnosis && <div className="finding">
                <div className="finding-head"><Search size={14} /><b>یافتهٔ بررسی</b><span className={incident.candidate?.passed ? 'tag ok' : 'tag warn'}>{incident.candidate?.passed ? 'آزمون‌شده' : 'تأیید نشده'}</span></div>
                <p>{incident.diagnosis}</p>
                {incident.change && <div className="change"><Code2 size={14} /><span>{incident.change}</span></div>}
                {incident.diff && <details className="disclosure"><summary>مشاهدهٔ تغییر پیشنهادی <ChevronLeft size={14} /></summary><Diff value={incident.diff} /></details>}
              </div>}

              {incident.error && <div className="inline-error"><TriangleAlert size={15} /><span>{incident.error}</span></div>}

              {incident.verification && <details className="disclosure checks">
                <summary>بررسی پس از انتشار · {number(incident.verification.checks.filter(c => c.passed).length)} از {number(incident.verification.checks.length)} موفق <ChevronLeft size={14} /></summary>
                <div className="check-list">{incident.verification.checks.map((check, i) => <div key={i}>{check.passed ? <Check size={15} className="ok-icon" /> : <X size={15} className="bad-icon" />}<span>{check.name}</span><b className={check.passed ? 'ok-text' : 'bad-text'}>{check.passed ? 'موفق' : 'ناموفق'}</b></div>)}</div>
              </details>}

              <div className="msg-actions">
                {events.length > 0 && <details className="disclosure inline"><summary>رویدادها ({number(events.length)}) <ChevronLeft size={14} /></summary><div className="event-list">{events.slice(-8).map(event => <div className="event" key={event.id}><span className={`dot ${event.status === 'failed' ? 'bad' : 'muted'}`} /><p>{event.message}</p><time>{time(event.at)}</time></div>)}</div></details>}
                <button className="link-btn" onClick={() => setView('evidence')}><Layers size={14} /> {number(allEvidence.length)} شاهد ثبت‌شده</button>
                {healthy && <button className="link-btn" onClick={() => setView('report')}><FileText size={14} /> مشاهدهٔ گزارش بازیابی <ArrowLeft size={13} /></button>}
              </div>
            </div>
          </div>}

          {!incident && <div className="msg quiet"><div className="msg-avatar">ن</div><div className="msg-body"><p className="msg-text">هنوز رخدادی برای این پروژه ثبت نشده است. مسئله را در کادر پایین بنویسید تا بررسی شروع شود.</p></div></div>}

          {pending.length > 0 && <div className="msg">
            <div className="msg-avatar">ن</div>
            <div className="msg-body">
              <div className="msg-head"><b>نگهبان</b><span>درخواست تأیید</span></div>
              {pending.map(action => <Approval key={action.id} action={action} busy={busy} onDecide={decision => void act(action.id, () => api(`/api/actions/${action.id}/decision`, { decision }))} />)}
            </div>
          </div>}
        </div>}

        {view === 'live' && <section className="page">
          <div className="page-head"><div><h2>اتاق زنده</h2><p>مرورگر واقعی عامل: ورود به کنسول لیارا، بازتولید خطا، انتشار اصلاح و بررسی دوباره.</p></div></div>
          <LiveRoom project={project} incident={incident} csrf={csrf} consoleConfigured={state?.capabilities.liveConsole} onOpenApproval={() => setView('overview')} />
        </section>}

        {view === 'evidence' && <section className="page">
          <div className="page-head">
            <div><h2>شواهد پروژه</h2><p>زمان دریافت، منبع و محدودیت هر شاهد همراه آن ثبت می‌شود.</p></div>
            <button className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => void act('evidence', async () => setEvidence(await api('/api/diagnostics', { projectId })))}>{busy === 'evidence' ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />} دریافت تازه</button>
          </div>
          <div className="panel"><EvidenceList items={allEvidence} expanded /></div>
        </section>}

        {view === 'report' && <section className="page">
          <div className="page-head">
            <div><h2>گزارش بازیابی</h2><p>نتیجهٔ واقعی رخداد، تغییر و بررسی پس از انتشار.</p></div>
            {incident && <a className="btn btn-secondary" href={`/api/reports/${incident.id}`} download><Download size={15} /> دریافت JSON</a>}
          </div>
          <div className="panel document">
            {!incident ? <div className="empty"><FileText size={22} /><p>پس از اولین بررسی، گزارش آن اینجا ثبت می‌شود.</p></div> : <>
              <div className={`report-status ${healthy ? 'ok' : ''}`}>
                <span>{healthy ? <CheckCheck size={22} /> : <Activity size={22} />}</span>
                <div><h3>{labels[incident.status]}</h3><p>{healthy ? 'رفع خطا با بررسی کاربردی تأیید شده است.' : 'این رخداد هنوز به‌عنوان رفع‌شده ثبت نشده است.'}</p></div>
                {incident.releaseId && <button className="btn btn-secondary" disabled={Boolean(busy) || Boolean(active)} onClick={() => void act('reverify', () => api(`/api/incidents/${incident.id}/verify`, {}))}><RefreshCw size={14} /> بررسی دوباره</button>}
              </div>
              <dl className="report-list">
                <div><dt>پروژه</dt><dd dir="ltr">{project?.name}</dd></div>
                <div><dt>شناسهٔ رخداد</dt><dd dir="ltr">{incident.id}</dd></div>
                <div><dt>نسخهٔ منتشرشده</dt><dd dir="ltr">{incident.releaseId ?? 'هنوز منتشر نشده'}</dd></div>
                <div><dt>درخواست</dt><dd>{incident.request}</dd></div>
                <div><dt>تشخیص</dt><dd>{incident.diagnosis ?? 'هنوز تکمیل نشده'}</dd></div>
                <div><dt>تغییر</dt><dd>{incident.change ?? 'اصلاحی ثبت نشده'}</dd></div>
              </dl>
              {incident.verification && <div className="check-list report-checks"><h3>بررسی پس از انتشار</h3>{incident.verification.checks.map((check, i) => <div key={i}>{check.passed ? <Check size={15} className="ok-icon" /> : <X size={15} className="bad-icon" />}<span>{check.name}</span><b className={check.passed ? 'ok-text' : 'bad-text'}>{check.passed ? 'موفق' : 'ناموفق'}</b></div>)}</div>}
              {incident.error && <div className="inline-error"><TriangleAlert size={15} /><span>{incident.error}</span></div>}
              {incident.diff && <details className="disclosure report-diff"><summary>تغییر سورس‌کد <ChevronLeft size={14} /></summary><Diff value={incident.diff} /></details>}
              <div className="report-limit"><Eye size={16} /><p>محدودهٔ بررسی: برنامهٔ نمونهٔ Node.js و قرارداد خلاصهٔ سفارش. این نتیجه تضمین سلامت همهٔ مسیرها یا پایش دائمی سرویس نیست.</p></div>
            </>}
          </div>
        </section>}
      </main>

      {view === 'overview' && <div className="composer-wrap">
        <form className="composer" onSubmit={e => { e.preventDefault(); if (busy || active || request.trim().length < 5) return; void act('investigate', () => api('/api/incidents', { projectId, request })); }}>
          <label className="sr-only" htmlFor="request">شرح مشکل</label>
          <textarea id="request" value={request} onChange={e => setRequest(e.target.value)} rows={2} placeholder="مشکل سرویس را بنویسید…" />
          <div className="composer-bar">
            <span className="composer-hint"><LockKeyhole size={13} /> بررسی بدون تغییر سرویس؛ انتشار فقط با تأیید شما.</span>
            <button className="btn btn-primary" disabled={Boolean(busy) || Boolean(active) || request.trim().length < 5}>
              {active ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}
              {active ? 'در حال بررسی رخداد' : 'بررسی و آماده‌سازی اصلاح'}
            </button>
          </div>
        </form>
        <p className="composer-note">نگهبان · عامل عملیات با اختیار محدود</p>
      </div>}
    </div>
  </div>;
}

function Timeline({ incident }: { incident?: Incident }) {
  const stages = [['collecting', 'شواهد'], ['patching', 'اصلاح کد'], ['testing', 'آزمون'], ['awaiting_approval', 'تأیید شما'], ['resolved', 'بازیابی']] as const;
  const order = ['collecting', 'patching', 'testing', 'awaiting_approval', 'deploying', 'verifying', 'resolved'];
  const current = incident ? order.indexOf(incident.status) : -1;
  return <div className="timeline">{stages.map(([status, label], i) => {
    const index = order.indexOf(status), done = current > index || (status === 'resolved' && current === 6), active = incident?.status === status || (status === 'resolved' && ['deploying', 'verifying'].includes(incident?.status ?? ''));
    return <div key={status} className={`stage ${done ? 'done' : ''} ${active ? 'current' : ''}`}><div className="stage-dot">{done ? <Check size={12} /> : active && status !== 'awaiting_approval' ? <LoaderCircle size={12} className="spin" /> : status === 'awaiting_approval' ? <LockKeyhole size={11} /> : number(i + 1)}</div><span>{label}</span></div>;
  })}</div>;
}

function Approval({ action, busy, onDecide }: { action: ActionPlan; busy: string; onDecide: (decision: 'approve' | 'reject') => void }) {
  return <div className="approval">
    <div className="approval-head"><span className="dot warn" /><b>درخواست تأیید</b><span className="tag">{action.kind === 'restart' ? 'ری‌استارت' : 'انتشار'}</span></div>
    <h3>{action.title}</h3>
    <p className="approval-summary">{action.summary}</p>
    <div className="approval-meta"><div><span>منبع</span><b className="mono" dir="ltr">{action.digest.slice(0, 12)}</b></div><div><span>اثر هزینه</span><b>{action.cost}</b></div></div>
    <div className="risk"><TriangleAlert size={14} /><span>{action.risk}</span></div>
    <div className="approval-buttons">
      <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => onDecide('approve')}>{busy === action.id ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} تأیید و اجرا</button>
      <button className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => onDecide('reject')}>انصراف</button>
    </div>
    <small className="approval-expiry"><Clock3 size={11} /> معتبر تا {time(action.expiresAt)} · مجوز یک‌بارمصرف</small>
  </div>;
}

function Diff({ value }: { value: string }) { return <pre className="diff" dir="ltr">{value.split('\n').map((line, i) => <span key={i} className={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : ''}>{line || ' '}<br /></span>)}</pre>; }

function EvidenceList({ items, expanded = false }: { items: Evidence[]; expanded?: boolean }) {
  return items.length ? <div className="evidence-list">{items.map(e => <details key={e.id} className="evidence-item">
    <summary><span className={e.available ? 'evidence-icon available' : 'evidence-icon'}>{e.available ? <FileText size={15} /> : <Clock3 size={15} />}</span><span><b>{e.title}</b><small>{e.available ? 'شاهد ثبت‌شده' : 'داده در دسترس نیست'} · {time(e.observedAt)}</small></span><ChevronLeft size={14} /></summary>
    {e.limitation && <p>{e.limitation}</p>}<pre dir="ltr">{JSON.stringify(e.data, null, 2)}</pre>
  </details>)}</div> : <div className="empty"><Layers size={20} /><p>پس از بررسی، شواهد واقعی اینجا نمایش داده می‌شوند.</p></div>;
}

function LiveRoom({ project, incident, csrf, consoleConfigured, onOpenApproval }: { project?: Project; incident?: Incident; csrf: string; consoleConfigured?: boolean; onOpenApproval: () => void }) {
  const [live, setLive] = useState<LiveSnapshot | null>(null), [streaming, setStreaming] = useState(false);
  const [connected, setConnected] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const load = useCallback(async () => { try { const r = await fetch('/api/live/state'); if (r.ok) setLive((await r.json()).live); } catch { } }, []);
  useEffect(() => {
    void load();
    const source = new EventSource('/api/live/stream');
    source.onopen = () => setConnected(true); source.onerror = () => setConnected(false);
    const onState = (event: Event) => { try { setLive(JSON.parse((event as MessageEvent).data)); } catch { } };
    source.addEventListener('state', onState);
    return () => { source.removeEventListener('state', onState); source.close(); };
  }, [load]);
  useEffect(() => { if (live && ['running', 'awaiting_fix', 'verifying', 'verified'].includes(live.status)) setStreaming(true); }, [live?.status]);
  const call = async (path: string, body?: unknown) => {
    setBusy(path); setError('');
    if (path === '/api/live/start') setStreaming(true);
    try { const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body ?? {}) }); const result = await r.json(); if (!r.ok) throw new Error(result.error || 'عملیات ناموفق بود.'); if (result.live) setLive(result.live); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const running = ['running', 'awaiting_fix', 'verifying'].includes(live?.status ?? '');
  const canVerify = streaming && !running && (incident?.status === 'resolved' || live?.status === 'verified');
  return <div className="live-grid">
    <section className="panel live-panel">
      <div className="panel-heading"><h2><MonitorPlay size={16} /> پنجرهٔ زندهٔ عامل</h2><div className="live-tags"><span className="tag"><span className={`dot ${connected ? 'ok' : 'warn'}`} />{connected ? 'متصل' : 'در حال اتصال'}</span><span className={`tag ${live?.status === 'verified' ? 'ok' : ''}`}>{liveLabels[live?.status ?? 'idle']}</span></div></div>
      <div className="live-stage">{streaming ? <img src="/api/live/mjpeg" alt="نمای زندهٔ مرورگر عامل" /> : <div className="live-placeholder"><MonitorPlay size={30} /><p>با شروع جلسه، مرورگر واقعی عامل روی کنسول لیارا و ویترین فروشگاه اینجا پخش می‌شود.</p><small>پخش تصویر فقط روی همین نشست خصوصی و ۱۲۷٫۰٫۰٫۱ انجام می‌شود.</small></div>}<div className="live-overlay"><span className="live-rec"><i />LIVE VIEW</span></div></div>
      <div className="live-address"><LockKeyhole size={12} /><span dir="ltr">{live?.currentUrl ?? live?.appUrl ?? '—'}</span></div>
      <div className="live-controls">
        <button className="btn btn-primary" disabled={!project || running || Boolean(busy)} onClick={() => void call('/api/live/start', { projectId: project?.id })}>{busy === '/api/live/start' ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />} شروع جلسهٔ زنده</button>
        <button className="btn btn-secondary" disabled={!streaming || Boolean(busy)} onClick={() => void call('/api/live/stop')}>{busy === '/api/live/stop' ? <LoaderCircle size={15} className="spin" /> : <Square size={14} />} توقف</button>
        {canVerify && <button className="btn btn-secondary" disabled={Boolean(busy) || live?.status === 'verifying'} onClick={() => void call('/api/live/verify')}>{busy === '/api/live/verify' || live?.status === 'verifying' ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} بررسی زندهٔ نتیجه</button>}
      </div>
      {error && <p role="alert" className="live-error"><TriangleAlert size={14} />{error}</p>}
      <p className="live-note"><Shield size={13} />{consoleConfigured ? 'ورود به کنسول با اعتبارنامهٔ محلی .env انجام می‌شود و هرگز به مدل، گزارش یا مرورگر نمایش داده نمی‌شود.' : 'کلید ورود کنسول تنظیم نشده است؛ جلسه از ویترین فروشگاه و برنامهٔ واقعی ادامه می‌یابد.'}</p>
    </section>
    <section className="panel live-side">
      <div className="panel-heading"><h2><Radio size={16} /> گام‌های عامل</h2><span className="tag">{number(live?.steps.length ?? 0)} گام</span></div>
      <ol className="live-steps">{(live?.steps ?? []).map(step => <li key={step.id} className={step.state}><span className="live-step-icon">{step.state === 'done' ? <Check size={12} /> : step.state === 'failed' ? <X size={12} /> : <LoaderCircle size={12} className="spin" />}</span><div><b>{step.title}</b>{step.detail && <small>{step.detail}</small>}</div><time>{time(step.at)}</time></li>)}{(!live || live.steps.length === 0) && <li className="live-empty"><Terminal size={20} /><p>با شروع جلسه، مسیر واقعی مرورگر و تصمیم‌های عامل اینجا ثبت می‌شود.</p></li>}</ol>
      {incident && <div className={`live-incident ${incident.status === 'resolved' ? 'ok' : ''}`}><span className={`dot ${incident.status === 'resolved' ? 'ok' : incident.status === 'failed' ? 'bad' : 'warn'}`} /><div><b>{labels[incident.status]}</b><small>{incident.error ?? 'رخداد همین پروژه، متصل به جلسهٔ زنده'}</small></div>{incident.status === 'awaiting_approval' && <button className="btn btn-secondary" onClick={onOpenApproval}>بررسی و تأیید <ArrowLeft size={13} /></button>}{incident.status === 'resolved' && <button className="btn btn-secondary" onClick={onOpenApproval}>مشاهدهٔ گزارش <ArrowLeft size={13} /></button>}</div>}
      {live?.verified && <div className="alert success" role="status"><CheckCheck size={16} /><span>بررسی زنده: HTTP {live.verified.status} — پاسخ واقعی سرویس پس از انتشار ثبت شد.</span></div>}
    </section>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
