import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
import { Core } from "../src/core.ts";
import { Chat, type ConversationAgent } from "../src/chat.ts";
import { createServer } from "../src/server.ts";
import type { ChatMessage } from "../src/types.ts";

const root = resolve(import.meta.dirname, "..");
async function setup(t: TestContext, agent: ConversationAgent) {
  const data = await mkdtemp(join(tmpdir(), "negahban-chat-test-"));
  const core = new Core(root, data, {
    async repair(source) {
      return {
        diagnosis: "فیلد تخفیف اختیاری پیش از reduce مقدار پیش‌فرض ندارد.",
        change: "آرایهٔ خالی برای تخفیف اختیاری اضافه شد.",
        sourceCode: source.replace(
          "order.discounts.reduce",
          "(order.discounts ?? []).reduce",
        ),
      };
    },
  });
  await core.initialize();
  const chat = new Chat(core, agent);
  chat.initialize();
  t.after(async () => {
    await core.settle();
    core.store.db.close();
    await rm(data, { recursive: true, force: true });
  });
  return { core, chat };
}

test("chat persists history, preserves project context and deduplicates retried messages", async (t) => {
  const contexts: any[] = [];
  const { core, chat } = await setup(t, {
    async respond(context) {
      contexts.push(context);
      return { intent: "answer", response: "پاسخ بر اساس گفتگوی همین پروژه." };
    },
  });
  const conversation = chat.create("local");
  const first = chat.send(
    conversation.id,
    "چه کارهایی می‌توانی انجام بدهی؟",
    "request_001",
  );
  chat.send(conversation.id, first.content, "request_001");
  await core.settle();
  assert.equal(contexts.length, 1);
  chat.send(conversation.id, "بیشتر توضیح بده", "request_002");
  await core.settle();
  assert.equal(contexts[1].project.id, "local");
  assert.deepEqual(
    contexts[1].messages.map((m: ChatMessage) => m.role),
    ["user", "assistant", "user"],
  );
  const reopened = new Chat(core);
  reopened.initialize();
  assert.equal(reopened.state().messages.length, 4);
  assert.equal(reopened.state().conversations[0].title, first.content);
  const other = chat.create("local");
  chat.send(other.id, "سؤال مستقل", "request_003");
  await core.settle();
  assert.equal(
    contexts[2].messages.length,
    1,
    "another conversation must not inherit earlier prompts",
  );
});

test("chat links actual recovery, explicit approval and follow-up verification", async (t) => {
  let context: any;
  const { core, chat } = await setup(t, {
    async respond(c: any) {
      context = c;
      return c.messages.at(-1).content === "دوباره بررسی کن"
        ? { intent: "verify", response: "نسخه را دوباره بررسی می‌کنم." }
        : { intent: "repair", response: "خطای سفارش را بررسی می‌کنم." };
    },
  });
  const conversation = chat.create("local");
  chat.send(conversation.id, "خطای ۵۰۰ سفارش را اصلاح کن", "request_001");
  await core.settle();
  await core.settle();
  const reply = chat.state().messages.find((m) => m.incidentId)!;
  const run = core.incident(reply.incidentId!);
  assert.equal(run.status, "awaiting_approval");
  assert.equal(core.project("local").revision, 1);
  await assert.rejects(core.execute(run.actionId!), /تأیید/);
  core.decide(run.actionId!, "approve");
  await core.execute(run.actionId!);
  assert.equal(core.incident(run.id).status, "resolved");
  chat.send(conversation.id, "دوباره بررسی کن", "request_002");
  await core.settle();
  assert.equal(context.incident.id, run.id);
  assert.equal(context.action.status, "succeeded");
  assert.equal(
    core.project("local").revision,
    2,
    "follow-up verification must not redeploy",
  );
  assert.equal(chat.state().messages.at(-1)?.status, "complete");
});

