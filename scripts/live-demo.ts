import { chromium } from 'playwright';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// Run only after the owner has approved this exact saved proposal.
if(!process.argv.includes('--approved'))throw new Error('Explicit approval of the saved live proposal is required.');
const proposal=JSON.parse(await readFile('artifacts/live-repair-proposal.json','utf8'));
const origin=`http://127.0.0.1:${process.env.PORT||4317}`;
const key=(await readFile('.data/human-key','utf8')).trim();
await mkdir('artifacts/video',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:'artifacts/video',size:{width:1440,height:1000}}});
const page=await context.newPage();
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let report:unknown;
try{
 await page.goto(`${origin}/#key=${key}`);await page.getByRole('heading',{name:'از خطا تا اطمینان.'}).waitFor();
 await page.getByRole('button',{name:/negahban-demo-/}).click();await wait(1500);
 const state=await page.evaluate(async()=>fetch('/api/state').then(r=>r.json()));
 const action=state.actions.find((a:any)=>a.id===proposal.action.id);
 assert.equal(action.digest,proposal.action.digest);assert.equal(action.status,'pending');
 await page.screenshot({path:'artifacts/live-before-dashboard.png',fullPage:true});await wait(5000);
 await page.goto(`${origin}/demo?target=liara`);await page.getByRole('button',{name:'محاسبهٔ خلاصهٔ سفارش بدون تخفیف'}).click();await page.waitForFunction(()=>/HTTP \d+/.test(document.querySelector('#result')?.textContent??''),{},{timeout:15000});
 assert.match(await page.locator('#result').innerText(),/HTTP 500/);await page.screenshot({path:'artifacts/live-request-before.png'});await wait(7000);
 await page.goto(origin);await page.getByRole('button',{name:/negahban-demo-/}).click();await wait(1000);
 await page.getByRole('button',{name:'شواهد و تشخیص',exact:true}).click();await wait(1500);
 await page.locator('.evidence-item').filter({hasText:'لاگ‌های برنامه'}).locator('summary').click();await wait(7000);
 await page.screenshot({path:'artifacts/live-evidence.png',fullPage:true});
 await page.getByRole('button',{name:'اتاق عملیات',exact:true}).click();
 await page.getByText('مشاهدهٔ تغییر پیشنهادی',{exact:false}).click();await page.locator('.diagnosis').scrollIntoViewIfNeeded();await wait(9000);
 await page.screenshot({path:'artifacts/live-diff.png',fullPage:true});
 const card=page.locator('.approval').filter({hasText:proposal.action.digest.slice(0,12)});await card.scrollIntoViewIfNeeded();await wait(6000);
 console.log(JSON.stringify({phase:'approve-exact-live-action',actionId:action.id,sourceDigest:action.digest}));
 await card.getByRole('button',{name:'تأیید و اجرا'}).click();
 const deadline=Date.now()+300000;let run:any;
 while(Date.now()<deadline){const s=await page.evaluate(async()=>fetch('/api/state').then(r=>r.json()));run=s.incidents.find((r:any)=>r.id===proposal.action.runId);if(['resolved','failed'].includes(run?.status))break;await wait(2000);}
 assert.equal(run?.status,'resolved',run?.error??'Live recovery did not finish.');
 await page.screenshot({path:'artifacts/live-recovered-dashboard.png',fullPage:true});await wait(5000);
 await page.getByRole('button',{name:'گزارش بازیابی',exact:true}).click();await wait(7000);await page.screenshot({path:'artifacts/live-recovery-report.png',fullPage:true});
 const response=await page.request.get(`${origin}/api/reports/${run.id}`);report=await response.json();await writeFile('artifacts/live-recovery-report.json',JSON.stringify(report,null,2));
 await page.goto(`${origin}/demo?target=liara`);await page.getByRole('button',{name:'محاسبهٔ خلاصهٔ سفارش بدون تخفیف'}).click();await page.waitForFunction(()=>/HTTP \d+/.test(document.querySelector('#result')?.textContent??''),{},{timeout:15000});assert.match(await page.locator('#result').innerText(),/HTTP 200/);await page.screenshot({path:'artifacts/live-request-after.png'});await wait(7000);
 console.log(JSON.stringify({phase:'live-recovery-complete',runId:run.id,releaseId:run.releaseId,verification:run.verification}));
}finally{
 const video=page.video();await context.close();if(video)await video.saveAs(join(process.cwd(),'artifacts','live-demo-silent.webm'));await browser.close();
}
