import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { readFile,writeFile,access } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Core,failingInput } from './core.ts';
import { LiveOperator } from './live.ts';
import { id,equals,messageOf } from './security.ts';
import { claimOwner } from './owner.ts';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
export async function createServer(options:{root?:string;data?:string;core?:Core;port?:number}={}){
  const app=Fastify({logger:false,bodyLimit:40000});
  const directory=options.root??root;
  const core=options.core??new Core(directory,options.data);await core.initialize(!options.core);
  const port=options.port??Number(process.env.PORT||4317);
  const origin=`http://127.0.0.1:${port}`;
  core.localOrigin=origin;
  const live=new LiveOperator(core,()=>core.localOrigin??origin);
  app.addHook('onClose',async()=>{await live.stop();});
  let liveStreams=0;
  const sessions=new Map<string,{csrf:string;expires:number}>();
  const capability=async(name:string)=>{const path=join(core.data,name);try{return (await readFile(path,'utf8')).trim();}catch{const key=id('cap')+id('secret');await writeFile(path,key,{mode:0o600});return key;}};
  const humanKey=await capability('human-key'),toolKey=await capability('mcp-key');
  const sessionOf=(request:any)=>{const cookies=String(request.headers.cookie??'').split(';').map((s:string)=>s.trim());const value=cookies.find((s:string)=>s.startsWith('negahban='))?.slice(9);const session=value?sessions.get(value):undefined;return session&&session.expires>Date.now()?session:undefined;};
  const isTool=(request:any)=>equals(String(request.headers.authorization??''),`Bearer ${toolKey}`);
  app.addHook('onRequest',async(request,reply)=>{
    const host=request.headers.host;
    if(host!==`127.0.0.1:${port}`)return reply.code(403).send({error:'Host مجاز نیست؛ از نشانی 127.0.0.1 استفاده کنید.'});
    reply.header('X-Content-Type-Options','nosniff').header('X-Frame-Options','DENY').header('Referrer-Policy','no-referrer').header('Cache-Control','no-store');
    if(!request.url.startsWith('/demo'))reply.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    if(!['GET','HEAD'].includes(request.method)&&request.headers.origin!==origin&&!isTool(request))return reply.code(403).send({error:'مبدأ درخواست معتبر نیست.'});
    if(request.url.startsWith('/api/')&&!['/api/session','/api/health'].includes(request.url.split('?')[0])){
      const session=sessionOf(request);
      if(!session&&!isTool(request))return reply.code(401).send({error:'برای ادامه، نشست خصوصی داشبورد را باز کنید.'});
      if(!['GET','HEAD'].includes(request.method)&&!isTool(request)&&!equals(String(request.headers['x-csrf-token']??''),session!.csrf))return reply.code(403).send({error:'تأیید نشست معتبر نیست.'});
    }
  });
  app.setErrorHandler((error,request,reply)=>{
    const err=error as {statusCode?:number;code?:string};
    const status=error instanceof z.ZodError?400:(typeof err.statusCode==='number'&&err.statusCode>=400&&err.statusCode<600?err.statusCode:400);
    const message=err.code==='FST_ERR_CTP_BODY_TOO_LARGE'?'حجم درخواست بیش از حد مجاز است.':err.code==='FST_ERR_CTP_INVALID_JSON_BODY'?'بدنهٔ درخواست JSON معتبر نیست.':err.code==='FST_ERR_CTP_INVALID_MEDIA_TYPE'?'نوع محتوای درخواست پشتیبانی نمی‌شود.':messageOf(error);
    return reply.code(status).send({error:message});
  });
  app.get('/api/health',async()=>({ok:true,service:'negahban'}));
  app.post('/api/session',async(request,reply)=>{
    const input=z.object({key:z.string().min(10).max(200)}).parse(request.body);
    if(!equals(input.key,humanKey))return reply.code(403).send({error:'کلید ورود معتبر نیست.'});
    const token=id('session'),csrf=id('csrf');sessions.set(token,{csrf,expires:Date.now()+8*3600_000});
    reply.header('Set-Cookie',`negahban=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
    return {csrf};
  });
  app.get('/api/session',async(request,reply)=>{const s=sessionOf(request);return s?{csrf:s.csrf}:reply.code(401).send({error:'نشست خصوصی لازم است.'});});
  app.get('/api/state',async()=>{const state=core.state();return {...state,capabilities:{...state.capabilities,liveConsole:Boolean(process.env.LIARA_CONSOLE_EMAIL&&process.env.LIARA_CONSOLE_PASSWORD)}};});
  app.get('/api/live/state',async()=>({live:live.snapshot(),configured:{console:Boolean(process.env.LIARA_CONSOLE_EMAIL&&process.env.LIARA_CONSOLE_PASSWORD),browser:process.env.LIVE_CHROMIUM||'/usr/bin/chromium'}}));
  app.post('/api/live/start',async(request,reply)=>{
    const {projectId}=z.object({projectId:z.string()}).parse(request.body);
    const project=core.project(projectId);
    const snapshot=await live.start(projectId,{onReproduced:async()=>{
      const latest=core.state().incidents.find(run=>run.projectId===projectId);
      // Reuse only an incident that is still moving; a resolved or rejected one is history.
      if(latest&&['collecting','patching','testing','awaiting_approval','deploying','verifying'].includes(latest.status))return latest.id;
      const text='سایت باز می‌شود، اما خلاصهٔ سفارش خطای ۵۰۰ دارد. علت را پیدا کن و اصلاح را برای تأیید من آماده کن.';
      try{return (await core.startIncident(projectId,text)).id;}catch(error){core.store.event('live','failed',messageOf(error));return undefined;}
    }});
    return reply.code(202).send({live:snapshot});
  });
  app.post('/api/live/stop',async()=>({live:await live.stop()}));
  app.post('/api/live/verify',async()=>({live:await live.verify()}));
  app.get('/api/live/stream',async(request,reply)=>{
    if(!sessionOf(request))return reply.code(401).send({error:'نشست خصوصی لازم است.'});
    if(liveStreams>=4)return reply.code(429).send({error:'تعداد نمایش زندهٔ هم‌زمان بیش از حد است.'});
    reply.hijack();liveStreams++;
    reply.raw.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','connection':'keep-alive','X-Content-Type-Options':'nosniff'});
    reply.raw.write(': live\n\n');
    const send=(event:string,payload:unknown)=>reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    const unsubscribe=live.subscribe(send);
    const heartbeat=setInterval(()=>reply.raw.write(': heartbeat\n\n'),12000);
    request.raw.on('close',()=>{clearInterval(heartbeat);unsubscribe();liveStreams--;});
  });
  app.get('/api/live/mjpeg',async(request,reply)=>{
    // Native multipart frames keep the viewer stable; the browser replaces one image instead of decoding a new data URL per frame.
    if(!sessionOf(request))return reply.code(401).send({error:'نشست خصوصی لازم است.'});
    if(liveStreams>=4)return reply.code(429).send({error:'تعداد نمایش زندهٔ هم‌زمان بیش از حد است.'});
    reply.hijack();liveStreams++;let closed=false;
    reply.raw.writeHead(200,{'content-type':'multipart/x-mixed-replace; boundary=frame','cache-control':'no-store','connection':'close','X-Content-Type-Options':'nosniff'});
    const write=(jpeg:Buffer)=>{if(closed||reply.raw.writableEnded)return;try{reply.raw.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);reply.raw.write(jpeg);reply.raw.write('\r\n');}catch{closed=true;}};
    const unsubscribe=live.subscribeFrames(write);
    request.raw.on('close',()=>{if(closed)return;closed=true;unsubscribe();liveStreams--;});
  });
  app.post('/api/diagnostics',async request=>core.collect(z.object({projectId:z.string()}).parse(request.body).projectId));
  app.post('/api/incidents',async(request,reply)=>{const input=z.object({projectId:z.string(),request:z.string().min(5).max(2000)}).parse(request.body);return reply.code(202).send(await core.startIncident(input.projectId,input.request));});
  app.post('/api/incidents/:id/verify',async(request,reply)=>{const {id:runId}=z.object({id:z.string()}).parse(request.params);core.track(core.reverify(runId).catch(()=>{}));return reply.code(202).send({runId,status:'verifying'});});
  app.post('/api/actions/prepare',async request=>{
    const input=z.object({projectId:z.string(),kind:z.enum(['deploy','restart','reset','rollback']),actionId:z.string().optional()}).parse(request.body);
    return input.kind==='reset'?core.resetProposal(input.projectId):input.kind==='rollback'?core.rollbackProposal(input.actionId!):core.prepareAction(input.projectId,input.kind);
  });
  app.post('/api/actions/:id/decision',async(request,reply)=>{
    // A tool capability never authorizes a human decision, even with a forged Origin.
    if(isTool(request)||!sessionOf(request))return reply.code(403).send({error:'تأیید فقط از نشست انسانی خصوصی پذیرفته می‌شود.'});
    const params=z.object({id:z.string()}).parse(request.params),body=z.object({decision:z.enum(['approve','reject'])}).parse(request.body);
    const action=core.decide(params.id,body.decision);
    if(body.decision==='approve')core.track(core.execute(action.id).catch(()=>{}));
    return {actionId:action.id,status:action.status};
  });
  app.post('/api/tools',async(request,reply)=>{
    if(!isTool(request))return reply.code(403).send({error:'دسترسی ابزار لازم است.'});
    const input=z.object({name:z.enum(['projects','diagnostics','incident_start','action_prepare','action_execute','report']),args:z.record(z.string(),z.unknown()).default({})}).parse(request.body);
    const a=input.args;
    if(input.name==='projects')return {projects:core.state().projects,scope:'registered-node-demo'};
    if(input.name==='diagnostics')return core.collect(z.string().parse(a.projectId));
    if(input.name==='incident_start')return core.startIncident(z.string().parse(a.projectId),z.string().min(5).max(2000).parse(a.request));
    if(input.name==='action_prepare')return core.prepareAction(z.string().parse(a.projectId),z.enum(['deploy','restart']).parse(a.kind));
    if(input.name==='action_execute')return core.execute(z.string().parse(a.actionId));
    return core.incident(z.string().parse(a.runId));
  });
  app.get('/api/reports/:id',async(request,reply)=>{const {id:runId}=z.object({id:z.string()}).parse(request.params);const run=core.incident(runId);reply.header('Content-Disposition',`attachment; filename="incident-${runId}.json"`);return {version:1,generatedAt:new Date().toISOString(),project:core.project(run.projectId),incident:run,action:run.actionId?core.action(run.actionId):null,events:core.store.events().filter(e=>e.runId===runId)};});
  let connections=0;
  app.get('/api/events',async(request,reply)=>{
    // Event streaming is a dashboard capability; a tool bearer must not consume the human UI's slots.
    if(!sessionOf(request))return reply.code(401).send({error:'نشست خصوصی لازم است.'});
    if(connections>=12)return reply.code(429).send({error:'تعداد اتصال‌های زنده بیش از حد است.'});
    reply.hijack();reply.raw.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','connection':'keep-alive','X-Content-Type-Options':'nosniff'});connections++;
    // Flush headers immediately; otherwise a quiet stream sends nothing until the 12s heartbeat.
    reply.raw.write(': connected\n\n');
    let last=Number(request.headers['last-event-id']||0);if(!Number.isFinite(last))last=0;
    const tick=()=>{const events=core.store.events(last);for(const e of events){reply.raw.write(`id: ${e.id}\nevent: update\ndata: ${JSON.stringify(e)}\n\n`);last=e.id;}};
    tick();const timer=setInterval(tick,700);const heartbeat=setInterval(()=>reply.raw.write(': heartbeat\n\n'),12000);
    request.raw.on('close',()=>{clearInterval(timer);clearInterval(heartbeat);connections--;});
  });
  app.get('/demo/healthz',async request=>{
    const {target}=z.object({target:z.enum(['local','liara']).optional()}).parse(request.query);
    if(target==='liara'){const p=core.project('liara');const r=await fetch(`${core.liara.appUrl(p.name)}/healthz`,{signal:AbortSignal.timeout(10000),redirect:'error'});return {status:r.status,body:await r.json(),scope:'live-liara'};}
    return {status:'ok',scope:'local-demo'};
  });
  app.get('/demo',async(request,reply)=>reply.type('text/html').send(`<!doctype html><html lang="fa" dir="rtl"><meta charset="UTF-8"><title>فروشگاه نمونه</title><style>body{font-family:Tahoma;background:#10191d;color:#eef5f1;max-width:720px;margin:80px auto;padding:24px}button{padding:14px;background:#99dfc7;border:0;border-radius:8px;cursor:pointer}pre{direction:ltr;white-space:pre-wrap;padding:24px;background:#17282c;border-radius:12px}a{color:#99dfc7}</style><h1>فروشگاه نمونهٔ نگهبان</h1><p>منبع اجرا: <strong id="scope"></strong>. بررسی سلامت می‌تواند موفق باشد، درحالی‌که درخواست کاربردی خطا دارد.</p><button id="test">محاسبهٔ خلاصهٔ سفارش بدون تخفیف</button><pre id="result">برای بررسی، دکمه را بزنید.</pre><a href="/demo/healthz">بررسی سلامت</a><script>document.querySelector('#scope').textContent=location.search.includes('target=liara')?'برنامهٔ واقعی روی لیارا':'اجرای محلی جدا';document.querySelector('a').href='/demo/healthz'+location.search;document.querySelector('#test').onclick=async()=>{const r=await fetch('/demo/api/summary'+location.search,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items:[{price:100,quantity:2}]})});document.querySelector('#result').textContent='HTTP '+r.status+String.fromCharCode(10)+JSON.stringify(await r.json(),null,2)}</script></html>`));
  app.post('/demo/api/summary',async(request,reply)=>{
    const {target}=z.object({target:z.enum(['local','liara']).optional()}).parse(request.query);
    // A missing body is a client error, not a server failure. This route is the rehearsal boundary.
    if(request.body===undefined)return reply.code(400).send({error:'INVALID_BODY'});
    const input=z.unknown().parse(request.body);
    if(target==='liara'){const result=await core.liara.summary(core.project('liara').name,input);return reply.code(result.status).send(result.body);}
    const p=core.project('local');const result=await core.runner.invoke(core.snapshots.path(p.currentSnapshot),input);
    return reply.code(result.status).send(result.body);
  });
  try{await access(join(directory,'dist/index.html'));await app.register(fastifyStatic,{root:join(directory,'dist'),wildcard:false});}
  catch{app.get('/',async(request,reply)=>reply.type('text/html').send('<p>Run npm run build, then restart the server.</p>'));}
  return {app,core,port,origin};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const release=await claimOwner(join(root,'.data'));
  let runtime:Awaited<ReturnType<typeof createServer>>;
  try{runtime=await createServer();await runtime.app.listen({port:runtime.port,host:'127.0.0.1'});}catch(error){await release();throw error;}
  const {app,origin}=runtime;
  console.log(`Negahban: ${origin}\nPrivate dashboard access: npm run access\nCredentials are never printed.`);
  for(const s of ['SIGINT','SIGTERM']as const)process.on(s,()=>void app.close().then(release).then(()=>process.exit(0)));
}
