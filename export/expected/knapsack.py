# Exported from YPEA Studio 0.1.0. Tested with ypea 0.6.0, which needs Python 3.12 or newer.
# Install it with: pip install ypea==0.6.0
#
# 0/1 knapsack
# Choose items to carry so that their total value is as large as possible within a weight limit. The
# data are synthetic.
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
# The solver of this run is ypea.GA.
# In the app it gave the objective value 617 after 20000 evaluations.

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

# Table items
weight = np.array([
    10, 15, 6, 5, 2, 9, 8, 7, 15, 2, 9, 10, 11, 5, 9, 7, 7, 14, 6, 8,
], dtype=float)  # kg
value = np.array([
    89, 46, 56, 33, 86, 41, 27, 99, 90, 97, 13, 99, 42, 22, 58, 45, 21, 92, 46, 44,
], dtype=float)  # $


# The problem

def objective(sol):
    # The value to maximize, in $.
    take = sol.take
    return sum(value * take)


# Every constraint: its name, its unit, its operator, the tolerance and the relative tolerance of
# an == constraint, and its scale. The app fixed the scales for this run. They only weigh the
# constraints against each other while the solver compares candidates that break them.
CONSTRAINTS = [
    ("Total weight", "kg", "<=", 0, 0, 34),
]


def constraint_sides(sol):
    # The left side and the right side of every constraint, in the constraint's own unit.
    take = sol.take
    return [
        # Total weight: left <= right, in kg
        (sum(weight * take), 50),
    ]


def gap(op, left, right, tolerance, relative_tolerance):
    # How far a constraint is from holding, in its own unit. It holds when this is 0 or less.
    if op == "<=":
        return left - right
    if op == ">=":
        return right - left
    # ==: the two sides may differ by a fixed amount plus a fraction of the size of the right side
    return abs(left - right) - (tolerance + relative_tolerance * abs(right))


def breach(op, left, right, unit):
    # How a broken constraint is described: the difference between its two sides in its own unit,
    # and as a percentage of the limit (the right side) unless the limit is 0.
    d = abs(left - right)
    if not d < float("inf"):
        return "a side is not a number"
    text = ("over by " if op == "<=" else "short by " if op == ">=" else "apart by ") + f"{d:.6g}"
    if unit:
        text = text + " " + unit
    percent = d / abs(right) * 100 if right != 0 else float("inf")
    if percent < float("inf"):
        text = text + f" ({percent:.3g}% of the limit)"
    return text


def evaluate(sol):
    # What ypea calls for every candidate. It returns the objective value and one number g for
    # every constraint: the gap divided by the scale. A constraint holds when its g is 0 or less.
    sides = constraint_sides(sol)
    g = []
    for i in range(len(CONSTRAINTS)):
        name, unit, op, tolerance, relative_tolerance, scale = CONSTRAINTS[i]
        left, right = float(sides[i][0]), float(sides[i][1])
        g.append(gap(op, left, right, tolerance, relative_tolerance) / scale)
    return objective(sol), g


# The run

def main():
    # a name or a unit that the console cannot show must not stop the script
    try:
        sys.stdout.reconfigure(errors="replace")
    except AttributeError:  # an output without this setting, as in a notebook
        pass

    problem = ypea.Problem(
        [
            ypea.Binary("take", shape=(20,)),
        ],
        evaluate,
        sense="max",
    )
    solver = ypea.GA(
        pop_size=100,
        crossover_prob=0.7,
        crossover_inflation=0.1,
        mutation_prob=0.3,
        mutation_rate=0.1,
        mutation_step_size=0.3,
        mutation_step_size_damp=1,
        selection="roulettewheel",
        selection_pressure=5,
        tournament_size=3,
        space="encoded",
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
    # both sides of every constraint for the best solution, computed again here
    sides = constraint_sides(best)
    feasible = True
    lines = []
    for i in range(len(CONSTRAINTS)):
        name, unit, op, tolerance, relative_tolerance, scale = CONSTRAINTS[i]
        left, right = float(sides[i][0]), float(sides[i][1])
        holds = gap(op, left, right, tolerance, relative_tolerance) <= 0
        feasible = feasible and holds
        mark = "(holds)" if holds else "(does not hold): " + breach(op, left, right, unit)
        lines.append(("  " + name + ":", left, op, right, unit, mark))
    print("Best feasible solution found" if feasible else "No feasible solution found")
    print("Objective:", f, "$")
    print("Solution:")
    print("  take =", best.take)
    print("Constraints:")
    for line in lines:
        print(*line)
    print("Evaluations:", result.nfe, "of", 20000)

    # for programs that read the result: set the environment variable YPEA_STUDIO_JSON to get
    # one more line, the whole result as JSON with every digit
    if os.environ.get("YPEA_STUDIO_JSON"):
        print(json.dumps(result.to_dict()))


if __name__ == "__main__":
    main()
