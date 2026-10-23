import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { Core } from '../src/core.ts';
import { redact } from '../src/security.ts';
import { createServer } from '../src/server.ts';
import type { RepairAgent } from '../src/agent.ts';
import { validateCandidate } from '../src/candidate.ts';
import vm from 'node:vm';
import { claimOwner } from '../src/owner.ts';

const root=resolve(import.meta.dirname,'..');
const fakeAgent:RepairAgent={async repair(source){return {diagnosis:'در تست، نبود تخفیف اختیاری باعث شکست reduce می‌شود.',change:'مقدار پیش‌فرض آرایهٔ خالی اضافه شد.',sourceCode:source.replace('order.discounts.reduce','(order.discounts ?? []).reduce')};}};
async function setup(agent=fakeAgent){const dir=await mkdtemp(join(tmpdir(),'negahban-test-'));const c=new Core(root,dir,agent);await c.initialize();return c;}
async function repaired(c:Core){const r=await c.startIncident('local','خلاصهٔ سفارش خطای ۵۰۰ می‌دهد.');await c.settle();return c.incident(r.id);}

test('real defect is reproduced; unobserved HTTP health is not fabricated',async()=>{const c=await setup();const p=c.project('local');const r=await c.runner.verify(c.snapshots.path(p.currentSnapshot));assert.equal(r.passed,false);assert.equal(r.checks.filter(x=>!x.passed).length,2);const evidence=await c.collect('local');assert.equal(evidence.find(e=>e.kind==='health')!.available,false);assert.equal((evidence.find(e=>e.kind==='http')!.data as any).status,500);});
test('independent verifier passes repaired candidate including held-out cases',async()=>{const c=await setup();const r=await repaired(c);assert.equal(r.status,'awaiting_approval');assert.equal(r.candidate!.passed,true);assert.equal(r.candidate!.checks.length,11);assert.equal(c.project('local').revision,1);});
test('unapproved apply is refused without changing deployment',async()=>{const c=await setup();const r=await repaired(c);await assert.rejects(c.execute(r.actionId!),/تأیید/);assert.equal(c.project('local').revision,1);});
test('rejection never changes source or marks incident resolved',async()=>{const c=await setup();const r=await repaired(c);c.decide(r.actionId!,'reject');await assert.rejects(c.execute(r.actionId!),/تأیید/);assert.equal(c.incident(r.id).status,'rejected');assert.equal(c.project('local').revision,1);});
test('approved recovery succeeds and replay causes no second deployment',async()=>{const c=await setup();const r=await repaired(c);c.decide(r.actionId!,'approve');const a=await c.execute(r.actionId!);assert.equal(a.status,'succeeded');assert.equal(c.incident(r.id).status,'resolved');assert.equal(c.incident(r.id).verification!.passed,true);await c.execute(a.id);assert.equal(c.project('local').revision,2);});
test('stale base revision invalidates approval',async()=>{const c=await setup();const r=await repaired(c);const p=c.project('local');p.revision++;c.store.put('projects',p);c.decide(r.actionId!,'approve');await assert.rejects(c.execute(r.actionId!),/نسخهٔ پایه/);assert.equal(c.incident(r.id).status,'failed');});
test('source tampering after approval is blocked',async()=>{const c=await setup();const r=await repaired(c);const a=c.action(r.actionId!);c.decide(a.id,'approve');const path=join(c.snapshots.path(a.snapshotId),'summary.mjs');await chmod(path,0o600);await writeFile(path,'export const summarizeOrder = () => ({status:200,body:{}});');await assert.rejects(c.execute(a.id),/تغییر کرده/);assert.equal(c.project('local').revision,1);});
test('expired approval cannot execute',async()=>{const c=await setup();const r=await repaired(c);c.decide(r.actionId!,'approve');const a=c.action(r.actionId!);a.expiresAt=new Date(Date.now()-1000).toISOString();c.store.put('actions',a);await assert.rejects(c.execute(a.id),/منقضی/);});
test('bad patches cannot reach approval',async()=>{const c=await setup({async repair(){return {diagnosis:'پاسخ ۲۰۰ همیشه برگردانده می‌شود.',change:'این یک اصلاح نامعتبر برای تست است.',sourceCode:'export function summarizeOrder(){return {status:200,body:{}}}'};}});const r=await repaired(c);assert.equal(r.status,'failed');assert.equal(r.actionId,undefined);});
test('sandbox cannot read host files or deployment credentials',async()=>{const c=await setup();const s=c.snapshots.get(c.project('local').currentSnapshot);const probe=await c.snapshots.create({...s.files,'summary.mjs':`import { existsSync } from 'node:fs'; export function summarizeOrder(){return {status:200,body:{host:existsSync('${root}/.env'),token:process.env.LIARA_API_TOKEN??null}}}`});const result=await c.runner.invoke(c.snapshots.path(probe.id),{});assert.deepEqual(result.body,{host:false,token:null});});
test('redaction removes structured secrets and known credentials',()=>{process.env.NEGAHBAN_TEST_SECRET='test-secret-long-value';const r=redact({envs:[{value:'private'}],authorization:'secret',message:'test-secret-long-value',apiKey:'private'}) as any;assert.equal(r.envs,undefined);assert.equal(r.authorization,undefined);assert.equal(r.message,'[REDACTED]');assert.equal(r.apiKey,'[REDACTED]');delete process.env.NEGAHBAN_TEST_SECRET;});
test('candidate contract blocks imports and constructor escapes',()=>{
 assert.throws(()=>validateCandidate("import fs from 'node:fs';export function summarizeOrder(o){return fs.readFileSync('/etc/passwd')}"));
 assert.throws(()=>validateCandidate("export function summarizeOrder(o){return o.constructor.constructor('return process')()}"));
});
test('helper initialization does not clear another active project lock',async()=>{const c=await setup();c.store.lock('local','owner');const helper=new Core(root,c.data,fakeAgent);await helper.initialize();assert.throws(()=>helper.store.lock('local','second'));c.store.unlock('local','owner');});
test('a second server cannot claim the same data directory',async()=>{const c=await setup();const release=await claimOwner(c.data);await assert.rejects(claimOwner(c.data),/در حال اجرا/);await release();const again=await claimOwner(c.data);await again();});
test('READY plus public 502 is a failed deployment, never successful setup',async()=>{
 const c=await setup();const p=c.project('local');p.mode='liara';p.name='test-sample';p.remoteRelease='before';c.store.put('projects',p);
 let remote='before';c.liara.currentRelease=async()=>remote;c.liara.deploy=async()=>{remote='after';return {releaseId:'after',output:'READY'};};
 c.liara.verifyHttp=async()=>({passed:false,source:'http',durationMs:1,checks:[0,1,2].map(i=>({name:String(i),passed:false,expected:{status:200},actual:{status:502}}))});
 c.verificationPolicy={attempts:1,delayMs:0,successes:1};
 const a=await c.prepareAction(p.id,'deploy');c.decide(a.id,'approve');await assert.rejects(c.execute(a.id),/ناموفق/);assert.equal(c.action(a.id).status,'failed');
});
test('a late successful HTTP check reconciles the same release without redeploy',async()=>{
 const c=await setup();c.verificationPolicy={attempts:3,delayMs:0,successes:2};
 const r=await repaired(c);const p=c.project('local');p.mode='liara';p.remoteRelease='before';c.store.put('projects',p);
 const a=c.action(r.actionId!);a.baseRelease='before';c.store.put('actions',a);
 let remote='before',deploys=0,pass=false,probes=0;
 c.liara.currentRelease=async()=>remote;c.liara.deploy=async()=>{deploys++;remote='after';return {releaseId:remote,output:'READY'}};
 c.liara.verifyHttp=async()=>{probes++;return {passed:pass,source:'http',durationMs:1,checks:[{name:'request',passed:pass,expected:{status:200},actual:{status:pass?200:500}}]};};
 c.decide(a.id,'approve');await assert.rejects(c.execute(a.id));assert.equal(c.incident(r.id).status,'failed');
 pass=true;await c.reverify(r.id);assert.equal(c.incident(r.id).status,'resolved');assert.equal(deploys,1);assert.ok(probes>=5);assert.equal(c.project('local').revision,2);
});
test('faulty prior source is not offered as known-good rollback',async()=>{const c=await setup();const run=await repaired(c);c.decide(run.actionId!,'approve');await c.execute(run.actionId!);await assert.rejects(c.rollbackProposal(run.actionId!),/نسخهٔ سالم/);});
test('HTTP boundary requires private human session and refuses MCP approval',async()=>{
 const c=await setup();const {app}=await createServer({root,core:c,port:4399});const host={host:'127.0.0.1:4399'};
 try{
  assert.equal((await app.inject({url:'/api/state',headers:host})).statusCode,401);
  const viewer=await app.inject({url:'/demo',headers:host});assert.doesNotThrow(()=>new vm.Script(viewer.body.match(/<script>([\s\S]*?)<\/script>/)![1]));
  const human=(await readFile(join(c.data,'human-key'),'utf8')).trim(),tool=(await readFile(join(c.data,'mcp-key'),'utf8')).trim();
  const login=await app.inject({method:'POST',url:'/api/session',headers:{...host,origin:'http://127.0.0.1:4399'},payload:{key:human}});assert.equal(login.statusCode,200);
  const cookie=String(login.headers['set-cookie']).split(';')[0],csrf=login.json().csrf;
  const a=await c.prepareAction('local','deploy');
  const forbidden=await app.inject({method:'POST',url:`/api/actions/${a.id}/decision`,headers:{...host,origin:'http://127.0.0.1:4399',authorization:`Bearer ${tool}`,cookie,'x-csrf-token':csrf},payload:{decision:'approve'}});assert.equal(forbidden.statusCode,403);
  const crossSite=await app.inject({method:'POST',url:`/api/actions/${a.id}/decision`,headers:{...host,origin:'https://evil.invalid',cookie,'x-csrf-token':csrf},payload:{decision:'approve'}});assert.equal(crossSite.statusCode,403);
  assert.equal(c.action(a.id).status,'pending');
 }finally{await app.close();}
});

