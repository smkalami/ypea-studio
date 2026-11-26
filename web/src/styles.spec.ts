// The design rules that a text search can hold: values come from the token file, the two
// dark blocks agree, no forbidden pattern is used, and no class is styled without being used.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { figureCss, PAINTS } from "../../export/figures/figure.ts";

const here = new URL("./", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, here), "utf8");
const SHEETS = ["styles/base.css", "styles/components.css", "styles/app.css", "styles/figures.css"];
const sources = (readdirSync(here, { recursive: true }) as string[])
  .map((name) => name.replaceAll("\\", "/"))
  .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".spec.ts"));
const scripts = sources.map(read).join("\n");
// the page itself holds the static header, and the guide is a page of static text
const code = scripts + readFileSync(new URL("../index.html", here), "utf8") + readFileSync(new URL("../guide.html", here), "utf8");
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("styles read tokens: no raw color, size, radius, duration or layer outside the token file", () => {
  for (const sheet of SHEETS) {
    // breakpoints cannot be tokens, so the conditions of media queries are left out
    const css = withoutComments(read(sheet)).replace(/@media[^{]*/g, "");
    assert.deepEqual(css.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? [], [], `${sheet}: a raw color`);
    // 1px lines are the only pixel value. Every other length is a token.
    assert.deepEqual((css.match(/\b\d*\.?\d+(px|rem|em|ms|s)\b/g) ?? []).filter((value) => value !== "1px"), [], `${sheet}: a raw length or duration`);
    assert.deepEqual(css.match(/z-index:\s*\d+/g) ?? [], [], `${sheet}: a raw layer number`);
    assert.deepEqual(css.match(/border-radius:\s*\d[^;]*/g) ?? [], [], `${sheet}: a raw radius`);
    assert.deepEqual((css.match(/box-shadow:[^;]*/g) ?? []).filter((shadow) => !/^box-shadow: (none|var\(--[a-z-]+\))$/.test(shadow)), [], `${sheet}: a raw shadow`);
  }
});

test("the two dark blocks of the token file hold the same values", () => {
  const css = read("styles/tokens.css");
  const block = (start: string) => {
    const from = css.indexOf("{", css.indexOf(start));
    return css.slice(from + 1, css.indexOf("}", from)).split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
  };
  assert.equal(block(':root:not([data-theme="light"])'), block(':root[data-theme="dark"]'));
});

test("no forbidden pattern: capitals by style, one-sided thick edges, removed outlines, system dialogs, system tooltips, arrow characters", () => {
  const css = withoutComments(SHEETS.map(read).join("\n"));
  assert.doesNotMatch(css, /text-transform:\s*uppercase/);
  assert.doesNotMatch(css, /border-(left|right|top|bottom|inline-start|inline-end|block-start|block-end):\s*([2-9]|\d\d)px/);
  assert.doesNotMatch(css, /content:\s*["'][^"']*[←-⇿■-◿✓✗]/);
  // the only place an outline is removed is the shared focus rule, which puts the halo in its place
  assert.equal((css.match(/outline:\s*(none|0)\b/g) ?? []).length, 1);
  assert.match(css, /:focus-visible\s*\{\s*outline: none;\s*border-color: var\(--focus-edge\);\s*box-shadow: var\(--focus-halo\);/);
  assert.match(css, /@media \(forced-colors: active\)\s*\{\s*:focus-visible\s*\{\s*outline:/);
  assert.doesNotMatch(code, /\b(window\.)?(alert|confirm|prompt)\(/);
  assert.doesNotMatch(scripts, /\stitle=|<title>/);
  assert.doesNotMatch(code, /[←-⇿■-◿✓✗]/);
  assert.doesNotMatch(code, /<select\b|type="number"/);
});

test("every class that the component styles name is used in the app", () => {
  const css = withoutComments(read("styles/components.css") + read("styles/app.css") + read("styles/base.css"));
  const named = new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((match) => match[1]));
  // `alert-…` and `btn-…` names are put together in code, and `in-project` is set on the body
  const unused = [...named].filter((name) => !new RegExp(`\\b${name}\\b`).test(code) && !/^alert-/.test(name));
  assert.deepEqual(unused, []);
});

test("the colors of a figure: the stylesheet holds the rules that the figures write, and the tokens hold the colors that a saved picture writes out", () => {
  // one source: the classes and their tokens come from the code that draws the figures
  assert.equal(withoutComments(read("styles/figures.css")).trim(), figureCss().trim());
  const css = read("styles/tokens.css");
  const light = css.slice(css.indexOf(":root {"), css.indexOf("@media"));
  for (const [token, value] of Object.values(PAINTS)) assert.match(light, new RegExp(`${token}: ${value};`, "i"), `${token} is ${value} in the light theme`);
  // every series has its color in the light block and in both dark blocks
  for (let n = 1; n <= 7; n++) assert.equal(css.match(new RegExp(`--series-${n}: #[0-9a-f]{6};`, "g"))?.length, 3);
});

test("every icon file is used through the icon wrapper, and its license is kept", () => {
  const files = readdirSync(new URL("icons/", here));
  assert.ok(files.includes("LICENSE"));
  const names = read("ui/Icon.tsx");
  for (const file of files.filter((name) => name.endsWith(".svg"))) {
    assert.ok(names.includes(`"${file.slice(0, -4)}"`), `${file} is not named in the icon wrapper`);
    assert.doesNotMatch(read(`icons/${file}`), /<script|\son\w+=|href=/, `${file} holds a script, a handler or a link`);
  }
});
