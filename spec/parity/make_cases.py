"""Writes the parity cases next to this file. Run it with the project's Python:

    .venv/Scripts/python spec/parity/make_cases.py      (Windows)
    .venv/bin/python spec/parity/make_cases.py          (elsewhere)

The project's .venv holds the pinned ypea release (the version is YPEA_TESTED in
engine/run.ts), and that is what the
cases come from. To try a ypea working copy instead, set the YPEA_REPO environment variable
to its folder. Cases made that way are marked "(working copy)" and must not be committed.

- rng.json: the reference generator alone.
- numpy.json: how NumPy adds numbers, for engine/numpy.ts.
- variables.json: ypea's own decoders.
- encode.json: ypea's own encoders, for the types that have native operators.
- operators.json: ypea's native operators (ypea.operators), called one at a time.
- traces/*.json: seeded runs of the real ypea methods with ypea.StudioRng. The runs are
  listed in methods/*.json, one file per method, so a method's cases live with the method.
  Each run is a whole project. Its objective and constraints run as real Python, the way an
  exported script would run them. A run with constraints lists its scales, which the app
  would otherwise take from a random sample.

With arguments, only the named files are written: the traces of a method file, for example
"make_cases.py de" for methods/de.json, or one of the files above, for example
"make_cases.py encode".
"""

import json
import os
import sys
import warnings
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from studio_rng import StudioRng, derive_seed  # noqa: E402


def write(name, data):
    (HERE / name).write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("wrote", name)


def rng_cases():
    rng = StudioRng(12345)
    p = [0.1, 0.2, 0.3, 0.4]
    # one stream, in this order, so the position after each kind of draw is tested too
    draws = [
        ["random", [], rng.random(5).tolist()],
        ["uniform", [-1, 1], rng.uniform(-1, 1, 3).tolist()],
        ["integers", [0, 7], rng.integers(7, size=5).tolist()],
        ["integers", [1, 3], rng.integers(1, 3, size=5).tolist()],
        ["standardNormal", [], rng.standard_normal(40).tolist()],
        ["standardCauchy", [], rng.standard_cauchy(40).tolist()],
        ["geometric", [0.3], rng.geometric(0.3, 40).tolist()],
        ["choice", [p], rng.choice(4, size=5, p=p).tolist()],
        ["permutation", [8], [rng.permutation(8).tolist()]],
        ["random", [], rng.random((2, 3)).ravel().tolist()],
    ]
    write("rng.json", {
        "seed": 12345,
        "draws": [{"method": m, "args": a, "values": v} for m, a, v in draws],
        "derivedSeeds": {"base": 1, "seeds": [derive_seed(1, i) for i in range(4)]},
    })


def load_ypea():
    """The pinned ypea installed in this Python, or the working copy named by YPEA_REPO."""
    if os.environ.get("YPEA_REPO"):
        sys.path.insert(0, str(Path(os.environ["YPEA_REPO"]) / "src"))
    import ypea
    return ypea


def plain(value):
    """A decoded value as JSON: nested lists, and for ordered groups a list of groups."""
    if isinstance(value, list):
        return [plain(g) for g in value]
    return np.asarray(value).tolist()


def numpy_cases():
    rng = StudioRng(77)
    cases = []
    for n in [1, 2, 7, 8, 9, 15, 16, 17, 64, 127, 128, 129, 130, 255, 256, 257, 300, 1000, 4097]:
        a = (rng.random(n) - 0.5) * 10.0 ** rng.integers(-4, 5, size=n)
        cases.append({"values": a.tolist(), "sum": float(np.sum(a)), "mean": float(np.mean(a))})
    write("numpy.json", {"numpy": np.__version__, "cases": cases})


