# Exported from YPEA Studio 0.1.0. Tested with ypea 0.7.0, which needs Python 3.12 or newer.
# Install it with: pip install ypea==0.7.0
#
# Traveling salesman
# Find a short round trip through 30 cities. The data are synthetic.
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
# In the app it gave the objective value 488.44999999999993 after 50000 evaluations.

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

# Table cities
x = np.array([
    11, 6, 79, 93, 78, 86, 57, 12, 99, 3, 52, 10, 83, 24, 56, 62, 34, 84, 54, 27, 20, 40, 96, 54,
    88, 69, 47, 95, 91, 89,
], dtype=float)  # km
y = np.array([
    35, 97, 74, 51, 88, 37, 77, 91, 48, 6, 76, 96, 48, 76, 53, 44, 13, 58, 46, 41, 41, 23, 95, 0,
    45, 78, 95, 83, 56, 25,
], dtype=float)  # km

# Table distance
distance = np.array([
    [
        0, 62.2, 78.39, 83.55, 85.43, 75.03, 62.29, 56.01, 88.96, 30.08, 57.98, 61.01, 73.16, 43.01,
        48.47, 51.79, 31.83, 76.54, 44.38, 17.09, 10.82, 31.38, 104.04, 55.44, 77.65, 72.2, 69.97,
        96.75, 82.71, 78.64,
    ],
    [
        62.2, 0, 76.54, 98.41, 72.56, 100, 54.78, 8.49, 105.12, 91.05, 50.57, 4.12, 91.27, 27.66,
        66.6, 77.1, 88.54, 87.21, 70.04, 59.81, 57.72, 81.44, 90.02, 108.23, 97.1, 65.8, 41.05,
        90.09, 94.37, 109.88,
    ],
    [
        78.39, 76.54, 0, 26.93, 14.04, 37.66, 22.2, 69.12, 32.8, 101.98, 27.07, 72.42, 26.31, 55.04,
        31.14, 34.48, 75.8, 16.76, 37.54, 61.59, 67.6, 64.2, 27.02, 78.11, 30.36, 10.77, 38.28,
        18.36, 21.63, 50.01,
    ],
    [
        83.55, 98.41, 26.93, 0, 39.92, 15.65, 44.41, 90.34, 6.71, 100.62, 48.02, 94.41, 10.44,
        73.39, 37.05, 31.78, 70.18, 11.4, 39.32, 66.75, 73.68, 59.94, 44.1, 64.2, 7.81, 36.12,
        63.66, 32.06, 5.39, 26.31,
    ],
    [
        85.43, 72.56, 14.04, 39.92, 0, 51.62, 23.71, 66.07, 45.18, 111.13, 28.64, 68.47, 40.31,
        55.32, 41.34, 46.82, 86.95, 30.59, 48.37, 69.35, 74.65, 75.29, 19.31, 91.21, 44.15, 13.45,
        31.78, 17.72, 34.54, 63.95,
    ],
    [
        75.03, 100, 37.66, 15.65, 51.62, 0, 49.41, 91.61, 17.03, 88.6, 51.74, 96.21, 11.4, 73.25,
        34, 25, 57.27, 21.1, 33.24, 59.14, 66.12, 48.08, 58.86, 48.92, 8.25, 44.38, 69.89, 46.87,
        19.65, 12.37,
    ],
    [
        62.29, 54.78, 22.2, 44.41, 23.71, 49.41, 0, 47.13, 51.04, 89.2, 5.1, 50.7, 38.95, 33.02,
        24.02, 33.38, 68.01, 33.02, 31.14, 46.86, 51.62, 56.61, 42.95, 77.06, 44.55, 12.04, 20.59,
        38.47, 39.96, 61.06,
    ],
    [
        56.01, 8.49, 69.12, 90.34, 66.07, 91.61, 47.13, 0, 97.05, 85.48, 42.72, 5.39, 83.01, 19.21,
        58.14, 68.62, 81.04, 79.2, 61.55, 52.2, 50.64, 73.54, 84.1, 100.22, 88.84, 58.46, 35.23,
        83.38, 86.41, 101.41,
    ],
    [
        88.96, 105.12, 32.8, 6.71, 45.18, 17.03, 51.04, 97.05, 0, 104.79, 54.71, 101.12, 16, 80.06,
        43.29, 37.22, 73.82, 18.03, 45.04, 72.34, 79.31, 64.08, 47.1, 65.8, 11.4, 42.43, 70.09,
        35.23, 11.31, 25.08,
    ],
    [
        30.08, 91.05, 101.98, 100.62, 111.13, 88.6, 89.2, 85.48, 104.79, 0, 85.45, 90.27, 90.35,
        73.08, 70.84, 70.18, 31.78, 96.25, 64.82, 42.44, 38.91, 40.72, 128.72, 51.35, 93.52, 97.67,
        99.28, 119.97, 101.21, 88.07,
    ],
    [
        57.98, 50.57, 27.07, 48.02, 28.64, 51.74, 5.1, 42.72, 54.71, 85.45, 0, 46.52, 41.77, 28,
        23.35, 33.53, 65.52, 36.72, 30.07, 43.01, 47.42, 54.34, 47.93, 76.03, 47.51, 17.12, 19.65,
        43.57, 43.83, 63.01,
    ],
    [
        61.01, 4.12, 72.42, 94.41, 68.47, 96.21, 50.7, 5.39, 101.12, 90.27, 46.52, 0, 87.37, 24.41,
        62.97, 73.54, 86.4, 83.19, 66.6, 57.57, 55.9, 78.92, 86.01, 105.6, 93.19, 61.68, 37.01,
        85.99, 90.34, 106.22,
    ],
    [
        73.16, 91.27, 26.31, 10.44, 40.31, 11.4, 38.95, 83.01, 16, 90.35, 41.77, 87.37, 0, 65.31,
        27.46, 21.38, 60.22, 10.05, 29.07, 56.44, 63.39, 49.74, 48.76, 56.08, 5.83, 33.11, 59.2, 37,
        11.31, 23.77,
    ],
    [
        43.01, 27.66, 55.04, 73.39, 55.32, 73.25, 33.02, 19.21, 80.06, 73.08, 28, 24.41, 65.31, 0,
        39.41, 49.68, 63.79, 62.64, 42.43, 35.13, 35.23, 55.36, 74.46, 81.71, 71.11, 45.04, 29.83,
        71.34, 69.92, 82.62,
    ],
    [
        48.47, 66.6, 31.14, 37.05, 41.34, 34, 24.02, 58.14, 43.29, 70.84, 23.35, 62.97, 27.46,
        39.41, 0, 10.82, 45.65, 28.44, 7.28, 31.38, 37.95, 34, 58, 53.04, 32.98, 28.18, 42.95, 49.2,
        35.13, 43.28,
    ],
    [
        51.79, 77.1, 34.48, 31.78, 46.82, 25, 33.38, 68.62, 37.22, 70.18, 33.53, 73.54, 21.38,
        49.68, 10.82, 0, 41.77, 26.08, 8.25, 35.13, 42.11, 30.41, 61.29, 44.72, 26.02, 34.71, 53.16,
        51.09, 31.38, 33.02,
    ],
    [
        31.83, 88.54, 75.8, 70.18, 86.95, 57.27, 68.01, 81.04, 73.82, 31.78, 65.52, 86.4, 60.22,
        63.79, 45.65, 41.77, 0, 67.27, 38.59, 28.86, 31.3, 11.66, 102.8, 23.85, 62.77, 73.82, 83.02,
        92.85, 71.4, 56.29,
    ],
    [
        76.54, 87.21, 16.76, 11.4, 30.59, 21.1, 33.02, 79.2, 18.03, 96.25, 36.72, 83.19, 10.05,
        62.64, 28.44, 26.08, 67.27, 0, 32.31, 59.48, 66.22, 56.22, 38.9, 65.3, 13.6, 25, 52.33,
        27.31, 7.28, 33.38,
    ],
    [
        44.38, 70.04, 37.54, 39.32, 48.37, 33.24, 31.14, 61.55, 45.04, 64.82, 30.07, 66.6, 29.07,
        42.43, 7.28, 8.25, 38.59, 32.31, 0, 27.46, 34.37, 26.93, 64.54, 46, 34.01, 35.34, 49.5,
        55.23, 38.33, 40.82,
    ],
    [
        17.09, 59.81, 61.59, 66.75, 69.35, 59.14, 46.86, 52.2, 72.34, 42.44, 43.01, 57.57, 56.44,
        35.13, 31.38, 35.13, 28.86, 59.48, 27.46, 0, 7, 22.2, 87.62, 49.09, 61.13, 55.97, 57.58,
        79.92, 65.73, 64.03,
    ],
    [
        10.82, 57.72, 67.6, 73.68, 74.65, 66.12, 51.62, 50.64, 79.31, 38.91, 47.42, 55.9, 63.39,
        35.23, 37.95, 42.11, 31.3, 66.22, 34.37, 7, 0, 26.91, 93.23, 53.26, 68.12, 61.4, 60.37,
        85.96, 72.57, 70.83,
    ],
    [
        31.38, 81.44, 64.2, 59.94, 75.29, 48.08, 56.61, 73.54, 64.08, 40.72, 54.34, 78.92, 49.74,
        55.36, 34, 30.41, 11.66, 56.22, 26.93, 22.2, 26.91, 0, 91.21, 26.93, 52.8, 62.18, 72.34,
        81.39, 60.75, 49.04,
    ],
    [
        104.04, 90.02, 27.02, 44.1, 19.31, 58.86, 42.95, 84.1, 47.1, 128.72, 47.93, 86.01, 48.76,
        74.46, 58, 61.29, 102.8, 38.9, 64.54, 87.62, 93.23, 91.21, 0, 103.87, 50.64, 31.91, 49,
        12.04, 39.32, 70.35,
    ],
    [
        55.44, 108.23, 78.11, 64.2, 91.21, 48.92, 77.06, 100.22, 65.8, 51.35, 76.03, 105.6, 56.08,
        81.71, 53.04, 44.72, 23.85, 65.3, 46, 49.09, 53.26, 26.93, 103.87, 0, 56.4, 79.43, 95.26,
        92.57, 67.12, 43.01,
    ],
    [
        77.65, 97.1, 30.36, 7.81, 44.15, 8.25, 44.55, 88.84, 11.4, 93.52, 47.51, 93.19, 5.83, 71.11,
        32.98, 26.02, 62.77, 13.6, 34.01, 61.13, 68.12, 52.8, 50.64, 56.4, 0, 38.08, 64.66, 38.64,
        11.4, 20.02,
    ],
    [
        72.2, 65.8, 10.77, 36.12, 13.45, 44.38, 12.04, 58.46, 42.43, 97.67, 17.12, 61.68, 33.11,
        45.04, 28.18, 34.71, 73.82, 25, 35.34, 55.97, 61.4, 62.18, 31.91, 79.43, 38.08, 0, 27.8,
        26.48, 31.11, 56.65,
    ],
    [
        69.97, 41.05, 38.28, 63.66, 31.78, 69.89, 20.59, 35.23, 70.09, 99.28, 19.65, 37.01, 59.2,
        29.83, 42.95, 53.16, 83.02, 52.33, 49.5, 57.58, 60.37, 72.34, 49, 95.26, 64.66, 27.8, 0,
        49.48, 58.8, 81.63,
    ],
    [
        96.75, 90.09, 18.36, 32.06, 17.72, 46.87, 38.47, 83.38, 35.23, 119.97, 43.57, 85.99, 37,
        71.34, 49.2, 51.09, 92.85, 27.31, 55.23, 79.92, 85.96, 81.39, 12.04, 92.57, 38.64, 26.48,
        49.48, 0, 27.29, 58.31,
    ],
    [
        82.71, 94.37, 21.63, 5.39, 34.54, 19.65, 39.96, 86.41, 11.31, 101.21, 43.83, 90.34, 11.31,
        69.92, 35.13, 31.38, 71.4, 7.28, 38.33, 65.73, 72.57, 60.75, 39.32, 67.12, 11.4, 31.11,
        58.8, 27.29, 0, 31.06,
    ],
    [
        78.64, 109.88, 50.01, 26.31, 63.95, 12.37, 61.06, 101.41, 25.08, 88.07, 63.01, 106.22,
        23.77, 82.62, 43.28, 33.02, 56.29, 33.38, 40.82, 64.03, 70.83, 49.04, 70.35, 43.01, 20.02,
        56.65, 81.63, 58.31, 31.06, 0,
    ],
], dtype=float)  # km


# The problem

def objective(sol):
    # The value to minimize, in km.
    route = sol.route
    return sum(distance[route, ops.roll(route, -1)])


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
            ypea.Permutation("route", n=30),
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
    print("Best feasible solution found")
    print("Objective:", f, "km")
    print("Solution:")
    print("  route =", best.route)
    print("Evaluations:", result.nfe, "of", 50000)
    # the objective value of the baseline, as the app computed it
    print("Baseline (Nearest-neighbor tour):", 630.8399999999999, "km")
    print("  This run minus it:", f - 630.8399999999999)

    # for programs that read the result: set the environment variable YPEA_STUDIO_JSON to get
    # one more line, the whole result as JSON with every digit
    if os.environ.get("YPEA_STUDIO_JSON"):
        print(json.dumps(result.to_dict()))


if __name__ == "__main__":
    main()
