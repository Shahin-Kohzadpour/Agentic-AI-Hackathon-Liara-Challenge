import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

// Requires the dashboard server to be running, like test:browser.
const origin = `http://127.0.0.1:${Number(process.env.PORT || 4317)}`;
const key = (await readFile('.data/human-key', 'utf8')).trim();
const login = await fetch(`${origin}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ key }) });
assert.equal(login.status, 200, 'private session login failed');
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const { csrf } = await login.json() as { csrf: string };
const headers = { cookie, origin, 'content-type': 'application/json', 'x-csrf-token': csrf };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const project = process.env.LIARA_PROJECT ? 'liara' : 'local';
const started = await fetch(`${origin}/api/live/start`, { method: 'POST', headers, body: JSON.stringify({ projectId: project }) });
assert.equal(started.status, 202, await started.text());

// Native MJPEG stream consumed exactly like the dashboard's <img> does.
const frames = new AbortController();
let framesSeen = 0;
const frameReader = (async () => {
  try {
    const response = await fetch(`${origin}/api/live/mjpeg`, { headers: { cookie }, signal: frames.signal });
    assert.equal(response.status, 200, 'MJPEG stream was rejected');
    const reader = response.body!.getReader();
    let boundary = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      boundary += Buffer.from(value).toString('latin1');
      const delim = '--frame';
      const last = boundary.lastIndexOf(delim);
      if (last >= 0) { framesSeen += boundary.split(delim).length - 1; boundary = boundary.slice(last + delim.length); }
    }
  } catch (error) { if ((error as Error).name !== 'AbortError') throw error; }
})();

let state: any = null;
const deadline = Date.now() + 180000;
while (Date.now() < deadline) {
  state = (await (await fetch(`${origin}/api/live/state`, { headers: { cookie } })).json() as { live: any }).live;
  if (state.reproduced || state.status === 'failed') break;
  await sleep(1500);
}
frames.abort();
await frameReader.catch(() => {});
await fetch(`${origin}/api/live/stop`, { method: 'POST', headers, body: '{}' });

await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/live-check.json', JSON.stringify({ at: new Date().toISOString(), project, frames: framesSeen, status: state?.status, consoleSession: state?.consoleSession, steps: state?.steps, reproduced: state?.reproduced }, null, 2));
assert.ok(framesSeen > 0, 'no live frame was streamed');
assert.notEqual(state?.status, 'failed', state?.error ?? 'live session failed');
assert.ok(state?.reproduced, 'the storefront probe did not complete in time');
assert.ok(state?.consoleSession, 'console session was not established');
assert.ok(state.steps.length >= 3, 'live playbook did not run');
assert.ok(state.steps.every((step: any) => step.state !== 'failed'), 'a live step failed');
console.log(JSON.stringify({ project, frames: framesSeen, status: state.status, consoleSession: state.consoleSession, steps: state.steps.map((step: any) => `${step.state}: ${step.title}`) }, null, 2));
