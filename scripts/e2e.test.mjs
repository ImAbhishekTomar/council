import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, request } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scripts = new URL('.', import.meta.url).pathname;
const repo = join(scripts, '..');
const tmp = mkdtempSync(join(tmpdir(), 'council-e2e-'));
const pidFile = join(tmp, 'server.pid');
let port, base, child, runId;

async function freePort() {
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const { port: p } = probe.address();
  await new Promise((r) => probe.close(r));
  return p;
}

const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const emit = (event) => post(`/api/runs/${runId}/events`, event);
const snapshot = async () => (await fetch(`${base}/api/runs/${runId}`)).json();
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

before(async () => {
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(scripts, 'server.mjs')], {
    env: { ...process.env, COUNCIL_DASHBOARD_PORT: String(port), COUNCIL_PID_FILE: pidFile },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  runId = (await (await post('/api/runs', { question: 'Q?' })).json()).id;
});

after(() => {
  child?.kill('SIGKILL');
  rmSync(tmp, { recursive: true, force: true });
});

test('server writes its own pid file after listening', () => {
  assert.equal(Number(readFileSync(pidFile, 'utf8')), child.pid);
});

test('SKILL.md event sequence produces the expected snapshot', async () => {
  const agent = (id, name, extra = {}) => ({ type: 'agent_joined', agent: { id, name, role: `${name} role` }, ...extra });
  const events = [
    { type: 'run_started', question: 'Should we ship?' },
    agent('atom', 'Atom'),
    agent('skeptic', 'Skeptic', { parentId: 'atom' }),
    { type: 'agent_status', id: 'skeptic', status: 'speaking', phase: 'critique' },
    { type: 'connection', from: 'skeptic', to: 'atom', label: 'risk' },
    { type: 'message', from: 'skeptic', to: ['atom'], summary: 'Ship behind a flag', confidence: 0.8 },
    { type: 'final', answer: 'Ship it', confidence: 2 },
    { type: 'run_finished' },
  ];
  for (const event of events) assert.equal((await emit(event)).status, 202, event.type);
  const run = await snapshot();
  assert.equal(run.question, 'Should we ship?');
  assert.equal(run.status, 'complete');
  assert.equal(run.answer, 'Ship it');
  assert.equal(run.confidence, 1);
  assert.deepEqual(run.agents.map((a) => a.id), ['atom', 'skeptic']);
  const skeptic = run.agents.find((a) => a.id === 'skeptic');
  assert.equal(skeptic.phase, 'critique');
  assert.equal(skeptic.confidence, 0.8);
  assert.equal(skeptic.activityStatus, 'done');
  assert.ok(run.links.some((l) => l.from === 'atom' && l.to === 'skeptic' && l.label === 'invited'));
  assert.ok(run.links.some((l) => l.from === 'skeptic' && l.to === 'atom' && l.label === 'risk'));
});

test('message without summary keeps the old summary', async () => {
  await emit({ type: 'message', from: 'skeptic', summary: 'Kept' });
  await emit({ type: 'message', from: 'skeptic' });
  await emit({ type: 'message', from: 'skeptic', summary: '' });
  const skeptic = (await snapshot()).agents.find((a) => a.id === 'skeptic');
  assert.equal(skeptic.summary, 'Kept');
});

test('bad percent escape returns 400', async () => {
  const res = await fetch(`${base}/%E0%A4%A`);
  assert.equal(res.status, 400);
});

test('foreign Host header gets 403', async () => {
  const status = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/health', headers: { host: 'evil.com' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

test('batch emit via council.mjs posts every event in order', async () => {
  const run = await (await post('/api/runs', { question: 'batch' })).json();
  const events = [
    { type: 'agent_joined', agent: { id: 'a', name: 'A' } },
    { type: 'agent_status', id: 'a', status: 'done' },
  ];
  const env = { ...process.env, COUNCIL_DASHBOARD_PORT: String(port) };
  const out = execFileSync(process.execPath, [join(scripts, 'council.mjs'), 'emit', run.id], { input: JSON.stringify(events), env, encoding: 'utf8' });
  assert.equal(out.trim().split('\n').length, 2);
  const after = await (await fetch(`${base}/api/runs/${run.id}`)).json();
  assert.equal(after.agents[0].activityStatus, 'done');
  // a failing event stops the batch with a non-zero exit
  assert.throws(() => execFileSync(process.execPath, [join(scripts, 'council.mjs'), 'emit', run.id], { input: JSON.stringify([{ type: 'bogus' }, events[0]]), env, stdio: 'pipe' }));
});

test('plugin versions match across manifests', () => {
  const versions = ['package.json', 'plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json']
    .map((f) => join(repo, f))
    .filter(existsSync)
    .map((f) => JSON.parse(readFileSync(f, 'utf8')).version)
    .filter(Boolean);
  assert.ok(versions.length > 0);
  assert.equal(new Set(versions).size, 1, `versions differ: ${versions}`);
});

test('SIGTERM exits within 2s with an SSE client connected, and removes the pid file', async () => {
  const controller = new AbortController();
  const sse = await fetch(`${base}/api/events?runId=${runId}`, { signal: controller.signal });
  await sse.body.getReader().read();
  const exited = new Promise((r) => child.once('exit', r));
  const started = Date.now();
  child.kill('SIGTERM');
  const timeout = new Promise((r) => setTimeout(() => r('timeout'), 2000));
  assert.notEqual(await Promise.race([exited, timeout]), 'timeout', 'server did not exit');
  assert.ok(Date.now() - started < 2000);
  assert.equal(existsSync(pidFile), false);
  assert.equal(alive(child.pid), false);
  controller.abort();
});

test('council.mjs stop kills the server and removes the pid file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'council-stop-'));
  const p = await freePort();
  const env = { ...process.env, TMPDIR: dir, COUNCIL_DASHBOARD_PORT: String(p) };
  const run = (...args) => execFileSync(process.execPath, [join(scripts, 'council.mjs'), ...args], { env, input: '{"question":"q"}' }).toString();
  run('start');
  const pid = Number(readFileSync(join(dir, 'council-live-dashboard', 'server.pid'), 'utf8'));
  assert.ok(alive(pid));
  run('stop');
  assert.equal(alive(pid), false);
  assert.equal(existsSync(join(dir, 'council-live-dashboard', 'server.pid')), false);
  rmSync(dir, { recursive: true, force: true });
});

test('verify-quote confirms a real quote and rejects a made-up one', async () => {
  const src = createServer((req, res) => res.end('<p>The server  closes\nopen connections.</p>'));
  await new Promise((r) => src.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${src.address().port}/`;
  const run = async (quote) => { try { return (await promisify(execFile)(process.execPath, [join(scripts, 'council.mjs'), 'verify-quote', url, quote])).stdout; } catch (e) { return String(e.stdout); } };
  assert.match(await run('server closes open connections'), /confirmed/);
  assert.match(await run('server never closes anything'), /not found/);
  await new Promise((r) => src.close(r));
});
