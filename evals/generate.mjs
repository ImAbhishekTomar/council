// Runs each bug-finding case under two conditions and caches the raw outputs for the eval frameworks.
//   plain   : one `claude -p` call
//   council : the same call through the /council skill (plugin loaded from COUNCIL_ROOT or this repo)
//   council-forced : same, but told to convene specialists, to test the mechanism when it does run
// Usage: node evals/generate.mjs [--cond plain,council] [--only id1,id2] [--force] [--jobs 3]
// Output: evals/outputs/<condition>/<case id>.json  {answer, seconds, costUsd, turns, agentCalls, tools}
// Stops on the first failed or empty CLI call so a failure is never scored as a wrong answer.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = new URL('.', import.meta.url).pathname;
const root = process.env.COUNCIL_ROOT || join(here, '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
const conditions = opt('--cond', 'plain,council').split(',');
const only = opt('--only', '')?.split(',').filter(Boolean);
const force = argv.includes('--force');
const jobs = Number(opt('--jobs', 3));
const cases = JSON.parse(readFileSync(join(here, 'bugs.json'))).filter((c) => !only.length || only.includes(c.id));
const cwd = mkdtempSync(join(tmpdir(), 'council-eval-'));

export const promptFor = (c) => `Review this code for real bugs against its spec.

Spec: ${c.spec}

Code:
\`\`\`
${c.code}
\`\`\`

List each real bug: what is wrong, why it breaks the spec, and the fix. Report only bugs you are confident about. Do not report style issues. If there is no bug, say "No bugs found."`;

function parseStream(stdout) {
  const tools = [];
  let result = null;
  for (const line of stdout.split('\n').filter(Boolean)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'assistant') for (const block of event.message?.content ?? []) if (block.type === 'tool_use') tools.push(block.name);
    if (event.type === 'result') result = event;
  }
  if (!result || result.is_error || !String(result.result || '').trim()) throw new Error(`no usable result: ${JSON.stringify(result)?.slice(0, 300)}`);
  return { answer: result.result, costUsd: result.total_cost_usd ?? null, turns: result.num_turns ?? null, tools, agentCalls: tools.filter((t) => t === 'Agent' || t === 'Task').length };
}

async function one(condition, c) {
  const file = join(here, 'outputs', condition, `${c.id}.json`);
  if (existsSync(file) && !force) return;
  mkdirSync(join(here, 'outputs', condition), { recursive: true });
  const forced = '\n\nConvene at least 3 narrow specialists in parallel and run the verification pass. Do not answer alone.';
  const prompt = condition === 'council' ? `/council ${promptFor(c)}` : condition === 'council-forced' ? `/council ${promptFor(c)}${forced}` : promptFor(c);
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
  if (condition.startsWith('council')) args.push('--plugin-dir', root, '--allowedTools', 'Skill Agent Bash(node *council.mjs*)');
  const start = Date.now();
  const { stdout } = await run('claude', args, { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 900000 });
  const out = { id: c.id, condition, seconds: Math.round((Date.now() - start) / 1000), ...parseStream(stdout) };
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`${condition} ${c.id}: ${out.seconds}s agents=${out.agentCalls} cost=${out.costUsd}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const queue = conditions.flatMap((cond) => cases.map((c) => [cond, c]));
  let failed = null;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (queue.length && !failed) {
      const [cond, c] = queue.shift();
      try { await one(cond, c); } catch (error) { failed = `${cond} ${c.id}: ${String(error.stderr || error.message).slice(0, 400)}`; }
    }
  }));
  if (failed) { console.error(`STOPPED: ${failed}`); process.exitCode = 1; }
}
