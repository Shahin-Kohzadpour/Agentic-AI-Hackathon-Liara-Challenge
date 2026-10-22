import { mkdir,open,readFile,unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function claimOwner(directory:string){
  await mkdir(directory,{recursive:true,mode:0o700});const path=join(directory,'server-owner');
  const value=JSON.stringify({pid:process.pid,nonce:randomUUID()});
  for(let attempt=0;attempt<2;attempt++){
    try{const file=await open(path,'wx',0o600);await file.writeFile(value);await file.close();return async()=>{try{if(await readFile(path,'utf8')===value)await unlink(path);}catch{}};}
    catch(e){
      if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
      const existing=await readFile(path,'utf8');let pid:number;
      try{pid=JSON.parse(existing).pid;if(!Number.isSafeInteger(pid)||pid<1)throw new Error();}catch{throw new Error('فایل مالک سرور نامعتبر است؛ پیش از اجرا آن را بررسی کنید.');}
      try{process.kill(pid,0);throw new Error('یک سرور نگهبان برای این فضای داده در حال اجراست.');}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
      if(await readFile(path,'utf8')===existing)await unlink(path);
    }
  }
  throw new Error('قفل مالک سرور به دست نیامد.');
}
