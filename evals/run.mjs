// Compares one plain answer with a Council answer per question. Needs the `claude` CLI.
// Usage: node evals/run.mjs [questions.json] [runs-per-question] [--resume results.json]
// COUNCIL_ROOT can point at a copy of the plugin to compare skill versions.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const resumeAt = args.indexOf('--resume');
const resumePath = resumeAt < 0 ? null : args[resumeAt + 1];
if (resumeAt >= 0 && !resumePath) throw new Error('--resume requires a results file');
const positional = args.filter((arg, i) => arg !== '--resume' && i !== resumeAt + 1);
const file = positional.find((arg) => arg.endsWith('.json')) || new URL('./questions.json', import.meta.url).pathname;
const runs = Number(positional.find((arg) => /^\d+$/.test(arg)) || 1);
const root = process.env.COUNCIL_ROOT || new URL('..', import.meta.url).pathname;
const questions = JSON.parse(readFileSync(file));
if (!Number.isInteger(runs) || runs < 1) throw new Error('runs-per-question must be a positive integer');
const resume = resumePath ? JSON.parse(readFileSync(resumePath)) : null;
if (resume && (resume.file !== file || resume.runs !== runs || resume.root !== root)) throw new Error('Resume metadata does not match questions, run count, and plugin root');

function ask(prompt, extra = []) {
  const start = Date.now();
  try {
    const text = execFileSync('claude', ['-p', prompt, ...extra], { encoding: 'utf8', timeout: 900000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (!text.trim()) throw new Error('CLI returned an empty answer');
    return { text, seconds: Math.round((Date.now() - start) / 1000) };
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message).trim().split('\n').slice(0, 3).join(' ');
    throw new Error(`claude call failed after ${Math.round((Date.now() - start) / 1000)}s: ${detail}`);
  }
}
// Each `must` item is a string or a list of accepted alternatives; all items must match.
const hit = (text, item) => [item].flat().some((m) => text.toLowerCase().includes(m.toLowerCase()));
const score = (text, must) => must.filter((item) => hit(text, item)).length / must.length;
const convened = (text) => /\b(?:specialist|reviewer|council member)s? (?:were |was )?(?:convened|consulted)|\b(?:no specialist discussion was needed|none consulted|council:\s*none)\b/i.test(text) ? !/\bno specialist discussion was needed\b|\bnone consulted\b|\bcouncil:\s*none\b/i.test(text) : null;

const rows = resume?.rows || [];
const outputPath = resumePath || new URL(`./results-${Date.now()}.json`, import.meta.url).pathname;
const save = () => writeFileSync(outputPath, JSON.stringify({ file, runs, root, completed: rows.length, total: questions.length * runs, rows }, null, 2));
for (let index = rows.length; index < questions.length * runs; index += 1) {
  const questionIndex = Math.floor(index / runs);
  const repetition = index % runs;
  const { q, must } = questions[questionIndex];
  let plain, council;
  try {
    plain = ask(q);
    council = ask(`/council ${q}`, ['--plugin-dir', root, '--allowedTools', 'Skill Agent Bash(node *council.mjs*)']);
  } catch (error) {
    console.error(`STOPPED: ${error.message}`);
    process.exitCode = 1;
    break;
  }
  const row = { questionIndex, repetition, q, plain: score(plain.text, must), plainSec: plain.seconds, plainAnswer: plain.text, council: score(council.text, must), councilSec: council.seconds, councilAnswer: council.text, convened: convened(council.text) };
  rows.push(row);
  console.log(`plain=${row.plain.toFixed(2)} (${row.plainSec}s) council=${row.council.toFixed(2)} (${row.councilSec}s) explicit escalation=${row.convened}  ${row.q}`);
  save();
}
if (rows.length) {
  const mean = (k) => (rows.reduce((s, r) => s + r[k], 0) / rows.length).toFixed(2);
  const councilOnly = rows.reduce((s, r) => s + (r.council - r.plain), 0);
  console.log(`keyword coverage only; completed=${rows.length}/${questions.length * runs}; plain=${mean('plain')} (${mean('plainSec')}s); council=${mean('council')} (${mean('councilSec')}s); mean score delta=${(councilOnly / rows.length).toFixed(2)}; explicit escalation detected=${rows.filter((r) => r.convened === true).length}/${rows.filter((r) => r.convened !== null).length}`);
  console.log(`saved ${outputPath}`);
}
