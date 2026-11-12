// promptfoo grader provider: `exec:` calls this with the grading prompt and reads the verdict from stdout.
// Uses the local `claude` CLI so no API key is needed.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const prompt = process.argv[2];
if (!prompt) { console.error('usage: judge.mjs <prompt>'); process.exit(2); }
const cwd = mkdtempSync(join(tmpdir(), 'council-judge-'));
const text = execFileSync('claude', ['-p', prompt], { cwd, encoding: 'utf8', timeout: 300000 });
// The CLI can add notices around the answer; keep only the JSON object the grader asked for.
const start = text.indexOf('{');
const end = text.lastIndexOf('}');
process.stdout.write(start >= 0 && end > start ? text.slice(start, end + 1) : text);
