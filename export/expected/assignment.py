# Exported from YPEA Studio 0.1.0. Tested with ypea 0.6.0, which needs Python 3.12 or newer.
# Install it with: pip install ypea==0.6.0
#
# Assignment
# Give each of 8 workers one task so that the total cost is as small as possible. Row i of the cost
# table is worker i. The data are synthetic.
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
# The solver of this run is ypea.SA.
# In the app it gave the objective value 188 after 20000 evaluations.

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

# Table cost
cost = np.array([
    [62, 92, 16, 43, 68, 97, 61, 72],
    [52, 39, 95, 44, 90, 34, 98, 38],
    [48, 81, 78, 47, 19, 72, 98, 97],
    [84, 71, 99, 95, 76, 66, 62, 26],
    [42, 74, 15, 64, 39, 12, 80, 37],
    [68, 27, 38, 11, 87, 24, 18, 54],
    [78, 43, 30, 79, 26, 42, 22, 43],
    [43, 72, 31, 94, 87, 49, 81, 99],
], dtype=float)  # $


# The problem

def objective(sol):
    # The value to minimize, in $.
    task = sol.task
    return sum(cost[range(8), task])


# The run

def main():
    # a name or a unit that the console cannot show must not stop the script
    try:
        sys.stdout.reconfigure(errors="replace")
    except AttributeError:  # an output without this setting, as in a notebook
        pass

    problem = ypea.Problem(
        [
            ypea.Permutation("task", n=8),
        ],
        objective,
        sense="min",
    )
    solver = ypea.SA(
        pop_size=10,
        max_sub_iter=10,
        initial_temp=10,
        final_temp=0.01,
        move_count=5,
        mutation_rate=0.1,
        mutation_step_size=0.3,
        mutation_step_size_damp=1,
        space="native",
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
    print("Objective:", f, "$")
    print("Solution:")
    print("  task =", best.task)
    print("Evaluations:", result.nfe, "of", 20000)
    # the objective value of the baseline, as the app computed it
    print("Baseline (Row-by-row greedy assignment):", 242, "$")
    print("  This run minus it:", f - 242)

    # for programs that read the result: set the environment variable YPEA_STUDIO_JSON to get
    # one more line, the whole result as JSON with every digit
    if os.environ.get("YPEA_STUDIO_JSON"):
        print(json.dumps(result.to_dict()))


if __name__ == "__main__":
    main()
