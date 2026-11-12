import { createServer } from 'node:http';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = process.env.COUNCIL_PLUGIN_ROOT || resolve(fileURLToPath(new URL('..', import.meta.url)));
const webRoot = join(root, 'dist');
const port = Number(process.env.COUNCIL_DASHBOARD_PORT || 41773);
const colors = ['#60d4c5', '#e5aa6d', '#b79bf4', '#83a9ed', '#e28aa5', '#c4cc79'];
const categories = ['coding', 'trading', 'creative', 'general'];
const phases = ['discussion', 'frame', 'perspective', 'critique', 'build', 'synthesize'];
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const pidFile = process.env.COUNCIL_PID_FILE;
const clients = new Map();
let runs = {};

function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let data = '';
  for await (const chunk of request) {
    data += chunk;
    if (data.length > 262144) throw new Error('Request body is too large');
  }
  return JSON.parse(data || '{}');
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function snapshot(run) {
  return structuredClone(run);
}

function publish(run) {
  const data = `data: ${JSON.stringify({ run: snapshot(run) })}\n\n`;
  for (const response of clients.get(run.id) ?? []) response.write(data);
}

function appendActivity(run, type, summary, fields = {}) {
  run.activity.push({ id: randomUUID(), type, summary: String(summary || '').slice(0, 1200), at: new Date().toISOString(), ...fields });
  if (run.activity.length > 250) run.activity.splice(0, run.activity.length - 250);
  run.updatedAt = new Date().toISOString();
}

function boundedText(value, fallback, max = 360) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
}

function nullableNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function makeAgent(event, now, index) {
  const input = event.agent && typeof event.agent === 'object' ? event.agent : event;
  const role = boundedText(input.role || input.expertise, 'Council specialist', 220);
  const profile = input.profile && typeof input.profile === 'object' ? input.profile : {};
  const settings = input.llmSettings && typeof input.llmSettings === 'object' ? input.llmSettings : {};
  const category = categories.includes(input.category) ? input.category : 'general';
  const phase = phases.includes(input.phase) ? input.phase : 'discussion';
  const labels = Array.isArray(input.labels) ? input.labels.filter((value) => typeof value === 'string').slice(0, 12).map((value) => value.slice(0, 60)) : [];
  const createdAt = typeof input.createdAt === 'string' && !Number.isNaN(Date.parse(input.createdAt)) ? input.createdAt : now;
  return {
    id: boundedText(input.id, `agent-${index + 1}`, 80),
    name: boundedText(input.name, 'Council member', 80),
    role,
    model: boundedText(input.model, 'Host-managed', 120),
    category,
    phase,
    profile: {
      temperament: boundedText(profile.temperament, 'Not provided'),
      expertise: boundedText(profile.expertise || input.expertise, role),
      memoryStyle: boundedText(profile.memoryStyle, 'Not provided'),
      riskBias: boundedText(profile.riskBias, 'Not provided'),
      speakingStyle: boundedText(profile.speakingStyle, 'Not provided'),
      goals: boundedText(profile.goals, 'Not provided'),
      constraints: boundedText(profile.constraints, 'Not provided'),
    },
    llmSettings: {
      temperature: nullableNumber(settings.temperature),
      topP: nullableNumber(settings.topP),
      maxOutputTokens: nullableNumber(settings.maxOutputTokens),
      frequencyPenalty: nullableNumber(settings.frequencyPenalty),
      presencePenalty: nullableNumber(settings.presencePenalty),
    },
    color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : colors[index % colors.length],
    confidence: Number.isFinite(input.confidence) ? clamp01(input.confidence) : 0.5,
    uuid: boundedText(input.uuid, randomUUID(), 80),
    fullName: typeof input.fullName === 'string' ? input.fullName.slice(0, 120) : null,
    userRole: typeof input.userRole === 'string' ? input.userRole.slice(0, 120) : null,
    summary: boundedText(input.summary, `${role} perspective is joining the council.`, 1200),
    labels: labels.length ? labels : [category, role].slice(0, 12),
    createdAt,
    activityStatus: 'thinking',
    parentId: boundedText(event.parentId || input.parentId, '', 80) || undefined,
  };
}

