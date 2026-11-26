// The CSV reader. Run from web/ with `npm test`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import linefit from "../../examples/linefit.json" with { type: "json" };
import { parseProject } from "../../engine/project.ts";
import { readCsv, tableFromCsv, tidyName } from "./csv.ts";

const file = (name: string) => readFileSync(new URL(`../../examples/data/${name}`, import.meta.url), "utf8");

test("a file with a header row becomes named columns, as the example holds them", () => {
  const table = tableFromCsv(file("calibration.csv"), "calibration.csv", true);
  const expected = linefit.data[0];
  assert.deepEqual(table, { name: "calibration", kind: "columns", columns: expected.columns.map(({ name, values }) => ({ name, values })) });
});

test("a file without a header becomes a matrix", () => {
  assert.deepEqual(tableFromCsv("1,2,3\r\n4,5,6\r\n", "my costs.csv", false), { name: "my_costs", kind: "matrix", values: [[1, 2, 3], [4, 5, 6]] });
});

test("numbers in the usual forms, other separators, a byte order mark, quotes and blank last lines", () => {
  assert.deepEqual(readCsv("\uFEFFa;b\n1;-2.5\n+3e2; .5 \n\n\n", true), { names: ["a", "b"], rows: [[1, -2.5], [300, 0.5]] });
  assert.deepEqual(readCsv('"x"\t"y"\n"1"\t2\n', true), { names: ["x", "y"], rows: [[1, 2]] });
  assert.deepEqual(readCsv("7\n8", false), { names: undefined, rows: [[7], [8]] });
});

test("a bad cell is named by its line and column", () => {
  assert.throws(() => readCsv("voltage,pressure\n0.5,14.38\n0.86,high\n", true), /^Error: Line 3 of the file, column "pressure": "high" is not a number\. Only numbers can be imported\.$/);
  assert.throws(() => readCsv("a,b\n1,\n", true), /Line 2 of the file, column "b": the cell is empty/);
  assert.throws(() => readCsv("1,2\n3,x\n", false), /Line 2 of the file, column 1 \(counting from 0\): "x" is not a number/);
  // things that JavaScript would read as numbers
  for (const cell of ["Infinity", "0x10", "NaN", "1_000", "1e", "--1", "1 2"]) {
    assert.throws(() => readCsv(`a\n${cell}\n`, true), /is not a number/, cell);
  }
});

test("files of the wrong shape get a clear message", () => {
  assert.throws(() => readCsv("", true), /This file is empty/);
  assert.throws(() => readCsv("\n\n", false), /This file is empty/);
  assert.throws(() => readCsv("a,b\n", true), /no rows of numbers/);
  assert.throws(() => readCsv("a,b\n1,2\n3\n", true), /Line 3 of the file has 1 values, but line 1 has 2/);
  assert.throws(() => readCsv("a,b\n1,2\n\n3,4\n", true), /Line 3 of the file is empty/);
  assert.throws(() => readCsv("1,2\n3,4\n", true), /holds numbers, not column names/);
  assert.throws(() => readCsv("a,b\n1,2\n", false), /Line 1 of the file, column 0 \(counting from 0\): "a" is not a number.*import the file as a table with a header row/);
});

test("names from a file become names an expression can use", () => {
  assert.equal(tidyName("Sensor voltage (V)"), "Sensor_voltage_V");
  assert.equal(tidyName("2nd"), "_2nd");
  assert.equal(tidyName("%"), "data");
  // the engine accepts an imported table as it is
  const project: any = { ...linefit, data: [tableFromCsv("Sensor voltage (V),pressure\n1,2\n", "c.csv", true)], objective: { sense: "min", source: "offset" } };
  delete project.view;
  assert.equal(parseProject(project).data![0].kind, "columns");
});