def variable_cases():
    """Every variable type as a project file writes it, decoded by ypea's own decoders."""
    ypea = load_ypea()
    specs = [
        ({"type": "real", "shape": [], "lb": -1, "ub": 3}, lambda: ypea.Real("v", lb=-1, ub=3)),
        ({"type": "real", "shape": [3], "lb": [0, -5, 2], "ub": [1, 5, 2]}, lambda: ypea.Real("v", lb=[0, -5, 2], ub=[1, 5, 2])),
        ({"type": "real", "shape": [2, 3], "lb": -10, "ub": 10}, lambda: ypea.Real("v", shape=(2, 3), lb=-10, ub=10)),
        ({"type": "integer", "shape": [4], "lb": -2, "ub": 5}, lambda: ypea.Integer("v", shape=4, lb=-2, ub=5)),
        ({"type": "integer", "shape": [], "lb": 7, "ub": 7}, lambda: ypea.Integer("v", lb=7, ub=7)),
        ({"type": "binary", "shape": [6]}, lambda: ypea.Binary("v", shape=6)),
        ({"type": "permutation", "n": 7}, lambda: ypea.Permutation("v", 7)),
        ({"type": "selection", "n": 7, "k": 3}, lambda: ypea.Selection("v", 7, 3)),
        ({"type": "binary_selection", "n": 7, "k": 3}, lambda: ypea.BinarySelection("v", 7, 3)),
        ({"type": "partition", "n": 6, "k": 3}, lambda: ypea.Partition("v", 6, 3)),
        ({"type": "partition", "n": 4, "k": 1}, lambda: ypea.Partition("v", 4, 1)),
        ({"type": "binary_partition", "n": 6, "k": 3}, lambda: ypea.BinaryPartition("v", 6, 3)),
        ({"type": "fixed_sum", "shape": [5], "target": 10}, lambda: ypea.FixedSum("v", 5, 10)),
        ({"type": "fixed_sum", "shape": [3, 4], "target": 1}, lambda: ypea.FixedSum("v", (3, 4), 1)),
        ({"type": "fixed_row_sum", "shape": [3, 4], "target": [1, 2, 3]}, lambda: ypea.FixedSum("v", (3, 4), [1, 2, 3], axis=1)),
        ({"type": "fixed_column_sum", "shape": [3, 4], "target": 5}, lambda: ypea.FixedSum("v", (3, 4), 5, axis=0)),
    ]
    rng = StudioRng(2026)

    cases = []
    for spec, make in specs:
        var = make()
        d = var.code_size
        codes = np.vstack([
            rng.random((4, d)),
            np.round(rng.random((3, d)), 1),  # coarse codes, so sorting meets ties
            np.zeros((1, d)), np.ones((1, d)), np.full((1, d), 0.5),
        ])
        decoded = var.decode(codes)
        cases.append({
            "variable": {"name": "v", **spec},
            "codes": codes.tolist(),
            "decoded": [plain(decoded[i]) for i in range(len(codes))],
        })
    write("variables.json", {"cases": cases})


def to_ypea_variable(ypea, v):
    t, name = v["type"], v["name"]
    shape = tuple(v["shape"]) if v.get("shape") else None
    if t == "real":
        return ypea.Real(name, shape=shape, lb=v["lb"], ub=v["ub"])
    if t == "integer":
        return ypea.Integer(name, shape=shape, lb=v["lb"], ub=v["ub"])
    if t == "binary":
        return ypea.Binary(name, shape=shape)
    if t == "permutation":
        return ypea.Permutation(name, v["n"])
    if t in ("selection", "binary_selection", "partition", "binary_partition"):
        cls = {"selection": ypea.Selection, "binary_selection": ypea.BinarySelection,
               "partition": ypea.Partition, "binary_partition": ypea.BinaryPartition}[t]
        return cls(name, v["n"], v["k"])
    axis = {"fixed_sum": None, "fixed_row_sum": 1, "fixed_column_sum": 0}[t]
    return ypea.FixedSum(name, tuple(v["shape"]), v["target"], axis=axis)


def encode_cases():
    """Values of the types that have native operators, encoded by ypea's own encoders."""
    ypea = load_ypea()
    specs = [
        {"type": "real", "shape": [], "lb": -1, "ub": 3},
        {"type": "real", "shape": [3], "lb": [0, -5, 2], "ub": [1, 5, 2]},
        {"type": "real", "shape": [2, 3], "lb": -10, "ub": 10},
        {"type": "integer", "shape": [4], "lb": -2, "ub": 5},
        {"type": "integer", "shape": [4], "lb": [0, 0, -4, 3], "ub": [0, 1, 40, 9]},
        {"type": "integer", "shape": [], "lb": 7, "ub": 7},
        {"type": "binary", "shape": [6]},
        {"type": "binary", "shape": []},
        {"type": "permutation", "n": 7},
        {"type": "permutation", "n": 1},
        {"type": "selection", "n": 7, "k": 3},
        {"type": "selection", "n": 5, "k": 1},
        {"type": "selection", "n": 4, "k": 4},
        {"type": "binary_selection", "n": 7, "k": 3},
        {"type": "binary_selection", "n": 5, "k": 1},
        {"type": "binary_selection", "n": 4, "k": 4},
        # ordered groups: k = 1, one item, and more groups than items, so some are empty
        {"type": "partition", "n": 6, "k": 3},
        {"type": "partition", "n": 4, "k": 1},
        {"type": "partition", "n": 1, "k": 1},
        {"type": "partition", "n": 2, "k": 4},
        {"type": "binary_partition", "n": 6, "k": 3},
        {"type": "binary_partition", "n": 4, "k": 1},
        {"type": "binary_partition", "n": 1, "k": 1},
        {"type": "binary_partition", "n": 2, "k": 4},
    ]
    rng = StudioRng(2027)
    cases = []
    for spec in specs:
        var = to_ypea_variable(ypea, {"name": "v", **spec})
        d = var.code_size
        # the values of random codes, of coarse codes (ties), and of both ends of every range
        values = var.decode(np.vstack([rng.random((5, d)), np.round(rng.random((3, d)), 1), np.zeros((1, d)), np.ones((1, d))]))
        cases.append({"variable": {"name": "v", **spec}, "values": plain(values), "encoded": var.encode(values).tolist()})
    write("encode.json", {"cases": cases})


