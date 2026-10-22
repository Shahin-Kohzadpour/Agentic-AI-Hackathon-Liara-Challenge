import React,{useEffect,useState,useCallback} from 'react';
import { createRoot } from 'react-dom/client';
import { ShieldCheck,Activity,Layers,ArrowUpLeft,ChevronLeft,Check,CheckCheck,Clock3,Code2,FileText,ExternalLink,GitBranch,LoaderCircle,LockKeyhole,RefreshCw,Search,Server,Shield,Terminal,TriangleAlert,X,Download,Radio,ArrowLeft,Workflow,Cloud,FlaskConical,Link2,Send,Eye,MonitorPlay,Play,Square } from 'lucide-react';
import type { Project,Incident,ActionPlan,Evidence,RunEvent } from '../types.ts';
import type { LiveSnapshot } from '../live.ts';
import './style.css';

type State={projects:Project[];incidents:Incident[];actions:ActionPlan[];events:RunEvent[];capabilities:{liaraConfigured:boolean;teamConfigured:boolean;agent:string;scope:string;liveConsole?:boolean}};
const liveLabels:Record<string,string>={idle:'آمادهٔ شروع',running:'در حال اجرا',awaiting_fix:'در انتظار اصلاح',verifying:'بررسی زنده',verified:'بررسی زنده موفق',failed:'متوقف با خطا',stopped:'متوقف'};
const labels:Record<string,string>={collecting:'جمع‌آوری شواهد',patching:'آماده‌سازی اصلاح',testing:'آزمون مستقل',awaiting_approval:'منتظر تأیید شما',deploying:'انتشار نسخه',verifying:'بررسی نتیجه',resolved:'رفع خطا تأیید شد',failed:'نیازمند بررسی',rejected:'انتشار لغو شد'};
const number=(value:number)=>value.toLocaleString('fa-IR');
const time=(value:string)=>new Date(value).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'});

