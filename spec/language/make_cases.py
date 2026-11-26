"""Evaluates the cases of cases.py in real Python and writes cases.json next to this file.

    .venv/Scripts/python spec/language/make_cases.py      (Windows)
    .venv/bin/python spec/language/make_cases.py          (elsewhere)

A case that raises must be marked error=True in cases.py, and a case marked so must raise.
This catches typing mistakes in the cases themselves.
"""

import builtins
import json
import math
import sys
import warnings
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ops  # noqa: E402
from cases import CASES, ENVS, REJECTS  # noqa: E402

BUILTINS = {name: getattr(builtins, name) for name in ("sum", "min", "max", "abs", "len", "range")}
BUILTINS["__build_class__"] = None  # nothing else from Python is reachable
ERRORS = {IndexError: "index", ValueError: "value", TypeError: "type"}


def to_python(entry):
    """An input as an exported script would hold it: NumPy arrays and NumPy scalars."""
    kind, value = entry["kind"], entry["value"]
    if kind == "groups":
        return [np.array(g, dtype=np.int64) for g in value]
    return np.array(value, dtype=float if kind == "float" else np.int64)[()]


def number(v):
    v = float(v)
    if math.isnan(v):
        return "nan"
    if math.isinf(v):
        return "inf" if v > 0 else "-inf"
    return v


def to_json(value):
    """A result as plain JSON. Truth values become 1 and 0, and non-finite numbers become text."""
    if isinstance(value, range):
        value = list(value)
    if isinstance(value, list):
        return [to_json(v) for v in value]
    a = np.asarray(value)
    if a.ndim == 0:
        return number(a)
    return [to_json(v) for v in a]


def run(env, expression, functions):
    scope = {"__builtins__": BUILTINS, "ops": ops, **{k: to_python(v) for k, v in ENVS[env].items()}}
    exec(functions, scope)  # noqa: S102
    return eval(expression, scope)  # noqa: S307


out = []
for name, env, expression, options in CASES:
    case = {"name": name, "env": env, "expression": expression}
    if options.get("functions"):
        case["functions"] = options["functions"]
    if options.get("approx"):
        case["approx"] = True
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # division by zero and friends give inf or nan, as specified
            result = run(env, expression, options.get("functions", ""))
    except tuple(ERRORS) as error:
        if not options.get("error"):
            raise SystemExit(f"case {name!r} raised {error!r} but is not marked error=True") from error
        case["error"] = ERRORS[type(error)]
    else:
        if options.get("error"):
            raise SystemExit(f"case {name!r} is marked error=True but gave {result!r}")
        case["value"] = to_json(result)
    out.append(case)

names = [c["name"] for c in out] + [r[0] for r in REJECTS]
assert len(set(names)) == len(names), "case names must be unique"
data = {
    "python": sys.version.split()[0],
    "numpy": np.__version__,
    "envs": ENVS,
    "cases": out,
    "rejects": [{"name": n, "where": w, "source": s, "line": line} for n, w, s, line in REJECTS],
}
(HERE / "cases.json").write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8", newline="\n")
print(f"wrote cases.json: {len(out)} cases, {sum('error' in c for c in out)} of them errors, {len(REJECTS)} rejects")
