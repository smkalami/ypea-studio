"""The shared cases of the limited Python syntax (spec/language.md).

Each case is an expression (and sometimes function definitions) with named inputs.
make_cases.py evaluates every case in real Python and writes the answers to cases.json.
The translator's tests must give the same answers. Add cases freely, but never write an
expected value by hand: run make_cases.py.

Inputs: F(...) is a list or table of floats, I(...) of whole numbers, G(...) the groups of a
partition. A plain number is a single float or whole number.
"""


def F(value):
    return {"kind": "float", "value": value}


def I(value):  # noqa: E743
    return {"kind": "int", "value": value}


def G(value):
    return {"kind": "groups", "value": value}


ENVS = {
    # a number whose square differs in the last digit between Python's power function and q * q
    "square": {"q": F(-0.40513530011104176), "qs": F([-0.40513530011104176, 1.5])},
    "basic": {
        "x": F([1.5, -2.0, 3.25, 0.5]),
        "y": F([2.0, 4.0, -1.0, 8.0]),
        "n": I([3, 0, 2, 1]),
        "b": I([1, 0, 1, 1]),
        "s": F(2.5),
        "k": I(3),
        "z": F(0.0),
        "t": F([[1.0, 2.0, 3.0, 4.0], [5.0, 6.0, 7.0, 8.5], [-1.0, 0.5, 2.0, 9.0]]),
        "m": I([[4, 1, 7, 2], [3, 9, 5, 8], [6, 0, 2, 1], [7, 7, 3, 4]]),
        "g": G([[0, 2], [], [1, 3]]),
    },
    # the line fit example, with awkward decimals so that the order of additions shows
    "fit": {
        "voltage": F([0.5, 0.86, 1.23, 1.59, 1.95, 2.32, 2.68, 3.05, 3.41, 3.77, 4.14, 4.5]),
        "pressure": F([14.38, 22.92, 33.06, 42.04, 50.71, 59.64, 69.56, 78.01, 86.9, 95.31, 104.99, 114.24]),
        "offset": F(1.7),
        "gain": F(24.3),
    },
    "long": {
        # 20 values with very different sizes: index-order and pairwise sums differ here
        "w": F([0.1, 1e8, -1e8, 0.2, 3.3e-5, 7.7, -2.2e3, 1e-9, 4.4, 5.5e5,
                -5.5e5, 0.3, 9.9e-3, 1.1, 2.2, -3.3, 6.6e7, -6.6e7, 0.7, 0.07]),
        "route": I([3, 0, 4, 1, 2]),
        "distance": F([[0.0, 2.5, 9.1, 4.2, 7.7], [2.5, 0.0, 3.3, 8.8, 1.9], [9.1, 3.3, 0.0, 6.4, 5.2],
                       [4.2, 8.8, 6.4, 0.0, 2.1], [7.7, 1.9, 5.2, 2.1, 0.0]]),
        "take": I([1, 0, 1, 1, 0]),
        "weight": F([3.5, 7.25, 4.0, 2.75, 9.5]),
    },
}

