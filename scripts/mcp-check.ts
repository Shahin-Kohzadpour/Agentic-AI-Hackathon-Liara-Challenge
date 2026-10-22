import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const port=Number(process.env.PORT||4317),base=`http://127.0.0.1:${port}`;
const token=(await readFile('.data/mcp-key','utf8')).trim();
const state=()=>fetch(`${base}/api/state`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json());
const client=new Client({name:'negahban-integration-check',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx','src/mcp.ts'],env:{PATH:process.env.PATH!,PORT:String(port)},stderr:'pipe'});
try{
 await client.connect(transport);
 const tools=await client.listTools();assert.equal(tools.tools.length,6);assert.equal(tools.tools.some(t=>/approve/.test(t.name)),false);
 const projects=await client.callTool({name:'liara_projects',arguments:{}});assert.equal(Boolean(projects.isError),false);
 const report:Record<string,unknown>={at:new Date().toISOString(),tools:tools.tools.map(t=>t.name),projects};
 if(process.argv.includes('--prepare-live')){
  const before=await state();assert.ok(before.projects.some((p:any)=>p.id==='liara'));
  let run=before.incidents.find((r:any)=>r.projectId==='liara'&&['collecting','patching','testing','awaiting_approval'].includes(r.status));
  if(!run){const started=await client.callTool({name:'incident_start',arguments:{projectId:'liara',request:'در برنامهٔ زنده، سفارش بدون تخفیف خطای ۵۰۰ دارد؛ علت را با لاگ و کد بررسی کن و اصلاح آزموده‌شده را برای تأیید آماده کن.'}});assert.equal(Boolean(started.isError),false);console.log('Live incident started through the real MCP client.');}
  const deadline=Date.now()+180000;
  while(Date.now()<deadline){const s=await state();run=s.incidents.find((r:any)=>r.projectId==='liara');if(run&&['awaiting_approval','failed'].includes(run.status))break;await new Promise(resolve=>setTimeout(resolve,2000));}
  assert.equal(run?.status,'awaiting_approval',run?.error??'Live repair did not reach approval.');
  const refused=await client.callTool({name:'deployment_apply',arguments:{actionId:run.actionId}});assert.equal(refused.isError,true,'MCP must not execute an unapproved live action.');
  const s=await state(),action=s.actions.find((a:any)=>a.id===run.actionId);assert.equal(action.status,'pending');
  report.liveProposal={run,action};report.unapprovedApplyRefused=true;
  console.log(JSON.stringify({status:run.status,actionId:action.id,sourceDigest:action.digest,tests:run.candidate.checks.length,allTestsPassed:run.candidate.passed,unapprovedMcpApplyRefused:true}));
 }
 await mkdir('artifacts',{recursive:true});await writeFile(process.argv.includes('--prepare-live')?'artifacts/mcp-check.json':'artifacts/mcp-check-readonly.json',JSON.stringify(report,null,2));console.log('MCP integration checks passed.');
}finally{await client.close();}
