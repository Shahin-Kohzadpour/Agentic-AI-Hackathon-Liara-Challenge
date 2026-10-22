import { chromium } from 'playwright';
import { readFile,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin=`http://127.0.0.1:${process.env.PORT||4317}`;
const key=(await readFile('.data/human-key','utf8')).trim();
const proposal=JSON.parse(await readFile('artifacts/live-repair-proposal.json','utf8'));
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:'artifacts/video',size:{width:1440,height:1000}}});
const page=await context.newPage(),wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
try{
 await page.goto(`${origin}/#key=${key}`);await page.getByRole('heading',{name:'از خطا تا اطمینان.'}).waitFor();
 await page.getByRole('button',{name:/negahban-demo-/}).click();await page.getByRole('button',{name:'گزارش بازیابی',exact:true}).click();
 await wait(3000);await page.getByRole('button',{name:'بررسی دوبارهٔ نتیجه'}).click();
 const deadline=Date.now()+45000;let run:any;
 while(Date.now()<deadline){const s=await page.evaluate(async()=>fetch('/api/state').then(r=>r.json()));run=s.incidents.find((r:any)=>r.id===proposal.action.runId);if(run?.status==='resolved')break;await wait(1000);}
 assert.equal(run?.status,'resolved',run?.error??'Recheck failed.');
 await wait(2500);await page.screenshot({path:'artifacts/live-recovery-report.png',fullPage:true});await page.screenshot({path:'artifacts/scene-report.png'});
 const report=await page.request.get(`${origin}/api/reports/${run.id}`).then(r=>r.json());await writeFile('artifacts/live-recovery-report.json',JSON.stringify(report,null,2));await wait(6000);
 await page.getByRole('button',{name:'اتاق عملیات',exact:true}).click();await wait(1500);await page.screenshot({path:'artifacts/live-recovered-dashboard.png',fullPage:true});await page.screenshot({path:'artifacts/scene-recovered.png'});
 await page.getByText('مشاهدهٔ تغییر پیشنهادی',{exact:false}).click();await page.locator('.diagnosis').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/scene-diff.png'});await wait(5000);
 await page.getByRole('button',{name:'شواهد و تشخیص',exact:true}).click();await page.locator('.evidence-item').filter({hasText:'لاگ‌های برنامه'}).locator('summary').click();await page.screenshot({path:'artifacts/scene-evidence.png'});await wait(5000);
 await page.goto(`${origin}/demo?target=liara`);await page.getByRole('button',{name:'محاسبهٔ خلاصهٔ سفارش بدون تخفیف'}).click();await page.waitForFunction(()=>/HTTP \d+/.test(document.querySelector('#result')?.textContent??''),{},{timeout:15000});
 assert.match(await page.locator('#result').innerText(),/HTTP 200/);await page.screenshot({path:'artifacts/live-request-after.png'});await wait(5000);
 console.log(JSON.stringify({status:run.status,releaseId:run.releaseId,verification:run.verification,recheckOnly:true},null,2));
}finally{const video=page.video();await context.close();if(video)await video.saveAs('artifacts/live-recheck-silent.webm');await browser.close();}