test('login errors are human readable, never a raw validation payload',async()=>{
 const c=await setup();const {app}=await createServer({root,core:c,port:4397});const host={host:'127.0.0.1:4397'},origin='http://127.0.0.1:4397';
 try{
  const blank=await app.inject({method:'POST',url:'/api/session',headers:{...host,origin},payload:{key:'   '}});
  assert.equal(blank.statusCode,400);
  const message=blank.json().error as string;
  assert.doesNotMatch(message,/\(\[|too_small|minimum|code/);
  
  const short=await app.inject({method:'POST',url:'/api/session',headers:{...host,origin},payload:{key:'123'}});
  assert.equal(short.statusCode,403);assert.match(short.json().error,/کلید ورود معتبر نیست/);
  
  const human=(await readFile(join(c.data,'human-key'),'utf8')).trim();
  const padded=await app.inject({method:'POST',url:'/api/session',headers:{...host,origin},payload:{key:`  ${human}\n`}});
  assert.equal(padded.statusCode,200);assert.ok(padded.json().csrf);
 }finally{await app.close();}
});

const freePort=async()=>new Promise<number>((ok,fail)=>{const s=net.createServer();s.once('error',fail);s.listen(0,'127.0.0.1',()=>{const p=(s.address() as net.AddressInfo).port;s.close(()=>ok(p));});});
const waitForHttp=async(url:string)=>{for(let i=0;i<60;i++){try{const r=await fetch(url);if(r.ok)return true;}catch{}await new Promise(r=>setTimeout(r,100));}return false;};

test('candidate contract accepts legitimate pure variants and rejects tagged templates',()=>{
 const legitimate=`export function summarizeOrder(order){
  if(!order||!Array.isArray(order.items)||order.items.length===0||order.items.some(item=>!Number.isSafeInteger(item.price)||item.price<0||!Number.isSafeInteger(item.quantity)||item.quantity<1||!Number.isSafeInteger(item.price*item.quantity)))return {status:400,body:{error:'INVALID_ITEMS'}};
  if(order.discounts!==undefined&&(!Array.isArray(order.discounts)||order.discounts.some(v=>!Number.isSafeInteger(v)||v<0||v>50)))return {status:400,body:{error:'INVALID_DISCOUNTS'}};
  const subtotal=order.items.reduce((s,i)=>s+i.price*i.quantity,0);
  const discount=Array.isArray(order.discounts)?order.discounts.reduce((s,v)=>s+v,0):0;
  const total=Math.max(0,subtotal-discount);
  return {status:200,body:{subtotal,discount,total:Math.abs(total)}};
 }`;
 assert.doesNotThrow(()=>validateCandidate(legitimate));
 assert.doesNotThrow(()=>validateCandidate("export function summarizeOrder(){return {status:200,body:{x:Number('1')}}}"));
 assert.throws(()=>validateCandidate('export function summarizeOrder(){return {status:200,body:{x:Math.max`1`}}}'),/خارج است/);
 assert.throws(()=>validateCandidate('export function summarizeOrder(){return {status:200,body:{x:Math.max.call(null,1)}}}'),/فراخوانی/);
});

test('one validator rejection triggers a bounded retry',async()=>{
 let calls=0;
 const retrying:RepairAgent={async repair(source){calls++;return calls===1?{diagnosis:'این تشخیص اول با طول کافی است.',change:'اصلاح اول نامعتبر است.',sourceCode:"export function summarizeOrder(o){return o.constructor.constructor('return process')()}"}:{diagnosis:'این تشخیص دوم با طول کافی است.',change:'اصلاح دوم معتبر است.',sourceCode:source.replace('order.discounts.reduce','(order.discounts ?? []).reduce')};}};
 const c=await setup(retrying);const r=await repaired(c);
 assert.equal(calls,2);assert.equal(r.status,'awaiting_approval');assert.equal(r.candidate!.passed,true);
});

test('tampered action digest cannot execute',async()=>{
 const c=await setup();const r=await repaired(c);const a=c.action(r.actionId!);c.decide(a.id,'approve');const t=c.action(a.id);t.digest='0'.repeat(64);c.store.put('actions',t);
 await assert.rejects(c.execute(a.id),/digest/);assert.equal(c.project('local').revision,1);
});

test('faulty seed is not reported deployed while the edge still serves the healthy predecessor',async()=>{
 const c=await setup();const p=c.project('local');p.mode='liara';p.name='test-sample';p.remoteRelease='before';c.store.put('projects',p);
 c.verificationPolicy={attempts:3,delayMs:0,successes:2};
 let remote='before';c.liara.currentRelease=async()=>remote;c.liara.deploy=async()=>{remote='after';return {releaseId:'after',output:'READY'}};
 c.liara.verifyHttp=async()=>({passed:true,source:'http',durationMs:1,checks:[{name:'request',passed:true,expected:{status:200},actual:{status:200}}]});
 const a=await c.prepareAction(p.id,'deploy');c.decide(a.id,'approve');
 await assert.rejects(c.execute(a.id),/ناموفق/);assert.equal(c.action(a.id).status,'failed');
});

test('faulty seed deploy completes only once the live 500 contract is observed',async()=>{
 const c=await setup();const p=c.project('local');p.mode='liara';p.name='test-sample';p.remoteRelease='before';c.store.put('projects',p);
 c.verificationPolicy={attempts:6,delayMs:0,successes:2};
 let remote='before',probes=0;
 c.liara.currentRelease=async()=>remote;c.liara.deploy=async()=>{remote='after';return {releaseId:'after',output:'READY'}};
 const ok={name:'passed',passed:true,expected:{status:200},actual:{status:200}};
 c.liara.verifyHttp=async()=>{probes++;return probes<=2
  ?{passed:true,source:'http',durationMs:1,checks:[ok,ok,ok]}
  :{passed:false,source:'http',durationMs:1,checks:[{name:'main',passed:false,expected:{status:200},actual:{status:500}},ok,ok]};};
 const a=await c.prepareAction(p.id,'deploy');c.decide(a.id,'approve');
 const done=await c.execute(a.id);
 assert.equal(done.status,'succeeded');assert.equal((done.result as any).verification.matched,true);assert.equal((done.result as any).verification.passed,false);
 assert.ok(probes>=4,'verification accepted the predecessor release too early');assert.equal(c.project(p.id).revision,2);
});

test('local faulty reset is recorded as an intentional defect, not a failed deployment',async()=>{
 const c=await setup();const a=await c.resetProposal('local');assert.match(a.title,/معیوب/);assert.match(a.risk,/تمرین محلی/);c.decide(a.id,'approve');const done=await c.execute(a.id);
 assert.equal(done.status,'succeeded');assert.equal((done.result as any).verification.matched,true);assert.equal((done.result as any).verification.passed,false);
 const live=await c.runner.invoke(c.snapshots.path(c.project('local').currentSnapshot),{items:[{price:100,quantity:2}]});
 assert.equal(live.status,500);
});

test('live reset is explicitly labeled as an intentional faulty deployment',async()=>{
 const c=await setup();const p=c.project('local');p.mode='liara';p.name='test-sample';p.remoteRelease='before';c.store.put('projects',p);c.liara.currentRelease=async()=>'before';
 const a=await c.resetProposal('local');assert.match(a.title,/معیوب/);assert.match(a.risk,/عمداً/);
});

test('demo boundary distinguishes missing body and oversized input',async()=>{
 const c=await setup();const {app}=await createServer({root,core:c,port:4398});const h={host:'127.0.0.1:4398'},o='http://127.0.0.1:4398';
 try{
  const missing=await app.inject({method:'POST',url:'/demo/api/summary',headers:{...h,origin:o}});assert.equal(missing.statusCode,400);assert.deepEqual(missing.json(),{error:'INVALID_BODY'});
  const big=await app.inject({method:'POST',url:'/demo/api/summary',headers:{...h,origin:o,'content-type':'application/json'},payload:'{"items":[{"price":1,"quantity":1}],"pad":"'+'x'.repeat(50000)+'"}'});assert.equal(big.statusCode,413);
 }finally{await app.close();}
});

test('SSE flushes headers immediately and is unavailable to the tool capability',async()=>{
 const c=await setup();const port=await freePort();const {app}=await createServer({root,core:c,port});await app.listen({port,host:'127.0.0.1'});
 try{
  const human=(await readFile(join(c.data,'human-key'),'utf8')).trim();
  const login=await fetch(`http://127.0.0.1:${port}/api/session`,{method:'POST',headers:{origin:`http://127.0.0.1:${port}`,'content-type':'application/json'},body:JSON.stringify({key:human})});
  assert.equal(login.status,200);
  const cookie=String(login.headers.get('set-cookie')).split(';')[0];const ctrl=new AbortController();const t0=Date.now();
  const stream=await fetch(`http://127.0.0.1:${port}/api/events`,{headers:{cookie},signal:ctrl.signal});const elapsed=Date.now()-t0;ctrl.abort();
  assert.equal(stream.status,200);assert.ok(elapsed<3000,`SSE headers took ${elapsed}ms`);
  const tool=(await readFile(join(c.data,'mcp-key'),'utf8')).trim();
  const forbidden=await fetch(`http://127.0.0.1:${port}/api/events`,{headers:{authorization:`Bearer ${tool}`}});
  assert.equal(forbidden.status,401);
 }finally{await app.close();}
});

test('naive missing-discount repair fails the new overflow boundaries',async()=>{
 const c=await setup();const s=c.snapshots.get(c.project('local').currentSnapshot);
 const naive=`export function summarizeOrder(order){
  if(!order||!Array.isArray(order.items)||order.items.length===0||order.items.some(item=>!Number.isInteger(item.price)||item.price<0||!Number.isInteger(item.quantity)||item.quantity<1))return {status:400,body:{error:'INVALID_ITEMS'}};
  if(order.discounts!==undefined&&(!Array.isArray(order.discounts)||order.discounts.some(v=>!Number.isInteger(v)||v<0||v>50)))return {status:400,body:{error:'INVALID_DISCOUNTS'}};
  const subtotal=order.items.reduce((s,i)=>s+i.price*i.quantity,0);
  const discount=(order.discounts??[]).reduce((s,v)=>s+v,0);
  return {status:200,body:{subtotal,discount,total:Math.max(0,subtotal-discount)}};
 }`;
 const snap=await c.snapshots.create({...s.files,'summary.mjs':naive});const v=await c.runner.verify(c.snapshots.path(snap.id));
 assert.equal(v.passed,false);assert.ok(v.checks.some(x=>x.name.includes('غیرایمن')&&!x.passed));assert.ok(v.checks.some(x=>x.name.includes('سرریز')&&!x.passed));
});

test('fixture HTTP server rejects malformed JSON with 400',async()=>{
 const port=await freePort();const child=spawn(process.execPath,[join(root,'fixtures/shop/server.mjs')],{env:{...process.env,PORT:String(port)},stdio:['ignore','ignore','ignore']});
 try{
  assert.equal(await waitForHttp(`http://127.0.0.1:${port}/healthz`),true,'fixture server did not start');
  const bad=await fetch(`http://127.0.0.1:${port}/api/summary`,{method:'POST',headers:{'content-type':'application/json'},body:'{"items":'});assert.equal(bad.status,400);assert.deepEqual(await bad.json(),{error:'INVALID_JSON'});
  const empty=await fetch(`http://127.0.0.1:${port}/api/summary`,{method:'POST',headers:{'content-type':'application/json'},body:''});assert.equal(empty.status,400);
 }finally{child.kill('SIGKILL');}
});

test('startup recovery marks interrupted work failed and clears only stale locks',async()=>{
 const c=await setup();const now=new Date().toISOString();
 c.store.put('incidents',{id:'inc_interrupted',projectId:'local',request:'بررسی interrupted',status:'patching',createdAt:now,updatedAt:now,evidence:[]} as any);
 c.store.put('actions',{id:'act_interrupted',projectId:'local',kind:'deploy',status:'executing',createdAt:now,expiresAt:now,baseRevision:1,baseSnapshot:c.project('local').currentSnapshot,snapshotId:c.project('local').currentSnapshot,digest:'0'.repeat(64),title:'t',summary:'s',risk:'r',cost:'c'} as any);
 c.store.lock('local','inc_interrupted');
 const helper=new Core(root,c.data,fakeAgent);await helper.initialize(true);
 assert.equal(helper.incident('inc_interrupted').status,'failed');
 assert.equal(helper.action('act_interrupted').status,'failed');
 // The stale lock is cleared, so a new owner can take it.
 helper.store.lock('local','new-owner');helper.store.unlock('local','new-owner');
});
