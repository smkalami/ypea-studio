# The project file

A project is one JSON file. It holds the whole definition of a problem: data, variables, objective, constraints, comparison values and run settings. The engine checks every field when it reads a file (`parseProject` in `engine/project.ts`), because a shared file is untrusted input. The worked examples in `examples/` are the reference files.

This is version 1 of the format. Parts marked **provisional** may still change before the public 1.0, and any change after that goes through a migration.

## Top level

| Field | Required | Meaning |
| --- | --- | --- |
| `format` | yes | Always `"ypea-studio-project"` |
| `version` | yes | `1` |
| `name` | yes | Shown in the project list |
| `description` | no | One or two sentences |
| `data` | no | Data tables (below) |
| `variables` | yes | At least one variable (below) |
| `functions` | no | Function definitions in limited Python syntax, shared by the objective and the constraints |
| `objective` | yes | `sense` (`"min"` or `"max"`), `source` (an expression that gives one number, see `spec/language.md`), optional `unit` |
| `constraints` | no | Each has `name`, `left`, `op` (`"<="`, `">="` or `"=="`), `right`, optional `unit`, for `==` an optional `tolerance` and `relative_tolerance`, and an optional `enabled` (below) |
| `baseline` | no | The solution in use today: `label` and `solution` |
| `reference` | no | A known answer: optional `label`, and `objective` (a known optimum value), `solution`, or both |
| `view` | no | How a solution is drawn (below) |
| `run` | yes | The first experiment: `method`, `settings`, `budget` (evaluations) and `seed` (0 to 4294967295), with an optional `name` |
| `experiments` | no | More experiments (below) |

A `solution` gives one value for every variable, keyed by its name. Each value must be a valid value of its variable (within bounds, a real permutation, and so on), and a file with an invalid one is refused.

Every name that an expression can use (data tables, data columns, variables) must be unique, start with a letter or underscore, and contain only letters, digits and underscores.

Units are labels only. Nothing is converted.

## Data

Two kinds of table:

```json
{ "name": "items", "kind": "columns", "columns": [
    { "name": "weight", "unit": "kg", "values": [3, 7, 4] },
    { "name": "value", "unit": "$", "values": [40, 90, 55] } ] }

{ "name": "cost", "kind": "matrix", "unit": "$", "values": [[12, 30], [25, 14]] }
```

Columns of one table have the same length, and an expression uses a column by its own name (`weight`). A matrix is used by the table name (`cost[i, j]`). A project may hold up to 200,000 data values.

## Variables

| `type` | Other fields | Decoded value | ypea type |
| --- | --- | --- | --- |
| `real` | `shape`, `lb`, `ub`, `unit` | Numbers within the bounds | `Real` |
| `integer` | `shape`, `lb`, `ub`, `unit` | Whole numbers within the bounds, both ends included | `Integer` |
| `binary` | `shape`, `unit` | 0 or 1 | `Binary` |
| `permutation` | `n` | An ordering of 0 to n - 1 | `Permutation` |
| `selection` | `n`, `k` | k different positions out of n, in order | `Selection` |
| `binary_selection` | `n`, `k` | n values of 0 or 1 with exactly k ones | `BinarySelection` |
| `partition` | `n`, `k` | k ordered groups (some may be empty) that share the positions 0 to n - 1. The app calls this type "Ordered groups". | `Partition` |
| `binary_partition` | `n`, `k` | A k by n table of 0 and 1, one row per group | `BinaryPartition` |
| `fixed_sum` | `shape`, `target`, `unit` | Non-negative numbers whose total is `target` | `FixedSum(axis=None)` |
| `fixed_row_sum` | `shape`, `target`, `unit` | A table in which every row adds up to `target` (one number, or one per row) | `FixedSum(axis=1)` |
| `fixed_column_sum` | `shape`, `target`, `unit` | A table in which every column adds up to `target` (one number, or one per column) | `FixedSum(axis=0)` |

`shape` is `[]` for one number, `[n]` for a list, or `[rows, columns]` for a table. The two row and column types need a table. `lb`, `ub` are one number or one per element, in row order. One variable may use up to 100,000 values.

Positions start at 0 everywhere.

