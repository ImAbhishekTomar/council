#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = join(tmpdir(), 'council-live-dashboard');
const pidFile = join(stateDir, 'server.pid');
const logFile = join(stateDir, 'server.log');
const port = Number(process.env.COUNCIL_DASHBOARD_PORT || 41773);
const base = `http://127.0.0.1:${port}`;

async function readInput() {
  if (!process.stdin.isTTY) {
    let value = '';
    for await (const chunk of process.stdin) value += chunk;
    if (value.trim()) return JSON.parse(value);
  }
  return {};
}

async function ensureServer() {
  try {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
    if (response.ok && (await response.json()).service === 'council') return;
  } catch { /* Start below. */ }

  mkdirSync(stateDir, { recursive: true });
  const stdout = openSync(logFile, 'a');
  const child = spawn(process.execPath, [join(root, 'scripts/server.mjs')], {
    detached: true,
    stdio: ['ignore', stdout, stdout],
    env: { ...process.env, COUNCIL_DASHBOARD_PORT: String(port), COUNCIL_PLUGIN_ROOT: root, COUNCIL_PID_FILE: pidFile },
  });
  child.unref();
  closeSync(stdout);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok && (await response.json()).service === 'council') return;
    } catch { /* Wait briefly for the listener. */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 125));
  }
  throw new Error(`Council dashboard did not start. See ${logFile}`);
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'start') {
    const input = await readInput();
    await ensureServer();
    const response = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: input.question || 'Council session' }),
    });
    if (!response.ok) throw new Error(`Could not create a session (${response.status})`);
    const run = await response.json();
    process.stdout.write(`${JSON.stringify({ runId: run.id, url: `${base}/?run=${encodeURIComponent(run.id)}`, serverUrl: base })}\n`);
    return;
  }

  if (command === 'emit') {
    const runId = args[0];
    if (!runId) throw new Error('Usage: council.mjs emit <runId> < event.json|events.json');
    const input = await readInput();
    const events = Array.isArray(input) ? input : [input];
    for (const event of events) {
      if (!event || !event.type) throw new Error('Each event JSON must contain a type field');
      const response = await fetch(`${base}/api/runs/${encodeURIComponent(runId)}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`Could not send Council event ${event.type} (${response.status}): ${body}`);
      process.stdout.write(`${body}\n`);
    }
    return;
  }

  if (command === 'stop') {
    if (!existsSync(pidFile)) {
      process.stdout.write('Council dashboard is not running.\n');
      return;
    }
    const pid = Number(readFileSync(pidFile, 'utf8'));
    let ownsPort = false;
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
      ownsPort = response.ok && (await response.json()).service === 'council';
    } catch { /* Already stopped. */ }
    if (ownsPort) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* Already stopped. */ }
    }
    // Keep the pid file while the process is alive; the server removes it itself on exit.
    for (let attempt = 0; attempt < 20 && isAlive(pid); attempt += 1) await new Promise((r) => setTimeout(r, 100));
    if (isAlive(pid)) {
      process.stdout.write('Council dashboard is still running; pid file kept.\n');
      return;
    }
    try { unlinkSync(pidFile); } catch { /* Server already removed it. */ }
    process.stdout.write('Council dashboard stopped.\n');
    return;
  }

  if (command === 'verify-quote') {
    const [url, ...words] = args;
    const quote = words.join(' ');
    if (!/^https?:\/\//.test(url || '') || !quote) throw new Error('Usage: council.mjs verify-quote <http(s) url> <quote>');
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Could not fetch the source (${response.status})`);
    const flat = (text) => text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const found = flat(await response.text()).includes(flat(quote));
    process.stdout.write(found ? 'confirmed: quote found in source\n' : 'not found: quote is not in source\n');
    process.exitCode = found ? 0 : 1;
    return;
  }

  process.stderr.write('Usage: council.mjs start | emit <runId> < event.json|events.json | stop | verify-quote <url> <quote>\n');
  process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
