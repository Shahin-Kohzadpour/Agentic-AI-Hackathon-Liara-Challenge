import { Liara } from '../src/liara.ts';
import { messageOf } from '../src/security.ts';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const client=new Liara(resolve(import.meta.dirname,'..'));
if(!client.configured())throw new Error('Set LIARA_API_TOKEN in local .env first.');
const report:Record<string,unknown>={at:new Date().toISOString(),readOnly:true};
for(const [name,path]of [['projects','/v1/projects'],['identity-and-plans','/v1/me']]as const){
  try{const b=await client.request(path);report[name]=name==='projects'?{ok:true,projects:b.projects?.map((p:any)=>({name:p.project_id,platform:p.type,status:p.status}))}:{ok:true,teamConfigured:Boolean(process.env.LIARA_TEAM_ID),availablePlanCount:Object.values(b.plans?.projects??{}).filter((p:any)=>p.available).length};}
  catch(e){report[name]={ok:false,error:messageOf(e)};}
}
if(process.env.LIARA_PROJECT)report.evidence=await client.collect(process.env.LIARA_PROJECT);
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/liara-spike.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
