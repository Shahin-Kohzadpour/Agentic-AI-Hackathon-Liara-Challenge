import { chromium } from "playwright";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { Core } from "../src/core.ts";
import { createServer } from "../src/server.ts";
import type { ConversationAgent } from "../src/chat.ts";

// Isolated UI integration test. The model is a fixture; recovery, proposals,
// approvals, deployment, verification, storage and HTTP boundaries are real local code.
// It never reads .env, touches the user's .data, or deploys to Liara.
const root = resolve(import.meta.dirname, "..");
const data = await mkdtemp(join(tmpdir(), "negahban-browser-"));
const core = new Core(root, data, {
  async repair(source) {
    return {
      diagnosis:
        "فیلد اختیاری discounts مقدار پیش‌فرض نداشت و فراخوانی reduce باعث خطای ۵۰۰ می‌شد.",
      change: "برای تخفیف‌های تعریف‌نشده، آرایهٔ خالی در نظر گرفته شد.",
      sourceCode: source.replace(
        "order.discounts.reduce",
        "(order.discounts ?? []).reduce",
      ),
    };
  },
});
await core.initialize();
const contexts: any[] = [];
const chatAgent: ConversationAgent = {
  async respond(context: any) {
    contexts.push(context);
    await new Promise((r) => setTimeout(r, 350));
    const text: string = context.messages.at(-1).content;
    if (text.includes("خطای آزمایشی"))
      throw new Error("ارتباط آزمایشی با مدل قطع شد. دوباره تلاش کنید.");
    if (text.includes("نسخهٔ معیوب"))
      return {
        intent: "reset",
        response:
          "پیشنهاد بازنشانی به نسخهٔ معیوب را آماده می‌کنم. این عملیات خطای نمونه را برمی‌گرداند.",
      };
    if (text.includes("وضعیت فعلی"))
      return {
        intent: "diagnostics",
        response: "شواهد واقعی سرویس را بررسی می‌کنم.",
      };
    if (text.includes("اصلاح"))
      return {
        intent: "repair",
        response:
          "خطای سفارش را بررسی و اصلاح آزموده‌شده را برای تأیید شما آماده می‌کنم.",
      };
    return {
      intent: "answer",
      response:
        context.incident?.status === "resolved"
          ? "فیلد تخفیف اختیاری است؛ آرایهٔ خالی از خطای reduce جلوگیری می‌کند. آزمون‌های مستقل و پاسخ نسخهٔ منتشرشده موفق بودند."
          : "می‌توانم شواهد پروژه را بررسی کنم و اصلاح نمونه را برای تأیید شما آماده کنم.",
    };
  },
};
const port = await new Promise<number>((resolve, reject) => {
  const s = net.createServer();
  s.on("error", reject);
  s.listen(0, "127.0.0.1", () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => resolve(p));
  });
});
const { app, origin } = await createServer({ root, core, port, chatAgent });
await app.listen({ port, host: "127.0.0.1" });
const key = (await readFile(join(data, "human-key"), "utf8")).trim();
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
  ignoreDefaultArgs: ["--disable-dev-shm-usage"],
});
const pageErrors: string[] = [];
const screenshot = async (page: import("playwright").Page, name: string) =>
  page.screenshot({ path: `artifacts/chat-${name}.png`, fullPage: true });
const noOverflow = async (page: import("playwright").Page) =>
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "page must not overflow horizontally",
  );
