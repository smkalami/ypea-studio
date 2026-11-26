# The limited Python syntax

Objectives, constraints and helper functions in a project are written in a small subset of Python. The app translates them to JavaScript (`engine/lang/`). A script exported from the app runs the same text unchanged in real Python with NumPy. This file is the contract between the two: the translator must give the value that real Python gives.

Real Python is the judge. `spec/language/cases.py` lists expressions with their inputs, `spec/language/make_cases.py` evaluates them in real Python and stores the answers in `spec/language/cases.json`, and the translator's tests compare against that file. Whole projects are compared too: `spec/parity/methods/constrained.json` runs objectives, functions and constraints through real Python inside ypea and through the translator inside the engine, and the runs must match. The `ops` functions are defined in Python by `spec/language/ops.py`, which an exported script will carry.

## 1. Where code appears and what it can see

| Field of the project file | Form | Names it can use |
| --- | --- | --- |
| `functions` | Zero or more `def` statements | Its own parameters and local names, data names, functions defined **earlier** in the text, the built-ins, `ops` |
| `objective.source` | One expression | Variable names, data names, the functions, the built-ins, `ops` |
| `constraints[].left` and `.right` | One expression each | The same as the objective |

- A function cannot see the variables. It gets them as arguments. This matches the exported script, where the functions are module-level code and the variables arrive in a solution object.
- A function can call only functions defined before it, so there is no recursion.
- Every other name is rejected when the project is translated, with the line and column. This is the security rule: generated JavaScript can never reach the page, storage or the network.

## 2. Values

| Value | Comes from | In JavaScript | In Python |
| --- | --- | --- | --- |
| Number | Literals, scalar variables, arithmetic | `number` | `float`, `int`, or a NumPy scalar |
| Truth value | Comparisons, `True`, `False`, `not`, `and`, `or` | `boolean` | `bool` |
| List (1-D) | Variables, data columns, slices, `ops` | Typed array | 1-D NumPy array |
| Table (2-D) | Matrix data, table variables | Typed array with rows and columns | 2-D NumPy array |
| Groups | A `partition` variable | Array of integer lists | Python list of 1-D integer arrays |
| Range | `range(...)` | Loop bounds | `range` |

All numbers are 64-bit floats in the app. Whole numbers are exact up to 2^53, which is far beyond any position or count in a project.

A truth value used in arithmetic counts as 1 or 0, with one exception that comes from NumPy: adding two truth values that both came from comparisons of data or variables gives "or" (1 or 0, never 2), and subtracting or negating them is an error. Use `sum(...)` to count.

There are no strings, dictionaries, tuples or sets.

## 3. Statements (inside `def` only)

- `name = expression`, and `name += expression` with `-=`, `*=` and `/=`. The four short forms work on numbers only, because NumPy would change a list in place and with it every name that holds the same list.
- A name set only inside a loop or inside one branch of an `if` cannot be used after it.
- `if`, `elif`, `else`. The condition must be a single number or truth value. A list as a condition is an error, as in NumPy.
- `for name in range(...)`, `for name in <list>`, `for name in <table>` (row by row), `for name in <groups>`, and `for name in [a, b, c]`.
- `return expression`. Every path through a function must end in a `return`.

Not supported, and rejected with a clear message and the line number: `class`, `import`, `while`, `break`, `continue`, `pass`, `lambda`, comprehensions, conditional expressions (`a if c else b`), default and keyword parameters, `*args`, decorators, `global`, element assignment (`a[i] = v`), tuple assignment (`a, b = ...`), strings, dictionaries, attribute access other than `ops.<name>`, method calls, and `try`.

Indentation uses spaces. A tab in indentation is rejected.

## 4. Expressions

**Literals.** Whole and decimal numbers, with an optional exponent (`3`, `0.5`, `1e-3`). `True` and `False`.

**Operators**, with Python's precedence and associativity:

| Operator | Rule |
| --- | --- |
| `+ - *` | Exact, element by element on lists and tables |
| `/` | True division, always a float |
| `//` | Floor division as Python does it for floats (toward minus infinity) |
| `%` | Remainder with the sign of the divisor, as in Python |
| `**` | Right associative. `-x ** 2` is `-(x ** 2)`. A power of exactly `2` of a list or table is `x * x` on both sides and is exact. Every other power may differ from Python in the last digit, and that includes `** 2` of a single number: Python then calls the C library's power function, which on Windows differs from `x * x` for about 1 value in 2000. Write `x * x` when a single number must match exactly. |
| unary `-`, `+` | |
| `< <= > >= == !=` | Chained comparisons (`a < b < c`) work for single numbers as in Python. On lists they compare element by element and give a list of truth values, and a chain on lists is an error, as in NumPy. |
| `not`, `and`, `or` | Single truth values or numbers only. `and` and `or` evaluate the right side only when needed and give one of their two operands, as in Python (`2 and 3` is 3). |

**Shapes.** Arithmetic and comparisons work between two numbers, a number and a list or table, two lists of the same length, two tables of the same shape, and a table with a list whose length is the number of columns (the list applies to every row). Anything else is an error in the app. NumPy accepts one more case, a list of length 1 with a longer list, which the app refuses.

**Whole and decimal numbers.** The app tracks which values are whole (positions, counts, whole-number variables) and which are decimal (real variables, all data, the result of `/`). Only a whole number can be a position. Python refuses `x[2.0]`, and so does the app, when the project is translated. A name that holds a whole number on one path and a decimal on another is treated as decimal.