def operator_cases():
    """ypea's native operators, each called alone on a fresh generator. "next" is the draw
    that follows the call, so the number of draws an operator uses is tested too."""
    ypea = load_ypea()
    from ypea import operators as ops

    src = StudioRng(31)
    seed = 1000

    # the crossovers of two orderings, at every pair of cut points
    orderings = []
    for m in (1, 2, 5, 7):
        for _ in range(2):
            p1, p2 = src.permutation(m), src.permutation(m)
            for name in ("order_crossover", "pmx", "cycle_crossover"):
                orderings.append({"name": name, "p1": p1.tolist(), "p2": p2.tolist(), "children": [
                    [i, j, getattr(ops, name)(p1, p2, i, j).tolist()] for i in range(m + 1) for j in range(i, m + 1)]})

    # the moves of one ordering, at every pair of distinct positions
    moves = []
    x = src.permutation(6)
    for name in ("swap", "inversion", "insertion", "scramble"):
        for i in range(6):
            for j in range(6):
                if i != j:
                    seed += 1
                    rng = StudioRng(seed)
                    moves.append({"name": name, "x": x.tolist(), "i": i, "j": j, "seed": seed,
                                  "result": getattr(ops, name)(x, i, j, rng).tolist(), "next": rng.random()})

    arrays = []
    for name in ("uniform_crossover", "one_point_crossover"):
        for shape in ((5, 6), (4, 2), (3, 1)):
            x1, x2 = src.integers(100, size=shape), src.integers(100, size=shape)
            seed += 1
            rng = StudioRng(seed)
            y1, y2 = getattr(ops, name)(x1, x2, rng)
            arrays.append({"name": name, "x1": x1.tolist(), "x2": x2.tolist(), "seed": seed,
                           "result": [y1.tolist(), y2.tolist()], "next": rng.random()})

    # the default operators of every type, with the edges of each: one element, equal bounds,
    # k = 1, k = n, and a step size that lands on a half (0.1 * 25)
    specs = [
        ({"type": "real", "shape": [], "lb": -1, "ub": 3}, {}),
        ({"type": "real", "shape": [3], "lb": [0, -5, 2], "ub": [1, 5, 2]}, {"alpha": 0.3, "rate": 0.5, "sigma": 0.4}),
        ({"type": "real", "shape": [2, 3], "lb": -10, "ub": 10}, {"rate": 0, "sigma": 0.2}),
        ({"type": "integer", "shape": [2, 2], "lb": -2, "ub": 5}, {}),
        ({"type": "integer", "shape": [5], "lb": -3, "ub": 22}, {"rate": 0.6, "sigma": 0.1}),
        ({"type": "integer", "shape": [4], "lb": [0, 0, -4, 3], "ub": [0, 1, 40, 9]}, {"rate": 1, "sigma": 0.3}),
        ({"type": "integer", "shape": [], "lb": 7, "ub": 7}, {}),
        ({"type": "binary", "shape": [6]}, {}),
        ({"type": "binary", "shape": []}, {"rate": 1}),
        ({"type": "permutation", "n": 7}, {}),
        ({"type": "permutation", "n": 2}, {}),
        ({"type": "permutation", "n": 1}, {}),
        ({"type": "selection", "n": 7, "k": 3}, {}),
        ({"type": "selection", "n": 5, "k": 1}, {}),
        ({"type": "selection", "n": 4, "k": 4}, {}),
        ({"type": "selection", "n": 1, "k": 1}, {}),
        ({"type": "binary_selection", "n": 7, "k": 3}, {}),
        ({"type": "binary_selection", "n": 5, "k": 1}, {}),
        ({"type": "binary_selection", "n": 4, "k": 4}, {}),
        ({"type": "partition", "n": 6, "k": 3}, {}),
        ({"type": "partition", "n": 5, "k": 1}, {}),
        ({"type": "partition", "n": 1, "k": 1}, {}),
        ({"type": "partition", "n": 1, "k": 2}, {}),
        ({"type": "partition", "n": 2, "k": 4}, {}),
        ({"type": "binary_partition", "n": 6, "k": 3}, {}),
        ({"type": "binary_partition", "n": 5, "k": 1}, {}),
        ({"type": "binary_partition", "n": 1, "k": 1}, {}),
        ({"type": "binary_partition", "n": 2, "k": 4}, {}),
    ]
    defaults = []
    for spec, params in specs:
        var = to_ypea_variable(ypea, {"name": "v", **spec})
        op = ops.default_operators(var, **params)
        x1, x2 = var.decode(src.random((8, var.code_size))), var.decode(src.random((8, var.code_size)))
        for method in ("crossover", "mutate"):
            seed += 1
            rng = StudioRng(seed)
            result = op.crossover(x1, x2, rng) if method == "crossover" else (op.mutate(x1, rng),)
            defaults.append({"variable": {"name": "v", **spec}, "params": params, "method": method, "seed": seed,
                             "x1": plain(x1), "x2": plain(x2), "result": [plain(y) for y in result], "next": rng.random()})
    write("operators.json", {"orderings": orderings, "moves": moves, "arrays": arrays, "defaults": defaults})


