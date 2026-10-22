import { chromium } from 'playwright';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

// Assumes the registered Liara sample is currently serving the intentional 500.
// Resetting the sample is a separate, explicitly approved deployment.
const origin = `http://127.0.0.1:${Number(process.env.PORT || 4317)}`;
const key = (await readFile('.data/human-key', 'utf8')).trim();
const dir = '.data/recording';
await mkdir(dir, { recursive: true });
const started = Date.now();
const marks: Record<string, number> = {};
const mark = (name: string) => { marks[name] = Math.round((Date.now() - started) / 100) / 10; };

const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox'], ignoreDefaultArgs: ['--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'fa-IR', recordVideo: { dir, size: { width: 1920, height: 1080 } } });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
mark('start');
try {
  await page.goto(`${origin}/#key=${key}`);
  await page.getByRole('heading', { name: 'از خطا تا اطمینان.' }).waitFor();
  await page.getByRole('button', { name: /negahban-demo-4d0934/ }).first().click();
  await page.waitForTimeout(8000);
  mark('liveTab');
  await page.getByRole('button', { name: /اتاق زنده/ }).click();
  await page.getByRole('heading', { name: 'پنجرهٔ زندهٔ عامل' }).waitFor();
  await page.waitForTimeout(9000);
  mark('liveStarted');
  await page.getByRole('button', { name: /شروع جلسهٔ زنده/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('ol.live-steps li b').length >= 4, undefined, { timeout: 240000 });
  mark('probeDone');
  await page.waitForTimeout(9000);
  mark('overview');
  await page.getByRole('button', { name: /اتاق عملیات/ }).click();
  await page.getByRole('button', { name: 'تأیید و اجرا' }).waitFor({ timeout: 240000 });
  mark('approvalReady');
  await page.waitForTimeout(9000);
  mark('approved');
  await page.getByRole('button', { name: 'تأیید و اجرا' }).click();
  await page.waitForTimeout(3000);
  mark('liveBack');
  await page.getByRole('button', { name: /اتاق زنده/ }).click();
  // Poll from the page itself; an async waitForFunction predicate can resolve early.
  let liveStatus = '';
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    liveStatus = await page.evaluate(async () => { const r = await fetch('/api/live/state'); const body = await r.json(); return body.live.status as string; });
    if (liveStatus === 'verified' || liveStatus === 'failed') break;
    await page.waitForTimeout(2000);
  }
  if (liveStatus !== 'verified') throw new Error(`Live verification ended as ${liveStatus}; recording would not show a real 200.`);
  mark('verified');
  await page.waitForTimeout(12000);
  mark('report');
  await page.getByRole('button', { name: /گزارش بازیابی/ }).click();
  await page.waitForTimeout(12000);
  mark('end');
} finally {
  const video = page.video();
  await context.close();
  const path = video ? await video.path() : undefined;
  if (path) await copyFile(path, join('artifacts', 'live-demo-silent.webm'));
  await browser.close();
  await writeFile('artifacts/live-demo-timeline.json', JSON.stringify({ marks, errors, recordedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ marks, errors }, null, 2));
}
