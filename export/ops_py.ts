// A copy of spec/language/ops.py, which an exported script carries. Do not edit it here: a test
// compares the two, and the command at the top of python.test.ts writes this file again.
export const OPS_PY = `"""The \`ops\` namespace of the limited Python syntax, defined in real Python (spec/language.md).

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
`;