def python_objective(project, scales):
    """The project's objective as an exported script would define it for ypea: the user's text
    runs unchanged in real Python, with the data as NumPy arrays and `ops` from spec/language.
    With constraints it returns (f, g), each g divided by its scale and satisfied when g <= 0."""
    import builtins

    sys.path.insert(0, str(HERE.parent / "language"))
    import ops

    scope = {"__builtins__": {n: getattr(builtins, n) for n in ("sum", "min", "max", "abs", "len", "range")}, "ops": ops}
    for table in project.get("data", []):
        if table["kind"] == "matrix":
            scope[table["name"]] = np.array(table["values"], dtype=float)
        else:
            for column in table["columns"]:
                scope[column["name"]] = np.array(column["values"], dtype=float)
    exec(project.get("functions", ""), scope)  # noqa: S102
    names = [v["name"] for v in project["variables"]]
    objective = compile(project["objective"]["source"], "objective", "eval")
    constraints = [(c["op"], compile(c["left"], "left", "eval"), compile(c["right"], "right", "eval"), c.get("tolerance", 0))
                   for c in project.get("constraints", [])]

    def gap(op, left, right, tolerance):
        return left - right if op == "<=" else right - left if op == ">=" else abs(left - right) - tolerance

    def evaluate(sol):
        values = {name: getattr(sol, name) for name in names}
        f = eval(objective, scope, values)  # noqa: S307
        if not constraints:
            return f
        g = [gap(op, eval(left, scope, values), eval(right, scope, values), tol) / scale  # noqa: S307
             for (op, left, right, tol), scale in zip(constraints, scales, strict=True)]
        return f, g

    return evaluate


def method_cases(only):
    """Runs every case in methods/*.json with the real ypea class and writes its trace."""
    ypea = load_ypea()
    label = ypea.__version__ + (" (working copy)" if os.environ.get("YPEA_REPO") else "")
    for path in sorted((HERE / "methods").glob("*.json")):
        if only and path.stem not in only:
            continue
        for run in json.loads(path.read_text(encoding="utf-8"))["runs"]:
            project = run["project"]
            scales = run.get("scales", [])
            problem = ypea.Problem([to_ypea_variable(ypea, v) for v in project["variables"]],
                                   python_objective(project, scales), sense=project["objective"]["sense"])
            algorithm = getattr(ypea, run["ypea"]["class"])(**run["ypea"]["kwargs"], max_nfe=project["run"]["budget"])
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")  # division by zero gives inf or nan, as the language says
                result = algorithm.solve(problem, seed=ypea.StudioRng(ypea.derive_seed(project["run"]["seed"], 0)))
            h = result.history
            write(f"traces/{run['name']}.json", {
                "ypea": label,
                "project": project,
                "scales": scales,
                "nfe": result.nfe,
                "traceNfe": h.trace_nfe.tolist(),
                "traceF": h.trace_obj_value.tolist(),
                "traceV": [v if np.isfinite(v) else "inf" for v in h.trace_violation.tolist()],
                "bestCodes": result.best.position.tolist(),
            })


(HERE / "traces").mkdir(exist_ok=True)
FILES = {"rng": rng_cases, "numpy": numpy_cases, "variables": variable_cases, "encode": encode_cases, "operators": operator_cases}
for name, make in FILES.items():
    if not sys.argv[1:] or name in sys.argv[1:]:
        make()
methods = [name for name in sys.argv[1:] if name not in FILES]
if methods or not sys.argv[1:]:
    method_cases(methods)