# (name, environment, expression, options). Options: functions="...", approx=True, error=True.
CASES = [
    # numbers and operators
    ("add", "basic", "s + k", {}),
    ("precedence", "basic", "2 + 3 * 4 - 6 / 4", {}),
    ("unary minus and power", "basic", "-s ** 2", {}),
    ("power is right associative", "basic", "2 ** 3 ** 2", {}),
    ("power two is exact", "basic", "x ** 2", {}),
    ("power two of a list is exact", "square", "qs ** 2", {}),
    ("power two of a single number may differ in the last digit", "square", "q ** 2", {"approx": True}),
    ("a product is always exact", "square", "q * q", {}),
    ("power three", "basic", "x ** 3", {"approx": True}),
    ("power half", "basic", "y[1] ** 0.5", {"approx": True}),
    ("true division of whole numbers", "basic", "k / 2", {}),
    ("floor division", "basic", "7 // 2", {}),
    ("floor division negative", "basic", "-7 // 2", {}),
    ("floor division floats", "basic", "x // 0.4", {}),
    ("floor division negative floats", "basic", "(-s) // 0.7", {}),
    ("remainder", "basic", "7 % 3", {}),
    ("remainder negative left", "basic", "-7 % 3", {}),
    ("remainder negative right", "basic", "7 % -3", {}),
    ("remainder floats", "basic", "x % 1.1", {}),
    ("remainder list by negative", "basic", "x % -0.7", {}),
    ("division by zero from data", "basic", "s / z", {}),
    ("negative division by zero from data", "basic", "-s / z", {}),
    ("zero over zero from data", "basic", "z / z", {}),
    ("list division by zero", "basic", "x / (y - y)", {}),
    ("exponent literal", "basic", "1e-3 * s + 2.5E2", {}),
    ("parentheses", "basic", "((s + 1) * (k - 1)) / (s - 0.5)", {}),
    # truth values
    ("comparison", "basic", "s > 2", {}),
    ("chained comparison true", "basic", "1 < s < 3", {}),
    ("chained comparison false", "basic", "1 < s < 2", {}),
    ("chained three", "basic", "0 <= k <= 3 != 4", {}),
    ("not", "basic", "not s > 2", {}),
    ("and or", "basic", "s > 2 and k == 3 or z > 0", {}),
    ("or short circuit", "basic", "k == 3 or 1 / z > 0", {}),
    ("truth value in arithmetic", "basic", "(s > 2) + (k < 0) + True", {}),
    ("equal and not equal", "basic", "(k == 3) + (k != 3) * 10", {}),
    ("list comparison", "basic", "x > 1", {}),
    ("count with sum", "basic", "sum(x > 1)", {}),
    ("list equality", "basic", "n == b", {}),
    ("chained comparison on a list", "basic", "0 < x < 2", {"error": True}),
    ("and on lists", "basic", "(x > 0) and (y > 0)", {"error": True}),
    # lists and tables
    ("list plus number", "basic", "x + 1", {}),
    ("number minus list", "basic", "10 - x", {}),
    ("list times list", "basic", "x * y", {}),
    ("float list times whole list", "basic", "x * n", {}),
    ("whole list division", "basic", "n / 2", {}),
    ("whole list floor division", "basic", "n // 2", {}),
    ("negate list", "basic", "-x", {}),
    ("lists of different length", "basic", "x + x[0:3]", {"error": True}),
    ("table plus number", "basic", "t + 1", {}),
    ("table times table", "basic", "t * t", {}),
    ("table plus list by columns", "basic", "t + x", {}),
    ("table plus list of wrong length", "basic", "t + x[0:3]", {"error": True}),
    ("table of different shape", "basic", "t + m", {"error": True}),
    # indexing
    ("element", "basic", "x[2]", {}),
    ("negative position", "basic", "x[-1]", {}),
    ("position from a variable", "basic", "x[k]", {}),
    ("position out of range", "basic", "x[4]", {"error": True}),
    ("negative position out of range", "basic", "x[-5]", {"error": True}),
    ("position not whole", "basic", "x[s]", {"error": True}),
    ("slice", "basic", "x[1:3]", {}),
    ("slice open start", "basic", "x[:2]", {}),
    ("slice open end", "basic", "x[2:]", {}),
    ("slice clamps", "basic", "x[2:99]", {}),
    ("slice negative", "basic", "x[-3:-1]", {}),
    ("empty slice sum", "basic", "sum(x[3:1])", {}),
    ("gather", "basic", "x[n]", {}),
    ("gather out of range", "basic", "x[n + 1]", {"error": True}),
    ("gather with floats", "basic", "x[y]", {"error": True}),
    ("gather with range", "basic", "x[range(1, 3)]", {}),
    ("table row", "basic", "t[1]", {}),
    ("table element", "basic", "t[2, 1]", {}),
    ("table element negative", "basic", "t[-1, -1]", {}),
    ("table element out of range", "basic", "t[3, 0]", {"error": True}),
    ("paired positions", "basic", "m[n, b]", {}),
    ("paired with range", "basic", "m[range(4), n]", {}),
    ("paired with one number", "basic", "m[n, 2]", {}),
    ("paired of different length", "basic", "m[n, b[0:3]]", {"error": True}),
    ("paired out of range", "basic", "m[n, n + 2]", {"error": True}),
    ("group", "basic", "g[2]", {}),
    ("empty group", "basic", "len(g[1])", {}),
    ("gather with a group", "basic", "x[g[0]]", {}),
    # built-ins
    ("sum in index order", "long", "sum(w)", {}),
    ("sum of expression", "long", "sum(w * w - w)", {}),
    ("sum of table", "basic", "sum(t)", {}),
    ("min max of list", "basic", "min(x) + 10 * max(x)", {}),
    ("min of numbers", "basic", "min(s, k, 2.75)", {}),
    ("max of numbers", "basic", "max(s, k)", {}),
    ("abs", "basic", "abs(x) + abs(-s)", {}),
    ("len", "basic", "len(x) + 10 * len(t) + 100 * len(g)", {}),
    ("sum of range", "basic", "sum(range(5)) + sum(range(2, 10, 3))", {}),
    ("min of table", "basic", "min(t)", {"error": True}),
    # ops
    ("ops constants", "basic", "ops.pi + ops.e", {}),
    ("ops inf", "basic", "min(s, ops.inf) + (ops.inf > 1e300)", {}),
    ("ops array", "basic", "ops.array([1, s, k]) * 2", {}),
    ("ops zeros ones arange", "basic", "ops.zeros(3) + ops.ones(3) * 2 + ops.arange(3)", {}),
    ("ops sum in pairs", "long", "ops.sum(w)", {}),
    ("ops mean", "long", "ops.mean(w)", {}),
    ("ops sum of expression", "long", "ops.sum(w * w - w)", {}),
    ("ops sum table", "basic", "ops.sum(t)", {}),
    ("ops sum axis 0", "basic", "ops.sum(t, axis=0)", {}),
    ("ops sum axis 1", "basic", "ops.sum(t, axis=1)", {}),
    ("ops mean axis 0", "basic", "ops.mean(t, axis=0)", {}),
    ("ops mean axis 1", "basic", "ops.mean(t, axis=1)", {}),
    ("ops prod", "basic", "ops.prod(x) + ops.prod(n + 1)", {}),
    ("ops min max", "basic", "ops.min(x) + ops.max(t)", {}),
    ("ops min max axis", "basic", "ops.min(t, axis=0) + ops.max(t, axis=0)", {}),
    ("ops max axis 1", "basic", "ops.max(t, axis=1)", {}),
    ("ops argmin argmax", "basic", "ops.argmin(x) * 10 + ops.argmax(x)", {}),
    ("ops argmax first of ties", "basic", "ops.argmax(b)", {}),
    ("ops argsort stable", "basic", "ops.argsort(b)", {}),
    ("ops sort", "basic", "ops.sort(x)", {}),
    ("ops cumsum", "long", "ops.cumsum(w)", {}),
    ("ops roll back", "long", "ops.roll(route, -1)", {}),
    ("ops roll forward", "long", "ops.roll(route, 2)", {}),
    ("ops sqrt", "basic", "ops.sqrt(y + 1.5)", {}),
    ("ops sqrt of negative", "basic", "ops.sqrt(x)", {}),
    ("ops abs floor ceil", "basic", "ops.abs(x) + ops.floor(x) * 10 + ops.ceil(x) * 100", {}),
    ("ops round half even", "basic", "ops.round(ops.array([0.5, 1.5, 2.5, -0.5, -1.5, 2.4999, 2.5001]))", {}),
    ("ops sign", "basic", "ops.sign(x - 0.5)", {}),
    ("ops minimum maximum", "basic", "ops.minimum(x, y) + 10 * ops.maximum(x, 1)", {}),
    ("ops clip", "basic", "ops.clip(x, 0, 2)", {}),
    ("ops where", "basic", "ops.where(x > 1, x, -y)", {}),
    ("ops where numbers", "basic", "ops.where(x > 1, 1, 0)", {}),
    ("ops exp log", "basic", "ops.exp(x / 4) + ops.log(y + 2)", {"approx": True}),
    ("ops sin cos tan", "basic", "ops.sin(x) + ops.cos(x) * ops.tan(s / 4)", {"approx": True}),
    ("ops dot lists", "basic", "ops.dot(x, y)", {"approx": True}),
    ("ops dot table list", "basic", "ops.dot(t, x)", {"approx": True}),
    ("ops dot wrong length", "basic", "ops.dot(x, y[0:3])", {"error": True}),
    ("ops argmin of table", "basic", "ops.argmin(t)", {"error": True}),
    # the worked examples
    ("line fit objective", "fit", "sum((pressure - (offset + gain * voltage)) ** 2)", {}),
    ("knapsack value", "long", "sum(weight * take)", {}),
    ("route cost", "long", "sum(distance[route, ops.roll(route, -1)])", {}),
    ("assignment cost", "long", "sum(distance[range(5), route])", {}),
    # functions
    ("function call", "fit", "squared_error(offset, gain)", {"functions": (
        "def squared_error(offset, gain):\n"
        "    return sum((pressure - (offset + gain * voltage)) ** 2)\n"
    )}),
    ("loop over range", "long", "route_cost(route)", {"functions": (
        "def route_cost(r):\n"
        "    total = 0\n"
        "    for i in range(len(r)):\n"
        "        total += distance[r[i], r[(i + 1) % len(r)]]\n"
        "    return total\n"
    )}),
    ("loop over a list with if", "basic", "positive_part(x)", {"functions": (
        "def positive_part(a):\n"
        "    total = 0.0\n"
        "    count = 0\n"
        "    for v in a:\n"
        "        if v > 1:\n"
        "            total += v\n"
        "            count += 1\n"
        "        elif v > 0:\n"
        "            total -= v / 2\n"
        "        else:\n"
        "            total *= 2\n"
        "    return total / (count + 1)\n"
    )}),
    ("loop over groups", "basic", "spread(g, x)", {"functions": (
        "def spread(groups, values):\n"
        "    worst = 0\n"
        "    for group in groups:\n"
        "        if len(group) > 0:\n"
        "            load = sum(values[group])\n"
        "            if load > worst:\n"
        "                worst = load\n"
        "    return worst\n"
    )}),
    ("loop over table rows", "basic", "row_peaks(t)", {"functions": (
        "def row_peaks(table):\n"
        "    total = 0\n"
        "    for row in table:\n"
        "        total += max(row) - min(row)\n"
        "    return total\n"
    )}),
    ("loop over a literal list", "basic", "poly(s)", {"functions": (
        "def poly(v):\n"
        "    result = 0\n"
        "    for c in [3, -2, 0.5]:\n"
        "        result = result * v + c\n"
        "    return result\n"
    )}),
    ("function calls an earlier function", "basic", "outer(x)", {"functions": (
        "def half(v):\n"
        "    return v / 2\n"
        "\n"
        "def outer(a):\n"
        "    b = half(a) + half(1)\n"
        "    return sum(b)\n"
    )}),
    ("early return", "basic", "first_big(x, 3)", {"functions": (
        "def first_big(a, limit):\n"
        "    for i in range(len(a)):\n"
        "        if a[i] > limit:\n"
        "            return i\n"
        "    return -1\n"
    )}),
    ("comments and blank lines", "basic", "f(s)", {"functions": (
        "# a helper\n"
        "def f(v):  # one argument\n"
        "\n"
        "    w = v * 2  # doubled\n"
        "    return w + 1\n"
    )}),
    ("range with step and negative step", "basic", "steps(10)", {"functions": (
        "def steps(n):\n"
        "    total = 0\n"
        "    for i in range(1, n, 3):\n"
        "        total += i\n"
        "    for i in range(n, 0, -4):\n"
        "        total += i * 100\n"
        "    return total\n"
    )}),
    ("index error inside a function", "basic", "bad(x)", {"error": True, "functions": (
        "def bad(a):\n"
        "    total = 0\n"
        "    for i in range(len(a) + 1):\n"
        "        total += a[i]\n"
        "    return total\n"
    )}),
    ("list as an if condition", "basic", "bad(x)", {"error": True, "functions": (
        "def bad(a):\n"
        "    if a > 0:\n"
        "        return 1\n"
        "    return 0\n"
    )}),
]

