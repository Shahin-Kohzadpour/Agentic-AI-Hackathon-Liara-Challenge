import { join } from 'node:path';
import { createPatch } from 'diff';
import { Store } from './store.ts';
import { Snapshots } from './snapshots.ts';
import { IsolatedRunner } from './runner.ts';
import { Liara } from './liara.ts';
import { CodexRepairAgent,type RepairAgent } from './agent.ts';
import { validateCandidate } from './candidate.ts';
import { id,messageOf,redact } from './security.ts';
import type { ActionPlan,Evidence,Incident,Project,RunStatus,Verification } from './types.ts';

export const failingInput={items:[{price:100,quantity:2}]};
export class Core {
  localOrigin?:string;
  // Edge routing can keep serving the previous release after READY for tens of seconds;
  // a short window would mark a correct repair as failed. Two consecutive successes are required.
  verificationPolicy={attempts:45,delayMs:2000,successes:2};
  readonly store:Store; readonly snapshots:Snapshots;readonly runner:IsolatedRunner;readonly liara:Liara;
  private agent:RepairAgent; private jobs=new Set<Promise<unknown>>();
  constructor(readonly root:string,readonly data=join(root,'.data'),agent?:RepairAgent){
    this.store=new Store(data);this.snapshots=new Snapshots(join(data,'snapshots'),this.store);this.runner=new IsolatedRunner(root);this.liara=new Liara(root);this.agent=agent??new CodexRepairAgent(root);
  }
  async initialize(recoverInterrupted=false){
    let seed=this.store.get<Project>('projects','local');
    if(!seed){const snapshot=await this.snapshots.seed(join(this.root,'fixtures','shop'));seed={id:'local',name:'demo-shop',mode:'local',currentSnapshot:snapshot.id,revision:1};this.store.put('projects',seed);}
    if(process.env.LIARA_PROJECT&&!this.store.get('projects','liara'))this.store.put('projects',{id:'liara',name:process.env.LIARA_PROJECT,mode:'liara',currentSnapshot:seed.currentSnapshot,revision:0});
    if(!recoverInterrupted)return;
    // Only the owning server startup recovers interrupted work; helper processes must not clear live locks.
    this.store.db.exec('DELETE FROM locks');
    for(const run of this.store.list<Incident>('incidents'))if(['collecting','patching','testing','deploying','verifying'].includes(run.status)){
      run.status='failed';run.error='سرویس هنگام اجرای عملیات متوقف شده است. وضعیت خارجی پیش از هر تکرار باید بررسی شود.';this.save(run);
    }
    for(const a of this.store.list<ActionPlan>('actions'))if(a.status==='executing'){
      a.status='failed';a.error='نتیجهٔ عملیات هنگام راه‌اندازی مجدد نامشخص بود؛ بررسی وضعیت خارجی لازم است.';this.store.put('actions',a);
    }
  }
  project(projectId:string){const p=this.store.get<Project>('projects',projectId);if(!p)throw new Error('پروژه پیدا نشد.');return p;}
  incident(runId:string){const r=this.store.get<Incident>('incidents',runId);if(!r)throw new Error('رخداد پیدا نشد.');return r;}
  action(actionId:string){const a=this.store.get<ActionPlan>('actions',actionId);if(!a)throw new Error('برنامهٔ عملیات پیدا نشد.');return a;}
  save(run:Incident){run.updatedAt=new Date().toISOString();this.store.put('incidents',run);}
  state(){return {projects:this.store.list<Project>('projects'),incidents:this.store.list<Incident>('incidents'),actions:this.store.list<ActionPlan>('actions'),events:this.store.recentEvents(),capabilities:{liaraConfigured:this.liara.configured(),teamConfigured:Boolean(process.env.LIARA_TEAM_ID),agent:'Codex',scope:'registered-node-demo',api:'https://developers.liara.ir/',localIsolation:'bubblewrap: no network, read-only source, no credentials'}};}
  event(run:Incident,status:RunStatus,message:string){run.status=status;this.save(run);this.store.event(run.id,status,message);}
  track(job:Promise<unknown>){this.jobs.add(job);void job.finally(()=>this.jobs.delete(job)).catch(()=>{});}
  async settle(){await Promise.allSettled([...this.jobs]);}
  async collect(projectId:string):Promise<Evidence[]>{
    const p=this.project(projectId);
    if(p.mode==='liara'){
      const evidence=await this.liara.collect(p.name);
      const http=await this.liara.verifyHttp(p.name);
      return [...evidence,{id:id('ev'),kind:'http',title:'درخواست‌های واقعی به برنامهٔ منتشرشده',observedAt:new Date().toISOString(),available:true,data:http}];
    }
    const result=await this.runner.invoke(this.snapshots.path(p.currentSnapshot),failingInput);
    let health:Evidence={id:id('ev'),kind:'health',title:'بررسی سلامت مستقل',observedAt:new Date().toISOString(),available:false,data:null,limitation:'در اجرای بدون سرور HTTP، سلامت شبکه مشاهده نشده است.'};
    if(this.localOrigin){try{const r=await fetch(`${this.localOrigin}/demo/healthz`,{signal:AbortSignal.timeout(5000)});health={...health,available:true,data:{status:r.status,body:await r.json()},limitation:undefined};}catch(e){health.limitation=messageOf(e);}}
    return [
      {id:id('ev'),kind:'http',title:'درخواست کاربردی خلاصهٔ سفارش',observedAt:new Date().toISOString(),available:true,data:{input:failingInput,status:result.status,body:result.body}},
      {id:id('ev'),kind:'logs',title:'لاگ واقعی اجرای محلی',observedAt:new Date().toISOString(),available:true,data:result.exception??'در این درخواست خطایی ثبت نشد.'},
      health,
      {id:id('ev'),kind:'source',title:'منبع مستقر در تمرین محلی',observedAt:new Date().toISOString(),available:true,data:{snapshot:p.currentSnapshot,digest:this.snapshots.get(p.currentSnapshot).digest,revision:p.revision}},
      {id:id('ev'),kind:'cpu',title:'منابع لیارا',observedAt:new Date().toISOString(),available:false,data:null,limitation:'این پروژه محلی است؛ دادهٔ منابع لیارا شبیه‌سازی نمی‌شود.'},
    ];
  }
  async startIncident(projectId:string,request:string){
    const p=this.project(projectId);if(p.mode==='liara'&&p.revision===0)throw new Error('ابتدا نسخهٔ نمونه را روی پروژهٔ لیارا منتشر کنید تا منبع اجرای زنده مشخص باشد.');
    const now=new Date().toISOString();
    const run:Incident={id:id('inc'),projectId,request:String(redact(request)),status:'collecting',createdAt:now,updatedAt:now,evidence:[]};
    this.store.lock(projectId,run.id);this.save(run);
    this.track(this.investigate(run));return run;
  }
  private async investigate(run:Incident){
    const p=this.project(run.projectId);
    try{
      this.event(run,'collecting','شواهد برنامه، نسخه و درخواست مسئله‌دار جمع‌آوری می‌شوند.');
      if(p.mode==='liara'){
        const current=await this.liara.currentRelease(p.name);
        if(current!==p.remoteRelease)throw new Error('نسخهٔ لیارا خارج از این جریان تغییر کرده است؛ تطبیق منبع دوباره لازم است.');
      }
      run.evidence=await this.collect(p.id);this.save(run);
      if(p.mode==='liara'){
        const live=run.evidence.find(e=>e.kind==='http')?.data as Verification|undefined;
        if(!live||(live.checks[0]?.actual as {status?:number})?.status!==500||!live.checks.slice(1).every(c=>c.passed))throw new Error('خطای زنده با سناریوی کد ثبت‌شده مطابقت ندارد. شواهد استقرار یا زیرساخت باید بررسی شوند؛ patch خودکار ساخته نمی‌شود.');
      }
      const source=await this.snapshots.assertIntact(p.currentSnapshot);
      run.baseline=await this.runner.verify(this.snapshots.path(source.id));this.save(run);
      if(run.baseline.passed)throw new Error('خطای نمونه در منبع فعلی بازتولید نشد. بدون شاهد patch تولید نمی‌شود.');
      this.event(run,'patching','خطا در محیط جدا بازتولید شد. Codex اصلاح محدود را آماده می‌کند.');
      let result=await this.agent.repair(source.files['summary.mjs'],run.request,run.evidence,run.baseline,message=>this.store.event(run.id,'patching',message));
      try{validateCandidate(result.sourceCode);}
      catch(validationError){
        // Model output is nondeterministic. One bounded retry with the exact validator error avoids
        // losing a valid incident to a legitimate construct the allowlist did not anticipate.
        this.store.event(run.id,'patching','اصلاح نخست با قرارداد تابع نمونه سازگار نبود؛ یک اصلاح محدود دوباره درخواست می‌شود.');
        const retryRequest=`${run.request}\n\nپاسخ قبلی توسط اعتبارسنج محافظت‌شده رد شد: ${messageOf(validationError)}\nیک ماژول کامل و اصلاح‌شده برگردان که فقط از تابع خالص نمونه و فراخوانی‌های مجاز استفاده می‌کند. قابلیت تازه‌ای اضافه نکن.`;
        result=await this.agent.repair(source.files['summary.mjs'],retryRequest,run.evidence,run.baseline,message=>this.store.event(run.id,'patching',message));
        validateCandidate(result.sourceCode);
      }
      run.diagnosis=result.diagnosis;run.change=result.change;run.threadId=result.threadId;
      run.diff=createPatch('summary.mjs',source.files['summary.mjs'],result.sourceCode,'نسخهٔ فعلی','اصلاح پیشنهادی');
      const snapshot=await this.snapshots.create({...source.files,'summary.mjs':result.sourceCode});
      this.event(run,'testing','اصلاح پیشنهادی با آزمون‌های مستقل و موارد نگه‌داشته‌شده بررسی می‌شود.');
      run.candidate=await this.runner.verify(this.snapshots.path(snapshot.id));this.save(run);
      if(!run.candidate.passed)throw new Error('اصلاح از آزمون‌های مستقل عبور نکرد؛ انتشار آماده نمی‌شود.');
      if(this.project(p.id).revision!==p.revision)throw new Error('نسخهٔ پایه هنگام بررسی تغییر کرده است.');
      const action=await this.prepareAction(p.id,'deploy',snapshot.id,run.id);
      run.actionId=action.id;this.event(run,'awaiting_approval','اصلاح آزموده‌شده آماده است. انتشار تنها پس از تأیید انسانی انجام می‌شود.');
    }catch(e){run.error=messageOf(e);this.event(run,'failed',run.error);}
    finally{this.store.unlock(p.id,run.id);}
  }
  async prepareAction(projectId:string,kind:ActionPlan['kind'],snapshotId?:string,runId?:string){
    const p=this.project(projectId),snapshot=await this.snapshots.assertIntact(snapshotId??p.currentSnapshot);
    if(kind==='env')throw new Error('ویرایش Env در این نسخه فعال نیست؛ از تغییر ناقص متغیرهای محرمانه جلوگیری می‌شود.');
    if(kind==='restart'&&p.mode==='local')throw new Error('ری‌استارت زیرساخت فقط برای پروژهٔ واقعی لیارا در دسترس است.');
    const now=new Date();
    const action:ActionPlan={id:id('act'),runId,projectId,kind,status:'pending',createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+30*60_000).toISOString(),baseRevision:p.revision,baseSnapshot:p.currentSnapshot,baseRelease:p.remoteRelease,snapshotId:snapshot.id,digest:snapshot.digest,
      title:kind==='restart'?'ری‌استارت برنامه':kind==='rollback'?'بازاستقرار منبع انتخاب‌شده':runId?'انتشار اصلاح آزموده‌شده':'انتشار برنامهٔ نمونه',
      summary:`${p.mode==='liara'?'لیارا':'محلی'} · ${p.name} · منبع ${snapshot.digest.slice(0,12)}`,
      risk:p.mode==='liara'?'این عملیات سرویس واقعی را تغییر می‌دهد و ممکن است وقفه داشته باشد. منبع قبلی نگهداری می‌شود؛ پیشنهاد بازگشت به آزمون سلامت و تأیید جداگانه نیاز دارد.':'فقط منبع تمرین محلی تغییر می‌کند؛ هزینه یا تغییر ابری ندارد.',
      cost:p.mode==='liara'?'پلن در این عملیات تغییر نمی‌کند؛ هزینهٔ سرویس فعلی لیارا ادامه دارد.':'بدون هزینهٔ زیرساخت ابری'};
    if(p.mode==='liara'){const remote=await this.liara.currentRelease(p.name);if(p.revision>0&&remote!==p.remoteRelease)throw new Error('نسخهٔ زنده با نسخهٔ ثبت‌شده یکسان نیست.');action.baseRelease=remote;}
    this.store.put('actions',action);return action;
  }
  // Only the authenticated browser route calls this method. MCP has no approval tool.
  decide(actionId:string,decision:'approve'|'reject'){
    return this.store.transaction(()=>{
      const a=this.action(actionId);if(a.status!=='pending')throw new Error('این درخواست قبلاً تصمیم‌گیری شده است.');
      if(Date.parse(a.expiresAt)<Date.now())throw new Error('مهلت تأیید تمام شده است.');
      a.status=decision==='approve'?'approved':'rejected';a.approvedAt=decision==='approve'?new Date().toISOString():undefined;this.store.put('actions',a);
      if(decision==='reject'&&a.runId){const run=this.incident(a.runId);this.event(run,'rejected','کاربر انتشار را رد کرد. هیچ تغییر سرویس انجام نشد.');}
      return a;
    });
  }
  async execute(actionId:string){
    const a=this.action(actionId);if(a.status==='succeeded')return a;
    if(a.status!=='approved')throw new Error('تأیید انسانی معتبر برای این عملیات ثبت نشده است.');
    const p=this.project(a.projectId);
    this.store.lock(p.id,a.id);
    let run=a.runId?this.incident(a.runId):undefined;
    try{
      const approvedSource=await this.snapshots.assertIntact(a.snapshotId);
      if(approvedSource.digest!==a.digest)throw new Error('منبع تأییدشده با digest مجوز مطابقت ندارد؛ تأیید تازه لازم است.');
      if(a.kind!=='restart')validateCandidate(approvedSource.files['summary.mjs']);
      const current=this.project(p.id);
      if(current.revision!==a.baseRevision||current.currentSnapshot!==a.baseSnapshot)throw new Error('نسخهٔ پایه تغییر کرده است؛ تأیید تازه لازم است.');
      if(Date.parse(a.expiresAt)<Date.now())throw new Error('مجوز عملیات منقضی شده است.');
      if(p.mode==='liara'&&await this.liara.currentRelease(p.name)!==a.baseRelease)throw new Error('نسخهٔ زنده پس از آماده‌سازی تغییر کرده است.');
      this.store.transaction(()=>{const latest=this.action(a.id);if(latest.status!=='approved')throw new Error('این مجوز قبلاً مصرف شده است.');a.status='executing';a.executedAt=new Date().toISOString();this.store.put('actions',a);});
      if(run)this.event(run,'deploying','منبع تأییدشده از مسیر کنترل‌شده منتشر می‌شود.');
      let releaseId=`local-${a.digest.slice(0,12)}`;
      if(p.mode==='liara'){
        if(a.kind==='restart'){await this.liara.restart(p.name);releaseId=await this.liara.currentRelease(p.name)??'unknown';}
        else{const deployed=await this.liara.deploy(this.snapshots.path(a.snapshotId),p.name,a.digest);releaseId=deployed.releaseId;a.result={output:deployed.output};}
      }
      p.currentSnapshot=a.snapshotId;p.revision++;if(p.mode==='liara')p.remoteRelease=releaseId;this.store.put('projects',p);
      if(run){run.releaseId=releaseId;this.event(run,'verifying','درخواست کاربردی و قرارداد پاسخ روی نسخهٔ منتشرشده دوباره بررسی می‌شوند.');}
      // The approved source decides the expected live contract: a deliberately faulty seed must
      // actually answer 500 before its deployment counts, instead of inheriting the predecessor's 200.
      const expectation=!run&&a.kind!=='restart'&&!(await this.runner.verify(this.snapshots.path(a.snapshotId))).passed?'faulty':'healthy';
      const verification=await this.verifyPublished(p,run,expectation);
      a.result={...(a.result as object??{}),releaseId,verification};
      if(run){run.verification=verification;this.save(run);}
      // An intentionally faulty seed is labeled as faulty, never as recovery.
      const intentionalDemoDefect=expectation==='faulty'&&verification.matched===true;
      if(!verification.passed&&!intentionalDemoDefect)throw new Error('بررسی کاربردی پس از انتشار ناموفق بود. وضعیت آمادهٔ زیرساخت به معنی موفقیت برنامه نیست.');
      a.status='succeeded';this.store.put('actions',a);
      if(run)this.event(run,'resolved','رفع خطا با اجرای دوبارهٔ درخواست و بررسی قرارداد پاسخ تأیید شد.');
      this.store.event(run?.id??a.id,'completed',verification.passed?'انتشار و بررسی کاربردی موفق بود.':'نسخهٔ نمونه منتشر شد؛ خطای عمدی آن برای تمرین همچنان قابل‌بازتولید است.');
      return a;
    }catch(e){a.status='failed';a.error=messageOf(e);this.store.put('actions',a);if(run){run.error=a.error;this.event(run,'failed',a.error);}throw new Error(a.error);}
    finally{this.store.unlock(p.id,a.id);}
  }
  async verifyLocalHttp(p:Project,expectation:'healthy'|'faulty'='healthy'):Promise<Verification>{
    // The public local demo route uses this same isolated invocation path.
    const start=Date.now();let actual:unknown;
    if(this.localOrigin){const r=await fetch(`${this.localOrigin}/demo/api/summary`,{method:'POST',headers:{'content-type':'application/json',origin:this.localOrigin},body:JSON.stringify(failingInput),signal:AbortSignal.timeout(10000)});actual={status:r.status,body:await r.json()};}
    else actual=await this.runner.invoke(this.snapshots.path(p.currentSnapshot),failingInput);
    const actualResult=actual as {status:number;body:unknown};
    const expected=expectation==='faulty'?{status:500}:{status:200,body:{subtotal:200,discount:0,total:200}};
    const contract=await this.runner.verify(this.snapshots.path(p.currentSnapshot));
    const matches=expectation==='faulty'
      ? actualResult.status===500
      : actualResult.status===200&&JSON.stringify(actualResult.body)===JSON.stringify(expected.body)&&contract.passed;
    // A deliberately faulty seed is a successful demonstration of the defect, not a recovery:
    // it is reported with matched=true and passed=false, exactly like the live path.
    return {passed:expectation==='healthy'&&matches,matched:matches,checks:[{name:expectation==='faulty'?'بازتولید خطای عمدی روی نسخهٔ معیوب':'اجرای دوبارهٔ درخواست اصلی',passed:matches,expected,actual},...contract.checks],durationMs:Date.now()-start,source:this.localOrigin?'http':'isolated-contract-tests'};
  }
  async verifyPublished(p:Project,run?:Incident,expectation:'healthy'|'faulty'='healthy'):Promise<Verification>{
    if(p.mode==='local')return this.verifyLocalHttp(p,expectation);
    const start=Date.now();
    let consecutive=0,result:Verification|undefined;
    // The edge can keep serving the previous release for tens of seconds after READY, so the
    // observed contract must match what the approved source actually does. Otherwise a deploy
    // of the faulty seed would be called finished while the healthy predecessor still answers.
    const matches=(v:Verification)=>expectation==='faulty'
      ? (v.checks[0]?.actual as {status?:number})?.status===500&&v.checks.slice(1).every(c=>c.passed)
      : v.passed;
    for(let attempt=0;attempt<this.verificationPolicy.attempts;attempt++){
      if(p.remoteRelease&&await this.liara.currentRelease(p.name)!==p.remoteRelease)throw new Error('نسخهٔ زنده هنگام بررسی نتیجه تغییر کرده است.');
      result=await this.liara.verifyHttp(p.name);
      consecutive=matches(result)?consecutive+1:0;
      if(consecutive>=this.verificationPolicy.successes)return {...result,durationMs:Date.now()-start,matched:true,passed:expectation==='healthy'?result.passed:false};
      if(run)this.store.event(run.id,'verifying',`بررسی کاربردی نوبت ${attempt+1}؛ ${expectation==='faulty'?'نسخهٔ معیوب هنوز پاسخ نمی‌دهد':'ثبات پاسخ پس از انتشار هنوز تأیید نشده است.'}`);
      if(attempt+1<this.verificationPolicy.attempts)await new Promise(resolve=>setTimeout(resolve,this.verificationPolicy.delayMs));
    }
    if(result&&consecutive<this.verificationPolicy.successes)return {...result,durationMs:Date.now()-start,passed:false,matched:false,checks:[...result.checks,{name:'ثبات پاسخ در بررسی‌های متوالی',passed:false,expected:{consecutive:this.verificationPolicy.successes},actual:{consecutive}}]};
    throw new Error('نتیجهٔ بررسی در دسترس نیست.');
  }
  async reverify(runId:string){
    const run=this.incident(runId);if(!run.actionId||!run.releaseId||!['failed','resolved'].includes(run.status))throw new Error('این رخداد آمادهٔ بررسی دوبارهٔ انتشار نیست.');
    const a=this.action(run.actionId),p=this.project(run.projectId);
    if(!a.approvedAt||p.currentSnapshot!==a.snapshotId||p.revision!==a.baseRevision+1)throw new Error('منبع فعلی با انتشار تأییدشدهٔ این رخداد مطابق نیست.');
    this.store.lock(p.id,run.id);
    try{
      if(p.mode==='liara'&&await this.liara.currentRelease(p.name)!==run.releaseId)throw new Error('نسخهٔ زنده با گزارش این رخداد مطابق نیست.');
      this.event(run,'verifying','فقط بررسی دوبارهٔ نسخهٔ موجود؛ هیچ استقرار تازه‌ای انجام نمی‌شود.');
      const verification=await this.verifyPublished(p,run);run.verification=verification;
      if(!verification.passed)throw new Error('پاسخ کاربردی هنوز پایدار و صحیح نیست.');
      a.status='succeeded';delete a.error;a.result={...(a.result as object??{}),verification,recheckedAt:new Date().toISOString()};this.store.put('actions',a);
      delete run.error;this.event(run,'resolved','رفع خطا با پاسخ‌های متوالی صحیح روی همان release تأیید شد.');return run;
    }catch(e){run.error=messageOf(e);this.event(run,'failed',run.error);throw e;}
    finally{this.store.unlock(p.id,run.id);}
  }
  async resetProposal(projectId:string){
    const snapshot=await this.snapshots.seed(join(this.root,'fixtures','shop'));
    const action=await this.prepareAction(projectId,'deploy',snapshot.id);
    const p=this.project(projectId);
    // A reset is intentionally destructive in both modes: label it explicitly before a human can approve it.
    action.title=p.mode==='liara'?'بازنشانی نمونهٔ زنده به نسخهٔ معیوب':'بازنشانی نمونهٔ محلی به نسخهٔ معیوب';
    action.risk=p.mode==='liara'
      ?'این عملیات عمداً نسخهٔ دارای خطای ۵۰۰ را روی سرویس واقعی منتشر می‌کند و تا اصلاح بعدی، درخواست بدون تخفیف را خراب می‌کند.'
      :'این عملیات فقط منبع تمرین محلی را به نسخهٔ دارای خطای ۵۰۰ برمی‌گرداند؛ هزینه یا تغییر ابری ندارد.';
    this.store.put('actions',action);
    return action;
  }
  async rollbackProposal(actionId:string){const previous=this.action(actionId);const verified=await this.runner.verify(this.snapshots.path(previous.baseSnapshot));if(!verified.passed)throw new Error('منبع قبلی از آزمون سلامت مستقل عبور نمی‌کند؛ به‌عنوان نسخهٔ سالم پیشنهاد نمی‌شود.');return this.prepareAction(previous.projectId,'rollback',previous.baseSnapshot);}
}
