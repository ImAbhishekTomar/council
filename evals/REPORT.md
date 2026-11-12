# Council eval report (2026-11-07)

## Setup
- Task: find planted bugs in 12 short snippets (10 with 1-2 bugs, 2 clean). Ground truth in `bugs.json`.
- Conditions: `plain` (one model call), `council` (the /council skill as shipped), `council-forced` (skill told to convene 3+ specialists and verify).
- Frameworks: promptfoo (keyword recall + LLM rubric), DeepEval (GEval recall and false-bug precision), Phoenix (traces, project `council-evals`). Judge = `claude` CLI, same model family as the answers.
- RAGAS: not used. It scores retrieval (context precision, faithfulness to retrieved context). Council has no retrieval step, and ragas 0.2.15 and 0.4.3 both fail to import with current langchain-community.
- Earlier run (not in this folder): 10 well-known debugging questions, plain = Council = 1.00 on keyword score; Council convened specialists on none of them.

## Results (n=12 per condition)
| | plain | council | council-forced |
|---|---|---|---|
| promptfoo keyword recall | 1.00 | 1.00 | 1.00 |
| promptfoo LLM rubric | 0.88 | 0.99 | 0.94 |
| DeepEval bug recall | 1.00 | 0.99 | 0.99 |
| DeepEval no-false-bugs | 0.93 | 0.89 | 0.88 |
| seconds per case | 25 | 28 | 149 |
| USD per case | 0.24 | 0.28 | 1.12 |
| specialists convened | 0 | 0 | 3.1 |

## Findings
1. No measurable accuracy gain. The two judges disagree on direction (promptfoo favours Council, DeepEval favours plain). Differences are 1 to 3 cases of 12 and within judge noise.
2. The task set is too easy. A single call finds every planted bug (keyword recall 1.00 for all). An eval where the baseline scores 100% cannot show that anything adds value.
3. As shipped, Council never escalates (0 of 12). It equals plain with about 17% more cost and wordier answers (1467 vs 1026 chars).
4. Forced Council costs 4.6x and takes 5.9x longer for no measured gain on this set.
5. The judge is the same model family as the answerer, and the ground truth is incomplete (the `cart` case has a legitimate third bug that the rubric counted as a false positive). Treat the numbers as rough.

## Gaps
- Nothing yet shows a case where Council beats plain. The product claim ("more accurate") is unproven.
- No harder benchmark. Needed: tasks where plain scores below 0.6 (multi-file bugs, subtle concurrency or security, real bug-fix tasks with a runnable test).
- Verification is still a prompt, not enforced. `council.mjs verify-quote` exists but nothing forces its use.
- Reviewers are the same model as contributors, so errors stay correlated.

## Decision rule before release
Build 15+ tasks where plain scores under 0.6 and success is judged by running code or tests, not keywords. Run plain vs council-forced. Ship only if council-forced gains at least 15 points at under 3x cost. If not, drop the multi-agent mechanism and keep it as a single-answer skill, or stop the project.

## Reproduce
```
pnpm eval:generate     # claude calls, costs tokens, caches outputs/
pnpm eval:promptfoo
pnpm eval:deepeval
evals/py/.venv-phoenix/bin/phoenix serve   # then: pnpm eval:phoenix  (UI http://localhost:6006)
```
