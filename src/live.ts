import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright';
import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { messageOf } from './security.ts';
import type { Core } from './core.ts';

export type LiveStatus = 'idle' | 'running' | 'awaiting_fix' | 'verifying' | 'verified' | 'failed' | 'stopped';
export interface LiveStep { id: number; at: string; state: 'running' | 'done' | 'failed'; title: string; detail?: string; }
export interface LiveProbe { status: number; body: unknown; at: string; }
export interface LiveSnapshot {
  status: LiveStatus;
  projectId?: string;
  projectName?: string;
  currentUrl?: string;
  appUrl?: string;
  consoleSession: boolean;
  steps: LiveStep[];
  reproduced?: LiveProbe;
  verified?: LiveProbe;
  error?: string;
  startedAt?: string;
}
type Listener = (event: 'state', payload: unknown) => void;
type FrameListener = (jpeg: Buffer) => void;
interface StepHandle { done(next?: string): void; fail(next?: string): void; progress(next: string): void; }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const DEMO_BUTTON = '#test';

/**
 * Runs a real Chromium session against the Liara console and the deployed sample,
 * and streams its screen over Server-Sent Events. The browser is driven only by the
 * fixed playbook below; the model never receives control of this session and the
 * console password never leaves the local process.
 */
export class LiveOperator {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private cdp?: CDPSession;
  private frame?: Buffer;
  private listeners = new Set<Listener>();
  private frameListeners = new Set<FrameListener>();
  private steps: LiveStep[] = [];
  private seq = 0;
  private state: LiveSnapshot = { status: 'idle', consoleSession: false, steps: [] };
  private lastFrameAt = 0;
  private keepalive?: NodeJS.Timeout;
  private stopped = false;
  // Session cookies for the console live only in .data (0600) and never reach the model or reports.
  private get consoleState() { return join(this.core.data, 'console-state.json'); }
  private flow?: Promise<void>;
  private runId?: string;
  private demoUrl = '';

  constructor(private core: Core, private demoBase: () => string) {}