async function staticFile(pathname, response) {
  let requested = '/index.html';
  if (pathname !== '/') {
    try { requested = decodeURIComponent(pathname); } catch {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Bad request path');
      return true;
    }
  }
  const path = resolve(webRoot, `.${requested}`);
  if (path !== webRoot && !path.startsWith(`${webRoot}${sep}`)) return false;
  let target = path;
  if (!existsSync(target) || !extname(target)) target = join(webRoot, 'index.html');
  try {
    const content = await readFile(target);
    response.writeHead(200, { 'content-type': mime[extname(target)] ?? 'application/octet-stream', 'cache-control': target.endsWith('index.html') ? 'no-store' : 'public, max-age=300', 'x-content-type-options': 'nosniff' });
    response.end(content);
    return true;
  } catch (error) {
    process.stderr.write(`Could not read dashboard asset ${target}: ${error instanceof Error ? error.message : String(error)}\n`);
    response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Dashboard bundle missing. Run pnpm build in the Council repository.');
    return true;
  }
}

const server = createServer(async (request, response) => {
  const authority = request.headers.host || '';
  const host = authority.startsWith('[') ? authority.slice(1, authority.indexOf(']')) : authority.split(':')[0];
  const origin = request.headers.origin;
  const remote = request.socket.remoteAddress || '';
  const loopback = remote === '::1' || remote === '127.0.0.1' || remote.startsWith('::ffff:127.');
  let sameOrigin = true;
  try { if (origin) sameOrigin = new URL(origin).host === authority; } catch { sameOrigin = false; }
  if (!loopback || !['127.0.0.1', 'localhost', '::1'].includes(host) || !sameOrigin) {
    sendJson(response, 403, { error: 'Loopback clients only' });
    return;
  }

  const url = new URL(request.url || '/', `http://${host}:${port}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, { ok: true, service: 'council' });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/runs') {
      const body = await readJson(request);
      const now = new Date().toISOString();
      const run = { id: randomUUID(), question: String(body.question || 'Council session').slice(0, 4000), status: 'active', startedAt: now, updatedAt: now, agents: [], links: [], activity: [] };
      runs[run.id] = run;
      appendActivity(run, 'run_started', 'Atom has opened the council.');
      const keys = Object.keys(runs);
      for (const oldId of keys.slice(0, Math.max(0, keys.length - 20))) delete runs[oldId];
      sendJson(response, 201, snapshot(run));
      publish(run);
      return;
    }
    const runPath = url.pathname.match(/^\/api\/runs\/([\w-]+)$/);
    if (request.method === 'GET' && runPath) {
      const run = runs[runPath[1]];
      if (!run) return sendJson(response, 404, { error: 'Session not found' });
      sendJson(response, 200, snapshot(run));
      return;
    }
    const eventPath = url.pathname.match(/^\/api\/runs\/([\w-]+)\/events$/);
    if (request.method === 'POST' && eventPath) {
      const run = runs[eventPath[1]];
      if (!run) return sendJson(response, 404, { error: 'Session not found' });
      const event = await readJson(request);
      const now = new Date().toISOString();
      switch (event.type) {
        case 'run_started':
          run.question = String(event.question || run.question).slice(0, 4000);
          appendActivity(run, event.type, 'Atom has opened the council.');
          break;
        case 'agent_joined': {
          const payload = event.agent && typeof event.agent === 'object' ? event.agent : event;
          if (!payload.id || !payload.name) return sendJson(response, 400, { error: 'agent_joined requires an agent with id and name' });
          let agent = run.agents.find((item) => item.id === String(payload.id));
          if (!agent) {
            agent = makeAgent(event, now, run.agents.length);
            run.agents.push(agent);
            if (agent.parentId && run.agents.some((item) => item.id === agent.parentId)) run.links.push({ from: agent.parentId, to: agent.id, label: 'invited', updatedAt: now });
          }
          appendActivity(run, event.type, `${agent.name} joined as ${agent.role}.`, { from: agent.name });
          break;
        }
        case 'agent_status': {
          const agent = run.agents.find((item) => item.id === String(event.id));
          if (!agent) return sendJson(response, 404, { error: 'Agent not found' });
          if (!['thinking', 'speaking', 'done', 'failed'].includes(event.status)) return sendJson(response, 400, { error: 'Unknown agent status' });
          agent.activityStatus = event.status;
          if (event.phase && phases.includes(event.phase)) agent.phase = event.phase;
          if (event.summary) agent.summary = String(event.summary).slice(0, 1200);
          appendActivity(run, event.type, `${agent.name} is ${agent.activityStatus}${event.summary ? `: ${event.summary}` : '.'}`, { from: agent.name });
          break;
        }
        case 'connection': {
          const from = String(event.from || '');
          const to = String(event.to || '');
          if (!run.agents.some((item) => item.id === from) || !run.agents.some((item) => item.id === to)) return sendJson(response, 400, { error: 'Connection endpoints must be current council members' });
          const existing = run.links.find((item) => item.from === from && item.to === to);
          if (existing) { existing.label = String(event.label || 'shared finding').slice(0, 100); existing.updatedAt = now; }
          else run.links.push({ from, to, label: String(event.label || 'shared finding').slice(0, 100), updatedAt: now });
          appendActivity(run, event.type, `${run.agents.find((item) => item.id === from).name} shared with ${run.agents.find((item) => item.id === to).name}.`, { from: run.agents.find((item) => item.id === from).name });
          break;
        }
        case 'message': {
          const agent = run.agents.find((item) => item.id === String(event.from));
          if (!agent) return sendJson(response, 404, { error: 'Message sender not found' });
          if (typeof event.summary === 'string' && event.summary) agent.summary = event.summary.slice(0, 1200);
          agent.activityStatus = 'speaking';
          if (Number.isFinite(event.confidence)) agent.confidence = clamp01(event.confidence);
          const to = Array.isArray(event.to) ? event.to.map(String).slice(0, 10) : [];
          appendActivity(run, event.type, agent.summary || `${agent.name} shared a finding.`, { from: agent.name, to, confidence: Number.isFinite(event.confidence) ? clamp01(event.confidence) : undefined });
          for (const target of to) {
            if (run.agents.some((item) => item.id === target) && target !== agent.id) {
              const link = run.links.find((item) => item.from === agent.id && item.to === target);
              if (link) link.updatedAt = now;
              else run.links.push({ from: agent.id, to: target, label: 'shared finding', updatedAt: now });
            }
          }
          break;
        }
        case 'final':
          run.answer = String(event.answer || '').slice(0, 12000);
          run.confidence = Number.isFinite(event.confidence) ? clamp01(event.confidence) : undefined;
          appendActivity(run, event.type, 'Atom has written the final answer.', { from: 'Atom', confidence: run.confidence });
          break;
        case 'run_finished':
          run.status = 'complete';
          for (const agent of run.agents) if (agent.activityStatus === 'thinking' || agent.activityStatus === 'speaking') agent.activityStatus = 'done';
          appendActivity(run, event.type, 'The council has finished.');
          break;
        case 'run_error':
          run.status = 'error';
          run.error = String(event.message || 'Council session failed.').slice(0, 500);
          appendActivity(run, event.type, run.error);
          break;
        default:
          return sendJson(response, 400, { error: 'Unsupported event type' });
      }
      if (run.links.length > 200) run.links.splice(0, run.links.length - 200);
      publish(run);
      sendJson(response, 202, { accepted: true, agents: run.agents.length, connections: run.links.length });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/events') {
      const runId = url.searchParams.get('runId');
      if (!runId || !runs[runId]) return sendJson(response, 404, { error: 'Session not found' });
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      response.write(`data: ${JSON.stringify({ run: snapshot(runs[runId]) })}\n\n`);
      const set = clients.get(runId) ?? new Set();
      set.add(response);
      clients.set(runId, set);
      const heartbeat = setInterval(() => response.write(': keep-alive\n\n'), 20000);
      response.on('close', () => { clearInterval(heartbeat); set.delete(response); if (!set.size) clients.delete(runId); });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/runs') {
      return sendJson(response, 200, Object.values(runs).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 20).map(({ id, question, status, startedAt }) => ({ id, question, status, startedAt })));
    }
    if (request.method === 'GET') {
      await staticFile(url.pathname, response);
      return;
    }
    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(response, error instanceof SyntaxError ? 400 : 500, { error: error instanceof Error ? error.message : 'Request failed' });
  }
});

server.listen(port, '127.0.0.1', () => {
  if (pidFile) writeFileSync(pidFile, String(process.pid));
  process.stdout.write(`Council dashboard listening at http://127.0.0.1:${port}\n`);
});

function shutdown() {
  if (pidFile) try { unlinkSync(pidFile); } catch { /* Already gone. */ }
  server.close(() => process.exit(0));
  server.closeAllConnections(); // open SSE streams would otherwise keep close() waiting forever
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
