"""DeepEval scoring of cached Council vs plain outputs.

The judge is the `claude` CLI (no API key needed). Run from the repo root:
    evals/py/.venv/bin/python evals/py/deepeval_run.py
Writes evals/deepeval-results.json.
"""
import json
import subprocess
import tempfile
from pathlib import Path

from deepeval.metrics import GEval
from deepeval.models import DeepEvalBaseLLM
from deepeval.test_case import LLMTestCase, LLMTestCaseParams

ROOT = Path(__file__).resolve().parents[2]
EVALS = ROOT / "evals"
SCRATCH = tempfile.mkdtemp(prefix="council-judge-")


class ClaudeCLI(DeepEvalBaseLLM):
    """Judge model that shells out to the local `claude` CLI."""

    def __init__(self, model="claude-cli"):
        self.model = model

    def load_model(self):
        return self.model

    def get_model_name(self):
        return self.model

    def generate(self, prompt, schema=None):
        if schema is not None:
            prompt += "\n\nReply with only one JSON object matching this schema, no prose:\n" + json.dumps(schema.model_json_schema())
        out = subprocess.run(["claude", "-p", prompt], cwd=SCRATCH, capture_output=True, text=True, timeout=300, stdin=subprocess.DEVNULL)
        text = out.stdout.strip()
        if out.returncode != 0 or not text:
            raise RuntimeError(f"claude judge failed: {out.stderr[:300]}")
        if schema is None:
            return text
        start, end = text.find("{"), text.rfind("}")
        return schema(**json.loads(text[start : end + 1]))

    async def a_generate(self, prompt, schema=None):
        return self.generate(prompt, schema)


judge = ClaudeCLI()
PARAMS = [LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT, LLMTestCaseParams.EXPECTED_OUTPUT]
recall = GEval(
    name="Bug recall",
    criteria=(
        "The expected output lists the real bugs in the code. Score how many of them the actual output "
        "correctly identifies, with a correct explanation. If the expected output says there are no bugs, "
        "score 1.0 only when the actual output also says there are no real bugs."
    ),
    evaluation_params=PARAMS,
    model=judge,
    threshold=0.7,
)
precision = GEval(
    name="No false bugs",
    criteria=(
        "Penalize every bug in the actual output that is NOT a real bug according to the expected output "
        "and the spec (style nitpicks, invented problems, claims about behaviour the spec allows). "
        "Score 1.0 when every reported bug is real; lower for each false report."
    ),
    evaluation_params=PARAMS,
    model=judge,
    threshold=0.7,
)

CONDITIONS = sorted(p.name for p in (EVALS / "outputs").iterdir() if p.is_dir())
cases = json.loads((EVALS / "bugs.json").read_text())
OUT = EVALS / "deepeval-results.json"
results = json.loads(OUT.read_text()) if OUT.exists() else []  # resume: finished rows are kept
done = {(r["condition"], r["id"]) for r in results}
for condition in CONDITIONS:
    for case in cases:
        path = EVALS / "outputs" / condition / f"{case['id']}.json"
        if not path.exists() or (condition, case["id"]) in done:
            continue
        out = json.loads(path.read_text())
        expected = "\n".join(f"- {b['desc']}" for b in case["bugs"]) or "No bugs. The code is correct."
        test = LLMTestCase(
            input=f"Spec: {case['spec']}\n\nCode:\n{case['code']}",
            actual_output=out["answer"],
            expected_output=expected,
        )
        row = {"id": case["id"], "condition": condition}
        try:
            for metric in (recall, precision):
                metric.measure(test, _show_indicator=False)
                row[metric.name] = metric.score
                row[metric.name + " reason"] = metric.reason
        except Exception as error:  # a judge failure must not erase finished rows; rerun to retry
            print("FAILED", condition, case["id"], str(error)[:200], flush=True)
            continue
        results.append(row)
        OUT.write_text(json.dumps(results, indent=2))
        print(condition, case["id"], row["Bug recall"], row["No false bugs"], flush=True)

for condition in CONDITIONS:
    rows = [r for r in results if r["condition"] == condition]
    if rows:
        print(condition, "recall=%.2f" % (sum(r["Bug recall"] for r in rows) / len(rows)), "precision=%.2f" % (sum(r["No false bugs"] for r in rows) / len(rows)), "n=%d" % len(rows))