**Division by zero** gives infinity or NaN where NumPy gives them (any operand that came from a variable or from data). The candidate then counts as the worst. With plain Python numbers on both sides, such as `1 / (len(a) - len(a))`, Python raises an error and stops the script, where the app gives infinity. This difference is known and accepted.

**Indexing.** Positions start at 0.

| Form | Meaning |
| --- | --- |
| `a[i]` | One element. A negative `i` counts from the end. |
| `a[i:j]`, `a[i:]`, `a[:j]` | A slice. Out-of-range ends are clamped, as in Python. No step. |
| `a[idx]` | Gather: `idx` is a list of whole numbers, and the result has its length. |
| `t[i]` | Row `i` of a table. |
| `t[i, j]` | One element of a table. |
| `t[rows, cols]` | Paired positions: element `k` of the result is `t[rows[k], cols[k]]`. One of the two may be a single number. |
| `g[i]` | Group `i` of a partition. |

A position that is out of range is an error on both sides. It stops the run with a message that names the field and the line. A position that is or may be a decimal number is refused when the project is translated.

**Calls.** Functions from `functions`, the built-ins, and `ops.<name>`, with positional arguments only (the one exception is `axis=` in `ops`).

## 5. Built-ins

These six keep their Python meaning. Nothing else from Python's built-ins is available.

| Call | Meaning |
| --- | --- |
| `sum(a)` | Adds the elements of a list **in index order**. This is what Python's `sum` does on a NumPy array, and it is exact on both sides. On a table it adds the rows and gives a list. |
| `min(a)`, `max(a)` | Smallest and largest element of a list. With two or more numbers, `min(a, b, ...)`. |
| `abs(x)` | Absolute value of a number, or of every element. |
| `len(a)` | Number of elements of a list, rows of a table, or groups. |
| `range(n)`, `range(a, b)`, `range(a, b, step)` | Whole numbers, for `for` loops and as positions (`t[range(n), idx]`). |

## 6. The `ops` namespace

Array operations live in `ops`. Each name means what the NumPy function of the same name means, so a NumPy user can guess them, and `spec/language/ops.py` defines them exactly.

| Group | Names |
| --- | --- |
| Constants | `ops.pi`, `ops.e`, `ops.inf` |
| Making lists | `ops.array([a, b, c])`, `ops.zeros(n)`, `ops.ones(n)`, `ops.arange(n)` |
| Reductions (`axis=0` or `axis=1` on tables) | `ops.sum`, `ops.mean`, `ops.prod`, `ops.min`, `ops.max` |
| Positions (lists only) | `ops.argmin`, `ops.argmax`, `ops.argsort` (stable), `ops.sort`, `ops.cumsum`, `ops.roll(a, k)` |
| Element by element | `ops.sqrt`, `ops.abs`, `ops.floor`, `ops.ceil`, `ops.round` (halves go to the even neighbor), `ops.sign`, `ops.minimum(a, b)`, `ops.maximum(a, b)`, `ops.clip(a, low, high)`, `ops.where(condition, a, b)` |
| Element by element, last digit may differ | `ops.exp`, `ops.log`, `ops.sin`, `ops.cos`, `ops.tan` |
| Products | `ops.dot(a, b)` for two lists, or a table and a list. The last digit may differ. |

`ops.sum` and `ops.mean` add the way NumPy adds (in pairs, see `engine/numpy.ts`), so they are exact on both sides and can differ from the built-in `sum` in the last digit. `ops.roll(a, -1)` moves every element one place toward the start, so `a[ops.roll(idx, -1)]` is "the next one, wrapping around".

## 7. How closely the two sides match

- **Exact.** Everything built from `+ - * /`, `//`, `%`, `** 2`, comparisons, indexing, `sum`, `min`, `max`, `abs`, `len`, and every `ops` function outside the two "last digit may differ" groups.
- **Within a relative 1e-12.** `**` with a power other than 2, `** 2` of a single number, `ops.exp`, `ops.log`, `ops.sin`, `ops.cos`, `ops.tan`, `ops.dot`. A case that uses one of these is marked `approx` in `cases.py`.
- **Errors.** A case that raises `IndexError`, `ValueError` or `TypeError` in Python must be an error in the app. The kind is recorded, and the wording is the app's own.

## 8. Choices that are stricter than Python

Where Python gives a value but the meaning is doubtful or differs between Python and NumPy, the app refuses the text. `spec/language/cases.py` lists every such form under REJECTS. The main ones: a truth list as a position (`x[x > 1]`), slices and gathers on tables, `ops` functions on a `range`, the short assignment forms on lists, one-line `if` and `def`, and number forms such as `0x10` and `1_000`.

Data columns and matrices count as decimal numbers, as a CSV reader would give them, so a data column cannot be a position. This is provisional: a project may later mark a column as whole numbers.

A `for` loop over a huge range is not stopped by the app. It runs until the user cancels the run.

## 9. Generated JavaScript

- The translator emits one JavaScript function per expression. User names never appear as JavaScript identifiers or property names without a prefix, and no generated code reads a property whose name comes from the user's text.
- Shapes are known when a project is translated (variables and data have fixed shapes), so the translator can check shapes early and choose loops over temporary arrays. Correctness comes first. Speed is guarded by a test (the target is 100,000 evaluations per second in one worker for the 50-city route objective).
- A runtime error carries the field (`objective`, a constraint's name, or a function's name) and the line.
