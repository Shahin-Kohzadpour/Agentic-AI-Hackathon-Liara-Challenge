import { chromium } from 'playwright';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const port=Number(process.env.PORT||4317),origin=`http://127.0.0.1:${port}`;
const key=(await readFile('.data/human-key','utf8')).trim();
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
let repairInvoked=false,preparedRepairUsed=false;
try{
 const page=await browser.newPage({viewport:{width:1440,height:1080},deviceScaleFactor:1});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${origin}/#key=${key}`);await page.getByRole('heading',{name:'از خطا تا اطمینان.'}).waitFor();
 await page.screenshot({path:'artifacts/dashboard-desktop.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'desktop horizontal overflow');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/dashboard-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile horizontal overflow');
 await page.setViewportSize({width:1440,height:1080});
 await page.goto(`${origin}/demo`);await page.getByRole('button',{name:'محاسبهٔ خلاصهٔ سفارش بدون تخفیف'}).click();await page.waitForFunction(()=>/HTTP \d+/.test(document.querySelector('#result')?.textContent??''),{},{timeout:15000});await page.goto(origin);
 const before=await page.evaluate(async()=>{const r=await fetch('/demo/api/summary',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items:[{price:100,quantity:2}]})});return {status:r.status,body:await r.json()};});
 console.log(JSON.stringify({phase:'initial-demo-request',...before}));
 if(before.status===500){
  let latest=await page.evaluate(async()=>fetch('/api/state').then(r=>r.json()));
  let current=latest.incidents.find((r:any)=>r.projectId==='local');
  if(!current||!['collecting','patching','testing','awaiting_approval'].includes(current.status)){
    repairInvoked=true;
    await page.getByRole('button',{name:'بررسی و آماده‌سازی اصلاح'}).click();console.log('Actual Codex repair started through browser UI.');
  }else preparedRepairUsed=true;
  const deadline=Date.now()+180000;
  while(Date.now()<deadline){
    latest=await page.evaluate(async()=>fetch('/api/state').then(r=>r.json()));current=latest.incidents.find((r:any)=>r.projectId==='local');
    if(current&&['awaiting_approval','failed'].includes(current.status))break;
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  const prepared=await page.evaluate(async()=>fetch('/api/state').then(r=>r.json()));
  const run=prepared.incidents.find((r:any)=>r.projectId==='local');
  console.log(JSON.stringify({phase:'real-codex-result',status:run.status,error:run.error,threadId:run.threadId,passed:run.candidate?.passed}));
  await page.screenshot({path:'artifacts/approval-desktop.png',fullPage:true});
  assert.equal(run.status,'awaiting_approval',run.error??'Repair did not reach approval.');
  await page.getByRole('button',{name:'تأیید و اجرا'}).first().click();
  const recoveryDeadline=Date.now()+30000;let resolved=false;
  while(Date.now()<recoveryDeadline){const s=await page.evaluate(async()=>fetch('/api/state').then(r=>r.json()));if(s.incidents.find((r:any)=>r.projectId==='local')?.status==='resolved'){resolved=true;break;}await new Promise(resolve=>setTimeout(resolve,500));}
  assert.equal(resolved,true,'Local recovery did not complete.');
 }
 const after=await page.evaluate(async()=>{const r=await fetch('/demo/api/summary',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items:[{price:100,quantity:2}]})});return {status:r.status,body:await r.json()};});
 assert.equal(after.status,200);assert.deepEqual(after.body,{subtotal:200,discount:0,total:200});
 await page.screenshot({path:'artifacts/recovered-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'گزارش بازیابی',exact:true}).click();
 await page.screenshot({path:'artifacts/report-desktop.png',fullPage:true});
 assert.deepEqual(errors,[]);
 await writeFile('artifacts/browser-check.json',JSON.stringify({at:new Date().toISOString(),before,after,pageErrors:errors,desktopOverflow:false,mobileOverflow:false,repairInvoked,preparedRepairUsed,repair:repairInvoked?'Actual Codex SDK':preparedRepairUsed?'Existing Codex proposal exercised':'No repair invoked: the local sample was already recovered',deployment:'local rehearsal only'},null,2));
 console.log(`Browser UI, desktop/mobile layout, and recovered response passed. Repair this run: ${repairInvoked?'actual Codex SDK':preparedRepairUsed?'existing proposal':'not needed; already recovered'}.`);
}finally{await browser.close();}
