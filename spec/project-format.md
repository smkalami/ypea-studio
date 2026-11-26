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
| `constraints` | no | Each has `name`, `left`, `op` (`"<="`, `">="` or `"=="`), `right`, optional `unit`, and for `==` an optional `tolerance` |
| `baseline` | no | The solution in use today: `label` and `solution` |
| `reference` | no | A known answer: optional `label`, and `objective` (a known optimum value), `solution`, or both |
| `run` | yes | `method`, `settings`, `budget` (evaluations) and `seed` (0 to 4294967295) |

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
| `partition` | `n`, `k` | k groups (some may be empty) that share the positions 0 to n - 1 | `Partition` |
| `binary_partition` | `n`, `k` | A k by n table of 0 and 1, one row per group | `BinaryPartition` |
| `fixed_sum` | `shape`, `target`, `unit` | Non-negative numbers whose total is `target` | `FixedSum(axis=None)` |
| `fixed_row_sum` | `shape`, `target`, `unit` | A table in which every row adds up to `target` (one number, or one per row) | `FixedSum(axis=1)` |
| `fixed_column_sum` | `shape`, `target`, `unit` | A table in which every column adds up to `target` (one number, or one per column) | `FixedSum(axis=0)` |

`shape` is `[]` for one number, `[n]` for a list, or `[rows, columns]` for a table. The two row and column types need a table. `lb`, `ub` are one number or one per element, in row order. One variable may use up to 100,000 values.

Positions start at 0 everywhere.

## Constraints

A constraint holds when `left op right` holds. `==` may carry a `tolerance` in the constraint's own unit: the two sides then count as equal when they differ by no more than that. Without one the tolerance is 0, which real-valued variables can rarely meet exactly.

The result of a run shows both sides of every constraint in its own unit. Internally each violation is divided by a scale that is fixed once per run (`engine/constraints.ts`), and the run records its scales.

## Provisional parts

- **`run` in the examples.** The fixed method and budget of each worked example are chosen and checked at milestone 4. The values in the files today are placeholders.
- **Data columns are decimal numbers**, so a data column cannot be used as a position (`spec/language.md`, section 8).
- **Several permutations in one variable.** ypea has a `count` option for this. The format does not offer it.
