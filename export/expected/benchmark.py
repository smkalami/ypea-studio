# Exported from YPEA Studio 0.1.0. Tested with ypea 0.7.0, which needs Python 3.12 or newer.
# Install it with: pip install ypea==0.7.0
#
# Benchmark functions
#
# Running this file repeats the run of the app with the same solver, settings, budget and seed.
# How closely the Python run follows the app:
# - With CMA-ES (ypea.CMAES) the two runs agree within a small tolerance, which grows with the
#   length of the run: about 1e-11 of the best value after 1000 evaluations.
# - With every other solver the two runs are the same, number for number.
# - Functions such as exp, log, sin, cos and tan, a power other than 2, and the square of a single
#   number can differ in the last digit between the two languages. A run that uses them can
#   then take a slightly different path. Write x * x for a square that must be exact.
#
# The solver of this run is ypea.PSO.
# In the app it gave the objective value 3.972943243380272e-12 after 20000 evaluations.

import json
import os
import sys

import numpy as np
import ypea


# The ops functions of the app. Each one is the NumPy function of the same name. They are made
# inside a function and live only in ops, so that sum, min, max, abs, len and range keep their
# Python meaning in the rest of this file.
def make_ops():
    """The `ops` namespace of the limited Python syntax, defined in real Python (spec/language.md).

    An exported script carries this module, and the Studio translator must give the same values.
    Every function is the NumPy function of the same name, restricted to what the app supports.
    """

    import numpy as np

    pi, e, inf = np.pi, np.e, np.inf

    def array(values):
        return np.array(values, dtype=float)

    def zeros(n):
        return np.zeros(int(n))

    def ones(n):
        return np.ones(int(n))

    def arange(n):
        return np.arange(int(n))

    # reductions: a list, or a table with axis=0 (down the columns) or axis=1 (along the rows)
    def sum(a, axis=None):  # noqa: A001
        return np.sum(a, axis=axis)

    def mean(a, axis=None):
        return np.mean(a, axis=axis)

    def prod(a, axis=None):
        return np.prod(a, axis=axis)

    def min(a, axis=None):  # noqa: A001
        return np.min(a, axis=axis)

    def max(a, axis=None):  # noqa: A001
        return np.max(a, axis=axis)

    # positions: lists only
    def _list(a):
        a = np.asarray(a)
        if a.ndim != 1:
            raise ValueError("this function needs a list")
        return a

    def argmin(a):
        return int(np.argmin(_list(a)))

    def argmax(a):
        return int(np.argmax(_list(a)))

    def argsort(a):
        return np.argsort(_list(a), kind="stable")

    def sort(a):
        return np.sort(_list(a), kind="stable")

    def cumsum(a):
        return np.cumsum(_list(a))

    def roll(a, k):
        return np.roll(_list(a), int(k))

    # element by element
    sqrt, floor, ceil, sign = np.sqrt, np.floor, np.ceil, np.sign
    abs = np.abs  # noqa: A001
    round = np.round  # noqa: A001
    minimum, maximum, clip, where = np.minimum, np.maximum, np.clip, np.where
    exp, log, sin, cos, tan = np.exp, np.log, np.sin, np.cos, np.tan

    def dot(a, b):
        a, b = np.asarray(a), np.asarray(b)
        if b.ndim != 1 or a.ndim not in (1, 2):
            raise ValueError("ops.dot needs two lists, or a table and a list")
        return np.dot(a, b)

    import types

    return types.SimpleNamespace(**locals())


ops = make_ops()


# The problem

def objective(sol):
    # The value to minimize.
    x = sol.x
    return sum(x ** 2)


# The run

def main():
    # a name or a unit that the console cannot show must not stop the script
    try:
        sys.stdout.reconfigure(errors="replace")
    except AttributeError:  # an output without this setting, as in a notebook
        pass
    if ypea.__version__ != "0.7.0":
        print("Note: this script was tested with ypea 0.7.0, and ypea " + ypea.__version__,
              "is installed. The numbers can differ.", file=sys.stderr)

    problem = ypea.Problem(
        [
            ypea.Real("x", shape=(10,), lb=-10, ub=10),
        ],
        objective,
        sense="min",
    )
    solver = ypea.PSO(
        pop_size=100,
        w=1,
        wdamp=0.99,
        c1=2,
        c2=2,
        w_final=None,
        max_velocity=None,
        max_nfe=20000,  # the budget, in evaluations
    )
    base_seed = 1  # the seed of the experiment in the app
    run_index = 0  # which run of the experiment this is, counted from 0
    seed = ypea.StudioRng(ypea.derive_seed(base_seed, run_index))
    # as in the app, a candidate that divides by zero counts as the worst, without a warning
    with np.errstate(all="ignore"):
        result = solver.solve(problem, seed=seed)

    best = result.best.solution
    f = result.best.obj_value
    print("Best feasible solution found")
    print("Objective:", f)
    print("Solution:")
    print("  x =", best.x)
    print("Evaluations:", result.nfe, "of", 20000)
    # the objective value of the reference, as the app computed it
    print("Reference:", 0)
    print("  This run minus it:", f - 0)

    # for programs that read the result: set the environment variable YPEA_STUDIO_JSON to get
    # one more line, the whole result as JSON with every digit
    if os.environ.get("YPEA_STUDIO_JSON"):
        print(json.dumps(result.to_dict()))


if __name__ == "__main__":
    main()
