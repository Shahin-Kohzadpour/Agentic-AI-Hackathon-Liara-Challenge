import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
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
test('independent verifier passes repaired candidate including held-out cases',async()=>{const c=await setup();const r=await repaired(c);assert.equal(r.status,'awaiting_approval');assert.equal(r.candidate!.passed,true);assert.equal(r.candidate!.checks.length,7);assert.equal(c.project('local').revision,1);});
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
