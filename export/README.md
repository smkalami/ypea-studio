# The Python script exporter

`python.ts` turns a project and one result of that project into a single Python file. Running the file with the `ypea` package repeats the run of the app: the same solver, settings, budget and seed.

```ts
import { exportPython } from "./python.ts";

const script: string = exportPython(project, result);
```

- `project` is the definition the result was produced from (its snapshot).
- `result` is what `runProject` returned, or a stored copy of it. The exporter reads `method`, `settings`, `seed`, `scales`, `versions` and `evaluations` from it, and the objective values of `best`, `baseline` and `reference` when they are there. The `run` of the project is not read. `scales` must hold a positive number for every constraint that was on and `null` for every constraint that was off, in the order of the project.

The exporter has no dependencies and uses no Node or browser API, so the app can call it directly.

## What a script holds

1. A header: the app version, the ypea version the export was tested with, the Python version ypea needs, the install command, and how closely the Python run follows the app.
2. The `ops` functions (the text of `spec/language/ops.py`), made inside a function so that they live only in `ops`.
3. The data as NumPy float arrays, with units as comments.
4. The user's functions, unchanged apart from the line ends.
5. The objective and both sides of every constraint as the user wrote them, with the variables taken from the solution (`offset = sol.offset`).
6. For a project with constraints: the list of constraints with the tolerance, the relative tolerance and the scale of each, the rule in one function (`gap`, the rule of `engine/constraints.ts` in the same order of arithmetic), and what ypea calls, which returns `(f, g)` with one `g = gap / scale` for each constraint. The scales are those of the result.
7. The constraints that were off in the app, as comments with their text. ypea does not get them. When every constraint was off, ypea gets the objective alone, as for a project without constraints.
8. `main()`: the variables as ypea variables, the problem, the solver with every setting of the result, `max_nfe` as the budget, the seed as `ypea.StudioRng(ypea.derive_seed(base_seed, run_index))`, and the lines that print the result: the status, the objective, every variable, both sides of every constraint that was on (computed again in Python), the names of the constraints that were off, the evaluations used, and the baseline and reference values of the app. A broken constraint is printed with its breach, in the words of `breach` in `report.ts`: the difference between the two sides in the constraint's unit, and as a percentage of the limit unless the limit is 0. Python prints these two numbers with six and three significant digits in its own notation.

With the environment variable `YPEA_STUDIO_JSON` set, a script prints one more line at the end: `result.to_dict()` of ypea as JSON, with every digit. The tests read that line.

## What the exporter guarantees

**The same run.** For every solver except CMA-ES, the script finds the same improvements at the same evaluations and ends on the same solution as the app, bit for bit. For CMA-ES the best value so far agrees within the bounds of `engine/methods/cmaes.test.ts` (a relative 1e-10 at 500 evaluations, 1e-8 at 1000, 1e-6 at 2000). Beyond 2000 evaluations no bound is set, and the tests only report the difference. A project that uses `ops.exp`, `ops.log`, `ops.sin`, `ops.cos`, `ops.tan`, `ops.dot`, a power other than 2, or `** 2` of a single number can differ in the last digit (`spec/language.md`, section 7), and the header of every script says so.

**No text of a project runs as code unless it is a code field.** A project file and a stored result may come from a stranger.

- Names, labels, descriptions and units are written only as a comment of one line, with every control character and line end replaced by a space, or as an escaped string literal.
- Numbers are written only when they are finite numbers, and names only when they are made of letters, digits and underscores.
- The solver class comes from the engine's list of solvers, and the settings pass the same checks as in a run.
- The code fields (functions, objective, constraint sides) are written as code, after `parseProject` and `buildProblem` have accepted the project. `exportPython` calls both and throws when either refuses.

**The six built-ins keep their meaning.** Nothing at the top level of a script is named `sum`, `min`, `max`, `abs`, `len` or `range`. The code that the exporter adds calls only `print`, `len`, `range`, `abs` and `float`, which no table, column, variable or function of a project can be named after. The script's own names (`objective`, `main`, `json` and so on) get an underscore added when the project already uses them.

## Tests

```
node --test "export/*.test.ts"
```

`python.test.ts` has two groups:

- Plain tests, which need only Node: the script of every file in `examples/` equals the stored one in `expected/`, hostile text ends up only in comments and string literals, invalid projects and results are refused, and every variable type and kind of setting is written correctly.
- Tests that run the scripts in real Python and compare them with the app: every example, every run in `spec/parity/methods/*.json` (tolerances and constraints that are off among them), and special cases (every variable type, a second run of an experiment, hostile text, clashing names, expressions with comments, broken constraints). They take about 25 seconds.

The second group needs the project's `.venv` folder with the pinned ypea (`YPEA_TESTED` in `engine/run.ts`). Create it once in the project folder:

```
python -m venv .venv
.venv/Scripts/python -m pip install ypea==0.6.0      (Windows)
.venv/bin/python -m pip install ypea==0.6.0          (elsewhere)
```

Without it, or with another ypea version in it, these tests are skipped and each one says why.

## Stored files

Two kinds of file here are written by a command, not by hand:

- `ops_py.ts` is a copy of `spec/language/ops.py` as a TypeScript string, because the exporter cannot read files in a browser. A test fails when the two differ.
- `expected/<example>.py` is the script of each file in `examples/`. A test fails when an example has no stored script or when its script changes.

Write them again with:

```
UPDATE_EXPECTED=1 node --test "export/*.test.ts"
```

Then read the changes before keeping them: a changed script is what a user will download.