test("chat serializes replies and reports model failures without losing the user message", async (t) => {
  let finish: (v: any) => void = () => {};
  const { core, chat } = await setup(t, {
    respond() {
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const conversation = chat.create("local");
  chat.send(conversation.id, "درخواست اول", "request_001");
  assert.throws(
    () => chat.send(conversation.id, "درخواست دوم", "request_002"),
    /قبلی/,
  );
  finish({ intent: "invalid", response: "" });
  await core.settle();
  assert.equal(chat.state().messages.length, 2);
  assert.equal(chat.state().messages[0].content, "درخواست اول");
  assert.equal(chat.state().messages[1].status, "failed");
  assert.doesNotMatch(
    chat.state().messages[1].content,
    /invalid_value|Zod|expected/,
  );
});

test("diagnostics saves actual evidence and invalid operations become explicit failures", async (t) => {
  let intent = "diagnostics" as "diagnostics" | "restart";
  const { core, chat } = await setup(t, {
    async respond() {
      return { intent, response: "درخواست را بررسی می‌کنم." };
    },
  });
  const conversation = chat.create("local");
  chat.send(conversation.id, "وضعیت را بررسی کن", "request_001");
  await core.settle();
  const evidence = chat.state().messages.at(-1)?.evidence;
  assert.equal(evidence?.find((e) => e.kind === "http")?.available, true);
  assert.equal(
    (evidence?.find((e) => e.kind === "http")?.data as any).status,
    500,
  );
  intent = "restart";
  chat.send(conversation.id, "ری‌استارت کن", "request_002");
  await core.settle();
  assert.equal(chat.state().messages.at(-1)?.status, "failed");
  assert.match(chat.state().messages.at(-1)!.content, /پروژهٔ واقعی/);
  assert.equal(core.project("local").revision, 1);
});

test("existing incidents migrate once, linked live work checks project, and interrupted replies recover", async (t) => {
  const { core, chat } = await setup(t, {
    async respond() {
      return { intent: "answer", response: "پاسخ" };
    },
  });
  const run = await core.startIncident("local", "خطای سفارش");
  await core.settle();
  chat.initialize();
  chat.initialize();
  assert.equal(chat.state().conversations.length, 1);
  assert.equal(chat.state().messages.length, 2);
  const other = chat.create("local");
  chat.linkIncident(other.id, core.incident(run.id));
  chat.linkIncident(other.id, core.incident(run.id));
  assert.equal(
    chat.state().messages.filter((m) => m.conversationId === other.id).length,
    1,
  );
  assert.throws(
    () => chat.linkIncident(other.id, { ...run, projectId: "different" }),
    /مطابقت/,
  );
  core.store.put<ChatMessage>("messages", {
    id: "interrupted",
    conversationId: other.id,
    role: "assistant",
    content: "در حال بررسی",
    status: "working",
    createdAt: new Date().toISOString(),
  });
  chat.initialize(true);
  assert.equal(
    core.store.get<ChatMessage>("messages", "interrupted")?.status,
    "failed",
  );
});

test("conversation HTTP routes enforce authentication, CSRF, validation and idempotency", async (t) => {
  const { core } = await setup(t, {
    async respond() {
      return { intent: "answer", response: "پاسخ" };
    },
  });
  const { app } = await createServer({
    root,
    core,
    port: 4395,
    chatAgent: {
      async respond() {
        return { intent: "answer", response: "پاسخ آزمایشی" };
      },
    },
  });
  const host = { host: "127.0.0.1:4395" },
    origin = "http://127.0.0.1:4395";
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/conversations",
          headers: { ...host, origin },
          payload: { projectId: "local" },
        })
      ).statusCode,
      401,
    );
    const key = (await readFile(join(core.data, "human-key"), "utf8")).trim();
    const login = await app.inject({
      method: "POST",
      url: "/api/session",
      headers: { ...host, origin },
      payload: { key },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const headers = {
      ...host,
      origin,
      cookie,
      "x-csrf-token": login.json().csrf,
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/conversations",
          headers: { ...host, origin, cookie },
          payload: { projectId: "local" },
        })
      ).statusCode,
      403,
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/conversations",
      headers,
      payload: { projectId: "local" },
    });
    assert.equal(created.statusCode, 201);
    const url = `/api/conversations/${created.json().id}/messages`;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers,
          payload: { content: " ", requestId: "request_001" },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers,
          payload: { content: "سلام", requestId: "request_001" },
        })
      ).statusCode,
      202,
    );
    await core.settle();
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers,
          payload: { content: "سلام", requestId: "request_001" },
        })
      ).statusCode,
      202,
    );
    const state = (await app.inject({ url: "/api/state", headers })).json();
    assert.equal(state.conversations.length, 1);
    assert.equal(state.messages.length, 2);
    assert.equal(state.messages[1].content, "پاسخ آزمایشی");
  } finally {
    await app.close();
  }
});

test("chat activity remains current after a long history and reports retain all run events", async (t) => {
  const { core } = await setup(t, {
    async respond() {
      return { intent: "answer", response: "پاسخ" };
    },
  });
  for (let i = 0; i < 300; i++)
    core.store.event("old-chat", "chat", "گفتگوی قبلی");
  core.store.event("current-run", "resolved", "بررسی جدید موفق بود.");
  assert.equal(core.state().events.at(-1)?.runId, "current-run");
  assert.equal(core.store.eventsForRun("old-chat").length, 300);
  assert.equal(
    core.store.events(0).length,
    250,
    "SSE pagination must keep its original ascending cursor",
  );
});

test("server closes active chat event streams during shutdown", async (t) => {
  const { core } = await setup(t, {
    async respond() {
      return { intent: "answer", response: "پاسخ" };
    },
  });
  const port = await new Promise<number>((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const port = (socket.address() as net.AddressInfo).port;
      socket.close(() => resolve(port));
    });
  });
  const { app, origin } = await createServer({ root, core, port });
  await app.listen({ port, host: "127.0.0.1" });
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const key = (await readFile(join(core.data, "human-key"), "utf8")).trim();
    const login = await app.inject({
      method: "POST",
      url: "/api/session",
      headers: { host: `127.0.0.1:${port}`, origin },
      payload: { key },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const events = await fetch(`${origin}/api/events`, {
      headers: { cookie },
      signal: controller.signal,
    });
    const live = await fetch(`${origin}/api/live/stream`, {
      headers: { cookie },
      signal: controller.signal,
    });
    assert.equal(events.status, 200);
    assert.equal(live.status, 200);
    await Promise.race([
      app.close(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Active streams prevented shutdown")),
          2000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    controller.abort();
    await app.close();
  }
});
