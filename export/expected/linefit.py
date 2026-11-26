# Exported from YPEA Studio 0.1.0. Tested with ypea 0.5.0, which needs Python 3.12 or newer.
# Install it with: pip install ypea==0.5.0
#
# Calibration line fit
# Fit the offset and gain of a pressure sensor to calibration readings. The data are synthetic.
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
# The solver of this run is ypea.NelderMead.
# In the app it gave the objective value 9.96728626890629 after 2000 evaluations.

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


# The data

# Table calibration
voltage = np.array([
    0.5, 0.86, 1.23, 1.59, 1.95, 2.32, 2.68, 3.05, 3.41, 3.77, 4.14, 4.5,
], dtype=float)  # V
pressure = np.array([
    14.38, 22.92, 33.06, 42.04, 50.67, 59.25, 67.85, 80.15, 87.83, 94.4, 104.85, 113.34,
], dtype=float)  # kPa


# The problem

def objective(sol):
    # The value to minimize, in kPa^2.
    offset = sol.offset
    gain = sol.gain
    return sum((pressure - (offset + gain * voltage)) ** 2)


# The run

def main():
    # a name or a unit that the console cannot show must not stop the script
    try:
        sys.stdout.reconfigure(errors="replace")
    except AttributeError:  # an output without this setting, as in a notebook
        pass

    problem = ypea.Problem(
        [
            ypea.Real("offset", lb=-10, ub=10),  # kPa
            ypea.Real("gain", lb=0, ub=100),  # kPa/V
        ],
        objective,
        sense="min",
    )
    solver = ypea.NelderMead(
        reflection=1,
        expansion=2,
        contraction=0.5,
        shrink=0.5,
        initial_step=0.1,
        restart_tol=1e-10,
        max_nfe=2000,  # the budget, in evaluations
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
    print("Objective:", f, "kPa^2")
    print("Solution:")
    print("  offset =", best.offset, "kPa")
    print("  gain =", best.gain, "kPa/V")
    print("Evaluations:", result.nfe, "of", 2000)
    # the objective value of the baseline, as the app computed it
    print("Baseline (Current settings):", 236.8362000000003, "kPa^2")
    print("  This run minus it:", f - 236.8362000000003)
    # the objective value of the reference, as the app computed it
    print("Reference (Least-squares line):", 9.967286268906392, "kPa^2")
    print("  This run minus it:", f - 9.967286268906392)

    # for programs that read the result: set the environment variable YPEA_STUDIO_JSON to get
    # one more line, the whole result as JSON with every digit
    if os.environ.get("YPEA_STUDIO_JSON"):
        print(json.dumps(result.to_dict()))


if __name__ == "__main__":
    main()
