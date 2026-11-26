# Exported from YPEA Studio 0.1.0. Tested with ypea 0.5.0, which needs Python 3.12 or newer.
# Install it with: pip install ypea==0.5.0
#
# Vehicle routing
# Plan the routes of 4 vehicles that leave one depot, serve 15 customers and return, so that the
# total distance is as small as possible and no vehicle carries more than 60 kg. The data are
# synthetic.
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
# In the app it gave the objective value 547.15 after 50000 evaluations.

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

# Table nodes
x = np.array([40, 86, 72, 100, 62, 62, 2, 68, 11, 38, 70, 20, 8, 31, 4, 89], dtype=float)  # km
y = np.array([53, 50, 8, 14, 20, 99, 82, 57, 37, 27, 38, 57, 89, 13, 23, 36], dtype=float)  # km

# Table customers
demand = np.array([12, 8, 6, 19, 17, 12, 11, 20, 14, 11, 11, 15, 8, 6, 18], dtype=float)  # kg

# Table distance
distance = np.array([
    [
        0, 46.1, 55.22, 71.56, 39.66, 50.99, 47.8, 28.28, 33.12, 26.08, 33.54, 20.4, 48.17, 41,
        46.86, 51.87,
    ],
    [
        46.1, 0, 44.27, 38.63, 38.42, 54.56, 89.89, 19.31, 76.12, 53.23, 20, 66.37, 87.21, 66.29,
        86.33, 14.32,
    ],
    [
        55.22, 44.27, 0, 28.64, 15.62, 91.55, 101.86, 49.16, 67.54, 38.95, 30.07, 71.45, 103.23,
        41.3, 69.63, 32.76,
    ],
    [
        71.56, 38.63, 28.64, 0, 38.47, 93.11, 119.28, 53.6, 91.92, 63.35, 38.42, 90.82, 118.7,
        69.01, 96.42, 24.6,
    ],
    [
        39.66, 38.42, 15.62, 38.47, 0, 79, 86.28, 37.48, 53.76, 25, 19.7, 55.97, 87.62, 31.78,
        58.08, 31.38,
    ],
    [
        50.99, 54.56, 91.55, 93.11, 79, 0, 62.36, 42.43, 80.28, 75.89, 61.52, 59.4, 54.92, 91.42,
        95.6, 68.54,
    ],
    [
        47.8, 89.89, 101.86, 119.28, 86.28, 62.36, 0, 70.58, 45.89, 65.73, 80.99, 30.81, 9.22,
        74.85, 59.03, 98.41,
    ],
    [
        28.28, 19.31, 49.16, 53.6, 37.48, 42.43, 70.58, 0, 60.41, 42.43, 19.1, 48, 68, 57.49, 72.47,
        29.7,
    ],
    [
        33.12, 76.12, 67.54, 91.92, 53.76, 80.28, 45.89, 60.41, 0, 28.79, 59.01, 21.93, 52.09,
        31.24, 15.65, 78.01,
    ],
    [
        26.08, 53.23, 38.95, 63.35, 25, 75.89, 65.73, 42.43, 28.79, 0, 33.84, 34.99, 68.88, 15.65,
        34.23, 51.79,
    ],
    [
        33.54, 20, 30.07, 38.42, 19.7, 61.52, 80.99, 19.1, 59.01, 33.84, 0, 53.49, 80.28, 46.32,
        67.68, 19.1,
    ],
    [
        20.4, 66.37, 71.45, 90.82, 55.97, 59.4, 30.81, 48, 21.93, 34.99, 53.49, 0, 34.18, 45.35,
        37.58, 72.12,
    ],
    [
        48.17, 87.21, 103.23, 118.7, 87.62, 54.92, 9.22, 68, 52.09, 68.88, 80.28, 34.18, 0, 79.4,
        66.12, 96.8,
    ],
    [
        41, 66.29, 41.3, 69.01, 31.78, 91.42, 74.85, 57.49, 31.24, 15.65, 46.32, 45.35, 79.4, 0,
        28.79, 62.39,
    ],
    [
        46.86, 86.33, 69.63, 96.42, 58.08, 95.6, 59.03, 72.47, 15.65, 34.23, 67.68, 37.58, 66.12,
        28.79, 0, 85.99,
    ],
    [
        51.87, 14.32, 32.76, 24.6, 31.38, 68.54, 98.41, 29.7, 78.01, 51.79, 19.1, 72.12, 96.8,
        62.39, 85.99, 0,
    ],
], dtype=float)  # km


# The functions, as they are written in the app

def route_length(g):
    if len(g) == 0:
        return 0
    return distance[0, g[0] + 1] + sum(distance[g[:-1] + 1, g[1:] + 1]) + distance[g[-1] + 1, 0]

def total_length(groups):
    total = 0
    for g in groups:
        total += route_length(g)
    return total

def heaviest_load(groups):
    worst = 0
    for g in groups:
        load = sum(demand[g])
        if load > worst:
            worst = load
    return worst


# The problem

def objective(sol):
    # The value to minimize, in km.
    routes = sol.routes
    return total_length(routes)


# Every constraint: its name, its unit, its operator, the tolerance and the relative tolerance of
# an == constraint, and its scale. The app fixed the scales for this run. They only weigh the
# constraints against each other while the solver compares candidates that break them.
CONSTRAINTS = [
    ("Heaviest load", "kg", "<=", 0, 0, 35),
]


def constraint_sides(sol):
    # The left side and the right side of every constraint, in the constraint's own unit.
    routes = sol.routes
    return [
        # Heaviest load: left <= right, in kg
        (heaviest_load(routes), 60),
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
            ypea.Partition("routes", n=15, k=4),
        ],
        evaluate,
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
        max_nfe=50000,  # the budget, in evaluations
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
    print("Objective:", f, "km")
    print("Solution:")
    print("  routes =", best.routes)
    print("Constraints:")
    for line in lines:
        print(*line)
    print("Evaluations:", result.nfe, "of", 50000)
    # the objective value of the baseline, as the app computed it
    print("Baseline (Nearest customer that still fits, one vehicle after another):", 665.0100000000001, "km")
    print("  This run minus it:", f - 665.0100000000001)

    # for programs that read the result: set the environment variable YPEA_STUDIO_JSON to get
    # one more line, the whole result as JSON with every digit
    if os.environ.get("YPEA_STUDIO_JSON"):
        print(json.dumps(result.to_dict()))


if __name__ == "__main__":
    main()
