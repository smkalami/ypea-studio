// Reads a CSV file of numbers into a data table: named columns from a file with a header
// row, or one matrix from a file without. Throws a message for the user.

import type { DataTable } from "../../engine/project.ts";

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** A name that an expression can use, made from any text: "Sensor voltage (V)" becomes "Sensor_voltage_V". */
export function tidyName(text: string): string {
  const name = text.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "data";
  return /^\d/.test(name) ? `_${name}` : name;
}

/** The lines of the file as cells. Line numbers in messages count from 1, as a text editor shows them. */
export function readCsv(text: string, header: boolean): { names?: string[]; rows: number[][] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  while (lines.length > 0 && lines.at(-1)!.trim() === "") lines.pop();
  if (lines.length === 0) throw new Error("This file is empty.");
  // a comma, or the semicolon or tab that some spreadsheets write
  // shortcut: a separator inside a quoted cell still splits it. Numbers never hold one, so only
  // a quoted column name with a comma is read wrongly. Parse quotes properly if users report it.
  const separator = lines[0].includes(",") ? "," : lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const cells = lines.map((line) => line.split(separator).map((cell) => cell.trim().replace(/^"(.*)"$/, "$1").trim()));

  let names: string[] | undefined;
  if (header) {
    names = cells[0].map(tidyName);
    if (cells[0].every((cell) => NUMBER.test(cell))) {
      throw new Error("The first line of this file holds numbers, not column names. Add a header row, or import the file as a matrix.");
    }
  }
  const body = cells.slice(header ? 1 : 0), first = header ? 2 : 1, width = cells[0].length;
  if (body.length === 0) throw new Error("This file has a header row but no rows of numbers.");
  const rows = body.map((row, r) => {
    const line = r + first;
    if (row.length === 1 && row[0] === "") throw new Error(`Line ${line} of the file is empty.`);
    if (row.length !== width) throw new Error(`Line ${line} of the file has ${row.length} values, but line 1 has ${width}.`);
    return row.map((cell, c) => {
      if (NUMBER.test(cell)) return Number(cell);
      const column = names ? `column "${names[c]}"` : `column ${c} (counting from 0)`;
      const hint = !header && line === 1 ? " If this line holds column names, import the file as a table with a header row." : "";
      throw new Error(`Line ${line} of the file, ${column}: ${cell === "" ? "the cell is empty" : `"${cell}" is not a number`}. Only numbers can be imported.${hint}`);
    });
  });
  return { names, rows };
}

/** A data table from a CSV file. The table takes its name from the file. */
export function tableFromCsv(text: string, fileName: string, header: boolean): DataTable {
  const { names, rows } = readCsv(text, header);
  const name = tidyName(fileName.replace(/\.[^.]*$/, ""));
  if (!names) return { name, kind: "matrix", values: rows };
  return { name, kind: "columns", columns: names.map((column, c) => ({ name: column, values: rows.map((row) => row[c]) })) };
}
