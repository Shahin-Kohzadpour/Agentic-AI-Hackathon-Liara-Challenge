import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

// Full journey against the real app: reset to the faulty release (HTTP 500), let Codex
// prepare a repair, approve it as the human owner, deploy, and require a live HTTP 200.
// Requires the dashboard server to be running, like test:browser and test:live.
const origin = `http://127.0.0.1:${Number(process.env.PORT || 4317)}`;
const appUrl = (process.env.LIARA_APP_URL || `https://${process.env.LIARA_PROJECT}.liara.run`).replace(/\/$/, '');
const key = (await readFile('.data/human-key', 'utf8')).trim();
const login = await fetch(`${origin}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ key }) });
assert.equal(login.status, 200, 'private session login failed');
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const { csrf } = await login.json() as { csrf: string };
const headers = { cookie, origin, 'content-type': 'application/json', 'x-csrf-token': csrf };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const log = (phase: string, extra: unknown = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), phase, ...extra as object }));

const call = async (path: string, method = 'GET', body?: unknown) => {
  const response = await fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let json: any; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  return { status: response.status, body: json };
};

// A tool capability must never approve, even with a valid session cookie.
const toolKey = (await readFile('.data/mcp-key', 'utf8')).trim();

const state = async () => (await call('/api/state')).body as { projects: any[]; incidents: any[]; actions: any[] };
const waitFor = async <T>(label: string, run: () => Promise<T | undefined>, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await run();
    if (value !== undefined) return value;
    await sleep(2000);
  }
  throw new Error(`${label} did not finish within ${Math.round(timeoutMs / 1000)}s`);
};
const publicSummary = async (body: unknown) => {
  const response = await fetch(`${appUrl}/api/summary`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  let parsed: unknown; try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 300) }; }
  return { status: response.status, body: parsed };
};

const initial = await state();
const project = initial.projects.find(p => p.id === 'liara');
assert.ok(project, 'liara project is missing from the fresh state');
log('state-loaded', { project: project.name, revision: project.revision, incidents: initial.incidents.length, actions: initial.actions.length });

// 1. Seed the faulty release through the same approval path as any other deployment.
const reset = await call('/api/actions/prepare', 'POST', { projectId: 'liara', kind: 'reset' });
assert.equal(reset.status, 200, JSON.stringify(reset.body));
assert.equal(reset.body.status, 'pending');
assert.match(reset.body.title, /معیوب/, 'reset must be labeled as an intentional faulty deployment');
log('reset-prepared', { actionId: reset.body.id, title: reset.body.title });

// An approval without the CSRF token, and from a tool capability, must both fail.
const noCsrf = await fetch(`${origin}/api/actions/${reset.body.id}/decision`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }) });
assert.equal(noCsrf.status, 403, 'approval without CSRF was accepted');
const toolApproval = await fetch(`${origin}/api/actions/${reset.body.id}/decision`, { method: 'POST', headers: { ...headers, authorization: `Bearer ${toolKey}` }, body: JSON.stringify({ decision: 'approve' }) });
assert.equal(toolApproval.status, 403, 'a tool capability was allowed to approve');

const resetDecision = await call(`/api/actions/${reset.body.id}/decision`, 'POST', { decision: 'approve' });
assert.equal(resetDecision.status, 200, JSON.stringify(resetDecision.body));
assert.equal(resetDecision.body.status, 'approved');
const resetDone = await waitFor('faulty reset deployment', async () => {
  const a = (await state()).actions.find(x => x.id === reset.body.id);
  return ['succeeded', 'failed'].includes(a?.status) ? a : undefined;
}, 420000);
assert.equal(resetDone.status, 'succeeded', resetDone.error ?? 'reset deployment failed');
log('faulty-release-live', { releaseId: resetDone.result?.releaseId, revision: resetDone.baseRevision + 1 });

// The public app must now reproduce the real defect while its health check stays green.
const broken = await publicSummary({ items: [{ price: 100, quantity: 2 }] });
assert.equal(broken.status, 500, `expected the faulty release to answer 500, got ${broken.status}`);
assert.equal((await fetch(`${appUrl}/healthz`, { signal: AbortSignal.timeout(15000) })).status, 200, 'health check should still pass');
log('defect-reproduced-live', broken);

// 2. Report the incident; the agent must diagnose it, not just retry the deploy.
const incident = await call('/api/incidents', 'POST', { projectId: 'liara', request: 'سایت باز می‌شود، اما خلاصهٔ سفارش خطای ۵۰۰ دارد. علت را پیدا کن و اصلاح را برای تأیید من آماده کن.' });
assert.equal(incident.status, 202, JSON.stringify(incident.body));
const runId = incident.body.id;
const prepared = await waitFor('agent repair proposal', async () => {
  const run = (await state()).incidents.find(r => r.id === runId);
  return ['awaiting_approval', 'failed'].includes(run?.status) ? run : undefined;
}, 420000);
assert.equal(prepared.status, 'awaiting_approval', prepared.error ?? 'agent did not prepare a repair');
assert.ok(prepared.actionId, 'repair proposal has no action');
assert.match(prepared.diff, /summary\.mjs/, 'diff is missing');
assert.ok(prepared.candidate?.passed, 'candidate did not pass the independent verifier');
log('repair-prepared', { runId, actionId: prepared.actionId, diagnosis: prepared.diagnosis?.slice(0, 160), checks: prepared.candidate?.checks?.length });

// 3. Nothing may reach production before the human approval.
const beforeApproval = await publicSummary({ items: [{ price: 100, quantity: 2 }] });
assert.equal(beforeApproval.status, 500, 'production changed before approval');

const approval = await call(`/api/actions/${prepared.actionId}/decision`, 'POST', { decision: 'approve' });
assert.equal(approval.status, 200, JSON.stringify(approval.body));
const resolved = await waitFor('approved recovery', async () => {
  const run = (await state()).incidents.find(r => r.id === runId);
  return ['resolved', 'failed'].includes(run?.status) ? run : undefined;
}, 480000);
assert.equal(resolved.status, 'resolved', resolved.error ?? 'recovery did not resolve');
assert.equal(resolved.verification?.passed, true, 'post-deploy verification did not pass');
log('recovered', { runId, releaseId: resolved.releaseId, passed: resolved.verification?.passed, checks: resolved.verification?.checks?.length });

// 4. Prove it on the public surface, not only inside the controller.
const fixed = await publicSummary({ items: [{ price: 100, quantity: 2 }] });
assert.equal(fixed.status, 200);
assert.deepEqual(fixed.body, { subtotal: 200, discount: 0, total: 200 });
const discounted = await publicSummary({ items: [{ price: 100, quantity: 2 }], discounts: [10] });
assert.deepEqual({ status: discounted.status, body: discounted.body }, { status: 200, body: { subtotal: 200, discount: 10, total: 190 } });
const invalid = await publicSummary({ items: [{ price: 100, quantity: 2 }], discounts: 'bad' });
assert.deepEqual({ status: invalid.status, body: invalid.body }, { status: 400, body: { error: 'INVALID_DISCOUNTS' } });
const health = await fetch(`${appUrl}/healthz`, { signal: AbortSignal.timeout(15000) });
assert.equal(health.status, 200);
log('public-contract-verified', { fixed, discounted: discounted.body, invalid: invalid.body });

// 5. The report must be downloadable and tied to the same release and events.
const report = await call(`/api/reports/${runId}`);
assert.equal(report.status, 200);
assert.equal(report.body.incident.status, 'resolved');
assert.equal(report.body.incident.releaseId, resolved.releaseId);
assert.ok(report.body.events.length >= 4, 'report has too few events');
assert.ok(report.body.action?.approvedAt, 'report is missing the approval timestamp');

await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/e2e-check.json', JSON.stringify({
  at: new Date().toISOString(), appUrl,
  faulty: { actionId: reset.body.id, releaseId: resetDone.result?.releaseId, status: broken.status },
  recovery: { runId, actionId: prepared.actionId, releaseId: resolved.releaseId, checks: resolved.verification?.checks, events: report.body.events.length },
  public: { fixed, discounted, invalid },
}, null, 2));
console.log(JSON.stringify({ summary: 'full journey passed', appUrl, faulty: broken.status, recovered: fixed.status, releaseId: resolved.releaseId, events: report.body.events.length }));