**Ordered groups (`partition`).** The n items and k - 1 separators are put in one ordering. The separators cut it into k groups, and the order of the items inside each group is kept. This is the usual way to write the routes of several vehicles (each group is the route of one vehicle) or the jobs on several machines. `examples/vrp.json` is a vehicle routing problem written this way. `binary_partition` splits the items in the same way but gives only the group of each item, without the order.

## Constraints

A constraint holds when `left op right` holds. Three optional fields change how it is judged:

| Field | Value | Meaning |
| --- | --- | --- |
| `tolerance` | A number that is not negative. `==` only. 0 when absent. | A fixed amount, in the constraint's own unit, that the two sides may differ by |
| `relative_tolerance` | A number that is not negative. `==` only. 0 when absent. | A fraction of the size of the right side that the two sides may differ by, on top of `tolerance`. 0.01 is 1%. |
| `enabled` | `true` or `false`. `true` when absent. | `false` turns the constraint off without deleting it |

**The rule for `==`.** The constraint holds when

```
abs(left - right) <= tolerance + relative_tolerance * abs(right)
```

This is the rule of NumPy's `isclose`, with `tolerance` as its `atol` and `relative_tolerance` as its `rtol`. The engine computes the right-hand side first (the product, then the sum) and then compares, and an exported script does the same, so both give the same answer for the same numbers (`engine/constraints.ts`).

- Without both fields a `==` constraint is exact, which real-valued variables can rarely meet.
- On a right side of 0 the relative tolerance adds nothing, because the product is 0. That is the rule, not an error. Give such a constraint a `tolerance`, or write it with a right side that is not 0.
- A `==` constraint with a side that is not a finite number never holds.
- `<=` and `>=` have no tolerance, and a file that gives them one is refused.

```json
{ "name": "Blend total", "left": "sum(share * amount)", "op": "==", "right": "500", "unit": "kg",
  "tolerance": 0.5, "relative_tolerance": 0.001 }
```

This one holds when the total is within 0.5 + 0.001 * 500 = 1 kg of 500 kg.

**A constraint that is off** (`"enabled": false`) stays in the project with its text. Its text is still translated when a run or a candidate test is prepared, so a mistake in it is still reported. It is not checked in a run or when a candidate is tested: it adds nothing to the violation, it never makes a result infeasible, and it has no scale. A result, a report and an exported script name the constraints that were off, so that a result is not read as meeting a limit that was not applied.

**In a result.** A run shows both sides of every constraint in its own unit. A broken constraint is described by the difference between its two sides in that unit, and by that difference as a percentage of the limit (the right side), which is left out when the limit is 0. A result lists every constraint of the project in `best.checks`, with a flag that says whether it was applied (`export/data.ts` describes the fields). Internally each violation is divided by a scale that is fixed once per run (`engine/constraints.ts`). The run records its scales, one for every constraint in the project's order, with `null` for a constraint that was off.

## View

A view tells the app how to draw a solution. Without one, a solution is shown as a table only. There are four kinds:

```json
{ "kind": "route", "variable": "route", "x": "x", "y": "y" }
{ "kind": "routes", "variable": "routes", "x": "x", "y": "y", "depot": 0, "distance": "distance" }
{ "kind": "line", "x": "voltage", "y": "pressure", "expression": "offset + gain * voltage" }
{ "kind": "selection", "variable": "take", "size": "weight" }
```

- **`route`** draws a closed tour. `variable` is a `permutation`, and `x` and `y` are two data columns of the same length that hold the coordinates of every position. The optional `distance` is described below.
- **`routes`** draws several closed tours from one depot. `variable` is a `partition`, and every group that is not empty is one tour: from the depot through the items of the group, in their order, and back. `x` and `y` are two data columns of the same length that hold the coordinates of every node: the depot in row `depot`, and the items in the other rows, in their order. So item i is row i when i is below `depot`, and row i + 1 otherwise. With `"depot": 0`, item i is row i + 1. `depot` is a whole number from 0 to n, and the columns need at least n + 1 rows. Each tour has its own color, from a palette that people with color blindness can tell apart, and dashed lines are used only after the colors are used up. Its name stands beside its line, and a legend gives its number of stops.
- **`distance`**, in a `route` or a `routes` view, is optional. It names a square `matrix` table with a row and a column for every row of the `x` column, in the same order (for `routes`, the depot included). With it the drawing gives the length of each tour as the table gives it, leg by leg, in the unit of the table. That is the length an objective built on the same table uses. Without it the drawing gives no length, because a length in straight lines between the points could disagree with the result.
- **`line`** draws the data points of two columns of the same length, and the curve that `expression` gives. The expression is written in the same language as the objective (`spec/language.md`), can use the same names, and must give a list with one value for each row of the `x` column (`buildCurve` in `engine/project.ts`).
- **`selection`** draws which items are chosen. `variable` is a list of `binary` values or a `binary_selection`. The optional `size` is a data column with one value for each item, which sets how large each item is drawn.