# Text the translator must refuse when a project is translated, each with the line of the
# problem. These are not run in Python (several are valid Python). `where` is "functions" or
# "expression".
REJECTS = [
    ("import", "functions", "import os\n", 1),
    ("from import", "functions", "from os import path\n", 1),
    ("while", "functions", "def f(a):\n    while a > 0:\n        a -= 1\n    return a\n", 2),
    ("class", "functions", "class A:\n    x = 1\n", 1),
    ("lambda", "expression", "(lambda v: v)(1)", 1),
    ("comprehension", "expression", "sum([v * 2 for v in x])", 1),
    ("conditional expression", "expression", "1 if s > 2 else 0", 1),
    ("string", "expression", "len('abc')", 1),
    ("dictionary", "expression", "{1: 2}", 1),
    ("attribute of a value", "expression", "x.shape", 1),
    ("method call", "expression", "x.sum()", 1),
    ("dunder attribute", "expression", "x.__class__", 1),
    ("unknown ops name", "expression", "ops.linalg(x)", 1),
    ("ops used as a value", "expression", "ops", 1),
    ("unknown name", "expression", "x + undefined_thing", 1),
    ("javascript global", "expression", "globalThis", 1),
    ("javascript constructor", "expression", "constructor", 1),
    ("python builtin outside the six", "expression", "eval(1)", 1),
    ("print", "expression", "print(1)", 1),
    ("function sees no variables", "functions", "def f():\n    return x[0]\n", 2),
    ("call before definition", "functions", "def f(a):\n    return h(a)\n\ndef h(a):\n    return a\n", 2),
    ("recursion", "functions", "def f(a):\n    return f(a - 1)\n", 2),
    ("missing return", "functions", "def f(a):\n    if a > 0:\n        return 1\n", 1),
    ("element assignment", "functions", "def f(a):\n    a[0] = 1\n    return a\n", 2),
    ("tuple assignment", "functions", "def f(a):\n    b, c = a, a\n    return b\n", 2),
    ("default parameter", "functions", "def f(a, b=1):\n    return a + b\n", 1),
    ("keyword argument", "expression", "min(s, key=k)", 1),
    ("break", "functions", "def f(a):\n    for v in a:\n        break\n    return 0\n", 3),
    ("tab indentation", "functions", "def f(a):\n\treturn a\n", 2),
    ("bad indentation", "functions", "def f(a):\n    b = 1\n      return b\n", 3),
    ("statement at top level", "functions", "y2 = 3\n", 1),
    ("assignment to a data name", "functions", "def f(a):\n    x = 1\n    return a\n", 2),
    ("function named like a builtin", "functions", "def sum(a):\n    return 0\n", 1),
    ("two functions with one name", "functions", "def f(a):\n    return a\n\ndef f(b):\n    return b\n", 4),
    ("wrong number of arguments", "expression", "abs(s, k)", 1),
    ("unbalanced parenthesis", "expression", "(s + 1", 1),
    ("two expressions", "expression", "s; k", 1),
    ("list literal as a value", "expression", "[1, 2] * 2", 1),
    ("slice with step", "expression", "x[::2]", 1),
    ("statement in an expression", "expression", "s = 3", 1),
    ("bitwise operator", "expression", "k & 1", 1),
    ("matrix multiply operator", "expression", "t @ x", 1),
    ("walrus", "expression", "(q := 3)", 1),
    ("star arguments", "expression", "min(*x)", 1),
    ("semicolon injection", "expression", "s); fetch('x'", 1),
    ("backtick", "expression", "`s`", 1),
    ("javascript comment", "expression", "s // 2 /* hidden */", 1),
]

