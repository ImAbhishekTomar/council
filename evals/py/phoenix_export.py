"""Send the cached eval runs to a local Phoenix server as OpenTelemetry traces.

Start Phoenix:   evals/py/.venv-phoenix/bin/phoenix serve          (UI at http://localhost:6006)
Then run:        evals/py/.venv-phoenix/bin/python evals/py/phoenix_export.py
One trace per (condition, case). Council tool calls become child spans, DeepEval scores become attributes.
"""
import json
import time
from pathlib import Path

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor

EVALS = Path(__file__).resolve().parents[1]
provider = TracerProvider(resource=Resource.create({"openinference.project.name": "council-evals", "service.name": "council-evals"}))
provider.add_span_processor(SimpleSpanProcessor(OTLPSpanExporter(endpoint="http://localhost:6006/v1/traces")))
tracer = provider.get_tracer("council-evals")

cases = {c["id"]: c for c in json.loads((EVALS / "bugs.json").read_text())}
scores = {}
score_file = EVALS / "deepeval-results.json"
if score_file.exists():
    for row in json.loads(score_file.read_text()):
        scores[(row["condition"], row["id"])] = row

now = time.time_ns()
sent = 0
for path in sorted((EVALS / "outputs").glob("*/*.json")):
    out = json.loads(path.read_text())
    case = cases.get(out["id"])
    if not case:
        continue
    start = now
    end = start + int(out["seconds"] * 1e9)
    now = end + 1_000_000
    attrs = {
        "openinference.span.kind": "CHAIN",
        "input.value": f"Spec: {case['spec']}\n\n{case['code']}",
        "output.value": out["answer"],
        "council.condition": out["condition"],
        "council.case": out["id"],
        "council.planted_bugs": len(case["bugs"]),
        "council.agent_calls": out["agentCalls"],
        "council.turns": out["turns"] or 0,
        "llm.cost.total": out["costUsd"] or 0.0,
    }
    score = scores.get((out["condition"], out["id"]))
    if score:
        attrs["eval.bug_recall"] = score["Bug recall"]
        attrs["eval.no_false_bugs"] = score["No false bugs"]
    span = tracer.start_span(f"{out['condition']}:{out['id']}", start_time=start, attributes=attrs)
    ctx = trace.set_span_in_context(span)
    for i, tool in enumerate(out["tools"]):
        child = tracer.start_span(f"tool:{tool}", context=ctx, start_time=start + i * 1000, attributes={"openinference.span.kind": "TOOL", "tool.name": tool})
        child.end(end_time=start + i * 1000 + 1000)
    span.end(end_time=end)
    sent += 1
provider.force_flush()
print(f"sent {sent} traces to http://localhost:6006 (project council-evals)")
