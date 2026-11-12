# Council

Council turns a question into a structured discussion among specialist agents, then has one coordinator synthesize their findings into an answer.

Council is a pair of lightweight plugins for Codex and Claude Code. It uses each host's own model access, tools, and subagent runtime. It does not call a separate model API or require API keys.

## What happens

1. **Atom** receives the question. Atom is the neutral coordinator.
2. Atom breaks the question into answer-changing subquestions and decides whether one answer is enough.
3. When outside views help, it creates narrowly scoped specialists for specific mechanisms or decisions, gives each only the context needed for its slice, and starts independent work in parallel when the host allows it.
4. Specialists can recommend further expertise. Atom decides whether to ask another specialist, shares relevant findings, and may convene a focused follow-up discussion.
5. Before synthesis, a different Council member checks the answer-changing claims against their cited evidence and searches for counterevidence. Each claim is marked supported, contradicted, uncertain, or unverifiable. Atom resolves conflicts by evidence quality, not votes; if no independent reviewer is available, Atom checks directly and says so.
6. Atom answers from supported claims, preserves meaningful disagreement, and explains material uncertainty with useful caveats and sources.

Specialists are labelled by their narrow role. They get no invented names or genders.

## Install

### Claude Code

After the repository is published, replace `<owner>` with its GitHub owner:

```text
/plugin marketplace add <owner>/council
/plugin install council@council
```

For local development, run `/plugin marketplace add /absolute/path/to/council`, then `/plugin install council@council`. Start a new Claude Code session. Invoke the skill with `/council` and include the question.

### Codex

From this repository root, run:

```sh
codex plugin marketplace add .
codex plugin add council@council
```

For a published repository, use `codex plugin marketplace add <owner>/council` instead of `.`. Start a new Codex session and invoke the `council` skill (for example, `$council`) with your question.

The portable `skills/council/SKILL.md` can also be copied to `~/.agents/skills/council/` for user-wide discovery.

Stop the local dashboard server with `node <plugin-root>/scripts/council.mjs stop` when you are done.

## How coordination works

Council uses the host's native subagents instead of launching nested CLI processes. Atom is the single coordinator and shared memory for one council session. It tracks the roster and findings in its context, passes relevant findings to specialists, and gathers their reports. Independent research can run in parallel. Follow-up work is relayed through Atom so it works in both hosts.

The verification pass reuses current members rather than adding a standing critic. Reviewers challenge specific claims with sources or calculations; they do not manufacture disagreement. Atom sends material challenges back to the contributor and does not cite sources it has not checked.

This first version does not create a persistent or peer-to-peer agent network. Subagents are scoped to the current host session and disappear when that session ends. That keeps credentials, permissions, and tool access under Codex or Claude's existing controls.

## Repository layout

- `skills/council/SKILL.md`: shared, portable Council workflow.
- `src/GraphPanel.tsx` and `src/graph.css`: D3 graph and persona drawer adapted from the Councils playground.
- `scripts/council.mjs`: dashboard lifecycle, event, and quote-verification CLI.
- `scripts/server.mjs`: loopback-only event server and SSE stream.
- `.claude-plugin/`: Claude Code plugin metadata and marketplace catalog.
- `.codex-plugin/`: Codex compatibility manifest.
- `plugin.json`: portable plugin manifest.

## Live graph

When a Council session starts, the skill also starts a small loopback-only dashboard server and returns a local URL. The host sends structured lifecycle events to that server; the React page receives them over Server-Sent Events and updates the D3 graph. It reuses the graph and details drawer from the Councils playground; selecting a node opens its full persona profile. The page has no separate discussion feed because the conversation stays in the host window. Run data stays in server memory and is discarded when the server stops. The listener is only available on this machine.

Build the dashboard bundle before distributing a release:

```sh
pnpm install
pnpm build
```

## Publish

The marketplace entries currently use the local repository path, which is useful for development. Before publishing, update `.claude-plugin/marketplace.json` to use the hosted Git repository source expected by Claude Code. Do not advertise the GitHub install command until the repository exists at that address.

## Development

Install dependencies and run the checks from the repository root:

```sh
pnpm install
pnpm build
pnpm test
```

The dashboard server serves the built files from `dist/`, so run `pnpm build` before starting it. To create a local dashboard session:

```sh
printf '{"question":"Local dashboard test"}\n' | node scripts/council.mjs start
```

The command prints the session ID and local URL. Stop the server when finished:

```sh
node scripts/council.mjs stop
```

Edit the skill and manifests in this repository. React and Vite are only needed to rebuild the bundled dashboard page. Review changes in both Codex and Claude Code before publishing a release.


Eval results and the ship-or-drop decision rule: [evals/REPORT.md](evals/REPORT.md).

Metrics: [METRICS.md](METRICS.md) (regenerate with `pnpm eval:metrics`).