# ---- added with the translator (engine/lang) ----
# What real Python and NumPy do at the edges: kinds of numbers, signed zeros, NaN, empty lists.
CASES += [
    # literals
    ("literal with a leading or trailing dot", "basic", "1. + .5 + 1.e1", {}),
    # truth values: NumPy adds two of its own as "or", Python adds two of its own as numbers
    ("numpy truth values add as or", "basic", "(s > 2) + (k > 2)", {}),
    ("python truth values add as numbers", "basic", "True + True + (1 < 2)", {}),
    ("truth list plus truth list is or", "basic", "(x > 0) + (y > 0)", {}),
    ("truth list times truth list", "basic", "(x > 0) * (y > 0)", {}),
    ("truth list times number", "basic", "(x > 0) * 2.5", {}),
    ("truth list plus whole number", "basic", "(x > 1) + 1", {}),
    ("truth minus truth", "basic", "(s > 2) - (k > 2)", {"error": True}),
    ("negate a truth list", "basic", "-(x > 1)", {"error": True}),
    ("negate a python truth value", "basic", "-True + (not s)", {}),
    ("truth division", "basic", "(s > 2) / (k > 2)", {}),
    ("truth floor division", "basic", "(x > 1) // (y > 1)", {}),
    ("sum of a truth table", "basic", "sum(t > 2)", {}),
    ("abs of truth values", "basic", "abs(True) + abs(s > 2)", {}),
    ("truth equals number", "basic", "(True == 1) + (s > 2) * 3 + ((s > 2) == 1)", {}),
    # whole numbers
    ("whole list floor division by zero", "basic", "n // (b - b)", {}),
    ("whole list remainder by zero", "basic", "n % (b - 1)", {}),
    ("whole number floor division and remainder by zero", "basic", "k // (k - 3) + k % (k - 3)", {}),
    ("whole product has no negative zero", "basic", "ops.array([(k - 3) * -2, -(k - 3), 0 * -1])", {}),
    ("whole list product has no negative zero", "basic", "(n * -1) * 1.0", {}),
    ("negative zero from division of whole numbers", "basic", "ops.array([0 / -s, (k - 3) / -1])", {}),
    ("negate a decimal zero", "basic", "-z", {}),
    ("whole powers are exact", "basic", "k ** 3 + 2 ** k + 7 ** 2", {}),
    ("whole list power", "basic", "n ** 2 + n ** n", {}),
    ("whole number to a negative power", "basic", "k ** -1", {"error": True}),
    ("python whole number to a negative power", "basic", "2 ** -2", {}),
    ("whole list to a negative power", "basic", "n ** (b - 2)", {"error": True}),
    ("zero to the power zero", "basic", "(k - 3) ** (k - 3) + z ** z", {}),
    ("whole number true division", "basic", "n / b", {}),
    # decimal numbers
    ("float floor division by zero", "basic", "x // z", {}),
    ("float remainder by zero", "basic", "x % z", {}),
    ("floor division by infinity", "basic", "x // ops.inf", {}),
    ("remainder by infinity", "basic", "x % ops.inf", {}),
    ("remainder by minus infinity", "basic", "x % -ops.inf", {}),
    ("infinity floor divided", "basic", "ops.inf // x + ops.inf % x", {}),
    ("negative zero remainder", "basic", "(z * -1) % y", {}),
    ("negative zero floor division", "basic", "(z * -1) // y", {}),
    ("floor division of lists", "basic", "y // x + y % x", {}),
    ("power two written as a decimal", "basic", "x ** 2.0", {}),
    ("power of one and of minus one", "basic", "ops.array([1, -1, 1]) ** ops.array([ops.inf, ops.inf, z / z])", {}),
    ("power with a list of exponents", "basic", "y ** n", {"approx": True}),
    ("power of a whole base to a half", "basic", "k ** 0.5", {"approx": True}),
    ("negative base to a half", "basic", "(-s) ** 0.5", {}),
    ("zero to a negative power", "basic", "z ** -1", {}),
    # and, or, not
    ("and or return an operand", "basic", "(s and k) + (z and k) + (z or s) + (k or s)", {}),
    ("not of numbers", "basic", "(not z) + (not s) + (not z / z)", {}),
    ("nan counts as true", "basic", "ops.array([z / z and 5, z / z or 7])", {}),
    ("longer chain", "basic", "0 < x[0] < y[0] < 10 > k", {}),
    # min and max
    ("min max with nan second", "basic", "min(s, z / z) + max(s, z / z)", {}),
    ("min with nan first", "basic", "min(z / z, s)", {}),
    ("builtin min skips a later nan", "basic", "min(ops.array([1, z / z, 0.5])) + max(ops.array([1, z / z, 3]))", {}),
    ("builtin min of signed zeros", "basic", "ops.array([min(z, -z), min(-z, z), max(z, -z), max(-z, z)])", {}),
    ("ops min max of signed zeros", "basic", "ops.array([ops.min(ops.array([z, -z])), ops.min(ops.array([-z, z])), ops.max(ops.array([z, -z])), ops.max(ops.array([-z, z]))])", {}),
    ("ops min with nan", "basic", "ops.array([ops.min(ops.array([1, z / z, 0.5])), ops.max(ops.array([z / z, 1]))])", {}),
    ("ops minimum with nan and zeros", "basic", "ops.minimum(ops.array([z, -z, z / z, 1]), ops.array([-z, z, 1, z / z]))", {}),
    ("ops maximum with nan and zeros", "basic", "ops.maximum(ops.array([z, -z, z / z, 1]), ops.array([-z, z, 1, z / z]))", {}),
    ("ops minimum of whole numbers", "basic", "ops.minimum(n, 1.5) + ops.maximum(n, b)", {}),
    ("min of an empty list", "basic", "min(x[3:1])", {"error": True}),
    ("ops max of an empty list", "basic", "ops.max(x[3:1])", {"error": True}),
    ("ops argmin of an empty list", "basic", "ops.argmin(x[3:1])", {"error": True}),
    ("min of a single number", "basic", "min(s)", {"error": True}),
    ("min max of a range", "basic", "min(range(3, 7)) + max(range(3, 7))", {}),
    ("ops min max along rows and columns", "basic", "ops.min(t, axis=1) + ops.max(m, axis=1)[0:3]", {}),
    # sums and products
    ("sums of negative zeros", "basic", "ops.array([sum(ops.array([-z, -z])), ops.sum(ops.array([-z, -z])), ops.sum(ops.zeros(9) * -1), ops.mean(ops.array([-z])), ops.prod(ops.array([-z]))])", {}),
    ("cumsum keeps negative zero", "basic", "ops.cumsum(ops.array([-z, -z, 1]))", {}),
    ("axis sums of negative zeros", "basic", "ops.sum(abs(t) * -z, axis=0) + ops.sum(abs(t) * -z, axis=1)[0]", {}),
    ("ops sum of a long list", "basic", "ops.sum(ops.arange(300) * 0.1)", {}),
    ("builtin sum of a long list", "basic", "sum(ops.arange(300) * 0.1)", {}),
    ("ops mean of a long list", "basic", "ops.mean(ops.arange(1000) / 7)", {}),
    ("ops sum of a table expression", "basic", "ops.sum(t * t - t / 3)", {}),
    ("ops mean of a table", "basic", "ops.mean(t / 3)", {}),
    ("ops prod of a table", "basic", "ops.prod(t / 3)", {}),
    ("ops prod along rows and columns", "basic", "ops.prod(t / 3, axis=0) + ops.prod(t / 3, axis=1)[0]", {}),
    ("ops prod of whole numbers has no negative zero", "basic", "ops.array([ops.prod(n * -1), ops.prod(m * -1, axis=1)[2]])", {}),
    ("ops reductions of truth values", "basic", "ops.sum(x > 1) + ops.mean(x > 1) + ops.prod(n + 1 > 0) + ops.sum(t > 2, axis=1)", {}),
    ("ops reductions of an empty list", "basic", "ops.array([ops.sum(x[3:1]), ops.mean(x[3:1]), ops.prod(x[3:1])])", {}),
    ("line fit with ops", "fit", "ops.sum((pressure - (offset + gain * voltage)) ** 2) + ops.mean(pressure * voltage)", {}),
    ("builtin sum of a table times a list", "basic", "sum(t * x / 3)", {}),
    # other ops
    ("ops sign of zeros and nan", "basic", "ops.sign(ops.array([-z, z, z / z, -3, ops.inf]))", {}),
    ("ops round at the edges", "basic", "ops.round(ops.array([-0.2, -0.5, 0.5, 1e300, -2.5, z / z, -ops.inf, -z, 0.49999999999999994, 4503599627370497.0, 2.5, 3.5]))", {}),
    ("ops rounding of whole numbers", "basic", "ops.round(n) + ops.floor(n) + ops.ceil(k) + ops.sign(n - 1) + ops.abs(n - 2)", {}),
    ("ops ceil near zero", "basic", "ops.ceil(ops.array([-0.5, -z, 0.5]))", {}),
    ("ops floor near zero", "basic", "ops.floor(ops.array([-0.5, -z, 0.5]))", {}),
    ("ops clip with crossed bounds", "basic", "ops.clip(x, 2, 0)", {}),
    ("ops clip with a nan bound", "basic", "ops.clip(x, z / z, 1) + ops.clip(z / z, 0, 1)", {}),
    ("ops clip with lists", "basic", "ops.clip(x, n, n + 1)", {}),
    ("ops clip of zeros", "basic", "ops.clip(ops.array([-z, z]), ops.array([z, -z]), 1)", {}),
    ("ops clip of whole numbers", "basic", "ops.clip(n, 1, 2) + ops.clip(k, 0, 2.5)", {}),
    ("ops where nan is true", "basic", "ops.where(ops.array([z, z / z, -z, 2]), 1, 0)", {}),
    ("ops where single numbers", "basic", "ops.where(s > 2, 1.5, 2) + ops.where(z, x, y)", {}),
    ("ops where on a table", "basic", "ops.where(t > 2, t, x)", {}),
    ("ops argmin argmax with nan", "basic", "ops.argmin(ops.array([1, z / z, 0, z / z])) * 10 + ops.argmax(ops.array([1, z / z, 5]))", {}),
    ("ops argsort with nan and zeros", "basic", "ops.argsort(ops.array([2, z / z, 1, -z, z, z / z, -ops.inf]))", {}),
    ("ops sort with nan and zeros", "basic", "ops.sort(ops.array([2, z / z, 1, z, -z, z / z, -ops.inf]))", {}),
    ("ops roll by more than the length", "basic", "ops.roll(x, -9) + ops.roll(x, 2.7) + ops.roll(x, 0)", {}),
    ("ops roll of an empty list", "basic", "len(ops.roll(x[3:1], 2))", {}),
    ("ops roll of an expression", "basic", "sum(x[ops.roll(n + 0, 1)] * ops.roll(x * 2, -1))", {}),
    ("ops zeros with a negative length", "basic", "ops.zeros(-1)", {"error": True}),
    ("ops arange with a negative length", "basic", "len(ops.arange(-2))", {}),
    ("ops zeros with a decimal length", "basic", "len(ops.zeros(2.9)) + len(ops.ones(True))", {}),
    ("ops array of nothing", "basic", "len(ops.array([]))", {}),
    ("ops dot of whole numbers", "basic", "ops.dot(n, b) + ops.dot(m, n)[1]", {"approx": True}),
    ("ops cumsum of truth values", "basic", "ops.cumsum(x > 0)", {}),
    # positions
    ("decimal position even when whole", "basic", "x[k / 1]", {"error": True}),
    ("whole positions from floor division", "basic", "x[len(x) // 2] + x[k // 1] + x[-0]", {}),
    ("gather with negative positions", "basic", "x[n - 4]", {}),
    ("gather with a negative position out of range", "basic", "x[n - 5]", {"error": True}),
    ("gather nothing", "basic", "len(x[range(0)])", {}),
    ("gather with a range that is too long", "basic", "x[range(5)]", {"error": True}),
    ("gather of an expression", "basic", "(x * 2 + y)[n]", {}),
    ("row then element", "basic", "t[1][2] + t[-1][-1]", {}),
    ("gather then element", "basic", "x[n][0]", {}),
    ("slice with whole variable ends", "basic", "x[k - 2:k]", {}),
    ("slice of a slice", "basic", "x[1:][1:]", {}),
    ("slice with far negative ends", "basic", "len(x[-99:-98]) + len(x[-99:]) * 10", {}),
    ("slice with a decimal end", "basic", "x[1.0:2]", {"error": True}),
    ("table row out of range", "basic", "t[3]", {"error": True}),
    ("group out of range", "basic", "g[3]", {"error": True}),
    ("negative group", "basic", "g[-1]", {}),
    ("two positions on a list", "basic", "x[n, 0]", {"error": True}),
    ("position on a single number", "basic", "s[0]", {"error": True}),
    ("paired with a range and a number", "basic", "t[range(3), 1]", {}),
    ("paired with negative positions", "basic", "m[n - 4, -1]", {}),
    ("paired inside a larger expression", "basic", "sum(t[range(3), b[0:3]] * x[0:3]) - ops.sum(m[n, n] / 7)", {}),
    # ranges
    ("len of ranges", "basic", "len(range(2, 10, 3)) + len(range(5, 0)) + len(range(10, 0, -3))", {}),
    ("range with a zero step", "basic", "sum(range(1, 5, 0))", {"error": True}),
    ("range with a decimal argument", "basic", "sum(range(s))", {"error": True}),
    ("range in arithmetic", "basic", "range(3) + 1", {"error": True}),
    ("range from whole variables", "basic", "sum(range(k, k * 4, k - 1))", {}),
    # functions
    ("accumulate from a whole zero", "basic", "acc(x) + acc(x[3:1]) + acc(n)", {"functions": (
        "def acc(a):\n"
        "    total = 0\n"
        "    for v in a:\n"
        "        total += v\n"
        "    return total\n"
    )}),
    ("nested loops over a table", "basic", "squares(t) + squares(m)", {"functions": (
        "def squares(table):\n"
        "    s = 0.0\n"
        "    for row in table:\n"
        "        for v in row:\n"
        "            s += v * v\n"
        "    return s\n"
    )}),
    ("loop over a literal list of lists", "basic", "both(x, y)", {"functions": (
        "def both(a, b):\n"
        "    s = 0\n"
        "    for part in [a, b, a * b]:\n"
        "        s += sum(part)\n"
        "    return s\n"
    )}),
    ("a name changes its kind", "basic", "twice(x)", {"functions": (
        "def twice(a):\n"
        "    a = sum(a)\n"
        "    a = a * 2\n"
        "    return a\n"
    )}),
    ("changing the loop variable does not change the loop", "basic", "f(k + 2)", {"functions": (
        "def f(count):\n"
        "    total = 0\n"
        "    for i in range(count):\n"
        "        i = i * 2\n"
        "        total += i\n"
        "    return total\n"
    )}),
    ("a function returns a list or a table", "basic", "sum(scale(x, 2)) + ops.sum(scale(t, x))", {"functions": (
        "def scale(a, factor):\n"
        "    return a * factor\n"
    )}),
    ("a number as a condition", "basic", "f(z) * 100 + f(s) * 10 + f(z / z)", {"functions": (
        "def f(a):\n"
        "    if a:\n"
        "        return 1\n"
        "    return 2\n"
    )}),
    ("return from nested loops", "basic", "find(t, 6.5) + 100 * find(t, 99)", {"functions": (
        "def find(table, limit):\n"
        "    count = 0\n"
        "    for row in table:\n"
        "        for v in row:\n"
        "            if v > limit:\n"
        "                return count\n"
        "            count += 1\n"
        "    return -1\n"
    )}),
    ("group loads", "basic", "worst(g, x) - best(g, x)", {"functions": (
        "def load(group, values):\n"
        "    return sum(values[group])\n"
        "\n"
        "def worst(groups, values):\n"
        "    out = -ops.inf\n"
        "    for i in range(len(groups)):\n"
        "        out = max(out, load(groups[i], values))\n"
        "    return out\n"
        "\n"
        "def best(groups, values):\n"
        "    out = ops.inf\n"
        "    for group in groups:\n"
        "        out = min(out, load(group, values))\n"
        "    return out\n"
    )}),
    ("if elif else with different kinds of numbers", "basic", "pick(k) + pick(s) + pick(z)", {"functions": (
        "def pick(v):\n"
        "    if v > 2.7:\n"
        "        out = 1\n"
        "    elif v > 1:\n"
        "        out = v / 2\n"
        "    else:\n"
        "        out = v > 0\n"
        "    return out * 4\n"
    )}),
    ("a loop that runs zero times", "basic", "count(0) + count(-3)", {"functions": (
        "def count(limit):\n"
        "    total = 5\n"
        "    for i in range(limit):\n"
        "        total += 1\n"
        "    for i in range(3, limit):\n"
        "        total += 1\n"
        "    return total\n"
    )}),
    ("a loop keeps the list it started with", "basic", "f(x) + f(n)", {"functions": (
        "def f(a):\n"
        "    total = 0\n"
        "    for v in a:\n"
        "        a = a * 2\n"
        "        total += v\n"
        "    return total + a[0]\n"
    )}),
    ("a loop variable with the name of its list", "basic", "f(x) + f(g[2])", {"functions": (
        "def f(a):\n"
        "    total = 0\n"
        "    for a in a:\n"
        "        total += a\n"
        "    return total\n"
    )}),
    ("a loop over groups keeps the groups it started with", "basic", "f(g)", {"functions": (
        "def f(parts):\n"
        "    total = 0\n"
        "    for part in parts:\n"
        "        parts = part\n"
        "        total += len(part) + len(parts)\n"
        "    return total\n"
    )}),
    ("truth values of mixed python and numpy numbers multiply", "basic", "f(s) + f(z)", {"functions": (
        "def f(c):\n"
        "    if c > 0:\n"
        "        v = 5\n"
        "    else:\n"
        "        v = c\n"
        "    return (v > 1) * (v > 2) + (v >= 0) * 3\n"
    )}),
]