## Experiments

An experiment is a solver setup: a method, its settings, a budget and a seed. `run` is the first experiment, and it is the one that the command line runs. It may carry a `name`. A project may hold more of them in `experiments`:

```json
"experiments": [
  { "id": "de-20k", "name": "DE 20k", "method": "de", "settings": {}, "budget": 20000, "seed": 1 }
]
```

Each entry has an `id` (unique in the project, made of letters, digits, underscores and hyphens), a `name`, and the same four fields as `run`, checked in the same way. To run an experiment, run a copy of the project whose `run` is that entry. Results are not part of the project file. A file that carries them is described next.

## A file of projects, with or without results

The app also writes and reads a second kind of file, which wraps project files:

```json
{ "format": "ypea-studio-projects", "version": 1,
  "projects": [ { "format": "ypea-studio-project", "...": "..." } ],
  "results": [ { "project": 0, "experiment": "", "curve": [14.2, 26.1], "file": { "format": "ypea-studio-result", "...": "..." } } ],
  "comparisons": [ { "project": 0, "finished": "2026-11-26T10:30:28.000Z", "versions": { "app": "0.1.0", "ypeaTested": "0.6.0" },
                     "definition": { "format": "ypea-studio-project", "...": "..." }, "experiments": [ "..." ] } ] }
```

- **`projects`** is a list of project files. "Download all projects" writes every project of the browser into it, without results.
- **`results`** and **`comparisons`** are optional. "Download the project with results" writes one project with both. A reader that does not know them still reads the projects.
- **A result** names its project by its position in `projects` and its experiment by its `id` (the empty text for `run`). `file` is a result file exactly as the app downloads one on its own (`export/data.ts`): the result, the project definition as it was when the run started, the versions and the finish time, which is required here. `curve` is optional: for a project that draws a fitted line, the line of the best solution, so that a reader does not have to compute it. A project has at most one result for each experiment.
- **A comparison** names its project in the same way. `definition` is the project as it was when the comparison started (its own `run` is not used). Each entry of `experiments` has a `name`, a `setup` (`method`, `settings`, `budget`, `seed`, with the budget of the comparison), `"reference": true` when it is the Random Search that the comparison added, and `results`: one entry for each run, in any order, with `best` (`objective`, `feasible`), `evaluations` (`used`, `budget`), `history` (`nfe`, `best`), `trace` (`nfe`, `violation`, which may stop after the first entry with a violation of zero), `seed` (`base`, `runIndex`, `run`), `method` and `settings`. A project has at most one comparison.

Everything in such a file is untrusted and is checked when it is opened. Every project passes `parseProject`. Every result passes `parseResultFile` and the check that the app applies to a result it stored itself, and its experiment must exist in its project. For a comparison, the definition with every setup passes `parseProject`, and the runs pass `checkComparable` (`engine/compare.ts`): one budget, the stated solver and settings, distinct run indices, and seeds that follow from the base seed. One part that fails refuses the whole file. Results and comparisons go to the browser's store of results, never into the project.

A number that is not finite cannot be written in JSON. The app leaves a result with such a best value out of the file and says so, because the file would not open again.

## Provisional parts

- **`run` in the examples.** The fixed method and budget of each worked example are chosen and checked at milestone 4. The values in the files today are placeholders.
- **Data columns are decimal numbers**, so a data column cannot be used as a position (`spec/language.md`, section 8).
- **Several permutations in one variable.** ypea has a `count` option for this. The format does not offer it.
