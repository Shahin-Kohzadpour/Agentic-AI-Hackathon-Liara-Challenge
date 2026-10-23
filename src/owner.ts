import { mkdir,open,readFile,readlink,unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

async function processStartTime(pid:number):Promise<string|undefined>{
  try{
    const stat=await readFile(`/proc/${pid}/stat`,'utf8');
    const close=stat.lastIndexOf(')');
    return stat.slice(close+2).trim().split(/\s+/)[19];
  }catch{return undefined;}
}

async function runtimeIdentity(pid:number){
  let pidNamespace:string|undefined;
  try{pidNamespace=await readlink('/proc/self/ns/pid');}catch{}
  return {host:hostname(),pidNamespace,startTime:await processStartTime(pid)};
}

export async function claimOwner(directory:string){
  await mkdir(directory,{recursive:true,mode:0o700});const path=join(directory,'server-owner');
  const identity=await runtimeIdentity(process.pid);
  const value=JSON.stringify({pid:process.pid,nonce:randomUUID(),...identity});
  for(let attempt=0;attempt<2;attempt++){
    try{const file=await open(path,'wx',0o600);await file.writeFile(value);await file.close();return async()=>{try{if(await readFile(path,'utf8')===value)await unlink(path);}catch{}};}
    catch(e){
      if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
      const existingText=await readFile(path,'utf8');let existing:any;
      try{existing=JSON.parse(existingText);if(!Number.isSafeInteger(existing.pid)||existing.pid<1)throw new Error();}catch{throw new Error('فایل مالک سرور نامعتبر است؛ پیش از اجرا آن را بررسی کنید.');}
      const sameRuntime=existing.host===identity.host&&(!existing.pidNamespace||existing.pidNamespace===identity.pidNamespace);
      if(sameRuntime){
        const storedStart=typeof existing.startTime==='string'?existing.startTime:undefined;
        const currentStart=await processStartTime(existing.pid);
        const ownerIsAlive=storedStart&&currentStart?storedStart===currentStart:await (async()=>{
          try{process.kill(existing.pid,0);return true;}
          catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error;}
        })();
        if(ownerIsAlive)throw new Error('یک سرور نگهبان برای این فضای داده در حال اجراست.');
      }
      if(await readFile(path,'utf8')===existingText)await unlink(path);
    }
  }
  throw new Error('قفل مالک سرور به دست نیامد.');
}
