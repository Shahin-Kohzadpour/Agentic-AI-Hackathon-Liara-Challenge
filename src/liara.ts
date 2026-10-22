import { readFile,mkdir,writeFile,rm,readdir,chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { command } from './runner.ts';
import { id,messageOf,redact,validProject } from './security.ts';
import type { Evidence,Verification } from './types.ts';

export class Liara {
  constructor(private root:string){}
  configured(){return Boolean(process.env.LIARA_API_TOKEN);}
  async request(path:string,method='GET',body?:unknown):Promise<any>{
    if(!this.configured())throw new Error('کلید لیارا تنظیم نشده است. راهنمای اتصال را ببینید.');
    const token=process.env.LIARA_API_TOKEN!;
    const auth=process.env.LIARA_AUTH_SCHEME==='raw'?token:`Bearer ${token}`;
    const url=new URL(path,'https://api.liara.ir');
    if(process.env.LIARA_TEAM_ID)url.searchParams.set('teamID',process.env.LIARA_TEAM_ID);
    const response=await fetch(url,{method,headers:{Authorization:auth,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(18000),redirect:'error'});
    if(!response.ok)throw new Error(`Liara HTTP ${response.status}: ${response.status===401?'اعتبار کلید یا روش احراز هویت بررسی شود.':response.status===403?'دسترسی این حساب کافی نیست.':response.status===429?'محدودیت نرخ؛ کمی بعد دوباره بررسی کنید.':'عملیات ناموفق بود؛ نتیجهٔ عملیات نوشتنی پیش از تکرار بررسی شود.'}`);
    const text=await response.text();if(text.length>2_000_000)throw new Error('پاسخ لیارا بیش از حد بزرگ است.');
    return text?JSON.parse(text):{};
  }
  async currentRelease(name:string):Promise<string|undefined>{
    const r=await this.request(`/v1/projects/${validProject(name)}/releases`);return typeof r.currentRelease==='string'?r.currentRelease:undefined;
  }
  async collect(name:string):Promise<Evidence[]>{
    validProject(name);
    const since=Math.floor(Date.now()/1000)-900;
    const current=await this.currentRelease(name).catch(()=>undefined);
    const prefix=`/v1/projects/${name}`;
    const logs=`/v2/projects/${name}/logs?start=${since}&direction=forward&last_lines=true${current?`&releaseId=${current}`:''}`;
    const sources=[['status','وضعیت برنامه',prefix],['logs','لاگ‌های برنامه',logs],['events','رویدادهای لیارا',`${prefix}/events`],['releases','نسخه‌های منتشرشده',`${prefix}/releases`],['cpu','مصرف CPU',`${prefix}/metrics/cpu?since=${since}`],['memory','مصرف حافظه',`${prefix}/metrics/memory?since=${since}`]] as const;
    return Promise.all(sources.map(async([kind,title,path])=>{
      const base={id:id('ev'),kind,title,observedAt:new Date().toISOString()};
      try {
        let raw=await this.request(path);
        if(kind==='logs')raw={endpoint:'v2',releaseId:current,lines:(raw.data??[]).flatMap((group:any)=>(group.values??[]).map(([timestamp,text]:[string,string])=>{
          let entry:any;try{entry=JSON.parse(text);}catch{entry={_entry:text};}
          let message:any=entry._entry;try{message=JSON.parse(message);}catch{}
          return {timestamp,releaseId:group.metaData?.releaseId,stream:entry.type,message};
        })).sort((a:any,b:any)=>String(a.timestamp).localeCompare(String(b.timestamp))).slice(-40)};
        const data=redact(raw);return {...base,available:true,data,...(['cpu','memory'].includes(kind)?{limitation:'سری خام لیارا؛ واحد و تازگی باید با قرارداد ارائه‌دهنده تطبیق داده شوند. دادهٔ خالی معادل صفر نیست.'}:{})};
      }
      catch(e){return {...base,available:false,data:null,limitation:messageOf(e)};}
    }));
  }
  appUrl(name:string) {
    validProject(name);
    const url=new URL(process.env.LIARA_APP_URL||`https://${name}.liara.run`);
    if(url.protocol!=='https:'||url.username||url.password)throw new Error('آدرس برنامه باید HTTPS و فاقد اطلاعات احراز هویت باشد.');
    // The only override is administrator configuration, never a model-supplied URL.
    return url.origin;
  }
  async summary(name:string,input:unknown):Promise<{status:number;body:unknown}>{
    const response=await fetch(`${this.appUrl(name)}/api/summary`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(10000),redirect:'error'});
    const text=await response.text();let body:unknown;try{body=JSON.parse(text);}catch{body={error:'NON_JSON_RESPONSE',excerpt:text.slice(0,300)};}
    return {status:response.status,body:redact(body)};
  }
  async verifyHttp(name:string):Promise<Verification>{
    const start=Date.now(),origin=this.appUrl(name);
    const fixtures=[
      {name:'درخواست اصلی بدون تخفیف',input:{items:[{price:100,quantity:2}]},status:200,body:{subtotal:200,discount:0,total:200}},
      {name:'تخفیف معتبر',input:{items:[{price:100,quantity:2}],discounts:[10]},status:200,body:{subtotal:200,discount:10,total:190}},
      {name:'قرارداد ورودی نامعتبر',input:{items:[{price:100,quantity:2}],discounts:'bad'},status:400,body:{error:'INVALID_DISCOUNTS'}},
    ];
    const checks=[];
    for(const c of fixtures){
      try{
        const response=await fetch(`${origin}/api/summary`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(c.input),signal:AbortSignal.timeout(10000),redirect:'error'});
        const text=await response.text();let body:unknown;
        try{body=JSON.parse(text);}catch{body={contentType:response.headers.get('content-type'),excerpt:text.slice(0,500)};}
        checks.push({name:c.name,passed:response.status===c.status&&JSON.stringify(body)===JSON.stringify(c.body),expected:{status:c.status,body:c.body},actual:{status:response.status,body:redact(body)}});
      }catch(e){checks.push({name:c.name,passed:false,expected:{status:c.status,body:c.body},actual:{error:messageOf(e)}});}
    }
    return {passed:checks.every(c=>c.passed),checks,durationMs:Date.now()-start,source:'http'};
  }
  async deploy(snapshotPath:string,name:string,digest:string):Promise<{releaseId:string;output:string}>{
    if(!this.configured())throw new Error('کلید لیارا تنظیم نشده است.');
    validProject(name);
    // Normalize archive permissions, not source contents; runtime UID differs from the workstation.
    for(const file of await readdir(snapshotPath))await chmod(join(snapshotPath,file),0o444);
    const before=await this.currentRelease(name);
    const pkg=JSON.parse(await readFile(join(this.root,'node_modules/@liara/cli/package.json'),'utf8'));
    const bin=typeof pkg.bin==='string'?pkg.bin:Object.values(pkg.bin)[0] as string;
    const cli=join(this.root,'node_modules/@liara/cli',bin);
    const credentialHome=join(this.root,'.data','cli',id('job'));
    await mkdir(credentialHome,{recursive:true,mode:0o700});
    try{
      // The installed CLI reads this documented account format; no token in argv.
      await writeFile(join(credentialHome,'.liara-auth.json'),JSON.stringify({version:'1',accounts:{negahban:{current:true,api_token:process.env.LIARA_API_TOKEN,region:'iran'}}}),{mode:0o600});
      const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:credentialHome,XDG_CONFIG_HOME:join(credentialHome,'.config'),CI:'1',NO_COLOR:'1',DO_NOT_TRACK:'1'};
      const args=[cli,'deploy','--app',name,'--path',snapshotPath,'--platform','node','--port','3000','--message',`negahban ${digest.slice(0,16)}`,'--detach'];
      if(process.env.LIARA_TEAM_ID)args.push('--team-id',process.env.LIARA_TEAM_ID);
      const result=await command(process.execPath,args,{cwd:snapshotPath,env,timeout:240000,limit:150000});
      if(result.code!==0)throw new Error(`CLI استقرار را تأیید نکرد. ${String(redact(result.stderr||result.stdout)).slice(-1800)}`);
      // Never treat a CLI exit code as proof that a new ready release exists.
      // A release can stay PENDING behind a slow regional build for minutes; do not
      // declare the deployment unknown while the platform is still rolling it out.
      for(let i=0;i<90;i++){
        const releases=await this.request(`/v1/projects/${name}/releases`);
        const current=releases.currentRelease;
        const entry=releases.releases?.find((r:any)=>r._id===current);
        if(current&&current!==before&&entry&&entry.state==='READY')return {releaseId:current,output:String(redact(result.stdout)).slice(-3000)};
        await new Promise(resolve=>setTimeout(resolve,2000));
      }
      throw new Error('پایان CLI ثبت شد ولی آماده‌شدن release تازه تأیید نشد. پیش از تکرار، وضعیت پروژه را بررسی کنید.');
    } finally{await rm(credentialHome,{recursive:true,force:true});}
  }
  async restart(name:string){return redact(await this.request(`/v1/projects/${validProject(name)}/actions/restart`,'POST'));}
}