try {
  const gate = await browser.newPage();
  let loginRequests = 0;
  gate.on("request", (r) => {
    if (r.url().endsWith("/api/session") && r.method() === "POST")
      loginRequests++;
  });
  await gate.goto(origin);
  await gate.getByRole("heading", { name: "فضای خصوصی نگهبان" }).waitFor();
  const login = gate.getByRole("button", { name: "ورود به فضای کار" });
  assert.equal(await login.isDisabled(), true);
  await gate.locator("#key").fill("abcd");
  assert.equal(await login.isDisabled(), true);
  assert.match(await gate.locator("#key-hint").innerText(), /کوتاه/);
  await gate.locator("#key").press("Enter");
  assert.equal(loginRequests, 0);
  await gate.locator("#key").fill(`  ${key}  `);
  await login.click();
  await gate
    .getByRole("heading", { name: "روی لیارا، چه کاری انجام بدهیم؟" })
    .waitFor();
  await gate.close();

  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`${origin}/#key=${key}`);
  await page
    .getByRole("heading", { name: "روی لیارا، چه کاری انجام بدهیم؟" })
    .waitFor();
  await page
    .getByRole("combobox", { name: "پروژهٔ فعال" })
    .selectOption("local");
  await screenshot(page, "home-desktop");
  await noOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "نمایش گفتگوها", exact: true })
    .waitFor();
  await screenshot(page, "home-mobile");
  await noOverflow(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page
    .getByRole("button", { name: "گفتگوی تازه", exact: true })
    .waitFor();

  await page.getByRole("button", { name: /وضعیت پروژه را بررسی کن/ }).click();
  await page.locator("#prompt").press("Enter");
  await page.getByRole("button", { name: /شواهد تازهٔ پروژه/ }).waitFor();
  await page.getByRole("button", { name: /شواهد تازهٔ پروژه/ }).click();
  await page.getByRole("heading", { name: "شواهد سرویس" }).waitFor();
  await noOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await screenshot(page, "evidence-mobile");
  await page.getByRole("button", { name: "بستن جزئیات", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "گفتگوی تازه", exact: true }).click();
  await page.getByRole("button", { name: /خطا را پیدا و اصلاح کن/ }).click();
  await page.locator("#prompt").press("Enter");
  await page
    .getByRole("button", { name: "تأیید و اجرا", exact: true })
    .waitFor({ timeout: 30000 });
  assert.equal(
    core.project("local").revision,
    1,
    "proposed repair must not execute before approval",
  );
  const repairConversation = await page.evaluate(() =>
    localStorage.getItem("negahban-conversation"),
  );
  await screenshot(page, "approval-desktop");
  await page
    .getByRole("button", { name: "مشاهدهٔ تغییر", exact: true })
    .click();
  await page.getByRole("heading", { name: "تغییر پیشنهادی" }).waitFor();
  await screenshot(page, "changes-desktop");
  await noOverflow(page);
  await page.getByRole("button", { name: "بستن جزئیات", exact: true }).click();
  await page.getByRole("button", { name: "تأیید و اجرا", exact: true }).click();
  await page
    .getByText("رفع خطا تأیید شد", { exact: true })
    .waitFor({ timeout: 30000 });
  assert.equal(core.project("local").revision, 2);
  const response = await fetch(`${origin}/demo/api/summary`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ items: [{ price: 100, quantity: 2 }] }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    subtotal: 200,
    discount: 0,
    total: 200,
  });
  await page.locator("#prompt").fill("چرا این تغییر لازم بود؟");
  await page.locator("#prompt").press("Enter");
  await page
    .getByText(
      "فیلد تخفیف اختیاری است؛ آرایهٔ خالی از خطای reduce جلوگیری می‌کند. آزمون‌های مستقل و پاسخ نسخهٔ منتشرشده موفق بودند.",
      { exact: true },
    )
    .waitFor();
  assert.equal(contexts.at(-1).incident.status, "resolved");
  await page.reload();
  await page.getByText("چرا این تغییر لازم بود؟", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("negahban-conversation")),
    repairConversation,
  );
  await screenshot(page, "conversation-desktop");
  await page.getByRole("button", { name: "آزمون‌ها", exact: true }).click();
  await page.getByRole("heading", { name: "نتیجهٔ آزمون‌ها" }).waitFor();
  await screenshot(page, "tests-desktop");
  await noOverflow(page);
  await page.getByRole("button", { name: "بستن جزئیات", exact: true }).click();

  await page
    .getByRole("button", { name: "تنظیمات و اتصال", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.getByRole("button", { name: "گفتگوی تازه", exact: true }).click();
  await page.locator("#prompt").fill("نسخهٔ معیوب را برای تمرین آماده کن");
  await page.locator("#prompt").press("Enter");
  await page
    .getByRole("button", { name: "تأیید و اجرا", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "انصراف", exact: true }).click();
  await page.getByText("لغو شد", { exact: true }).first().waitFor();
  assert.equal(
    core.project("local").revision,
    2,
    "rejecting reset must preserve the deployed source",
  );
  await page.locator("#prompt").fill("نسخهٔ معیوب را دوباره آماده کن");
  await page.locator("#prompt").press("Enter");
  await page
    .getByRole("button", { name: "تأیید و اجرا", exact: true })
    .waitFor();
  const action = core.state().actions.find((a) => a.status === "pending")!;
  action.expiresAt = new Date(Date.now() - 1000).toISOString();
  core.store.put("actions", action);
  await page.reload();
  await page.getByText("مهلت تأیید تمام شد", { exact: true }).first().waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "تأیید و اجرا", exact: true })
      .count(),
    0,
  );
  await page.locator("#prompt").fill("خطای آزمایشی");
  await page.locator("#prompt").press("Enter");
  await page
    .getByText("ارتباط آزمایشی با مدل قطع شد. دوباره تلاش کنید.", {
      exact: true,
    })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page
    .getByRole("button", { name: "نمایش گفتگوها", exact: true })
    .waitFor();
  await screenshot(page, "conversation-mobile");
  await page
    .getByRole("button", { name: "نمایش گفتگوها", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "جستجو در گفتگوها" })
    .fill("وضعیت فعلی");
  await page.getByRole("navigation").getByRole("button").first().click();
  await page.getByRole("button", { name: /شواهد تازهٔ پروژه/ }).waitFor();
  assert.equal(
    await page.getByText("چرا این تغییر لازم بود؟", { exact: true }).count(),
    0,
    "history selection must show only the selected conversation",
  );
  await page.getByRole("button", { name: "نمای زنده", exact: true }).click();
  await page.getByRole("heading", { name: "نمای زندهٔ عامل" }).waitFor();
  assert.equal(
    await page.locator('img[src="/api/live/mjpeg"]').count(),
    0,
    "opening a panel must not start browser automation",
  );
  await noOverflow(page);
  assert.deepEqual(pageErrors, []);
  await writeFile(
    "artifacts/chat-browser-check.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        mode: "isolated local integration with fixture model",
        pageErrors,
        desktopOverflow: false,
        mobileOverflow: false,
        gate: "passed",
        diagnostics: "passed",
        recoveryAndApproval: "passed",
        verifiedHttpStatus: 200,
        followupContext: "passed",
        persistedHistory: "passed",
        rejectionAndExpiry: "passed",
        failedReply: "passed",
        historySearch: "passed",
        cloudOperations: 0,
      },
      null,
      2,
    ),
  );
  console.log(
    "Chat browser checks passed: gate, responsive layout, real local recovery, approval/rejection/expiry, persisted history, contextual follow-up, diagnostics, failure and live preview. No cloud changes.",
  );
} finally {
  await browser.close();
  await core.settle();
  await app.close();
  core.store.db.close();
  await rm(data, { recursive: true, force: true });
}
