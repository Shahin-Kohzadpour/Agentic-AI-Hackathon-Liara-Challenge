import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { Verification } from './types.ts';

export function command(file:string,args:string[],options:{cwd?:string;env?:NodeJS.ProcessEnv;timeout?:number;input?:string;limit?:number}={}):Promise<{stdout:string;stderr:string;code:number}> {
  return new Promise((ok,fail)=>{
    const child=spawn(file,args,{cwd:options.cwd,env:options.env??process.env,stdio:['pipe','pipe','pipe'],detached:true});
    let stdout='',stderr='',finished=false;
    const kill=()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{child.kill('SIGKILL');}};
    const timer=setTimeout(()=>{kill();finish(new Error('مهلت اجرای عملیات به پایان رسید.'))},options.timeout??30000);
    const finish=(error?:Error,code=0)=>{if(finished)return;finished=true;clearTimeout(timer);error?fail(error):ok({stdout,stderr,code});};
    child.on('error',e=>finish(e));
    for(const [stream,key]of [[child.stdout,'stdout'],[child.stderr,'stderr']]as const) stream.on('data',d=>{
      if(key==='stdout')stdout+=d;else stderr+=d;
      if(stdout.length+stderr.length>(options.limit??200000)){kill();finish(new Error('حجم خروجی عملیات بیش از حد مجاز است.'));}
    });
    child.on('close',code=>finish(undefined,code??1));
    child.stdin.on('error',()=>{});child.stdin.end(options.input);
  });
}
export class IsolatedRunner {
  constructor(private root:string){}
  async execute(snapshotPath:string,script:string,args:string[]=[]) {
    const flags=['--unshare-all','--die-with-parent','--new-session','--clearenv','--ro-bind','/usr','/usr','--symlink','usr/lib','/lib','--symlink','usr/lib','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--ro-bind',process.execPath,'/node','--ro-bind',resolve(snapshotPath),'/app','--ro-bind',resolve(this.root,'runner'),'/runner','--chdir','/app','--setenv','HOME','/tmp','/node','--max-old-space-size=96',`/runner/${script}`,...args];
    const result=await command('/usr/bin/bwrap',flags,{env:{PATH:'/usr/bin:/bin'},timeout:12000});
    if(result.code!==0)throw new Error(`اجرای محیط جدا ناموفق بود: ${result.stderr.slice(-1000)}`);
    return JSON.parse(result.stdout.trim());
  }
  async verify(path:string):Promise<Verification> {const start=Date.now();return {...await this.execute(path,'verify.mjs'),durationMs:Date.now()-start,source:'isolated-contract-tests'};}
  async invoke(path:string,input:unknown):Promise<{status:number;body:unknown;exception?:string}> {return this.execute(path,'invoke.mjs',[JSON.stringify(input)]);}
}