function App(){
  const [csrf,setCsrf]=useState(''),[auth,setAuth]=useState<'loading'|'ready'|'locked'>('loading');
  const [state,setState]=useState<State|null>(null),[projectId,setProjectId]=useState('local');
  const [request,setRequest]=useState('سایت باز می‌شود، اما خلاصهٔ سفارش خطای ۵۰۰ دارد. علت را پیدا کن و اصلاح را برای تأیید من آماده کن.');
  const [error,setError]=useState(''),[busy,setBusy]=useState(''),[view,setView]=useState('overview');
  const [evidence,setEvidence]=useState<Evidence[]|null>(null),[key,setKey]=useState('');
  const [connection,setConnection]=useState(true);
  const api=useCallback(async(path:string,body?:unknown)=>{
    const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json','x-csrf-token':csrf}:{},body:body?JSON.stringify(body):undefined});
    const result=await r.json();if(!r.ok)throw new Error(result.error||'دریافت نتیجه ناموفق بود.');return result;
  },[csrf]);
  const load=useCallback(async()=>{try{setState(await api('/api/state'));}catch(e){setError(String((e as Error).message));}},[api]);
  const login=async(token:string)=>{
    const r=await fetch('/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:token})});
    const body=await r.json();if(!r.ok)throw new Error(body.error);setCsrf(body.csrf);setAuth('ready');setKey('');
  };
  useEffect(()=>{void(async()=>{try{
    const fragment=new URLSearchParams(location.hash.slice(1)),token=fragment.get('key');
    if(token){history.replaceState(null,'',location.pathname);await login(token);}
    else{const r=await fetch('/api/session');if(!r.ok){setAuth('locked');return;}setCsrf((await r.json()).csrf);setAuth('ready');}
  }catch(e){setError((e as Error).message);setAuth('locked');}})();},[]);
  useEffect(()=>{if(auth!=='ready')return;void load();const source=new EventSource('/api/events');
    source.onopen=()=>setConnection(true);source.onerror=()=>setConnection(false);source.addEventListener('update',()=>void load());
    const interval=setInterval(()=>void load(),6000);return()=>{source.close();clearInterval(interval);};
  },[auth,load]);
  const act=async(name:string,fn:()=>Promise<unknown>)=>{setBusy(name);setError('');try{await fn();await load();}catch(e){setError((e as Error).message);}finally{setBusy('');}};
  const project=state?.projects.find(p=>p.id===projectId);
  const incident=state?.incidents.find(r=>r.projectId===projectId);
  const pending=state?.actions.filter(a=>a.projectId===projectId&&a.status==='pending')??[];
  const active=incident&&['collecting','patching','testing','deploying','verifying'].includes(incident.status);
  const events=state?.events.filter(e=>e.runId===incident?.id)??[];
  const allEvidence=evidence??incident?.evidence??[];
  const tests=incident?.verification??incident?.candidate;
  const healthy=incident?.status==='resolved';

  if(auth==='loading')return <div className="gate"><LoaderCircle className="spin"/><p>در حال بازیابی نشست خصوصی…</p></div>;
  if(auth==='locked')return <main className="gate"><div className="gate-card"><div className="brand-mark"><ShieldCheck size={30}/></div><span className="eyebrow">NEG_AHBAN / PRIVATE WORKSPACE</span><h1>فضای خصوصی نگهبان</h1><p>برای تأیید عملیات، لینک خصوصی نمایش‌داده‌شده در ترمینال را باز کنید. ابزارهای MCP به کلید این صفحه دسترسی ندارند.</p><code dir="ltr">npm run access</code><form onSubmit={e=>{e.preventDefault();void act('login',()=>login(key));}}><label htmlFor="key">یا کلید ورود محلی را وارد کنید</label><input id="key" type="password" value={key} onChange={e=>setKey(e.target.value)} autoComplete="off"/><button className="primary" disabled={!key||Boolean(busy)}>ورود به فضای کار <ArrowLeft size={17}/></button></form>{error&&<p role="alert" className="error-text">{error}</p>}</div></main>;
  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="نگهبان"><div className="brand-mark"><ShieldCheck size={27}/></div><div><b>نگهبان<span className="brand-dot">.</span></b><small>همکار استقرار و بازیابی</small></div></a>
      <div className="workspace-label">فضای کار <span className="tiny-tag">MVP</span></div>
      <nav>
        {[['overview','اتاق عملیات',Activity],['live','اتاق زنده',MonitorPlay],['evidence','شواهد و تشخیص',Search],['report','گزارش بازیابی',FileText]].map(([name,label,Icon])=>{const Component=Icon as typeof Activity;return <button key={String(name)} className={view===name?'nav active':'nav'} onClick={()=>setView(String(name))}><Component size={19}/>{String(label)}{view===name&&<ChevronLeft size={15}/>}</button>;})}
      </nav>
      <div className="sidebar-divider"/>
      <div className="workspace-label">پروژه‌های ثبت‌شده <span>{number(state?.projects.length??0)}</span></div>
      <div className="project-list">{state?.projects.map(p=><button key={p.id} className={projectId===p.id?'project selected':'project'} onClick={()=>{setProjectId(p.id);setEvidence(null);setView('overview');}}><span className="project-icon">{p.mode==='liara'?<Cloud size={17}/>:<FlaskConical size={17}/>}</span><span><b dir="ltr">{p.name}</b><small>{p.mode==='liara'?'اجرای واقعی روی لیارا':'تمرین محلی و جدا'}</small></span>{projectId===p.id&&<span className="dot mint"/>}</button>)}</div>
      <div className="sidebar-note"><LockKeyhole size={18}/><p>شما تصمیم می‌گیرید.<br/><span>تغییر سرویس، فقط با تأیید شما.</span></p></div>
      <div className="sidebar-bottom"><div className="connection"><span className={`dot ${connection?'mint':'amber'}`}/>{connection?'جریان رویدادها متصل است':'در حال اتصال دوباره'}</div><a href="https://developers.liara.ir/" target="_blank" rel="noreferrer">مستندات رسمی لیارا <ExternalLink size={13}/></a><div className="edition">BUILT FOR LIARA HACKATHON <span>01</span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><Layers size={16}/><span>فضای کار</span><ChevronLeft size={13}/><b>{project?.mode==='liara'?'تیم لیارا':'محیط تمرین'}</b></div><div className="topbar-right"><span className="small-pill"><Shield size={13}/> تأیید انسانی فعال</span><span className="avatar">ن</span></div></header>
      <main className="content">
        <div className="page-heading"><div><div className="eyebrow">DEPLOY. DIAGNOSE. RECOVER.</div><h1>{view==='evidence'?'هر تشخیص، با یک شاهد.':view==='live'?'عامل، همین حالا در حال کار است.':view==='report'?'بازیابی، با نتیجهٔ قابل‌بررسی.':'از خطا تا اطمینان.'}</h1><p>{view==='live'?'مرورگر واقعی عامل را ببینید: ورود به کنسول لیارا، بازتولید خطا، انتشار اصلاح و بررسی دوباره.' :'انتشار، تشخیص و اصلاح؛ در یک جریان روشن و با کنترل شما.'}</p></div><a className="secondary demo-link" href={project?.mode==='liara'?'/demo?target=liara':'/demo'} target="_blank" rel="noreferrer">مشاهدهٔ برنامه <ArrowUpLeft size={17}/></a></div>
        {error&&<div className="alert error" role="alert"><TriangleAlert size={18}/><span>{error}</span><button aria-label="بستن خطا" onClick={()=>setError('')}><X size={17}/></button></div>}
        <div className={`environment-banner ${project?.mode==='liara'?'live':''}`}><span className="env-icon">{project?.mode==='liara'?<Cloud size={19}/>:<FlaskConical size={19}/>}</span><div><b>{project?.mode==='liara'?'پروژهٔ واقعی لیارا':'تمرین محلی؛ با اجرای واقعی کد'}</b><span>{project?.mode==='liara'?'عملیات این پروژه سرویس ابری را تغییر می‌دهد و به تأیید نیاز دارد.':'این اجرا منابع ابری را تغییر نمی‌دهد. شواهد، آزمون و اصلاح در محیط جدا اجرا می‌شوند.'}</span></div><span className="mode-label">{project?.mode==='liara'?'LIVE / LIARA':'LOCAL / ISOLATED'}</span></div>
        <section className="stats">
          <div className="stat"><span className={`stat-icon ${healthy?'good':'neutral'}`}><Activity size={20}/></span><div><span className="stat-label">وضعیت آخرین بررسی</span><b className={healthy?'good-text':''}>{incident?labels[incident.status]:'آمادهٔ بررسی'}</b><small>{healthy?'درخواست کاربردی دوباره تأیید شد':'سلامت فرایند، به‌تنهایی معیار موفقیت نیست'}</small></div></div>
          <div className="stat"><span className="stat-icon neutral"><CheckCheck size={20}/></span><div><span className="stat-label">آزمون‌های مستقل</span><b>{tests?<><span className={tests.passed?'good-text':'warning-text'}>{number(tests.checks.filter(c=>c.passed).length)}</span><span className="stat-of"> / {number(tests.checks.length)}</span></>:'هنوز اجرا نشده'}</b><small>{tests?'نتیجهٔ واقعی آزمون‌های قرارداد پاسخ':'شامل ورودی‌های معتبر و نامعتبر'}</small></div></div>
          <div className="stat"><span className="stat-icon neutral"><GitBranch size={20}/></span><div><span className="stat-label">نسخهٔ ثبت‌شدهٔ پروژه</span><b className="mono" dir="ltr">{project?.remoteRelease?project.remoteRelease.slice(-12):`revision ${project?.revision??'—'}`}</b><small>تطبیق منبع با نسخه، پیش از انتشار</small></div></div>
        </section>

        {view==='live'&&<LiveRoom project={project} incident={incident} csrf={csrf} consoleConfigured={state?.capabilities.liveConsole} onOpenApproval={()=>setView('overview')}/>}

        {view==='overview'&&<>
          <section className="request-card"><div className="section-top"><div className="section-title"><span className="icon-circle"><Workflow size={20}/></span><div><h2>چه مشکلی پیش آمده؟</h2><p>مسئله را توضیح دهید؛ بررسی و آماده‌سازی اصلاح با نگهبان.</p></div></div><span className="tag"><span className="dot mint"/> اصلاح با Codex</span></div><label className="sr-only" htmlFor="request">شرح مشکل</label><textarea id="request" value={request} onChange={e=>setRequest(e.target.value)} rows={2}/><div className="request-bottom"><span><LockKeyhole size={14}/> بررسی و آماده‌سازی، بدون تغییر سرویس</span><button className="primary" disabled={Boolean(busy)||Boolean(active)||request.length<5} onClick={()=>void act('investigate',()=>api('/api/incidents',{projectId,request}))}>{active?<LoaderCircle size={17} className="spin"/>:<Search size={17}/>} {active?'در حال بررسی رخداد':'بررسی و آماده‌سازی اصلاح'} <ArrowLeft size={16}/></button></div></section>
          <div className="work-grid"><section className="panel timeline-panel"><div className="panel-heading"><h2><Radio size={18}/> جریان رفع رخداد</h2>{incident&&<span className={`tag ${healthy?'success-tag':''}`}>{labels[incident.status]}</span>}</div><Timeline incident={incident}/>{events.length>0?<div className="event-list">{events.slice(-5).map(event=><div className="event" key={event.id}><span className={`event-dot ${event.status==='failed'?'red':''}`}/><p>{event.message}</p><time>{time(event.at)}</time></div>)}</div>:<div className="empty-timeline"><Terminal size={23}/><p>با ثبت درخواست، شواهد و گام‌های واقعی اجرا اینجا ظاهر می‌شوند.</p></div>}</section>
            <section className="panel review-panel"><div className="panel-heading"><h2><ShieldCheck size={18}/> تصمیم با شماست</h2><LockKeyhole size={16}/></div>{pending.length>0?pending.map(action=><Approval key={action.id} action={action} busy={busy} onDecide={decision=>void act(action.id,()=>api(`/api/actions/${action.id}/decision`,{decision}))}/>):<div className="approval-empty"><div className="approval-symbol"><ShieldCheck size={34}/></div><h3>{healthy?'اصلاح منتشر شد و بررسی شد':'هنوز تغییری منتظر تأیید نیست'}</h3><p>{healthy?'شواهد، نسخه و نتیجهٔ بررسی در گزارش بازیابی ثبت شده‌اند.':'بعد از بررسی و آزمون، پیشنهاد دقیق تغییر همراه با اثر و نتیجهٔ آزمون نمایش داده می‌شود.'}</p>{healthy&&<button className="secondary" onClick={()=>setView('report')}>مشاهدهٔ گزارش <ArrowLeft size={15}/></button>}</div>}</section>
          </div>
          {incident?.diagnosis&&<section className="panel diagnosis"><div className="panel-heading"><h2><Search size={18}/> یافتهٔ بررسی</h2><span className="tag">{incident.candidate?.passed?'تأیید با بازتولید و آزمون':'اصلاح هنوز تأیید نشده'}</span></div><p>{incident.diagnosis}</p><div className="change-note"><Code2 size={17}/><span>{incident.change}</span></div>{incident.diff&&<details><summary>مشاهدهٔ تغییر پیشنهادی <Code2 size={15}/></summary><Diff value={incident.diff}/></details>}</section>}
          <div className="bottom-grid"><section className="panel"><div className="panel-heading"><h2><Layers size={18}/> شواهد در دسترس</h2><button className="text-button" onClick={()=>setView('evidence')}>مشاهدهٔ همه <ArrowLeft size={14}/></button></div><EvidenceList items={allEvidence.slice(0,3)}/></section><section className="panel operations"><div className="panel-heading"><h2><Server size={18}/> عملیات پروژه</h2><span className="tag">نیازمند تأیید</span></div><p>ابتدا پیشنهاد ساخته می‌شود؛ اجرای آن به تصمیم شما وابسته است.</p><button className="operation" disabled={Boolean(busy)||Boolean(active)} onClick={()=>void act('prepare',()=>api('/api/actions/prepare',{projectId,kind:'reset'}))}><Code2 size={17}/><div><b>آماده‌سازی نسخهٔ نمونه</b><small>شروع یا تکرار سناریوی خطای عمدی</small></div><ChevronLeft size={17}/></button>{project?.mode==='liara'&&<button className="operation" disabled={Boolean(busy)||Boolean(active)} onClick={()=>void act('restart',()=>api('/api/actions/prepare',{projectId,kind:'restart'}))}><RefreshCw size={17}/><div><b>پیشنهاد ری‌استارت</b><small>بدون تغییر پلن یا سورس‌کد</small></div><ChevronLeft size={17}/></button>}</section></div>
        </>}

        {view==='evidence'&&<section className="panel evidence-page"><div className="panel-heading"><h2><Search size={19}/> شواهد پروژه</h2><button className="secondary" disabled={Boolean(busy)} onClick={()=>void act('evidence',async()=>setEvidence(await api('/api/diagnostics',{projectId})))}>{busy==='evidence'?<LoaderCircle className="spin" size={16}/>:<RefreshCw size={16}/>} دریافت تازه</button></div><p className="muted">زمان دریافت، منبع و محدودیت هر شاهد همراه آن ثبت می‌شود. دادهٔ منابع در تمرین محلی ساخته نمی‌شود.</p><EvidenceList items={allEvidence} expanded/></section>}
        {view==='report'&&<section className="panel report"><div className="panel-heading"><h2><FileText size={19}/> گزارش رفع رخداد</h2>{incident&&<a className="secondary" href={`/api/reports/${incident.id}`} download><Download size={16}/> دریافت JSON</a>}</div>{!incident?<div className="empty-timeline"><FileText size={28}/><p>پس از اولین بررسی، گزارش آن اینجا ثبت می‌شود.</p></div>:<><div className={`report-status ${healthy?'is-resolved':''}`}><span>{healthy?<CheckCheck size={30}/>:<Activity size={30}/>}</span><div><h3>{labels[incident.status]}</h3><p>{healthy?'رفع خطا با بررسی کاربردی تأیید شده است.':'این رخداد هنوز به‌عنوان رفع‌شده ثبت نشده است.'}</p></div>{incident.releaseId&&<button className="secondary" disabled={Boolean(busy)||Boolean(active)} onClick={()=>void act('reverify',()=>api(`/api/incidents/${incident.id}/verify`,{}))}><RefreshCw size={15}/> بررسی دوبارهٔ نتیجه</button>}</div><dl><div><dt>پروژه</dt><dd dir="ltr">{project?.name}</dd></div><div><dt>شناسهٔ رخداد</dt><dd dir="ltr">{incident.id}</dd></div><div><dt>نسخهٔ منتشرشده</dt><dd dir="ltr">{incident.releaseId??'هنوز منتشر نشده'}</dd></div><div><dt>درخواست</dt><dd>{incident.request}</dd></div><div><dt>تشخیص</dt><dd>{incident.diagnosis??'هنوز تکمیل نشده'}</dd></div><div><dt>تغییر</dt><dd>{incident.change??'اصلاحی ثبت نشده'}</dd></div></dl>{incident.verification&&<div className="verification-table"><h3>بررسی پس از انتشار</h3>{incident.verification.checks.map((check,i)=><div key={i}>{check.passed?<Check size={17}/>:<X size={17}/>}<span>{check.name}</span><b className={check.passed?'good-text':'warning-text'}>{check.passed?'موفق':'ناموفق'}</b></div>)}</div>}{incident.error&&<div className="alert error"><TriangleAlert size={17}/>{incident.error}</div>}{incident.diff&&<details><summary>تغییر سورس‌کد</summary><Diff value={incident.diff}/></details>}<div className="report-limit"><Eye size={18}/><p>محدودهٔ بررسی: برنامهٔ نمونهٔ Node.js و قرارداد خلاصهٔ سفارش. این نتیجه تضمین سلامت همهٔ مسیرها یا پایش دائمی سرویس نیست.</p></div></>}</section>}
        <footer className="footer"><span>نگهبان · همکار فنی، با اختیار محدود</span><span><LockKeyhole size={12}/> کلیدها وارد شواهد و پیام مدل نمی‌شوند</span></footer>
      </main>
    </div>
  </div>;
}

function Timeline({incident}:{incident?:Incident}){
 const stages=[['collecting','شواهد'],['patching','اصلاح کد'],['testing','آزمون'],['awaiting_approval','تأیید شما'],['resolved','بازیابی']];
 const order=['collecting','patching','testing','awaiting_approval','deploying','verifying','resolved'];
 const current=incident?order.indexOf(incident.status):-1;
 return <div className="timeline">{stages.map(([status,label],i)=>{const index=order.indexOf(status),done=current>index||(status==='resolved'&&current===6),active=incident?.status===status||(status==='resolved'&&['deploying','verifying'].includes(incident?.status??''));return <div key={status} className={`stage ${done?'done':''} ${active?'current':''}`}><div className="stage-circle">{done?<Check size={16}/>:active&&status!=='awaiting_approval'?<LoaderCircle size={16} className="spin"/>:status==='awaiting_approval'?<LockKeyhole size={14}/>:number(i+1)}</div><span>{label}</span></div>;})}</div>;
}
function Approval({action,busy,onDecide}:{action:ActionPlan;busy:string;onDecide:(decision:'approve'|'reject')=>void}){
 return <div className="approval"><div className="approval-label"><span className="dot amber"/> درخواست تأیید</div><h3>{action.title}</h3><p>{action.summary}</p><dl><div><dt>منبع</dt><dd className="mono">{action.digest.slice(0,12)}</dd></div><div><dt>اثر هزینه</dt><dd>{action.cost}</dd></div></dl><div className="risk"><TriangleAlert size={15}/><span>{action.risk}</span></div><div className="approval-buttons"><button className="primary" disabled={Boolean(busy)} onClick={()=>onDecide('approve')}>{busy===action.id?<LoaderCircle className="spin" size={16}/>:<Check size={16}/>} تأیید و اجرا</button><button className="secondary" disabled={Boolean(busy)} onClick={()=>onDecide('reject')}>انصراف</button></div><small className="approval-expiry"><Clock3 size={12}/> معتبر تا {time(action.expiresAt)} · مجوز یک‌بارمصرف</small></div>;
}
function Diff({value}:{value:string}){return <pre className="diff" dir="ltr">{value.split('\n').map((line,i)=><span key={i} className={line.startsWith('+')?'added':line.startsWith('-')?'removed':''}>{line||' '}<br/></span>)}</pre>;}
function EvidenceList({items,expanded=false}:{items:Evidence[];expanded?:boolean}){return items.length?<div className="evidence-list">{items.map(e=><details key={e.id} className="evidence-item"><summary><span className={e.available?'evidence-icon available':'evidence-icon'}>{e.available?<FileText size={16}/>:<Clock3 size={16}/>}</span><span><b>{e.title}</b><small>{e.available?'شاهد ثبت‌شده':'داده در دسترس نیست'} · {time(e.observedAt)}</small></span><ChevronLeft size={15}/></summary>{e.limitation&&<p>{e.limitation}</p>}<pre dir="ltr">{JSON.stringify(e.data,null,2)}</pre></details>)}</div>:<div className="evidence-empty"><Layers size={23}/><p>پس از بررسی، شواهد واقعی اینجا نمایش داده می‌شوند.</p></div>;}

function LiveRoom({project,incident,csrf,consoleConfigured,onOpenApproval}:{project?:Project;incident?:Incident;csrf:string;consoleConfigured?:boolean;onOpenApproval:()=>void}){
  const [live,setLive]=useState<LiveSnapshot|null>(null),[streaming,setStreaming]=useState(false);
  const [connected,setConnected]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState('');
  const load=useCallback(async()=>{try{const r=await fetch('/api/live/state');if(r.ok)setLive((await r.json()).live);}catch{}} ,[]);
  useEffect(()=>{void load();
    const source=new EventSource('/api/live/stream');
    source.onopen=()=>setConnected(true);source.onerror=()=>setConnected(false);
    const onState=(event:Event)=>{try{setLive(JSON.parse((event as MessageEvent).data));}catch{}};
    source.addEventListener('state',onState);
    return ()=>{source.removeEventListener('state',onState);source.close();};
  },[load]);
  // A page reload during an existing session should reconnect to the native frame stream.
  useEffect(()=>{if(live&&['running','awaiting_fix','verifying','verified'].includes(live.status))setStreaming(true);},[live?.status]);
  const call=async(path:string,body?:unknown)=>{setBusy(path);setError('');
    if(path==='/api/live/start')setStreaming(true);
    try{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(body??{})});const result=await r.json();if(!r.ok)throw new Error(result.error||'عملیات ناموفق بود.');if(result.live)setLive(result.live);}
    catch(e){setError((e as Error).message);}finally{setBusy('');}
  };
  const running=['running','awaiting_fix','verifying'].includes(live?.status??'');
  const canVerify=streaming&&!running&&(incident?.status==='resolved'||live?.status==='verified');
  return <div className="live-grid">
    <section className="panel live-panel">
      <div className="panel-heading"><h2><MonitorPlay size={19}/> پنجرهٔ زندهٔ عامل</h2>      <div className="live-tags"><span className="tag"><span className={`dot ${connected?'mint':'amber'}`}/>{connected?'جریان رویداد متصل':'در حال اتصال'}</span><span className={`tag ${live?.status==='verified'?'success-tag':''}`}>{liveLabels[live?.status??'idle']}</span></div></div>
      <div className="live-stage">{streaming?<img src="/api/live/mjpeg" alt="نمای زندهٔ مرورگر عامل" />:<div className="live-placeholder"><MonitorPlay size={40}/><p>با شروع جلسه، مرورگر واقعی عامل روی کنسول لیارا و ویترین فروشگاه اینجا پخش می‌شود.</p><small>پخش تصویر فقط روی همین نشست خصوصی و ۱۲۷٫۰٫۰٫۱ انجام می‌شود.</small></div>}<div className="live-overlay"><span className="live-rec"><i/>LIVE VIEW</span></div></div>
      <div className="live-address"><LockKeyhole size={13}/><span dir="ltr">{live?.currentUrl??live?.appUrl??'—'}</span></div>
      <div className="live-controls">
        <button className="primary" disabled={!project||running||Boolean(busy)} onClick={()=>void call('/api/live/start',{projectId:project?.id})}>{busy==='/api/live/start'?<LoaderCircle size={16} className="spin"/>:<Play size={16}/>} شروع جلسهٔ زنده</button>
        <button className="secondary" disabled={!streaming||Boolean(busy)} onClick={()=>void call('/api/live/stop')}>{busy==='/api/live/stop'?<LoaderCircle size={16} className="spin"/>:<Square size={15}/>} توقف</button>
        {canVerify&&<button className="secondary" disabled={Boolean(busy)||live?.status==='verifying'} onClick={()=>void call('/api/live/verify')}>{busy==='/api/live/verify'||live?.status==='verifying'?<LoaderCircle size={16} className="spin"/>:<RefreshCw size={16}/>} بررسی زندهٔ نتیجه</button>}
      </div>
      {error&&<p role="alert" className="live-error"><TriangleAlert size={15}/>{error}</p>}
      <p className="live-note"><Shield size={14}/>{consoleConfigured?'ورود به کنسول با اعتبارنامهٔ محلی .env انجام می‌شود و هرگز به مدل، گزارش یا مرورگر نمایش داده نمی‌شود.':'کلید ورود کنسول تنظیم نشده است؛ جلسه از ویترین فروشگاه و برنامهٔ واقعی ادامه می‌یابد.'}</p>
    </section>
    <section className="panel live-side">
      <div className="panel-heading"><h2><Radio size={18}/> گام‌های عامل</h2><span className="tag">{number(live?.steps.length??0)} گام</span></div>
      <ol className="live-steps">{(live?.steps??[]).map(step=><li key={step.id} className={step.state}><span className="live-step-icon">{step.state==='done'?<Check size={14}/>:step.state==='failed'?<X size={14}/>:<LoaderCircle size={14} className="spin"/>}</span><div><b>{step.title}</b>{step.detail&&<small>{step.detail}</small>}</div><time>{time(step.at)}</time></li>)}{(!live||live.steps.length===0)&&<li className="live-empty"><Terminal size={22}/><p>با شروع جلسه، مسیر واقعی مرورگر و تصمیم‌های عامل اینجا ثبت می‌شود.</p></li>}</ol>
      {incident&&<div className={`live-incident ${incident.status==='resolved'?'ok':''}`}><span className={`dot ${incident.status==='resolved'?'mint':incident.status==='failed'?'amber':'mint'}`}/><div><b>{labels[incident.status]}</b><small>{incident.error??'رخداد همین پروژه، متصل به جلسهٔ زنده'}</small></div>{incident.status==='awaiting_approval'&&<button className="secondary" onClick={onOpenApproval}>بررسی و تأیید <ArrowLeft size={14}/></button>}{incident.status==='resolved'&&<button className="secondary" onClick={onOpenApproval}>گزارش بازیابی <ArrowLeft size={14}/></button>}</div>}
      {live?.verified&&<div className="alert success" role="status"><CheckCheck size={17}/><span>بررسی زنده: HTTP {live.verified.status} — پاسخ واقعی سرویس پس از انتشار ثبت شد.</span></div>}
    </section>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
