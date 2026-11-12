// promptfoo config: plain vs Council on the bug-finding cases.
// Run: npx promptfoo@latest eval -c evals/promptfooconfig.mjs --no-cache   (after `node evals/generate.mjs`)
import { readFileSync } from 'node:fs';

const cases = JSON.parse(readFileSync(new URL('./bugs.json', import.meta.url)));
const lower = (text) => String(text).toLowerCase();

// Cheap keyword recall: fraction of planted bugs whose any-keyword appears in the answer.
// Clean cases pass only when the answer says there are no bugs.
const recall = (bugs) => (output) => {
  const text = lower(output);
  if (!bugs.length) {
    const clean = /no (real )?bugs?( found)?|no issues|is correct|no problems/.test(text);
    return { pass: clean, score: clean ? 1 : 0, reason: clean ? 'clean code, no false alarm' : 'false alarm on clean code' };
  }
  const found = bugs.filter((b) => b.any.some((k) => text.includes(lower(k))));
  return { pass: found.length === bugs.length, score: found.length / bugs.length, reason: `found ${found.map((b) => b.id).join(', ') || 'none'} of ${bugs.map((b) => b.id).join(', ')}` };
};

export default {
  description: 'Council vs plain: planted-bug review',
  prompts: ['{{id}}'],
  providers: [
    { id: 'file://promptfoo-provider.mjs', label: 'plain', config: { condition: 'plain' } },
    { id: 'file://promptfoo-provider.mjs', label: 'council', config: { condition: 'council' } },
    { id: 'file://promptfoo-provider.mjs', label: 'council-forced', config: { condition: 'council-forced' } },
  ],
  defaultTest: {
    options: { provider: { id: 'exec:node judge.mjs' } },
  },
  tests: cases.map((c) => ({
    description: c.id,
    vars: { id: c.id },
    assert: [
      { type: 'javascript', value: (output) => recall(c.bugs)(output), metric: 'keyword_recall' },
      {
        type: 'llm-rubric',
        metric: 'judge_correct',
        value: c.bugs.length
          ? `The answer must correctly identify ALL of these real bugs and must not claim other bugs that are not real:\n${c.bugs.map((b) => `- ${b.desc}`).join('\n')}`
          : 'The code is correct. The answer must say there are no real bugs and must not invent any.',
      },
    ],
  })),
};