# Attempts to reach JavaScript, text that could exhaust the translator, forms of Python numbers
# outside the spec, and valid Python that the translator refuses on purpose because the answer
# would not be what the spec promises.
REJECTS += [
    ("prototype name", "expression", "__proto__", 1),
    ("ops constructor", "expression", "ops.constructor(1)", 1),
    ("ops prototype", "expression", "ops.__proto__", 1),
    ("ops toString", "expression", "ops.toString()", 1),
    ("ops hasOwnProperty", "expression", "ops.hasOwnProperty(1)", 1),
    ("constructor of a value", "expression", "x.constructor.constructor(1)", 1),
    ("name starting with two underscores", "functions", "def __init__(a):\n    return a\n", 1),
    ("local name starting with two underscores", "functions", "def f(a):\n    __proto__ = a\n    return a\n", 2),
    ("parameter starting with two underscores", "functions", "def f(__proto__):\n    return 1\n", 1),
    ("unicode lookalike of a name", "expression", "\uff58 + 1", 1),
    ("unicode digit", "expression", "\u0661 + 1", 1),
    ("cyrillic lookalike of a name", "expression", "\u0445 + 1", 1),
    ("unicode escape in a name", "expression", "\\u0078 + 1", 1),
    ("non-breaking space", "expression", "s +\u00a0k", 1),
    ("zero width space", "expression", "s\u200b + k", 1),
    ("line separator", "expression", "s\u2028+ k", 1),
    ("null character", "expression", "s\x00", 1),
    ("form feed", "expression", "s +\x0c k", 1),
    ("backslash continuation", "expression", "s + \\\n k", 1),
    ("hex literal", "expression", "0x10", 1),
    ("binary literal", "expression", "0b11", 1),
    ("underscore in a number", "expression", "1_000", 1),
    ("number with leading zeros", "expression", "0777", 1),
    ("number too large for a float", "expression", "1e999", 1),
    ("whole number too large to be exact", "expression", "9007199254740993", 1),
    ("imaginary number", "expression", "1j", 1),
    ("number glued to a word", "expression", "1or 2", 1),
    ("attribute of a number", "expression", "1 .real", 1),
    ("deeply nested parentheses", "expression", "(" * 300 + "s" + ")" * 300, 1),
    ("deeply nested brackets", "expression", "x" + "[n" * 300 + "]" * 300, 1),
    ("very long chain", "expression", "s" + " + s" * 600, 1),
    ("deep chain of minus signs", "expression", "-" * 300 + "s", 1),
    ("deep chain of powers", "expression", "2 ** " * 300 + "2", 1),
    ("one-line if", "functions", "def f(a):\n    if a > 0: return 1\n    return 0\n", 2),
    ("one-line def", "functions", "def f(a): return a\n", 1),
    ("nested def", "functions", "def f(a):\n    def g(b):\n        return b\n    return g(a)\n", 2),
    ("return without a value", "functions", "def f(a):\n    return\n", 2),
    ("for else", "functions", "def f(a):\n    for v in a:\n        a = v\n    else:\n        a = 1\n    return a\n", 4),
    ("name set only inside a loop", "functions", "def f(a):\n    for v in a:\n        last = v\n    return last\n", 4),
    ("name set only in one branch", "functions", "def f(a):\n    if a > 0:\n        b = 1\n    return b\n", 4),
    ("local named like a function", "functions", "def f(a):\n    return a\n\ndef h(a):\n    f = a\n    return f\n", 5),
    ("function named ops", "functions", "def ops(a):\n    return a\n", 1),
    ("function named like a name of the exported script", "functions", "def np(a):\n    return a\n", 1),
    ("loop variable named like a builtin", "functions", "def f(a):\n    for len in a:\n        a = 1\n    return a\n", 2),
    ("two parameters with one name", "functions", "def f(a, a):\n    return a\n", 1),
    ("percent assignment", "functions", "def f(a):\n    a %= 2\n    return a\n", 2),
    ("decorator", "functions", "@staticmethod\ndef f(a):\n    return a\n", 1),
    ("type hint", "functions", "def f(a: float):\n    return a\n", 1),
    ("line that does nothing", "functions", "def f(a):\n    a + 1\n    return a\n", 2),
    ("docstring", "functions", 'def f(a):\n    """Returns a."""\n    return a\n', 2),
    ("code after the functions", "functions", "def f(a):\n    return a\n\nf(1)\n", 4),
    ("call of a value", "expression", "x(1)", 1),
    ("function used as a value", "expression", "sum + 1", 1),
    ("ops function used as a value", "expression", "ops.sum", 1),
    ("ops constant called", "expression", "ops.pi()", 1),
    ("axis on a builtin", "expression", "sum(t, axis=0)", 1),
    ("axis that is not written as 0 or 1", "expression", "ops.sum(t, axis=k)", 1),
    ("axis out of range", "expression", "ops.sum(t, axis=2)", 1),
    ("axis on a function without it", "expression", "ops.sqrt(t, axis=0)", 1),
    ("in operator", "expression", "s in x", 1),
    ("is operator", "expression", "s is k", 1),
    ("None", "expression", "None", 1),
    ("double quotes", "expression", 'len("abc")', 1),
    ("empty expression", "expression", "", 1),
    ("only a comment", "expression", "# nothing", 1),
    ("two lines", "expression", "s\nk", 2),
    ("tuple", "expression", "(s, k)", 1),
    ("empty parentheses", "expression", "()", 1),
    ("comma after a position", "expression", "x[1,]", 1),
    ("three positions", "expression", "t[0, 0, 0]", 1),
    ("exclamation mark", "expression", "!s", 1),
    ("dollar sign", "expression", "$s", 1),
    ("question mark", "expression", "s ? 1 : 2", 1),
    ("not after an operator", "expression", "1 + not s", 1),
    ("list as an ops argument", "expression", "ops.sum([s, k])", 1),
    # valid Python, refused because Python's answer is not what the spec promises
    ("truth value as a position", "expression", "x[s > 2]", 1),
    ("mask as positions", "expression", "x[x > 1]", 1),
    ("square root of truth values", "expression", "ops.sqrt(x > 1)", 1),
    ("axis on a list", "expression", "ops.sum(x, axis=0)", 1),
    ("slice of a table", "expression", "t[0:2]", 1),
    ("rows of a table by a list", "expression", "t[n]", 1),
    ("ops array of a list", "expression", "ops.array(x)", 1),
    ("and with a list on the right", "expression", "s > 2 and x", 1),
    ("ops function on a range", "expression", "ops.sum(range(3))", 1),
    ("position on a range", "expression", "range(5)[2]", 1),
    ("not of a list", "expression", "not x[0:1]", 1),
]
