// promptfoo provider that returns the cached answer for a case, so scoring never re-runs the model.
// Generate the cache first with `node evals/generate.mjs`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;

export default class CachedProvider {
  constructor(options) {
    this.condition = options.config.condition;
  }

  id() {
    return `cached-${this.condition}`;
  }

  async callApi(_prompt, context) {
    const file = join(here, 'outputs', this.condition, `${context.vars.id}.json`);
    let out;
    try { out = JSON.parse(readFileSync(file)); } catch { return { error: `missing cached output ${file}` }; }
    return { output: out.answer, cost: out.costUsd ?? undefined, latencyMs: out.seconds * 1000, metadata: { agentCalls: out.agentCalls, turns: out.turns } };
  }
}