  snapshot(): LiveSnapshot { return { ...this.state, steps: this.steps.map(s => ({ ...s })) }; }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener('state', this.snapshot());
    return () => { this.listeners.delete(listener); };
  }

  /** Native MJPEG delivery: Chromium replaces frames in one <img>, no per-frame JS decode. */
  subscribeFrames(listener: FrameListener) {
    this.frameListeners.add(listener);
    if (this.frame) listener(this.frame);
    return () => { this.frameListeners.delete(listener); };
  }

  private emit(event: 'state', payload: unknown) { for (const listener of this.listeners) { try { listener(event, payload); } catch {} } }
  private emitFrame(jpeg: Buffer) {
    this.frame = jpeg;
    for (const listener of this.frameListeners) { try { listener(jpeg); } catch {} }
  }
  private publish() { this.state.steps = this.steps; this.emit('state', this.snapshot()); }

  private step(title: string, detail?: string): StepHandle {
    const step: LiveStep = { id: ++this.seq, at: new Date().toISOString(), state: 'running', title, ...(detail ? { detail } : {}) };
    this.steps.push(step); this.state.steps = this.steps; this.emit('state', this.snapshot());
    return {
      done: (next?: string) => { step.state = 'done'; if (next) step.detail = next; this.emit('state', this.snapshot()); },
      fail: (next?: string) => { step.state = 'failed'; if (next) step.detail = next; this.emit('state', this.snapshot()); },
      progress: (next: string) => { step.detail = next; this.emit('state', this.snapshot()); },
    };
  }

  private async launch() {
    const executablePath = process.env.LIVE_CHROMIUM || '/usr/bin/chromium';
    // Keep /dev/shm: forcing Chromium onto /tmp for compositor buffers caused renderer crashes on this host.
    this.browser = await chromium.launch({ headless: process.env.LIVE_HEADLESS !== 'false', executablePath, args: ['--no-sandbox'], ignoreDefaultArgs: ['--disable-dev-shm-usage'] });
    const storageState = await readFile(this.consoleState, 'utf8').then(text => JSON.parse(text)).catch(() => undefined);
    const context = await this.browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fa-IR', deviceScaleFactor: 1, ...(storageState ? { storageState } : {}) });
    this.context = context;
    // Do not abort third-party requests: the console's hydration hangs when its analytics fetch fails.
    // The console is the real site; ad hosts are left untouched so the automation behaves like a person.
    this.page = await context.newPage();
    this.cdp = await context.newCDPSession(this.page);
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 55, maxWidth: 1024, maxHeight: 640, everyNthFrame: 1 });
    this.cdp.on('Page.screencastFrame', (frame: { data: string; sessionId: number }) => {
      if (Date.now() - this.lastFrameAt < 300) { void this.cdp?.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {}); return; }
      this.lastFrameAt = Date.now();
      this.emitFrame(Buffer.from(frame.data, 'base64'));
      void this.cdp?.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
    });
    // Screencast is event-driven; a static page would look frozen. Sample it while it sleeps.
    this.keepalive = setInterval(() => {
      // Nobody is watching: do not burn CPU capturing an idle browser.
      if (this.stopped || !this.page || (this.listeners.size === 0 && this.frameListeners.size === 0) || Date.now() - this.lastFrameAt < 1500) return;
      void this.page.screenshot({ type: 'jpeg', quality: 55 }).then(buffer => {
        this.lastFrameAt = Date.now(); this.emitFrame(buffer);
      }).catch(() => {});
    }, 1000);
  }

  async start(projectId: string, hooks: { onReproduced?: () => Promise<string | undefined> | string | undefined } = {}) {
    if (['running', 'awaiting_fix', 'verifying'].includes(this.state.status)) throw new Error('یک جلسهٔ زندهٔ دیگر در حال اجراست.');
    const project = this.core.project(projectId);
    if (this.browser) await this.stop();
    this.stopped = false;
    this.steps = []; this.seq = 0; this.frame = undefined; this.runId = undefined;
    this.state = { status: 'running', projectId, projectName: project.name, consoleSession: false, steps: [], startedAt: new Date().toISOString() };
    this.publish();
    this.flow = this.run(projectId, hooks).catch(error => this.fail(error));
    return this.snapshot();
  }

  private fail(error: unknown) {
    if (this.stopped) { this.state.status = 'stopped'; return; }
    this.state.status = 'failed'; this.state.error = messageOf(error);
    this.steps.push({ id: ++this.seq, at: new Date().toISOString(), state: 'failed', title: 'جلسهٔ زنده متوقف شد', detail: this.state.error });
    this.publish();
  }

  private async run(projectId: string, hooks: { onReproduced?: () => Promise<string | undefined> | string | undefined }) {
    const project = this.core.project(projectId);
    const demoUrl = `${this.demoBase()}/demo${project.mode === 'liara' ? '?target=liara' : ''}`;
    this.demoUrl = demoUrl;
    this.state.appUrl = project.mode === 'liara' ? this.core.liara.appUrl(project.name) : demoUrl;
    await this.launch();
    if (this.stopped) return;

    const login = this.step(project.mode === 'liara' ? 'ورود زنده به کنسول لیارا' : 'اجرای محلی بدون کنسول');
    if (project.mode !== 'liara') {
      login.done('این پروژه محلی است؛ کنسول لیارا لازم نیست.');
    } else {
      try {
        const connected = await this.consoleLogin();
        this.state.consoleSession = connected;
        if (connected) login.done(`تیم «${process.env.LIARA_TEAM_NAME || 'لیارا'}» انتخاب شد.`);
        else login.done('کلید کنسول تنظیم نشده است؛ جلسه از ویترین فروشگاه ادامه می‌یابد.');
      } catch (error) {
        login.fail(`ورود به کنسول ممکن نشد؛ ادامهٔ نمایش بدون کنسول. ${messageOf(error)}`);
        await this.page?.goto('about:blank').catch(() => {});
      }
    }
    if (this.stopped) return;

    if (project.mode === 'liara' && this.state.consoleSession) {
      const visit = this.step('باز کردن برنامه در کنسول', project.name);
      try {
        await this.goto(`https://console.liara.ir/apps/${encodeURIComponent(project.name)}/overview`, 2600);
        await this.goto(`https://console.liara.ir/apps/${encodeURIComponent(project.name)}/releases`, 2200);
        await this.goto(`https://console.liara.ir/apps/${encodeURIComponent(project.name)}/logs`, 2200);
        visit.done('اطلاعات کلی، تاریخچهٔ نسخه‌ها و لاگ‌های برنامه مرور شد.');
      } catch (error) { visit.fail(messageOf(error)); }
    }
    if (this.stopped) return;

    const open = this.step('باز کردن ویترین فروشگاه', project.mode === 'liara' ? 'درخواست از برنامهٔ واقعی لیارا عبور می‌کند.' : 'اجرای محلی و جدا.');
    try {
      await this.page!.goto(demoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page!.locator(DEMO_BUTTON).waitFor({ timeout: 15000 });
      this.state.currentUrl = demoUrl; this.publish();
      open.done();
    } catch (error) { open.fail(messageOf(error)); throw error; }
    if (this.stopped) return;

    const probe = await this.reproduce('بازتولید خطا با یک درخواست واقعی', 500, 1);
    this.state.reproduced = probe; this.publish();
    if (probe.status === 500) {
      this.state.status = 'awaiting_fix';
      this.publish();
      const runId = await hooks.onReproduced?.();
      if (runId) this.runId = runId;
      await this.watchResolution();
    } else {
      const note = this.step('خطای ۵۰۰ بازتولید نشد', `پاسخ دریافتی HTTP ${probe.status} بود؛ برای نمایش رخداد ابتدا نسخهٔ معیوب را از کارت عملیات منتشر کنید.`);
      this.state.status = probe.status === 200 ? 'idle' : 'failed';
      note.done(this.state.status === 'idle' ? 'سرویس در حال حاضر سالم است.' : 'پاسخ غیرمنتظره ثبت شد.');
      this.publish();
    }
  }

  private async consoleLogin() {
    const email = process.env.LIARA_CONSOLE_EMAIL, password = process.env.LIARA_CONSOLE_PASSWORD;
    if (!email || !password) return false;
    const page = this.page!;
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.goto('https://console.liara.ir/auth', { waitUntil: 'commit', timeout: 60000 });
      const stage = await this.consoleStage(45000);
      // A persisted session lands on team selection or the app list, never on the password form.
      if (stage === 'apps') return true;
      if (stage === 'team') { await this.enterConsoleTeam(); return true; }
      if (stage !== 'email') continue;
      await page.locator('input[type=email]').first().fill(email);
      await page.getByRole('button', { name: 'ادامه' }).click();
      const passwordInput = page.locator('input[type=password]');
      await passwordInput.waitFor({ timeout: 30000 });
      await passwordInput.fill(password);
      await page.getByRole('button', { name: 'تایید' }).click();
      const next = await this.consoleStage(60000);
      if (next === 'team') { await this.enterConsoleTeam(); return true; }
      if (next === 'apps') return true;
      throw new Error('پس از ورود، صفحهٔ تیم یا برنامه‌ها بارگذاری نشد.');
    }
    throw new Error('صفحهٔ ورود کنسول در مهلت مقرر بارگذاری نشد.');
  }

  private async consoleStage(timeout: number): Promise<'email' | 'team' | 'apps' | 'unknown'> {
    const page = this.page!;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (page.url().includes('/apps') && !page.url().includes('/auth')) return 'apps';
      if (await page.getByText('انتخاب تیم').first().isVisible().catch(() => false)) return 'team';
      if (await page.locator('input[type=email]').first().isVisible().catch(() => false)) return 'email';
      await sleep(800);
    }
    return 'unknown';
  }

  private async enterConsoleTeam() {
    const page = this.page!;
    this.state.currentUrl = page.url(); this.publish();
    const team = process.env.LIARA_TEAM_NAME || 'لیارا';
    await page.getByText(team, { exact: true }).first().click();
    await page.waitForURL('**/apps**', { timeout: 60000 });
    await sleep(1200);
    this.state.currentUrl = page.url(); this.publish();
    await this.rememberConsoleSession();
  }

  private async rememberConsoleSession() {
    if (!this.context) return;
    await this.context.storageState({ path: this.consoleState }).then(() => chmod(this.consoleState, 0o600)).catch(() => {});
  }

  private async goto(url: string, settle: number) {
    await this.page!.goto(url, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
    await sleep(settle);
    this.state.currentUrl = this.page!.url(); this.publish();
  }

  private async reproduce(title: string, expected: number, attempts = 1): Promise<LiveProbe> {
    const step = this.step(title);
    const page = this.page!;
    let probe: LiveProbe | undefined;
    try {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        if (attempt > 1) {
          // Edge routing may serve the previous release for a while after READY; re-open and retry.
          await page.goto(this.demoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.locator(DEMO_BUTTON).waitFor({ timeout: 15000 });
          step.progress(`تلاش ${attempt} از ${attempts}؛ انتشار در لبهٔ شبکه هنوز تثبیت نشده است.`);
        }
        await page.locator(DEMO_BUTTON).click({ timeout: 15000 });
        await page.waitForFunction(() => ((document.querySelector('#result')?.textContent) ?? '').startsWith('HTTP '), undefined, { timeout: 20000 });
        const text = (await page.locator('#result').textContent()) ?? '';
        const [head, ...rest] = text.split('\n');
        const status = Number(head.replace('HTTP ', '').trim());
        let body: unknown = rest.join('\n');
        try { body = JSON.parse(rest.join('\n')); } catch {}
        probe = { status, body, at: new Date().toISOString() };
        if (status === expected) {
          step.done(expected === 500 ? 'درخواست کاربردی طبق انتظار ۵۰۰ دریافت کرد؛ شواهد واقعی ثبت شد.' : `پاسخ ۲۰۰ پس از ${attempt} تلاش روی نسخهٔ تازه تأیید شد.`);
          return probe;
        }
        if (expected === 200 && attempt < attempts) await sleep(3000);
      }
      const detail = `پاسخ نهایی زنده: HTTP ${probe?.status ?? '—'}`;
      if (expected === 200) step.fail(detail); else step.done(detail);
      return probe!;
    } catch (error) {
      step.fail(messageOf(error));
      throw error;
    }
  }

  private async watchResolution() {
    if (!this.runId) { this.state.status = 'failed'; this.state.error = 'رخداد خودکار ثبت نشد؛ بررسی دستی لازم است.'; this.publish(); return; }
    const deadline = Date.now() + 15 * 60_000;
    let announced = false, deployStep: StepHandle | undefined;
    while (!this.stopped && Date.now() < deadline) {
      const incident = this.core.state().incidents.find(run => run.id === this.runId);
      if (incident) {
        if (incident.status === 'awaiting_approval' && !announced) {
          announced = true;
          this.step('اصلاح آزموده شد؛ منتظر تأیید شما', 'هیچ تغییری روی سرویس بدون تأیید انسان انجام نمی‌شود.').done();
        }
        if (incident.status === 'deploying' && !deployStep) {
          deployStep = this.step('انتشار با تأیید شما آغاز شد');
        }
        if (incident.status === 'verifying' && deployStep) { deployStep.done('نسخهٔ جدید منتشر شد؛ بررسی زندهٔ نتیجه انجام می‌شود.'); deployStep = undefined; }
        if (incident.status === 'resolved') {
          if (deployStep) { deployStep.done('نسخهٔ جدید منتشر شد.'); deployStep = undefined; }
          this.state.status = 'verifying'; this.publish();
          const probe = await this.reproduce('بررسی دوبارهٔ همان درخواست روی سرویس زنده', 200, 12);
          this.state.verified = probe;
          if (probe.status === 200) {
            this.state.status = 'verified'; this.publish();
            await this.showNewRelease();
          } else {
            this.state.status = 'failed'; this.publish();
          }
          return;
        }
        if (['failed', 'rejected'].includes(incident.status)) {
          if (deployStep) { deployStep.fail(incident.error); deployStep = undefined; }
          this.state.status = 'failed'; this.state.error = incident.error; this.publish();
          return;
        }
      }
      await sleep(2000);
    }
    if (!this.stopped) { this.state.status = 'failed'; this.state.error = 'مهلت پانزده‌دقیقه‌ای برای تأیید و انتشار تمام شد.'; this.publish(); }
  }

  private async showNewRelease() {
    if (!this.state.consoleSession || !this.state.projectName) return;
    const step = this.step('نمایش نسخهٔ تازه در کنسول لیارا');
    try {
      await this.goto(`https://console.liara.ir/apps/${encodeURIComponent(this.state.projectName)}/releases`, 3200);
      step.done('نسخهٔ منتشرشده در تاریخچهٔ کنسول دیده می‌شود.');
    } catch (error) { step.fail(messageOf(error)); }
  }

  async verify() {
    if (!this.page || !this.browser?.isConnected()) throw new Error('جلسهٔ زنده فعال نیست؛ ابتدا آن را شروع کنید.');
    if (!['awaiting_fix', 'verifying', 'verified', 'failed'].includes(this.state.status)) throw new Error('این جلسه در وضعیت قابل‌بررسی نیست.');
    this.state.status = 'verifying'; this.publish();
    let probe: LiveProbe;
    try { probe = await this.reproduce('بررسی دستی دوبارهٔ درخواست', 200, 12); }
    catch (error) { this.state.status = 'failed'; this.state.error = messageOf(error); this.publish(); throw error; }
    this.state.verified = probe;
    this.state.status = probe.status === 200 ? 'verified' : 'awaiting_fix';
    this.publish();
    if (probe.status === 200) await this.showNewRelease();
    return this.snapshot();
  }

  async stop() {
    this.stopped = true;
    if (this.keepalive) clearInterval(this.keepalive);
    if (this.state.status !== 'verified') this.state.status = 'stopped';
    this.publish();
    try { await this.cdp?.send('Page.stopScreencast'); } catch {}
    await Promise.race([this.flow?.catch(() => {}), sleep(8000)]);
    await this.browser?.close().catch(() => {});
    this.browser = undefined; this.context = undefined; this.page = undefined; this.cdp = undefined;
    return this.snapshot();
  }
}
