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
# In the app it gave the objective value 584.3499999999999 after 50000 evaluations.

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
x = np.array([4, 66, 86, 50, 72, 8, 100, 14, 62, 20, 62, 99, 2, 82, 44, 52], dtype=float)  # km
y = np.array([77, 10, 68, 57, 64, 92, 64, 98, 11, 37, 38, 27, 70, 38, 20, 57], dtype=float)  # km

# Table customers
demand = np.array([6, 19, 10, 7, 5, 8, 20, 7, 19, 10, 20, 11, 6, 16, 18], dtype=float)  # kg

# Table distance
distance = np.array([
    [
        0, 91.29, 82.49, 50.16, 69.23, 15.52, 96.88, 23.26, 87.86, 43.08, 69.89, 107.35, 7.28,
        87.21, 69.63, 52,
    ],
    [
        91.29, 0, 61.35, 49.65, 54.33, 100.44, 63.81, 102.22, 4.12, 53.34, 28.28, 37.12, 87.73,
        32.25, 24.17, 49.04,
    ],
    [
        82.49, 61.35, 0, 37.64, 14.56, 81.61, 14.56, 78, 61.85, 72.92, 38.42, 43.01, 84.02, 30.27,
        63.78, 35.74,
    ],
    [
        50.16, 49.65, 37.64, 0, 23.09, 54.67, 50.49, 54.56, 47.54, 36.06, 22.47, 57.45, 49.73,
        37.22, 37.48, 2,
    ],
    [
        69.23, 54.33, 14.56, 23.09, 0, 69.86, 28, 67.23, 53.94, 58.59, 27.86, 45.8, 70.26, 27.86,
        52.15, 21.19,
    ],
    [
        15.52, 100.44, 81.61, 54.67, 69.86, 0, 96.17, 8.49, 97.35, 56.29, 76.37, 111.83, 22.8,
        91.61, 80.5, 56.22,
    ],
    [
        96.88, 63.81, 14.56, 50.49, 28, 96.17, 0, 92.48, 65.22, 84.43, 46.04, 37.01, 98.18, 31.62,
        71.22, 48.51,
    ],
    [
        23.26, 102.22, 78, 54.56, 67.23, 8.49, 92.48, 0, 99.36, 61.29, 76.84, 110.75, 30.46, 90.69,
        83.57, 55.9,
    ],
    [
        87.86, 4.12, 61.85, 47.54, 53.94, 97.35, 65.22, 99.36, 0, 49.4, 27, 40.31, 84.15, 33.6,
        20.12, 47.07,
    ],
    [
        43.08, 53.34, 72.92, 36.06, 58.59, 56.29, 84.43, 61.29, 49.4, 0, 42.01, 79.63, 37.59, 62.01,
        29.41, 37.74,
    ],
    [
        69.89, 28.28, 38.42, 22.47, 27.86, 76.37, 46.04, 76.84, 27, 42.01, 0, 38.6, 68, 20, 25.46,
        21.47,
    ],
    [
        107.35, 37.12, 43.01, 57.45, 45.8, 111.83, 37.01, 110.75, 40.31, 79.63, 38.6, 0, 106.1,
        20.25, 55.44, 55.76,
    ],
    [
        7.28, 87.73, 84.02, 49.73, 70.26, 22.8, 98.18, 30.46, 84.15, 37.59, 68, 106.1, 0, 86.16,
        65.3, 51.66,
    ],
    [
        87.21, 32.25, 30.27, 37.22, 27.86, 91.61, 31.62, 90.69, 33.6, 62.01, 20, 20.25, 86.16, 0,
        42.05, 35.51,
    ],
    [
        69.63, 24.17, 63.78, 37.48, 52.15, 80.5, 71.22, 83.57, 20.12, 29.41, 25.46, 55.44, 65.3,
        42.05, 0, 37.85,
    ],
    [
        52, 49.04, 35.74, 2, 21.19, 56.22, 48.51, 55.9, 47.07, 37.74, 21.47, 55.76, 51.66, 35.51,
        37.85, 0,
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


# Every constraint: its name, its unit, its operator, the tolerance of an == constraint, and its
# scale. The app fixed the scales for this run. They only weigh the constraints against each
# other while the solver compares candidates that break them.
CONSTRAINTS = [
    ("Heaviest load", "kg", "<=", 0, 39),
]


def constraint_sides(sol):
    # The left side and the right side of every constraint, in the constraint's own unit.
    routes = sol.routes
    return [
        # Heaviest load: left <= right, in kg
        (heaviest_load(routes), 60),
    ]


def gap(op, left, right, tolerance):
    # How far a constraint is from holding, in its own unit. It holds when this is 0 or less.
    if op == "<=":
        return left - right
    if op == ">=":
        return right - left
    return abs(left - right) - tolerance


def evaluate(sol):
    # What ypea calls for every candidate. It returns the objective value and one number g for
    # every constraint: the gap divided by the scale. A constraint holds when its g is 0 or less.
    sides = constraint_sides(sol)
    g = []
    for i in range(len(CONSTRAINTS)):
        name, unit, op, tolerance, scale = CONSTRAINTS[i]
        g.append(gap(op, float(sides[i][0]), float(sides[i][1]), tolerance) / scale)
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
        name, unit, op, tolerance, scale = CONSTRAINTS[i]
        left, right = float(sides[i][0]), float(sides[i][1])
        holds = gap(op, left, right, tolerance) <= 0
        feasible = feasible and holds
        mark = "(holds)" if holds else "(does not hold)"
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
    print("Baseline (Nearest customer that still fits, one vehicle after another):", 815.5699999999999, "km")
    print("  This run minus it:", f - 815.5699999999999)

    # for programs that read the result: set the environment variable YPEA_STUDIO_JSON to get
    # one more line, the whole result as JSON with every digit
    if os.environ.get("YPEA_STUDIO_JSON"):
        print(json.dumps(result.to_dict()))


if __name__ == "__main__":
    main()
