// Checks the built app in the installed Chrome: once served at the root of a site, and once
// under a subpath, as a preview build on GitHub Pages is. Run with `npm run check:browser`,
// which builds first. No browser is downloaded.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { summarize } from "../../engine/compare.ts";
import { METHODS } from "../../engine/methods/index.ts";
import { parseProject } from "../../engine/project.ts";
import { deriveSeed } from "../../engine/rng.ts";
import { APP_VERSION, runProject, testCandidate, YPEA_TESTED } from "../../engine/run.ts";
import { parseResultFile } from "../../export/data.ts";
import { breach, ruleWords } from "../../export/report.ts";
import { suggest } from "../src/suggest.ts";

const dist = new URL("../dist/", import.meta.url);
const example = async (name) => JSON.parse(await readFile(new URL(`../../examples/${name}.json`, import.meta.url), "utf8"));
const csv = (name) => fileURLToPath(new URL(`../../examples/data/${name}.csv`, import.meta.url));
const benchmark = await example("benchmark");
const linefit = await example("linefit");
const tsp = await example("tsp");
const vrp = await example("vrp");
const knapsack = await example("knapsack");
// The bundled benchmark finishes in a few milliseconds, so the cancel check needs a run that lasts.
// The engine reports progress only when the best improves. With 100 values the best keeps
// improving for millions of evaluations (with 10 it stops after 36,000, with 1000 it starts late).
const long = {
  ...benchmark,
  name: "Long benchmark",
  variables: [{ name: "x", type: "real", shape: [100], lb: -10, ub: 10 }],
  run: { ...benchmark.run, budget: 2_000_000_000 },
};
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
/** A number as the app shows it: at most six significant digits. */
const shown = (value) => String(Number(value.toPrecision(6)));

/** Serves dist/ under `prefix` only. Every other path is 404, so an absolute asset path fails. */
async function serve(prefix) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    const file = path.slice(prefix.length) || "index.html";
    try {
      if (!path.startsWith(prefix) || file.includes("..")) throw new Error("outside the site");
      const body = await readFile(new URL(file, dist));
      response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  // The server stays up until the process exits. A closed one could hand its port to the next case,
  // and a kept connection to the old server then fails.
  return { url: `http://127.0.0.1:${server.address().port}${prefix}` };
}

async function check(browser, prefix) {
  const say = (text) => console.log(`  ${text}`);
  console.log(`\nServed at ${prefix}`);
  const site = await serve(prefix);
  // a fresh context has its own empty storage
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const problems = [];
  // runs and checks use two worker files, so that the runs can be counted
  let runWorkers = 0, helpWorkers = 0;
  page.on("worker", (worker) => (/\/worker-[^/]*\.js$/.test(worker.url()) ? runWorkers++ : /\/helper-[^/]*\.js$/.test(worker.url()) ? helpWorkers++ : problems.push(`unknown worker: ${worker.url()}`)));
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("console", (message) => message.type() === "error" && problems.push(`console error: ${message.text()}`));
  page.on("requestfailed", (request) => problems.push(`request failed: ${request.url()}`));
  page.on("response", (response) => response.status() >= 400 && problems.push(`status ${response.status()}: ${response.url()}`));
  page.on("request", (request) => {
    if (!/^(data|blob):/.test(request.url()) && !request.url().startsWith(site.url)) problems.push(`request outside the site: ${request.url()}`);
  });

  // With SHOTS set to a folder, pictures of the main screens are saved there (root case only).
  const shot = async (name) => {
    if (process.env.SHOTS && prefix === "/") await page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true });
  };
  const button = (name) => page.getByRole("button", { name, exact: true });
  const heading = (name) => page.getByRole("heading", { name, exact: true });
  const field = (label, within = page) => within.getByLabel(label, { exact: true });
  const status = page.getByRole("status");
  const result = page.locator(".result");
  const projectFile = page.locator("#project-file");
  /** An entry of the sidebar. Its name starts with the label, and may go on with a count and a problem mark. */
  const side = (label) => page.locator(".sidebar").getByRole("button", { name: new RegExp(`^${label}`) });
  const saved = () => page.locator(".saving").filter({ hasText: "All changes saved" }).waitFor();
  // A choice is a button that opens a list. These three stand for picking a value, reading the choices and reading the value.
  const choose = async (box, value) => {
    await box.click();
    await page.getByRole("listbox").locator(`[data-value="${value}"]`).click();
    await page.getByRole("listbox").waitFor({ state: "detached" });
  };
  const choices = async (box) => {
    await box.click();
    const texts = await page.getByRole("option").allInnerTexts();
    await page.keyboard.press("Escape");
    await page.getByRole("listbox").waitFor({ state: "detached" });
    return texts;
  };
  const chosen = (box) => box.getAttribute("data-value");
  const dialog = page.getByRole("dialog");
  /** Waits for the end of a run. A run that ends in a message instead of a result fails here, with that message. */
  const finished = async () => {
    await page.waitForFunction(() => {
      const region = document.querySelector("[role=status]");
      return region.textContent.includes("Run finished") || region.parentElement.dataset.state === "error";
    });
    assert.match(await status.innerText(), /^Run finished\./);
  };
  const fromList = async (name) => {
    await button(`Open ${name}`).click();
    await heading(name).waitFor();
  };
  const toList = async () => {
    await button("All projects").click();
    await heading("Your projects").waitFor();
  };
  const blank = async (name) => {
    await button("New blank project").click();
    await heading("Untitled project").waitFor();
    await field("Project name").fill(name);
    await heading(name).waitFor();
  };

  // 1. The description and the Python link are in the HTML itself, before any script runs.
  const html = await (await fetch(site.url)).text();
  assert.match(html, /is a free browser app in which a researcher or practitioner/);
  assert.match(html, /<a href="https:\/\/pypi\.org\/project\/ypea\/">Use YPEA in Python<\/a>/);
  assert.match(html, /<a href="\.\/guide\.html">Guide<\/a>/);
  // the guide is static HTML too, and the build wrote the versions of the engine into it
  const guide = (await (await fetch(`${site.url}guide.html`)).text()).replace(/\s+/g, " ");
  assert.ok(guide.includes(`tested with ypea ${YPEA_TESTED},`) && guide.includes(`YPEA Studio, version ${APP_VERSION}.`), "the guide names the versions of the engine");
  assert.doesNotMatch(guide, /%[A-Z_]+%/, "no placeholder is left in the guide");
  say(`static HTML holds the description, the Guide link and the Use YPEA in Python link, and the guide names ypea ${YPEA_TESTED} and version ${APP_VERSION}`);

  // 2. A new visitor sees the examples and no project list.
  await page.goto(site.url);
  await heading("Try an example").waitFor();
  assert.equal(await heading("Your projects").count(), 0);
  await button("New blank project").waitFor();
  await shot("01-welcome");
  say("new visitor: Try an example is shown, with no project list, and a blank project can be started");
  // keyboard focus is visible: Tab reaches the skip link, the two links of the header, the choice of theme, then the first example
  for (const expected of ["Skip to the content", "Guide", "Use YPEA in Python", "", "Calibration line fit"]) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      // a card is one button whose halo is drawn around the whole card
      const element = document.activeElement, style = getComputedStyle(element.closest(".card") ?? element);
      return [element.textContent.trim(), getComputedStyle(element).outlineStyle, style.boxShadow !== "none"];
    });
    // the halo is a shadow around the focused element, with no outline
    assert.deepEqual(focused, [expected, "none", true]);
  }
  // the halo fades in, so its full size is waited for: a glow of 3px around an edge of 1px
  await page.waitForFunction(() => getComputedStyle(document.activeElement.closest(".card")).boxShadow.includes("0px 0px 0px 4px"));
  say("keyboard focus shows a halo on the links and on a button");
  // the choice of theme: one tab stop, arrow keys move, and the choice is applied to the page
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => document.activeElement.closest("label").parentElement.querySelector("legend").textContent), "Theme");
  assert.equal(await page.locator(".segmented label:has(input:focus-visible)").evaluate((label) => getComputedStyle(label).boxShadow !== "none"), true);
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "dark");
  say("theme: the arrow keys move through system, light and dark, and the page follows");

  // The guide: a second page beside the app. The link of the header opens it with the keyboard, its links are relative,
  // so it is found under a subpath too, it keeps the chosen theme, and its own link leads back to the app.
  await page.getByRole("link", { name: "Guide", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "YPEA Studio guide", level: 1 }).waitFor();
  assert.equal(new URL(page.url()).pathname, `${prefix}guide.html`);
  assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.locator(".segmented").waitFor();
  // every entry of the contents leads to a heading of the page
  const lost = await page.evaluate(() => [...document.querySelectorAll("nav a")].map((a) => a.getAttribute("href")).filter((href) => !document.querySelector(`:is(h2, h3)${href}`)));
  assert.deepEqual(lost, []);
  assert.equal(await page.getByRole("navigation", { name: "Contents" }).getByRole("link").count(), 19);
  await shot("01-guide");
  await page.getByRole("link", { name: "Open the app", exact: true }).focus();
  await page.keyboard.press("Enter");
  await heading("Try an example").waitFor();
  assert.equal(new URL(page.url()).pathname, prefix);
  say("guide: the Guide link of the header opens it with the keyboard, every entry of its contents has its heading, and Open the app leads back");

  // 3. Create the benchmark project and run it to the end, with one click on Run.
  await button("Benchmark functions").click();
  await heading("Benchmark functions").waitFor();
  await button("Run").click();
  await status.filter({ hasText: "Run finished. Best feasible solution found." }).waitFor();
  const first = await result.innerText();
  assert.match(first, /Result of "Quick run"/);
  assert.match(first, /Best feasible solution found\./);
  assert.match(first, /Objective \(minimized\)\s+[\d.e-]+/);
  assert.match(first, /Known answer: reference\s+0\s+Difference from the known answer\s+[\d.e-]+/);
  assert.match(first, /Evaluations\s+20,000 of 20,000/);
  assert.match(first, /Time\s+[\d.]+ m?s/);
  assert.match(first, /x\s+\[(-?[\d.e-]+, ){9}-?[\d.e-]+\]/);
  assert.match(first, /This is one run of a randomized solver \(Particle Swarm Optimization\) with a recorded seed \(seed 1, run 0\)/);
  const objective = first.match(/Objective \(minimized\)\s+(\S+)/)[1];
  assert.equal(Number(objective), 3.97294e-12); // the seeded run of the command line, to six digits
  // the chart of the best value has its axes named and says in words what it shows
  const chart = result.getByRole("img", { name: /^The best value went from .* after 200 evaluations to 3\.97294e-12 after 20,000\.$/ });
  assert.match(await chart.innerHTML(), />Evaluations<.*>Best value, log scale</s);
  assert.match(first, /The best value went from/);
  await button("Run again with a new seed").waitFor();
  say(`benchmark ran to the end: objective ${objective}, ${first.match(/20,000 of 20,000/)[0]} evaluations, with its chart`);

  // 4. Open a long project from disk, see live progress, and cancel.
  await toList();
  await projectFile.setInputFiles({ name: "long.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(long)) });
  await heading("Long benchmark").waitFor();
  await button("Run").click();
  const progress = page.locator(".progress span");
  await progress.waitFor();
  const before = await progress.innerText();
  assert.match(before, /of 2,000,000,000 evaluations/);
  await page.waitForFunction((text) => document.querySelector(".progress span")?.textContent !== text, before);
  const after = await progress.innerText();
  say(`live progress: "${before}" then "${after}"`);
  await button("Cancel").click();
  await status.filter({ hasText: "Run cancelled." }).waitFor();
  await button("Run").waitFor();
  await page.waitForTimeout(300); // a terminated worker posts nothing more
  assert.equal(await progress.count(), 0);
  assert.equal(await result.count(), 0);
  assert.match(await status.innerText(), /Run cancelled\./);
  say("cancelled: the run stopped and left no result");

  // 5. A file that is not a project shows the message of parseProject and adds nothing.
  await toList();
  await projectFile.setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...benchmark, version: 7 })) });
  const alert = page.getByRole("alert");
  await alert.waitFor();
  assert.match(await alert.innerText(), /Project file: version 7 is not supported/);
  say(`bad file: "${await alert.innerText()}"`);

  // 6. An example with data, a baseline and a known answer runs, and reports against both.
  await button("Calibration line fit").click();
  await heading("Calibration line fit").waitFor();
  await button("Run").click();
  await finished();
  const fit = await result.innerText();
  assert.match(fit, /Best feasible solution found/);
  assert.match(fit, /In use today: Current settings/);
  assert.match(fit, /Known answer: Least-squares line/);
  await result.getByRole("img", { name: /^12 data points of pressure \(kPa\) against voltage \(V\), with the fitted line\. The line is at most [\d.]+ kPa away from a point\. The residuals \(data minus line\) lie between -?[\d.]+ and -?[\d.]+ kPa\.$/ }).waitFor();
  await shot("02-linefit-result");
  say("line fit: ran to the end, is compared with the current settings and the least-squares line, and draws the fitted line");

  // 7. Duplicate, rename, download and delete, from the list.
  await toList();
  await button("Duplicate Benchmark functions").click();
  await button("Rename Benchmark functions copy").waitFor();
  // rename asks in a dialog of the app: Escape leaves the name alone and gives the focus back
  await button("Rename Benchmark functions copy").click();
  await dialog.getByRole("heading", { name: "Rename the project" }).waitFor();
  assert.equal(await field("Project name", dialog).inputValue(), "Benchmark functions copy");
  assert.equal(await page.evaluate(() => document.activeElement.tagName), "INPUT");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Rename Benchmark functions copy");
  await button("Rename Benchmark functions copy").click();
  // an empty name is refused next to the field, and the dialog stays open
  await field("Project name", dialog).fill("  ");
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await dialog.locator(".problems").filter({ hasText: "Problem: Type a name." }).waitFor();
  await field("Project name", dialog).fill("Renamed copy");
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await button("Download Renamed copy").waitFor();
  const read = async (download) => JSON.parse(await readFile(await download.path(), "utf8"));
  let [download] = await Promise.all([page.waitForEvent("download"), button("Download Renamed copy").click()]);
  assert.equal(download.suggestedFilename(), "Renamed-copy.json");
  assert.deepEqual(await read(download), { ...benchmark, name: "Renamed copy" });
  // delete asks first, with the focus on Cancel. Cancel keeps the project.
  await button("Delete Renamed copy").click();
  await dialog.getByText('"Renamed copy" and its results will be deleted. This cannot be undone.').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Cancel");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "detached" });
  await button("Delete Renamed copy").click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await button("Delete Renamed copy").waitFor({ state: "detached" });
  [download] = await Promise.all([page.waitForEvent("download"), button("Download all projects").click()]);
  const names = (await read(download)).projects.map((p) => p.name).sort();
  assert.deepEqual(names, ["Benchmark functions", "Calibration line fit", "Long benchmark"]);
  say(`duplicate, rename, download and delete work. Download all projects holds: ${names.join(", ")}`);

  // The route example draws its round trip in the result, and redraws it while a run improves it.
  await button("Traveling salesman").click();
  await heading("Traveling salesman").waitFor();
  await button("Run").click();
  await finished();
  await result.getByRole("img", { name: /^Round trip through 30 points, in this order: (\d+, ){30}and back to \d+\.$/ }).waitFor();
  assert.match(await result.innerText(), /In use today: Nearest-neighbor tour\s+[\d.]+ km/);
  await toList();
  await projectFile.setInputFiles({ name: "route.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...tsp, name: "Long route", run: { ...tsp.run, budget: 2_000_000_000 } })) });
  await heading("Long route").waitFor();
  await button("Run").click();
  const live = page.locator(".live").getByRole("img", { name: /^Round trip through 30 points/ });
  await live.waitFor();
  const route = await live.getAttribute("aria-label");
  await page.waitForFunction((label) => document.querySelector(".live svg")?.getAttribute("aria-label") !== label, route);
  await button("Cancel").click();
  await status.filter({ hasText: "Run cancelled." }).waitFor();
  say("route: the result draws the round trip, and the drawing changes while a run improves it");
  await toList();

  // The vehicle routing example: several routes from one depot, with a capacity limit in kg.
  await button("Vehicle routing").click();
  await heading("Vehicle routing").waitFor();
  await button("Run").click();
  await finished();
  const routed = await result.innerText();
  const expected = runProject(parseProject(vrp));
  assert.match(routed, /Best feasible solution found\./);
  assert.ok(routed.includes(`Objective (minimized)\n${shown(expected.best.objective)} km`));
  assert.ok(routed.includes(`In use today: Nearest customer that still fits, one vehicle after another\n${shown(expected.baseline.objective)} km`));
  assert.match(routed, /Difference from what is in use today\s+-[\d.]+ km \([\d.]+% lower\), which is better/);
  const load = routed.match(/Heaviest load\s+(\d+) kg\s+at most 60 kg\s+Yes/)[1];
  assert.equal(Number(load), expected.best.constraints[0].left);
  // every route that is used has its own solid color, its name beside its line, and a legend entry with its stops and its length
  const drawnRoutes = /^(\d) routes from the depot and back\.( Route \d: \d+ stops?, [\d.]+ km, in this order: [\d, ]+\.)+$/;
  const picture = result.getByRole("img", { name: drawnRoutes });
  await picture.waitFor();
  const used = Number((await picture.getAttribute("aria-label")).match(drawnRoutes)[1]);
  const drawnLines = (kind) => picture.locator(`${kind}[data-series]`).evaluateAll((lines) => lines.map((line) => `${getComputedStyle(line).stroke} ${line.getAttribute("stroke-dasharray") ?? "solid"}`));
  // each route is drawn twice with the same color: once on the map, and once in the legend
  const lines = await drawnLines("path");
  assert.equal(lines.length, used);
  assert.equal(new Set(lines).size, used);
  assert.ok(lines.every((line) => line.endsWith(" solid")), "with few routes no line is dashed");
  assert.deepEqual(await drawnLines("line"), lines);
  assert.equal(await picture.locator("text[data-series]").filter({ hasText: /^Route \d$/ }).count(), used);
  const legend = await picture.locator("text[data-series]").filter({ hasText: /^Route \d: \d+ stops?, [\d.]+ km$/ }).allTextContents();
  assert.equal(legend.length, used);
  // the lengths of the legend are read from the table of distances, so together they are the objective
  const legendTotal = legend.reduce((sum, text) => sum + Number(text.match(/, ([\d.]+) km$/)[1]), 0);
  assert.ok(Math.abs(legendTotal - expected.best.objective) < 0.05 * used, `the legend adds up to ${legendTotal} km, the objective is ${expected.best.objective} km`);
  assert.match(await result.locator("figcaption").first().innerText(), /^Each line is one route: it leaves the depot \(the square\), visits its stops in order and returns\. A route has its own color and, beside its line, its name in bold\./);
  await shot("09-vehicle-routing-result");
  await toList();
  await projectFile.setInputFiles({ name: "routes.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...vrp, name: "Long routes", run: { ...vrp.run, budget: 2_000_000_000 } })) });
  await heading("Long routes").waitFor();
  await button("Run").click();
  const liveRoutes = page.locator(".live").getByRole("img", { name: /routes? from the depot and back\./ });
  await liveRoutes.waitFor();
  const plan = await liveRoutes.getAttribute("aria-label");
  await page.waitForFunction((label) => document.querySelector(".live svg")?.getAttribute("aria-label") !== label, plan);
  await button("Cancel").click();
  await status.filter({ hasText: "Run cancelled." }).waitFor();
  say(`vehicle routing: ${shown(expected.best.objective)} km against ${shown(expected.baseline.objective)} km in use today, the heaviest load is ${load} kg of at most 60 kg, ${used} routes are drawn in ${used} colors with legend lengths that add up to ${shown(legendTotal)} km, and the drawing changes while a run improves it`);
  await toList();

  // 8. The line fit, built from a blank project with its own CSV.
  await button("New blank project").click();
  await heading("Untitled project").waitFor();
  await field("Project name").fill("My line fit");
  await heading("My line fit").waitFor();
  // a blank project cannot run yet, and says what to do next, where it belongs
  await side("Variables").getByRole("img", { name: "has a problem" }).waitFor();
  await side("Data").click();
  await page.locator("#csv-table").setInputFiles(csv("calibration"));
  await field("Table name").waitFor();
  assert.equal(await field("Table name").inputValue(), "calibration");
  assert.deepEqual([await field("Name of column 0").inputValue(), await field("Name of column 1").inputValue()], ["voltage", "pressure"]);
  assert.match(await page.locator("table.preview").innerText(), /12 rows\. The first 5 are shown\. Positions start at 0\.\s+Position\s+voltage\s+pressure\s+0\s+0\.5\s+14\.38/);
  await field("Unit of column 0").fill("V");
  await field("Unit of column 1").fill("kPa");
  // a file that is not all numbers names the line and the column of the bad cell
  await page.locator("#csv-table").setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2\n3,oops\n") });
  await alert.waitFor();
  assert.equal(await alert.innerText(), 'bad.csv was not imported. Line 3 of the file, column "b": "oops" is not a number. Only numbers can be imported.');
  say(`CSV import: calibration.csv gives the table "calibration" with voltage and pressure. A bad file says: "${await alert.innerText()}"`);

  await side("Variables").click();
  const card = (n) => page.locator("fieldset.item").nth(n);
  for (const [n, name, low, high, unit] of [[0, "offset", "-10", "10", "kPa"], [1, "gain", "0", "100", "kPa/V"]]) {
    await button("Add a variable").click();
    await field("Name", card(n)).fill(name);
    await field("Lowest value", card(n)).fill(low);
    await field("Highest value", card(n)).fill(high);
    await field("Unit", card(n)).fill(unit);
  }
  assert.equal((await choices(field("What it holds", card(0)))).length, 11);
  // a name that the engine refuses shows the engine's message next to the name
  await field("Name", card(1)).fill("voltage");
  await card(1).locator(".problems").filter({ hasText: 'Problem: the name "voltage" is used twice' }).waitFor();
  assert.equal(await field("Name", card(1)).getAttribute("aria-invalid"), "true");
  await field("Name", card(1)).fill("gain");
  await card(1).locator(".problems").waitFor({ state: "detached" });
  await shot("03-variables");
  say("variables: offset and gain added with limits and units. A name used twice shows the engine's message at the name");

  await side("Objective").click();
  await field("Unit").fill("kPa^2");
  await page.getByText("Write the expression from a preset").click();
  await choose(field("Preset"), "squared-error");
  // the preset offers the names that exist, and starts each need on a name of its own
  assert.deepEqual(await choices(field("Measured values (data column)")), ["voltage", "pressure"]);
  assert.deepEqual(await choices(field("Gain variable")), ["offset", "gain"]);
  assert.deepEqual([await chosen(field("Offset variable")), await chosen(field("Gain variable"))], ["offset", "gain"]);
  await choose(field("Measured values (data column)"), "pressure");
  // a choice works from the keyboard too: the arrow keys move in the open list and Enter picks
  await field("Input values (data column)").focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("listbox").waitFor();
  await page.keyboard.press("End");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  assert.equal(await chosen(field("Input values (data column)")), "voltage");
  await button("Write the expression").click();
  const squared = "sum((pressure - (offset + gain * voltage)) ** 2)";
  assert.equal(await field("Expression").inputValue(), squared);
  await page.locator(".ok").filter({ hasText: "Checked: this gives one number." }).waitFor();
  say(`objective: the squared error preset wrote "${squared}", and the check accepts it`);

  // text outside the language shows its problem next to the field, with the line, and marks the part
  await field("Expression").fill("sum((pressure - offset)\n  ** )");
  const objectiveProblems = page.locator(".field", { has: field("Expression") }).locator(".problems");
  await objectiveProblems.waitFor();
  const languageError = await objectiveProblems.innerText();
  assert.match(languageError, /^Problem on line 2, column \d+: \S/);
  assert.equal(await field("Expression").getAttribute("aria-invalid"), "true");
  assert.ok((await field("Expression").getAttribute("aria-describedby")).split(" ").includes(await objectiveProblems.getAttribute("id")));
  await shot("04-objective-error");
  await side("Objective").getByRole("img", { name: "has a problem" }).waitFor();
  // a run is refused with the same message while the problem is there, and no worker starts
  const runsBefore = runWorkers;
  await button("Run").click();
  await status.filter({ hasText: "This project cannot run yet." }).waitFor();
  assert.equal(runWorkers, runsBefore);
  await field("Expression").fill(squared);
  await objectiveProblems.waitFor({ state: "detached" });
  await side("Objective").getByRole("img", { name: "has a problem" }).waitFor({ state: "detached" });
  say(`language error next to the objective field: "${languageError}"`);

  await side("Drawing").click();
  await choose(field("What to draw"), "line");
  await choose(field("Column along the bottom (x)"), "voltage");
  await choose(field("Column up the side (y)"), "pressure");
  await field("Expression of the line").fill("offset + gain * voltage");

  // test a candidate by hand: the current settings of the example
  await side("Test a candidate").click();
  await field("offset (kPa)").fill("0");
  await field("gain (kPa/V)").fill("24");
  await button("Test this candidate").click();
  const tested = page.locator(".tested");
  await tested.waitFor();
  const byHand = shown(testCandidate(parseProject(linefit), { offset: 0, gain: 24 }).objective);
  assert.match(await tested.innerText(), new RegExp(`Objective \\(to minimize\\)\\s+${byHand.replace(".", "\\.")} kPa\\^2\\s`));
  await tested.getByRole("img", { name: /^12 data points of pressure/ }).waitFor();
  // a candidate outside the limits is refused with the engine's message
  await field("gain (kPa/V)").fill("500");
  await button("Test this candidate").click();
  await alert.filter({ hasText: 'Problem: "gain" must be from 0 to 100, got 500' }).waitFor();
  await field("gain (kPa/V)").fill("24");
  await field("Name of the baseline").fill("Current settings");
  await button("Store this candidate as the baseline").click();
  await page.getByText("Stored: Current settings, offset = 0, gain = 24.").waitFor();
  await shot("05-candidate");
  say(`candidate by hand (offset 0, gain 24): objective ${byHand} kPa^2, as the engine gives. Stored as the baseline`);

  await button("Run").click();
  await finished();
  const mine = await result.innerText();
  assert.match(mine, /In use today: Current settings\s+[\d.]+ kPa\^2\s+Difference from what is in use today\s+-[\d.]+ kPa\^2 \([\d.]+% lower\), which is better/);
  assert.ok(mine.includes(`In use today: Current settings\n${byHand} kPa^2`));
  assert.match(mine, /offset\s+-?[\d.]+\s+kPa\s+gain\s+[\d.]+\s+kPa\/V/);
  await result.getByRole("img", { name: /^12 data points of pressure/ }).waitFor();
  const versus = mine.match(/Difference from what is in use today\s+(.*)/)[1];
  await saved();
  say(`my line fit ran: against the baseline the result is ${versus}`);

  // 9. The knapsack, built from a blank project: a yes or no variable, two presets and two experiments.
  await toList();
  await blank("My knapsack");
  await side("Data").click();
  await page.locator("#csv-table").setInputFiles(csv("items"));
  await field("Unit of column 0").fill("kg");
  await field("Unit of column 1").fill("$");
  await side("Variables").click();
  await button("Add a variable").click();
  await field("Name", card(0)).fill("take");
  await choose(field("What it holds", card(0)), "binary");
  await choose(field("Shape", card(0)), "1");
  await field("Number of values", card(0)).fill("20");
  await side("Objective").click();
  await choose(field("Goal"), "max");
  await field("Unit").fill("$");
  await page.getByText("Write the expression from a preset").click();
  await choose(field("Preset"), "selected-total");
  await choose(field("Value of each item (data column)"), "value");
  await button("Write the expression").click();
  assert.equal(await field("Expression").inputValue(), "sum(value * take)");
  await side("Constraints").click();
  await page.getByText("Add a constraint from a preset").click();
  assert.deepEqual(await choices(field("Preset")), ["Capacity limit", "Largest load of a group at most a limit"]);
  await choose(field("Size of each item (data column)"), "weight");
  await field("Limit").fill("50");
  await button("Add the constraint").click();
  assert.deepEqual(
    [await field("Name", card(0)).inputValue(), await field("Left side").inputValue(), await chosen(field("Comparison")), await field("Right side").inputValue(), await field("Unit", card(0)).inputValue()],
    ["Total weight", "sum(weight * take)", "<=", "50", "kg"],
  );
  await side("Drawing").click();
  await choose(field("What to draw"), "selection");
  assert.equal(await chosen(field("Yes or no variable")), "take");
  await choose(field("Column for the size of each item"), "weight");
  // check boxes that were never touched are zeros: nothing taken, then item 4 alone (2 kg, 86 $)
  await side("Test a candidate").click();
  assert.equal(await page.locator("fieldset.checks input").count(), 20);
  await button("Test this candidate").click();
  await tested.filter({ hasText: /Objective \(to maximize\)\s*0 \$/ }).waitFor();
  await page.locator("fieldset.checks").getByLabel("4", { exact: true }).check();
  await button("Test this candidate").click();
  await tested.filter({ hasText: /Objective \(to maximize\)\s*86 \$.*Total weight\s*2 kg\s*at most 50 kg\s*Yes/ }).waitFor();
  say('knapsack: the presets wrote "sum(value * take)" and the constraint "Total weight": sum(weight * take) <= 50 kg');

  // the first experiment is the suggestion for yes or no values, which was designed for them, so there is no note
  await side("Quick run").click();
  const note = page.getByRole("note");
  assert.equal(await page.locator(".suggested").innerText(), `${METHODS.ga.name} is suggested for this project because it holds yes or no values or whole numbers. You can change it.`);
  assert.equal(await note.count(), 0);
  // a solver that was designed for other values, picked by hand: a calm note, not a warning and not a block, and no longer a suggestion
  await choose(field("Solver"), "pso");
  await page.locator(".suggested").waitFor({ state: "detached" });
  assert.equal(
    (await note.innerText()).replace(/\s+/g, " "),
    "Note: Particle Swarm Optimization was designed for decimal numbers. This project has yes or no values, and the solver may still work well on them. " +
    "Solvers designed for every kind of value in this project: Random Search, Genetic Algorithm, Simulated Annealing.",
  );
  assert.equal(await note.getAttribute("class"), "alert alert-neutral ");
  await field("Name of the experiment").fill("PSO quick run");
  // a second experiment, as a copy with another solver and one of its settings changed
  await button("New experiment").click();
  await field("Name of the experiment").fill("GA run");
  await choose(field("Solver"), "ga");
  await note.waitFor({ state: "detached" });
  await page.getByText("Settings of Genetic Algorithm").click();
  // a setting whose own name says little has readable words on screen, and the project keeps the names of the file
  assert.deepEqual(await choices(field("Work on")), ["Codes between 0 and 1", "The values themselves"]);
  await page.getByText("Working on the values themselves changes orderings, selections and yes or no values directly, which suits routes and assignments.").waitFor();
  assert.equal(await page.getByLabel("space", { exact: true }).count(), 0);
  await choose(field("Work on"), "native");
  assert.equal(await chosen(field("Work on")), "native");
  await saved();
  [download] = await Promise.all([page.waitForEvent("download"), button("Download project").click()]);
  assert.deepEqual((await read(download)).experiments[0].settings, { space: "native" });
  await button("Reset to the defaults of the solver").click();
  assert.equal(await chosen(field("Work on")), "encoded");
  // an empty setting is refused by the engine, with its message at that setting
  await field("pop_size").fill("");
  const settingProblems = page.locator(".field", { has: field("pop_size") }).locator(".problems");
  await settingProblems.filter({ hasText: 'Problem: Genetic Algorithm: "pop_size" must be a whole number from 1 to 1000000' }).waitFor();
  assert.equal(await field("pop_size").getAttribute("aria-invalid"), "true");
  await field("Budget (evaluations)").fill("0.5");
  await page.locator(".field", { has: field("Budget (evaluations)") }).locator(".problems").filter({ hasText: "must be a positive whole number of evaluations" }).waitFor();
  await field("Budget (evaluations)").fill("20000");
  await field("pop_size").fill("50");
  await settingProblems.waitFor({ state: "detached" });
  assert.equal(await page.locator(".sidebar ul").nth(2).getByRole("button").count(), 3);
  assert.match(await page.locator(".output .empty").innerText(), /"GA run" has no result yet/);
  // an experiment asks before it is deleted, and Cancel keeps it
  await button("Delete").click();
  await dialog.getByText('"GA run" and its result will be deleted. This cannot be undone.').waitFor();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(await page.locator(".sidebar ul").nth(2).getByRole("button").count(), 3);

  await side("PSO quick run").click();
  await button("Run").click();
  await finished();
  const pso = await result.innerText();
  assert.match(pso, /Result of "PSO quick run"/);
  assert.match(pso, /Total weight\s+\d+ kg\s+at most 50 kg\s+(Yes|No, broken)/);
  assert.match(pso, /randomized solver \(Particle Swarm Optimization\)/);
  await result.getByRole("img", { name: /^\d+ of 20 items are chosen: positions [\d, ]+\.$/ }).waitFor();
  await side("GA run").click();
  await button("Run").click();
  await status.filter({ hasText: "Run finished. Best feasible solution found." }).waitFor();
  const ga = await result.innerText();
  assert.match(ga, /Result of "GA run"/);
  assert.match(ga, /randomized solver \(Genetic Algorithm\) with a recorded seed \(seed 1, run 0\)/);
  const weight = ga.match(/Total weight\s+(\d+ kg)\s+at most 50 kg\s+Yes/)[1];
  assert.ok(Number.parseInt(weight) <= 50 && Number.parseInt(weight) > 30);
  const value = ga.match(/Objective \(maximized\)\s+(\d+ \$)/)[1];
  // each experiment keeps its own result
  await side("PSO quick run").click();
  assert.equal(await result.innerText(), pso);
  await shot("06-knapsack-experiments");
  say(`knapsack ran twice. GA run: ${value} with total weight ${weight} of at most 50 kg. PSO quick run keeps its own result, with the note that the solver was designed for other values and may still work well`);

  // Run again with a new seed belongs to the experiment: it moves the seed and replaces that result only
  await side("GA run").click();
  await button("Run again with a new seed").click();
  await status.filter({ hasText: "Run finished." }).waitFor();
  const again2 = await result.innerText();
  assert.match(again2, /randomized solver \(Genetic Algorithm\) with a recorded seed \(seed 2, run 0\)/);
  assert.equal(await field("Seed").inputValue(), "2");
  assert.equal((await result.innerText()).includes("has changed since this run"), false);
  // an edit after the run is said next to the result, and the result stays as it was
  await field("Budget (evaluations)").fill("30000");
  await result.getByText("has changed since this run").waitFor();
  assert.match(await result.innerText(), /Evaluations\s+20,000 of 20,000/);
  await field("Budget (evaluations)").fill("20000");
  await result.getByText("has changed since this run").waitFor({ state: "detached" });
  await saved();
  await shot("07-ga-result");
  say("run again with a new seed: the GA run now has seed 2. An edit after a run is noted next to the result");

  // Vehicle routing, built from a blank project: ordered groups, and the two presets that write helper functions.
  await toList();
  await blank("My routes");
  await side("Data").click();
  await page.locator("#csv-table").setInputFiles(csv("nodes"));
  await field("Unit of column 0", card(0)).fill("km");
  await field("Unit of column 1", card(0)).fill("km");
  await page.locator("#csv-table").setInputFiles(csv("customers"));
  await field("Unit of column 0", card(1)).fill("kg");
  await page.locator("#csv-matrix").setInputFiles(csv("distance"));
  await page.getByText("A matrix of 16 rows and 16 columns.").waitFor();
  await side("Variables").click();
  await button("Add a variable").click();
  await field("Name", card(0)).fill("routes");
  const kinds = await choices(field("What it holds", card(0)));
  assert.ok(kinds.includes("Ordered groups (n items in k groups)") && kinds.includes("Groups without order (n items in k groups), as a table of 0 and 1"));
  await choose(field("What it holds", card(0)), "partition");
  await card(0).getByText("For the routes of several vehicles or the jobs on several machines. An ordering of all items is cut into groups by separators, and the order inside a group counts.").waitFor();
  await field("Number of items (n)", card(0)).fill("15");
  await field("Number of groups (k)", card(0)).fill("4");
  await shot("10-ordered-groups-variable");
  await side("Objective").click();
  await field("Unit").fill("km");
  await page.getByText("Write the expression from a preset").click();
  await choose(field("Preset"), "routes-length");
  assert.deepEqual([await chosen(field("Ordered groups variable")), await chosen(field("Distance table (matrix)")), await field("Row of the depot").inputValue()], ["routes", "distance", "0"]);
  // a row that the table does not have is refused, and nothing is written
  await field("Row of the depot").fill("16");
  await button("Write the expression").click();
  await alert.filter({ hasText: "The row of the depot must be a whole number from 0 to 15." }).waitFor();
  assert.equal(await field("Expression").inputValue(), "");
  await field("Row of the depot").fill("0");
  await button("Write the expression").click();
  assert.equal(await field("Expression").inputValue(), "total_length(routes)");
  await page.getByText("Added to Functions: route_length, total_length.", { exact: true }).waitFor();
  await page.locator(".ok").filter({ hasText: "Checked: this gives one number." }).waitFor();
  await shot("11-routes-preset");
  // the functions are ordinary text. One is changed by hand, and the preset then leaves it alone
  await side("Functions").click();
  const helpers = vrp.functions.slice(0, vrp.functions.indexOf("def heaviest_load")).trimEnd() + "\n";
  assert.equal(await field("Function definitions").inputValue(), helpers);
  const own = helpers.replace("total += route_length(g)", "total += 2 * route_length(g)");
  await field("Function definitions").fill(own);
  await side("Objective").click();
  await page.getByText("Write the expression from a preset").click();
  await choose(field("Preset"), "routes-length");
  await button("Write the expression").click();
  await page.getByText("Functions already has route_length, total_length, which were kept as they are. Check that they do what this preset expects.", { exact: true }).waitFor();
  await side("Functions").click();
  assert.equal(await field("Function definitions").inputValue(), own);
  await field("Function definitions").fill(helpers);
  await side("Constraints").click();
  await page.getByText("Add a constraint from a preset").click();
  await choose(field("Preset"), "largest-load");
  assert.deepEqual([await chosen(field("Ordered groups variable")), await chosen(field("Load of each item (data column)"))], ["routes", "x"]);
  await choose(field("Load of each item (data column)"), "demand");
  await field("Limit").fill("60");
  await button("Add the constraint").click();
  await page.getByText("Added to Functions: heaviest_load.", { exact: true }).waitFor();
  assert.deepEqual(
    [await field("Name", card(0)).inputValue(), await field("Left side").inputValue(), await chosen(field("Comparison")), await field("Right side").inputValue(), await field("Unit", card(0)).inputValue()],
    ["Largest load", "heaviest_load(routes)", "<=", "60", "kg"],
  );
  await side("Functions").click();
  // the text the presets wrote is the text of the worked example
  assert.equal(await field("Function definitions").inputValue(), vrp.functions);
  await side("Drawing").click();
  assert.ok((await choices(field("What to draw"))).includes("Several routes from one depot"));
  await choose(field("What to draw"), "routes");
  assert.deepEqual(
    [await chosen(field("Ordered groups variable")), await chosen(field("Column with the x position")), await chosen(field("Column with the y position")), await field("Row of the depot").inputValue()],
    ["routes", "x", "y", "0"],
  );
  // a row that the columns do not have shows the engine's message
  await field("Row of the depot").fill("16");
  await page.locator(".problems").filter({ hasText: '"view.depot" must be the row of the depot, a whole number from 0 to 15' }).waitFor();
  await field("Row of the depot").fill("0");
  await page.locator(".problems").waitFor({ state: "detached" });
  await shot("12-routes-drawing-form");
  // the plan of the example, typed by hand, gives the value the engine gives
  await side("Test a candidate").click();
  await page.getByLabel(/^routes/).fill(vrp.baseline.solution.routes.map((group) => group.join(", ")).join("\n"));
  await button("Test this candidate").click();
  await tested.filter({ hasText: new RegExp(`Objective \\(to minimize\\)\\s*${shown(expected.baseline.objective).replace(".", "\\.")} km`) }).waitFor();
  // ---- figures, start: the optional table of distances of a drawing
  // Without a table the drawing names the stops of each route and gives no length, which could disagree with the result.
  await tested.getByRole("img", { name: /^\d routes from the depot and back\.( Route \d: \d+ stops?, in this order: [\d, ]+\.)+$/ }).waitFor();
  assert.equal(await tested.locator("svg text").filter({ hasText: / km$/ }).count(), 1, "only the bar of the scale has a unit");
  await side("Drawing").click();
  assert.equal(await chosen(field("Table of distances")), "");
  assert.deepEqual(await choices(field("Table of distances")), ["None, show no length", "distance"]);
  await choose(field("Table of distances"), "distance");
  await page.locator(".problems").waitFor({ state: "detached" });
  // with the table, the candidate is drawn with the length of each route. This table was imported without a unit, so the number is named as a length.
  const drawnLengths = /^\d routes from the depot and back\.( Route \d: \d+ stops?, length [\d.]+, in this order: [\d, ]+\.)+$/;
  await side("Test a candidate").click();
  await button("Test this candidate").click();
  await tested.getByRole("img", { name: drawnLengths }).waitFor();
  // ---- figures, end
  // the solver suggested for a blank project with ordered groups, with the same definition as the example, gives the same routes as the engine
  await button("Run").click();
  await finished();
  const mineRouted = await result.innerText();
  const forGroups = suggest(vrp.variables);
  assert.equal(forGroups.method, "sa");
  assert.match(mineRouted, new RegExp(`randomized solver \\(${METHODS.sa.name}\\)`));
  const byEngine = runProject(parseProject({ ...vrp, run: { method: forGroups.method, settings: forGroups.settings, budget: forGroups.budget, seed: 1 } }));
  assert.ok(mineRouted.includes(`Objective (minimized)\n${shown(byEngine.best.objective)} km`));
  assert.match(mineRouted, /Largest load\s+\d+ kg\s+at most 60 kg\s+Yes/);
  await result.getByRole("img", { name: drawnLengths }).waitFor();

  // a new name for a matrix, typed key by key: the function that uses the table by its name can follow
  await side("Data").click();
  await field("Table name", card(2)).click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("dist", { delay: 30 });
  const tableOffer = card(2).locator(".field", { has: field("Table name") }).locator(".hint");
  assert.equal((await tableOffer.innerText()).replace(/\s+/g, " "), "2 places still use the old name distance. Rename there too");
  await button("Rename there too").click();
  await side("Functions").click();
  assert.equal(await field("Function definitions").inputValue(), vrp.functions.replaceAll("distance[", "dist["));
  await side("Functions").getByRole("img", { name: "has a problem" }).waitFor({ state: "detached" });
  await side("Objective").click();
  await page.locator(".ok").filter({ hasText: "Checked: this gives one number." }).waitFor();
  await saved();
  say(`ordered groups from a blank project: the presets wrote "total_length(routes)", the constraint "Largest load": heaviest_load(routes) <= 60 kg, and the three helper functions of the example. A function changed by hand was kept. The run gives ${shown(byEngine.best.objective)} km, as the engine does`);

  // Editing: the suggested solver, Undo, names that are used, and the way back from a run.
  await toList();
  await blank("My edits");
  const suggestion = page.locator(".suggested");
  const setup = page.locator(".runbar .setup");
  const undoButton = page.locator(".run-status").getByRole("button", { name: "Undo", exact: true });
  const redoButton = page.locator(".run-status").getByRole("button", { name: "Redo", exact: true });
  const items = page.locator("fieldset.item");
  const solverOf = (id) => METHODS[id].name;
  // a blank project: its experiment is a suggestion, and says so in plain words, not as a warning
  await side("Quick run").click();
  assert.equal(await suggestion.innerText(), `${solverOf("cmaes")} is suggested for this project as a start, and the suggestion will follow the variables you add. You can change it.`);
  assert.equal(await suggestion.getAttribute("class"), "hint suggested");
  assert.equal(await page.locator(".alert").count(), 0);
  await side("Data").click();
  await page.locator("#csv-table").setInputFiles(csv("items"));
  await side("Variables").click();
  await button("Add a variable").click();
  await side("Quick run").click();
  assert.equal(await suggestion.innerText(), `${solverOf("cmaes")} is suggested for this project because it holds only decimal numbers. You can change it.`);
  assert.equal(await chosen(field("Solver")), "cmaes");
  assert.equal(await field("Budget (evaluations)").inputValue(), "20000");
  // an ordering is added: the suggestion changes, and the status line says so where the variables are edited
  await side("Variables").click();
  await button("Add a variable").click();
  await choose(field("What it holds", card(1)), "permutation");
  await status.filter({ hasText: `The suggested solver of "Quick run" is now ${solverOf("ga")}.` }).waitFor();
  assert.equal(await status.getAttribute("aria-live"), "polite");
  assert.match(await setup.innerText(), new RegExp(`^Quick run: ${solverOf("ga")}, 20,000 evaluations, seed 1$`));
  await choose(field("What it holds", card(0)), "selection");
  await status.filter({ hasText: `The suggested solver of "Quick run" is now ${solverOf("sa")}.` }).waitFor();
  await side("Quick run").click();
  assert.equal(await suggestion.innerText(), `${solverOf("sa")} is suggested for this project because its variables are orderings, selections or groups. You can change it.`);
  await saved();
  [download] = await Promise.all([page.waitForEvent("download"), button("Download project").click()]);
  const suggestedFor = suggest([{ type: "selection" }, { type: "permutation" }]);
  assert.deepEqual((await read(download)).run, { method: suggestedFor.method, settings: suggestedFor.settings, budget: 20000, seed: 1, name: "Quick run" });
  await side("Variables").click();
  await choose(field("What it holds", card(0)), "real");
  await status.filter({ hasText: `The suggested solver of "Quick run" is now ${solverOf("ga")}.` }).waitFor();
  say(`suggested solver: a blank project starts with ${solverOf("cmaes")}, an ordering beside decimal numbers gives ${solverOf("ga")} on the values themselves, orderings alone give ${solverOf("sa")}, each said in the status line and on the experiment`);

  // Remove a variable that nothing uses: it goes at once, and comes back with the button and with the keyboard.
  await button("Remove variable x2").click();
  assert.equal(await dialog.count(), 0);
  await status.filter({ hasText: `The variable x2 was removed. The suggested solver of "Quick run" is now ${solverOf("cmaes")}.` }).waitFor();
  assert.equal(await items.count(), 1);
  // the Remove button that took its place has the focus, and the message covers no control: it is the status line of the run bar
  await page.waitForFunction(() => document.activeElement.getAttribute("aria-label") === "Remove variable x");
  assert.equal(await undoButton.evaluate((b) => b.closest(".runbar") !== null && b.closest("[role=status]") === null), true);
  await undoButton.click();
  await status.filter({ hasText: "The last change was undone." }).waitFor();
  assert.equal(await items.count(), 2);
  assert.equal(await chosen(field("What it holds", card(1))), "permutation");
  assert.match(await setup.innerText(), new RegExp(`^Quick run: ${solverOf("ga")},`));
  // the same button now offers the other way, and still has the focus
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Redo");
  await redoButton.click();
  await status.filter({ hasText: "The change was made again." }).waitFor();
  assert.equal(await items.count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Undo");
  // the keyboard: Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z, while the focus is not in a text field
  await page.keyboard.press("Control+z");
  await items.nth(1).waitFor();
  await page.keyboard.press("Control+y");
  await items.nth(1).waitFor({ state: "detached" });
  await page.keyboard.press("Control+z");
  await items.nth(1).waitFor();
  await page.keyboard.press("Control+Shift+z");
  await items.nth(1).waitFor({ state: "detached" });
  await page.keyboard.press("Meta+z");
  await items.nth(1).waitFor();
  // Typing in one field is one step. Inside the field the keys belong to the browser, which undoes the typing and no step of the project.
  await field("Unit", card(0)).click();
  await page.keyboard.type("kilogram", { delay: 20 });
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(200);
  assert.equal(await items.count(), 2);
  const afterBrowserUndo = await field("Unit", card(0)).inputValue();
  assert.notEqual(afterBrowserUndo, "kilogram");
  // what the field shows after the browser's undo is what the project holds: the part is drawn again from the project, and says the same
  await side("Objective").click();
  await side("Variables").click();
  assert.equal(await field("Unit", card(0)).inputValue(), afterBrowserUndo);
  // a pause ends a step: emptying the field is one step, and the word typed after the next pause is another
  await page.waitForTimeout(1100);
  await field("Unit", card(0)).fill("");
  await page.waitForTimeout(1100);
  await page.keyboard.type("kilogram", { delay: 20 });
  await heading("Variables").click();
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => document.activeElement.id === "panel-heading");
  assert.equal(await field("Unit", card(0)).inputValue(), "");
  assert.equal(await items.count(), 2);
  await page.keyboard.press("Control+y");
  assert.equal(await field("Unit", card(0)).inputValue(), "kilogram");
  await page.keyboard.press("Control+z");
  assert.equal(await field("Unit", card(0)).inputValue(), "");
  // the other way round: after the app's undo, Ctrl+Z inside that field is the browser's again, and field and project still agree
  await field("Unit", card(0)).click();
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(200);
  const afterBoth = await field("Unit", card(0)).inputValue();
  assert.equal(await items.count(), 2);
  await side("Objective").click();
  await side("Variables").click();
  assert.equal(await field("Unit", card(0)).inputValue(), afterBoth);
  await field("Unit", card(0)).fill("");
  await button("Remove variable x2").click();
  await items.nth(1).waitFor({ state: "detached" });
  say(`undo: a variable that nothing uses was removed at once, and came back with the Undo button and with Ctrl+Z. Redo, Ctrl+Y and Ctrl+Shift+Z work. Typing a word in one field is one step, and Ctrl+Z inside the field was left to the browser (the field then held "${afterBrowserUndo}")`);

  // The definition: yes or no values with a limit that is a variable, so that one name holds another.
  await field("Name", card(0)).fill("weight_limit");
  await field("Highest value", card(0)).fill("60");
  await button("Add a variable").click();
  await field("Name", card(1)).fill("take");
  await choose(field("What it holds", card(1)), "binary");
  await status.filter({ hasText: `The suggested solver of "Quick run" is now ${solverOf("ga")}.` }).waitFor();
  await choose(field("Shape", card(1)), "1");
  await field("Number of values", card(1)).fill("20");
  await side("Objective").click();
  await choose(field("Goal"), "max");
  const profit = "sum(value * take) - sum(weight * take) / (1 + weight_limit)  # weight counts a little";
  await field("Expression").fill(profit);
  await side("Constraints").click();
  for (const [n, name, left, right] of [[0, "Total weight", "sum(weight * take)", "weight_limit"], [1, "Items", "sum(take)", "15"], [2, "Limit", "weight_limit", "60"]]) {
    await button("Add a constraint").click();
    await field("Name", card(n)).fill(name);
    await field("Left side", card(n)).fill(left);
    await field("Right side", card(n)).fill(right);
  }
  await saved();
  await side("Constraints").getByRole("img", { name: "has a problem" }).waitFor({ state: "detached" });
  await side("Quick run").click();
  assert.equal(await suggestion.innerText(), `${solverOf("ga")} is suggested for this project because it holds yes or no values or whole numbers. You can change it.`);
  await page.getByText(`Settings of ${solverOf("ga")}`).click();
  assert.deepEqual([await field("mutation_step_size").inputValue(), await field("mutation_step_size_damp").inputValue(), await chosen(field("Work on"))], ["0.3", "1", "encoded"]);

  // Run from the Constraints part, in a window short enough to scroll: the run bar then offers the way back.
  await page.setViewportSize({ width: 1440, height: 620 });
  const backButton = button("Back to Constraints");
  const fromConstraints = async () => {
    await side("Constraints").click();
    await field("Right side", card(2)).focus();
    const scroll = await page.evaluate(() => window.scrollY);
    // Pressed where it is on screen, as a person does. A click by name first scrolls the page to where the bar would be if it did not stay in view.
    const box = await button("Run").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await finished();
    await result.waitFor();
    return scroll;
  };
  // 1. another step takes the way back away
  await fromConstraints();
  await backButton.waitFor();
  assert.equal(await button("Show the result").count(), 0);
  await side("Objective").click();
  await side("Quick run").click();
  await result.waitFor();
  assert.equal(await backButton.count(), 0);
  // 2. back: the part, the place on the page and the focus are as they were left
  const left = await fromConstraints();
  assert.ok(left > 0, "the Constraints part scrolls in this window");
  await page.evaluate(() => window.scrollTo(0, 0));
  // with the keyboard
  await backButton.focus();
  await page.keyboard.press("Enter");
  await heading("Constraints").waitFor();
  await page.waitForFunction((y) => Math.abs(window.scrollY - y) <= 1, left);
  assert.deepEqual(
    await page.evaluate(() => [document.activeElement.value, document.activeElement.closest("fieldset").querySelector("legend").textContent, document.querySelector(`label[for="${document.activeElement.id}"]`).textContent]),
    ["60", "Constraint 2", "Right side"],
  );
  assert.equal(await backButton.count(), 0);
  // from another part the same place of the bar leads on to the result
  await button("Show the result").waitFor();
  // 3. a new run from the experiment itself has nowhere to go back to
  await fromConstraints();
  await backButton.waitFor();
  await button("Run").click();
  await finished();
  assert.equal(await backButton.count(), 0);
  await page.setViewportSize({ width: 1440, height: 900 });
  const kept = await result.innerText();
  say(`run from Constraints: the run bar offered "Back to Constraints", which returned to the part at the same scroll position (${left}px) with the focus in the field that had it. It went away after another step and after a run from the experiment itself`);

  // Remove a column that is used: a dialog names each place, and Cancel has the focus.
  await side("Data").click();
  await button("Remove column weight").click();
  await dialog.getByRole("heading", { name: "Remove the column weight?" }).waitFor();
  assert.deepEqual(await dialog.locator(".uses li").allInnerTexts(), ["The objective uses weight.", 'The constraint "Total weight" uses weight.']);
  assert.equal(await dialog.locator(".uses code").first().innerText(), "weight");
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Cancel");
  // the keys of Undo do nothing behind a dialog
  await page.keyboard.press("Control+z");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(await field("Name of column 0").inputValue(), "weight");
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Remove column weight");
  await side("Constraints").click();
  assert.equal(await field("Right side", card(2)).inputValue(), "60");
  await side("Data").click();
  // remove anyway: nothing else is changed, and the parts that used the column show their problem
  // with the keyboard: Enter on the button opens the dialog, Tab goes from Cancel to "Remove anyway", Enter removes
  await button("Remove column weight").focus();
  await page.keyboard.press("Enter");
  await dialog.waitFor();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Remove anyway");
  await page.keyboard.press("Enter");
  await status.filter({ hasText: "The column weight was removed." }).waitFor();
  assert.equal(await field("Name of column 0").inputValue(), "value");
  await side("Objective").getByRole("img", { name: "has a problem" }).waitFor();
  await side("Constraints").getByRole("img", { name: "has a problem" }).waitFor();
  await side("Constraints").click();
  assert.match(await card(0).locator(".field", { has: field("Left side") }).locator(".problems").innerText(), /The name "weight" is not known/);
  // a run is refused, and says so: the message of the removal does not stand in its way
  const refusedBefore = runWorkers;
  await button("Run").click();
  await status.filter({ hasText: "This project cannot run yet." }).waitFor();
  assert.equal(await page.locator(".run-status").getAttribute("data-state"), "error");
  assert.equal(runWorkers, refusedBefore);
  await side("Objective").click();
  assert.equal(await field("Expression").inputValue(), profit);
  const missing = await page.locator(".field", { has: field("Expression") }).locator(".problems").innerText();
  assert.match(missing, /weight/);
  // the only column that is left cannot be removed, and says why
  await side("Data").click();
  assert.equal(await button("Remove column value").getAttribute("aria-disabled"), "true");
  assert.equal(await button("Remove column value").getAttribute("data-tip"), "A table needs at least one column. Remove the table instead.");
  await button("Remove column value").click({ force: true });
  assert.equal(await field("Name of column 0").inputValue(), "value");
  // undo: the column is back, and the problem marks go. The button went with the message when Run was pressed, so the keyboard is used.
  assert.equal(await undoButton.count(), 0);
  await heading("Data").click();
  await page.keyboard.press("Control+z");
  assert.equal(await field("Name of column 0").inputValue(), "weight");
  await side("Objective").getByRole("img", { name: "has a problem" }).waitFor({ state: "detached" });
  await side("Constraints").getByRole("img", { name: "has a problem" }).waitFor({ state: "detached" });
  // the run and its result were never part of what Undo takes back
  await side("Quick run").click();
  assert.equal(await result.innerText(), kept);
  say(`a column in use: the dialog listed "The objective uses weight." and 'The constraint "Total weight" uses weight.' with the focus on Cancel. After "Remove anyway" the objective said: "${missing.replace(/\s+/g, " ")}". Undo brought the column back, the marks went, and the result of the run stayed`);

  // A new name, typed key by key: the places that use the old one can follow, and a longer name that holds it is left alone.
  await side("Data").click();
  await field("Name of column 0").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("mass", { delay: 30 });
  const offer = page.locator(".field", { has: field("Name of column 0") }).locator(".hint");
  assert.equal((await offer.innerText()).replace(/\s+/g, " "), "2 places still use the old name weight. Rename there too");
  await side("Objective").getByRole("img", { name: "has a problem" }).waitFor();
  await button("Rename there too").click();
  await offer.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement.value), "mass");
  await side("Objective").getByRole("img", { name: "has a problem" }).waitFor({ state: "detached" });
  await side("Objective").click();
  const followed = "sum(value * take) - sum(mass * take) / (1 + weight_limit)  # weight counts a little";
  assert.equal(await field("Expression").inputValue(), followed);
  await page.locator(".ok").filter({ hasText: "Checked: this gives one number." }).waitFor();
  await side("Constraints").click();
  assert.deepEqual([await field("Left side", card(0)).inputValue(), await field("Right side", card(0)).inputValue(), await field("Left side", card(2)).inputValue()], ["sum(mass * take)", "weight_limit", "weight_limit"]);
  // the carried name is a step of its own: Ctrl+Z takes it back and leaves the new name of the column, so the old name is missing again
  await heading("Constraints").click();
  await page.keyboard.press("Control+z");
  assert.equal(await field("Left side", card(0)).inputValue(), "sum(weight * take)");
  await side("Objective").getByRole("img", { name: "has a problem" }).waitFor();
  await side("Data").click();
  assert.equal(await field("Name of column 0").inputValue(), "mass");
  await side("Constraints").click();
  await heading("Constraints").click();
  await page.keyboard.press("Control+y");
  assert.equal(await field("Left side", card(0)).inputValue(), "sum(mass * take)");
  // a variable: its name follows into the expressions, and the variable whose name holds it keeps its own
  await side("Variables").click();
  await field("Name", card(1)).click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("pick", { delay: 30 });
  // with the keyboard: the offer is the next stop after the field, and the field has the focus again afterward
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Rename there too");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement.value === "pick");
  await side("Objective").click();
  assert.equal(await field("Expression").inputValue(), followed.replaceAll("take", "pick"));
  await page.locator(".ok").filter({ hasText: "Checked: this gives one number." }).waitFor();
  say(`rename: "weight" became "mass" key by key, the line under the field said "2 places still use the old name weight.", and "Rename there too" gave "${followed}" with weight_limit and the comment untouched. A variable followed in the same way`);

  // A function is renamed in the text itself. The calls can follow while the text has the same functions, and nothing is offered after one is deleted.
  await side("Functions").click();
  const defs = "def total(t):\n    return sum(t)\n\ndef twice(t):\n    return 2 * total(t)\n";
  await field("Function definitions").fill(defs);
  await side("Constraints").click();
  await field("Left side", card(1)).fill("twice(pick)");
  await field("Right side", card(1)).fill("30");
  await saved();
  await side("Constraints").getByRole("img", { name: "has a problem" }).waitFor({ state: "detached" });
  await side("Functions").click();
  await field("Function definitions").click();
  await field("Function definitions").evaluate((area) => area.setSelectionRange("def total".length, "def total".length));
  await page.keyboard.type("_of", { delay: 30 });
  const functionOffer = page.locator(".field", { has: field("Function definitions") }).locator(".hint");
  assert.equal((await functionOffer.innerText()).replace(/\s+/g, " ").trim(), "1 place still uses the old name total. Rename there too");
  await button("Rename there too").click();
  assert.equal(await field("Function definitions").inputValue(), defs.replaceAll("total", "total_of"));
  await functionOffer.waitFor({ state: "detached" });
  await side("Functions").getByRole("img", { name: "has a problem" }).waitFor({ state: "detached" });
  // the first function is deleted: the second is now the first in the text, and its name is not offered to the call of the one that is gone
  await field("Function definitions").evaluate((area) => area.setSelectionRange(0, area.value.indexOf("def twice")));
  await page.keyboard.press("Delete");
  assert.equal(await field("Function definitions").inputValue(), "def twice(t):\n    return 2 * total_of(t)\n");
  await page.locator(".field", { has: field("Function definitions") }).locator(".problems").filter({ hasText: "total_of" }).waitFor();
  assert.equal(await button("Rename there too").count(), 0);
  // leaving the field and coming back to it changes nothing about that
  await heading("Functions").click();
  await field("Function definitions").click();
  await page.waitForTimeout(200);
  assert.equal(await button("Rename there too").count(), 0);
  await heading("Functions").click();
  await page.keyboard.press("Control+z");
  assert.equal(await field("Function definitions").inputValue(), defs.replaceAll("total", "total_of"));
  await side("Functions").getByRole("img", { name: "has a problem" }).waitFor({ state: "detached" });
  say('a function renamed in the text ("total" to "total_of") was followed by its call with "Rename there too". After the first function was deleted, nothing was offered');

  // The user picks a solver: the experiment is theirs from then on, and the variables no longer change it.
  await side("Quick run").click();
  await suggestion.waitFor();
  await choose(field("Solver"), "de");
  await suggestion.waitFor({ state: "detached" });
  await side("Variables").click();
  await button("Add a variable").click();
  await choose(field("What it holds", card(2)), "permutation");
  await page.waitForTimeout(300);
  assert.match(await setup.innerText(), new RegExp(`^Quick run: ${solverOf("de")}, 20,000 evaluations, seed 1$`));
  assert.doesNotMatch(await status.innerText(), /suggested/);
  // an experiment that starts from nothing starts as the suggestion, here for a mix
  await button("New experiment").click();
  await heading("Experiment").waitFor();
  assert.equal(await field("Name of the experiment").inputValue(), "Experiment 2");
  assert.match(await suggestion.innerText(), new RegExp(`^${solverOf("ga")} is suggested for this project because it mixes orderings`));
  await page.getByText(`Settings of ${solverOf("ga")}`).click();
  assert.equal(await chosen(field("Work on")), "native");
  await saved();
  say(`a solver picked by hand (${solverOf("de")}) stayed when an ordering was added, and a new experiment started from the suggestion for the mix`);

  // Compare: two experiments of the knapsack example and Random Search, five runs each.
  await toList();
  await button("0/1 knapsack").click();
  await heading("0/1 knapsack").waitFor();
  await button("Run").click();
  await finished();
  const quick = await result.innerText();
  // a second experiment with another solver and another budget of its own
  await button("New experiment").click();
  await field("Name of the experiment").fill("PSO run");
  await choose(field("Solver"), "pso");
  // The example may get another solver, budget or seed later, so nothing below names its numbers: they are read from the example.
  const sack = { solver: METHODS[knapsack.run.method].name, budget: knapsack.run.budget, half: knapsack.run.budget / 2 };
  const commas = (n) => n.toLocaleString("en-US");
  await field("Budget (evaluations)").fill(String(sack.half));
  await side("Compare experiments").click();
  await heading("Compare experiments").waitFor();
  await page.locator(".output .empty").filter({ hasText: "No comparison yet." }).waitFor();
  // Run stays the one filled button, and the comparison has its own, which is not filled
  assert.deepEqual(await page.locator(".btn-primary").allInnerTexts(), ["Run"]);
  assert.equal(await field("Runs of each experiment").inputValue(), "10");
  assert.equal(await page.getByLabel(`Quick run (${sack.solver})`).isChecked() && await page.getByLabel("PSO run (Particle Swarm Optimization)").isChecked(), true);
  // different budgets are said plainly, and one budget is set for the comparison
  assert.equal(
    (await page.getByRole("note").innerText()).replace(/\s+/g, " "),
    `Note: the chosen experiments have different budgets (Quick run: ${commas(sack.budget)}, PSO run: ${commas(sack.half)}). A comparison gives every run the same number of evaluations, so one budget is set here for all of them.`,
  );
  assert.equal(await field("Budget of every run (evaluations)").inputValue(), String(sack.budget));
  // a number of runs that cannot be is refused at its field, and the comparison does not start
  await field("Runs of each experiment").fill("0");
  await page.locator(".problems").filter({ hasText: "The number of runs must be a whole number from 1 to 100." }).waitFor();
  assert.equal(await button("Run the comparison").getAttribute("aria-disabled"), "true");
  const cores = await page.evaluate(() => navigator.hardwareConcurrency);
  // the app's own rule: one core is left to the page, at most eight workers, and never more than there are runs
  const pool = Math.max(1, Math.min((cores || 2) - 1, 8, 15));
  const runsBeforeCompare = runWorkers;
  // forced, because the button says that it cannot be used
  await button("Run the comparison").click({ force: true });
  await page.waitForTimeout(200);
  assert.equal(runWorkers, runsBeforeCompare);
  // the usual numbers of runs are one click away, and the field takes any other
  await page.getByText("Papers in this field usually report 20 to 30 runs.").waitFor();
  for (const runs of ["30", "20", "10"]) {
    await button(`${runs} runs`).click();
    assert.equal(await field("Runs of each experiment").inputValue(), runs);
  }
  await page.getByText(`This will do 20 runs of ${commas(sack.budget)} evaluations each, in the background.`).waitFor();
  await field("Runs of each experiment").fill("5");
  await page.getByLabel("Add Random Search as a reference").check();
  await page.getByText(`This will do 15 runs of ${commas(sack.budget)} evaluations each, in the background.`).waitFor();
  await shot("13-compare-form");

  // a comparison that lasts: it shows in the run bar from every part, the page stays in use, and it can be cancelled
  await field("Budget of every run (evaluations)").fill("2000000000");
  await button("Run the comparison").click();
  const comparing = page.locator(".comparing span");
  await comparing.filter({ hasText: "Comparison: 0 of 15 runs done" }).waitFor();
  await page.getByText("The comparison is running. You can keep working in this project.").waitFor();
  await side("Variables").click();
  await heading("Variables").waitFor();
  assert.equal(await comparing.innerText(), "Comparison: 0 of 15 runs done");
  await field("Unit", card(0)).fill("item");
  await saved();
  await field("Unit", card(0)).fill("");
  await button("Show the comparison").click();
  await heading("Compare experiments").waitFor();
  // the button went away with the part it was on, so the heading of the new part has the focus
  await page.waitForFunction(() => document.activeElement.id === "panel-heading" && document.activeElement.textContent === "Compare experiments");
  // the browser reports its workers a moment after they start, so the count is given time to arrive, and then it must be exact
  for (let tries = 0; tries < 100 && runWorkers < runsBeforeCompare + pool; tries++) await page.waitForTimeout(100);
  assert.equal(runWorkers, runsBeforeCompare + pool);
  await button("Cancel the comparison").click();
  await page.getByText("Comparison cancelled. Nothing was kept from it.").waitFor();
  await button("Run the comparison").waitFor();
  await page.waitForTimeout(300); // ended workers post nothing more
  assert.equal(await comparing.count(), 0);
  await page.locator(".output .empty").filter({ hasText: "No comparison yet." }).waitFor();
  say(`a comparison of 15 long runs started in ${pool} workers, showed in the run bar while another part was edited, and was cancelled with nothing kept`);

  // the comparison itself, with a budget of its own
  await field("Budget of every run (evaluations)").fill("5000");
  await button("Run the comparison").click();
  await page.getByText("Comparison finished.").waitFor({ timeout: 120000 });
  assert.equal(runWorkers, runsBeforeCompare + 2 * pool);
  const table = page.locator(".comparison table").first();
  const rows = (await table.locator("tbody tr").allInnerTexts()).map((row) => row.split("\t").map((cell) => cell.trim()));
  // the same runs, done here by the engine: the summary must not depend on how the workers shared them
  const setups = [
    { ...knapsack.run, budget: 5000 },
    { name: "PSO run", method: "pso", settings: {}, budget: 5000, seed: knapsack.run.seed },
    { name: "Random Search (reference)", method: "random", settings: {}, budget: 5000, seed: knapsack.run.seed },
  ];
  const summary = summarize(setups.map((run) => {
    const project = parseProject({ ...knapsack, run });
    return { name: run.name, project, results: [0, 1, 2, 3, 4].map((runIndex) => runProject(project, { runIndex })) };
  }));
  const solvers = [sack.solver, "Particle Swarm Optimization", "Random Search"];
  assert.deepEqual(rows, summary.experiments.map((e, n) => [
    e.name, solvers[n], `${e.feasibleRuns} of 5`,
    `${e.evaluations.usedMin === e.evaluations.usedMax ? "5,000" : `${e.evaluations.usedMin.toLocaleString("en-US")} to ${e.evaluations.usedMax.toLocaleString("en-US")}`} of 5,000`,
    ...(e.objective ? [`${shown(e.objective.median)} $`, `${shown(e.objective.q1)} to ${shown(e.objective.q3)} $`, `${shown(e.objective.best)} $`] : ["No numbers, because no run was feasible"]),
  ]));
  // the experiments stay in the order of the project, whatever their numbers are
  assert.deepEqual(rows.map((row) => row[0]), ["Quick run", "PSO run", "Random Search (reference)"]);
  assert.ok(summary.experiments.some((e) => e.feasibleRuns > 0 && e.objective));
  assert.match(await page.locator("#comparison-words").innerText(), /^Every experiment was run 5 times, each run with its own seed and with 5,000 evaluations\. The objective is maximized, in \$\. The median, the quartiles and the best value are over the feasible runs only/);
  await page.getByText("These numbers only describe the runs, and the conclusion is the reader's.").waitFor();
  // one chart for each experiment with a feasible run, drawn as the report draws it
  const drawn = summary.experiments.filter((e) => e.feasibleRuns > 0);
  assert.equal(await page.locator(".charts svg").count(), drawn.length);
  await page.locator(".charts").getByRole("img", { name: new RegExp(`^${drawn[0].name}\\. Feasible runs: ${drawn[0].feasibleRuns} of 5\\. The median of the best value went from`) }).waitFor();
  assert.equal(await page.locator(".charts .drawing-box").first().getAttribute("tabindex"), "0");
  // nothing on the page judges: no winner, no ranking, no test
  const judging = /winner|best solver|significan|p-value|\branking|\branked|statistic|outperform/i;
  assert.doesNotMatch(await page.locator("body").innerText(), judging);
  assert.equal(await page.locator(".comparison table .holds, .comparison table strong, .comparison table mark").count(), 0);
  // every seed is on record
  await page.getByText("What ran: the setups and the seeds").click();
  const seeds = (await page.locator(".comparison .disclosure tbody tr").first().innerText()).split("\t").at(-1).trim();
  assert.equal(seeds, [0, 1, 2, 3, 4].map((runIndex) => deriveSeed(knapsack.run.seed, runIndex)).join(", "));
  await shot("14-compare-summary");
  const compared = await table.innerText();
  // the experiments kept their own budgets
  await side("PSO run").click();
  assert.equal(await field("Budget (evaluations)").inputValue(), String(sack.half));
  // an edit of a compared experiment is said next to the summary, and going back takes the note away
  await field("Seed").fill("5");
  await side("Compare experiments").click();
  await page.locator(".comparison").getByText("has changed since this comparison").waitFor();
  assert.equal(await table.innerText(), compared);
  await side("PSO run").click();
  await field("Seed").fill(String(knapsack.run.seed));
  await side("Compare experiments").click();
  await table.waitFor();
  assert.equal(await page.locator(".comparison").getByText("has changed since this comparison").count(), 0);
  await saved();
  say(`comparison of ${rows.length} experiments with 5 runs each: ${rows.map((row) => `${row[0]} ${row[2]} feasible, median ${row[4]}`).join("; ")}. No judging word on the page, the order is the user's, and an edit afterwards is noted`);

  // Share: every download of the result and of the comparison.
  const text = async (download) => readFile(await download.path(), "utf8");
  const save = async (name, within = page) => (await Promise.all([page.waitForEvent("download"), within.getByRole("button", { name, exact: true }).click()]))[0];
  // the two most used files are next to the result
  await side("Quick run").click();
  assert.equal(await result.innerText(), quick);
  download = await save("Download the report");
  assert.equal(download.suggestedFilename(), "0-1-knapsack-Quick-run-report.html");
  await button("All downloads").click();
  await heading("Share").waitFor();
  await page.waitForFunction(() => document.activeElement.id === "panel-heading" && document.activeElement.textContent === "Share");
  // and from the summary of a comparison in the same way, with the keyboard
  await side("Compare experiments").click();
  await button("Download the summary and the charts").focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement.id === "panel-heading" && document.activeElement.textContent === "Share");
  assert.deepEqual(await page.locator(".btn-primary").allInnerTexts(), ["Run"]);
  assert.equal(await chosen(field("Result to share")), "");
  await shot("15-share");
  const objectiveShown = Number(quick.match(/Objective \(maximized\)\s+(\S+)/)[1]);
  const resultOnScreen = { used: Number(quick.match(/Evaluations\s+([\d,]+) of/)[1].replaceAll(",", "")) };
  assert.match(quick, /Best feasible solution found\./);

  download = await save("Download the Python script");
  assert.equal(download.suggestedFilename(), "0-1-knapsack-Quick-run.py");
  const script = await text(download);
  assert.match(script, /^# Exported from YPEA Studio \d+\.\d+\.\d+\. Tested with ypea \d+\.\d+\.\d+, which needs Python 3\.12 or newer\.\n/);
  assert.ok(script.includes("import ypea") && script.includes(`# In the app it gave the objective value ${objectiveShown} after ${resultOnScreen.used} evaluations.`));

  download = await save("Download the report");
  const report = await text(download);
  assert.match(report, /^<!doctype html>\n<html lang="en">/);
  assert.equal(report.match(/<html/g).length, 1);
  assert.doesNotMatch(report, /<script|<link|<img|src=|url\(/i);
  assert.ok(report.includes("<h1>0/1 knapsack</h1>") && report.includes("Comparison of experiments") && report.includes("Random Search (reference)"));
  // without the comparison, when the user says so
  await page.getByLabel("Include the comparison in the report and in the result file").uncheck();
  assert.equal((await text(await save("Download the report"))).includes("Comparison of experiments"), false);
  await page.getByLabel("Include the comparison in the report and in the result file").check();
  // printing: the report opens in a tab of its own, where the print command of the browser prints it
  const [tab] = await Promise.all([context.waitForEvent("page"), button("Open the report to print").click()]);
  await tab.waitForURL(/^blob:/);
  await tab.getByRole("heading", { name: "0/1 knapsack", exact: true }).waitFor();
  assert.equal(await tab.locator("script").count(), 0);
  await tab.close();

  download = await save("Result (JSON)");
  assert.equal(download.suggestedFilename(), "0-1-knapsack-Quick-run-result.json");
  const resultFile = JSON.parse(await text(download));
  assert.deepEqual([resultFile.format, resultFile.version, resultFile.experiment, resultFile.result.best.objective], ["ypea-studio-result", 1, "Quick run", objectiveShown]);
  assert.equal(resultFile.comparison.experiments.length, 3);
  assert.equal(parseResultFile(resultFile).project.name, "0/1 knapsack");
  download = await save("Solution (CSV)");
  assert.equal(download.suggestedFilename(), "0-1-knapsack-Quick-run-solution.csv");
  const solutionRows = (await text(download)).trimEnd().split("\r\n");
  assert.deepEqual([solutionRows[0], solutionRows.length], ["variable,position,value,unit", 21]);
  assert.deepEqual(solutionRows.slice(1).map((row) => Number(row.split(",")[2])), resultFile.result.best.solution.take);
  download = await save("History of the run (CSV)");
  const historyRows = (await text(download)).trimEnd().split("\r\n");
  assert.deepEqual([historyRows[0], historyRows.length, historyRows.at(-1)], ["evaluations,best_value,feasible", 101, `${sack.budget},${objectiveShown},yes`]);
  download = await save("Summary (CSV)");
  assert.equal(download.suggestedFilename(), "0-1-knapsack-comparison.csv");
  const summaryRows = (await text(download)).trimEnd().split("\r\n");
  assert.equal(summaryRows[0], "experiment,solver,runs,feasible_runs,budget,evaluations_used_min,evaluations_used_max,median,first_quartile,third_quartile,best,unit");
  assert.deepEqual(summaryRows.slice(1).map((row) => row.split(",").slice(0, 5).join(",")), summary.experiments.map((e) => `${e.name},${e.method},5,${e.feasibleRuns},5000`));

  // charts: an SVG file that needs no page, and a PNG picture of it
  const png = async (download) => {
    const bytes = await readFile(await download.path());
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20), bytes.length];
  };
  for (const [name, file, words, height] of [
    // a history has a legend, and so 38 more in height, when a part of its line is not a result
    ["History chart", "0-1-knapsack-Quick-run-history", /<title id="history-title">Best value against evaluations<\/title><desc id="history-desc">The best value went from /, [300, 338]],
    ["Drawing of the solution", "0-1-knapsack-Quick-run-drawing", /<title id="drawing-title">Chosen items<\/title><desc id="drawing-desc">\d+ of 20 items are chosen: positions /, [268]],
    ["Comparison charts", "0-1-knapsack-comparison", /<title id="comparison-title">[^<]+<\/title><desc id="comparison-desc">Quick run\. Feasible runs: /, undefined],
  ]) {
    download = await save(`${name} (SVG)`);
    assert.equal(download.suggestedFilename(), `${file}.svg`);
    const svg = await text(download);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 440 \d+" width="440" height="\d+" role="img" aria-labelledby="[a-z]+-title [a-z]+-desc" font-size="12" font-family="[^"]+"><title /);
    assert.match(svg, words);
    // its own background right after its title and its description, every color written out, and nothing that points outside the file
    assert.match(svg, /<\/desc><rect width="440" height="\d+" fill="#ffffff"\/>/);
    assert.doesNotMatch(svg, /var\(|<script|href=|class=|<style|style=|currentColor/);
    const tall = Number(svg.match(/ height="(\d+)"/)[1]);
    if (height) assert.ok(height.includes(tall), `${name}: a height of ${tall}`);
    // the file stands on its own: a browser draws it as a picture, with the size it names
    assert.deepEqual(await page.evaluate(async (source) => {
      const image = new Image();
      image.src = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }, svg), [440, tall]);
    download = await save(`${name} (PNG)`);
    assert.equal(download.suggestedFilename(), `${file}.png`);
    const [wide, high, size] = await png(download);
    assert.deepEqual([wide, high], [880, 2 * tall]);
    assert.ok(size > 3000, `${name}: a picture of ${size} bytes is empty`);
  }
  await page.getByText("Pictures are saved in the light theme, whatever theme the app has").waitFor();
  assert.equal(await alert.count(), 0);
  say("share: the Python script, the report with and without the comparison, the report in a tab for printing, the result as JSON, three CSV files, and the history chart, the drawing and the comparison charts as SVG and PNG all hold what they should");

  // the downloaded script, run in real Python with the pinned ypea, gives the result of the screen
  const python = [new URL("../../.venv/Scripts/python.exe", import.meta.url), new URL("../../.venv/bin/python", import.meta.url)].map(fileURLToPath).find(existsSync);
  const pinned = python && spawnSync(python, ["-c", "import ypea; print(ypea.__version__)"], { encoding: "utf8" });
  if (!python) say("SKIPPED: the downloaded script was not run in Python, because the project has no .venv folder");
  else if (pinned.status !== 0 || pinned.stdout.trim() !== YPEA_TESTED) say(`SKIPPED: the downloaded script was not run in Python, because the .venv does not hold ypea ${YPEA_TESTED}`);
  else {
    const ran = spawnSync(python, ["-"], { input: script, encoding: "utf8", env: { ...process.env, YPEA_STUDIO_JSON: "1", PYTHONIOENCODING: "utf-8" } });
    assert.equal(ran.status, 0, ran.stderr);
    const lines = ran.stdout.trimEnd().split(/\r?\n/), inPython = JSON.parse(lines.at(-1));
    assert.equal(lines[0], "Best feasible solution found");
    assert.equal(inPython.best.obj_value, objectiveShown);
    assert.equal(inPython.best.obj_value, resultFile.result.best.objective);
    assert.equal(inPython.nfe, resultFile.result.evaluations.used);
    assert.deepEqual(inPython.best.position, resultFile.result.best.codes);
    assert.deepEqual(inPython.best.solution.take, resultFile.result.best.solution.take);
    assert.deepEqual(inPython.trace.nfe, resultFile.result.trace.nfe);
    say(`the downloaded script ran in Python with ypea ${YPEA_TESTED}: objective ${inPython.best.obj_value} after ${inPython.nfe} evaluations, the same solution and the same improvements as on screen`);
  }

  // the project with its results, opened as a new project the way a colleague would open it
  download = await save("Download the project with results");
  assert.equal(download.suggestedFilename(), "0-1-knapsack-with-results.json");
  const shared = await read(download);
  assert.deepEqual([shared.format, shared.version, shared.projects.length, shared.results.map((r) => r.experiment), shared.comparisons.length], ["ypea-studio-projects", 1, 1, [""], 1]);
  assert.equal(parseProject(shared.projects[0]).name, "0/1 knapsack");
  assert.equal(shared.projects[0].results, undefined);
  // the plain project file still holds the definition only
  assert.equal((await read(await save("Download the project"))).format, "ypea-studio-project");
  await toList();
  await projectFile.setInputFiles({ name: "shared.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...shared, projects: [{ ...shared.projects[0], name: "Shared knapsack" }] })) });
  await heading("Shared knapsack").waitFor();
  const workersBeforeShared = runWorkers;
  await result.waitFor();
  assert.equal(await result.innerText(), quick);
  await side("Compare experiments").click();
  assert.equal(await table.innerText(), compared);
  assert.equal(await page.locator(".comparison").getByText("has changed since this comparison").count(), 0);
  assert.equal(runWorkers, workersBeforeShared);
  // a file whose results were tampered with is refused as a whole
  await toList();
  const tampered = structuredClone(shared);
  tampered.comparisons[0].experiments[0].results[1].seed.run = 1;
  await projectFile.setInputFiles({ name: "tampered.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(tampered)) });
  await alert.filter({ hasText: "This file holds a comparison that cannot be read." }).waitFor();
  assert.equal(await page.locator("table.projects tbody tr").count(), 13);
  await fromList("Shared knapsack");
  say("a project downloaded with its results opens as a new project with the same result and the same comparison, without a run. A file with a changed seed is refused");

  // The result that is not feasible: the difference from the baseline, and no "better" or "worse".
  await toList();
  await projectFile.setInputFiles({ name: "overloaded.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...vrp, name: "Overloaded routes", constraints: [{ ...vrp.constraints[0], right: "20" }] })) });
  await heading("Overloaded routes").waitFor();
  await button("Run").click();
  await page.waitForFunction(() => document.querySelector("[role=status]").textContent.includes("Run finished"));
  const overloaded = await result.innerText();
  assert.match(overloaded, /No feasible solution found\./);
  assert.match(overloaded, /Difference from what is in use today\s+-?[\d.]+ km \([\d.]+% (lower|higher)\)\n/);
  assert.doesNotMatch(overloaded, /which is (better|worse)/);
  // and its history says that its values are not results, with the whole line dashed
  assert.match(overloaded, /No candidate was feasible during this run\. The whole line is dashed: its values belong to candidates that break a constraint, and they are not results\./);
  // one line only, in the muted color and dashed, and the legend under the chart names it
  const historyLines = await result.locator("figure").last().locator("path").evaluateAll((paths) => paths.map((path) => [path.getAttribute("class"), path.getAttribute("d").length > 0, getComputedStyle(path).strokeDasharray]));
  assert.deepEqual(historyLines.map((line) => [line[0], line[1]]), [["fig-stroke-muted", true]]);
  assert.notEqual(historyLines[0][2], "none");
  assert.equal(await result.locator("figure").last().locator("text").filter({ hasText: "Not a result: the best candidate breaks a constraint" }).count(), 1);
  await shot("16-not-feasible-result");
  say(`a result that is not feasible: "${overloaded.match(/Difference from what is in use today\s+(.*)/)[1]}" with no verdict, and a dashed history that says its values are not results`);

  // Constraints: a breach in the same words on screen and in the report, the list of tolerances, and a constraint that is off.
  const overloadedProject = { ...vrp, name: "Overloaded routes", constraints: [{ ...vrp.constraints[0], right: "20" }] };
  const heavy = runProject(parseProject(structuredClone(overloadedProject))).best.checks[0];
  assert.match(breach(heavy), /^Over by [\d.]+ kg \([\d.]+% of the limit\)$/);
  /** The cells of the row of one constraint, in a result or in a test. */
  const cells = async (name, within = result) =>
    (await within.locator("table.constraints tbody tr").filter({ has: page.getByRole("rowheader", { name, exact: true }) }).locator("th, td").allInnerTexts()).map((cell) => cell.trim());
  assert.deepEqual(await cells("Heaviest load"), ["Heaviest load", `${shown(heavy.left)} kg`, "at most 20 kg", "No, broken", breach(heavy)]);
  let reported = await text(await save("Download the report"));
  assert.ok(reported.includes(`<td class="broken">No, broken</td><td>${breach(heavy)}</td>`), "the report says the breach in the words of the screen");

  // an "equal to" constraint is exact at first, and the list writes the two plain fields of the project file
  /** The second constraint as the downloaded project file holds it. The file must be one the engine accepts. */
  const second = async () => {
    const file = await read((await Promise.all([page.waitForEvent("download"), button("Download project").click()]))[0]);
    parseProject(structuredClone(file));
    return file.constraints[1];
  };
  const described = (box) => box.evaluate((element) => element.getAttribute("aria-describedby").split(" ").map((id) => document.getElementById(id).textContent).join(" "));
  const near = { name: "Near one", left: "1", op: "==", right: "1.0005" };
  await side("Constraints").click();
  await button("Add a constraint").click();
  await field("Name", card(1)).fill(near.name);
  await field("Left side", card(1)).fill(near.left);
  await field("Right side", card(1)).fill(near.right);
  assert.equal(await field("Tolerance").count(), 0, "only an equal to constraint has a tolerance");
  await choose(field("Comparison", card(1)), "==");
  const tolerance = field("Tolerance");
  assert.equal(await chosen(tolerance), "exact");
  assert.deepEqual(await choices(tolerance), ["Exact", "Within 0.1% of the right side", "Within 1% of the right side", "Within a fixed amount", "Both, typed by hand"]);
  assert.deepEqual(await second(), near);
  await choose(tolerance, "0.001");
  assert.deepEqual(await second(), { ...near, relative_tolerance: 0.001 });
  // a percentage of a right side of 0 allows nothing: said in general, and as a note when the right side is plainly 0
  assert.equal(await described(tolerance), "A percentage of the right side adds nothing when the right side is 0.");
  await field("Right side", card(1)).fill("0");
  assert.equal(await described(tolerance), "Note: the right side is 0, so a percentage of it allows no difference at all. Use a fixed amount instead.");
  await field("Right side", card(1)).fill(near.right);
  assert.equal(await described(tolerance), "A percentage of the right side adds nothing when the right side is 0.");
  // a fixed amount: the choice stays while its field is empty, so a number can be typed, deleted and typed again
  await choose(tolerance, "fixed");
  assert.deepEqual([await chosen(tolerance), await field("Fixed amount").inputValue()], ["fixed", ""]);
  assert.deepEqual(await second(), near);
  await field("Fixed amount").fill("0.5");
  await field("Fixed amount").fill("");
  assert.equal(await chosen(tolerance), "fixed");
  await field("Fixed amount").fill("0.25");
  assert.deepEqual(await second(), { ...near, tolerance: 0.25 });
  // a choice from the list is a step that Undo takes back
  await choose(tolerance, "0.01");
  assert.deepEqual(await second(), { ...near, relative_tolerance: 0.01 });
  await heading("Constraints").click();
  await page.keyboard.press("Control+z");
  await status.filter({ hasText: "The last change was undone." }).waitFor();
  assert.deepEqual([await chosen(tolerance), await field("Fixed amount").inputValue()], ["fixed", "0.25"]);
  // both numbers typed by hand, with the exact rule and both values in words
  await choose(tolerance, "both");
  await field("Fraction").fill("0.02");
  assert.deepEqual(await second(), { ...near, tolerance: 0.25, relative_tolerance: 0.02 });
  const rule = ruleWords({ op: "==", tolerance: 0.25, relativeTolerance: 0.02 });
  assert.equal(rule, "The two sides may differ by 0.25 plus 2% of the size of the right side (tolerance 0.25, relative tolerance 0.02)");
  assert.equal(await card(1).locator("p.hint").filter({ hasText: "The rule:" }).innerText(), `${rule}. The rule: abs(left - right) <= tolerance + relative_tolerance * abs(right).`);
  // numbers that fit no entry of the list read as typed by hand when the part is shown again
  await side("Objective").click();
  await side("Constraints").click();
  assert.equal(await chosen(field("Tolerance")), "both");
  // the test of a candidate says the rule in the same words
  await side("Test a candidate").click();
  await button("Fill from the baseline").click();
  await tested.waitFor();
  assert.deepEqual(await cells(near.name, tested), [near.name, "1", `equal to 1.0005. ${rule}`, "Yes", "None"]);
  // another comparison has no tolerance: both fields leave the file, which the engine would otherwise refuse
  await side("Constraints").click();
  await choose(field("Comparison", card(1)), "<=");
  assert.equal(await field("Tolerance").count(), 0);
  await field("Right side", card(1)).fill("0.5");
  const loose = { ...near, op: "<=", right: "0.5" };
  assert.deepEqual(await second(), loose);
  await page.waitForTimeout(700); // the check of the project answers
  assert.equal(await side("Constraints").getByRole("img", { name: "has a problem" }).count(), 0);

  // a constraint is turned off without removing it: said in words at the constraint and in the sidebar, and one step for Undo
  const on = field("Check this constraint", card(1));
  const sideWords = async () => (await side("Constraints").innerText()).replace(/\s+/g, " ").trim();
  assert.equal(await sideWords(), "Constraints 2");
  await on.uncheck();
  await card(1).locator("legend").filter({ hasText: /^Constraint 1 \(off, not checked\)$/ }).waitFor({ state: "attached" });
  assert.equal(await card(1).locator(".item-title").innerText(), "Constraint 1 (off, not checked)");
  assert.equal(await sideWords(), "Constraints 2, 1 off");
  assert.deepEqual(await second(), { ...loose, enabled: false });
  // with the keyboard, from the check box itself
  await on.focus();
  await page.keyboard.press("Control+z");
  await status.filter({ hasText: "The last change was undone." }).waitFor();
  assert.deepEqual([await on.isChecked(), await sideWords(), await card(1).locator(".item-title").innerText()], [true, "Constraints 2", "Constraint 1"]);
  assert.deepEqual(await second(), loose);
  await page.keyboard.press("Control+y");
  await status.filter({ hasText: "The change was made again." }).waitFor();
  assert.deepEqual([await on.isChecked(), await sideWords()], [false, "Constraints 2, 1 off"]);
  // the test of a candidate shows both sides of it and no verdict, and names it
  await side("Test a candidate").click();
  await button("Test this candidate").click();
  await tested.filter({ hasText: "Off, not checked" }).waitFor();
  assert.deepEqual(await cells(near.name, tested), [near.name, "1", "at most 0.5", "Off, not checked", ""]);
  assert.match(await tested.innerText(), /Not checked: one constraint was turned off in this test \("Near one"\)\. The test does not say whether it holds\./);
  assert.match(await tested.innerText(), /Constraints\s+(1 of 1 broken\.|Every constraint that is on holds\.)/);
  // and so does the result of a run, in the words of the report
  await button("Run").click();
  await page.waitForFunction(() => document.querySelector("[role=status]").textContent.includes("Run finished"));
  await result.filter({ hasText: "Not checked:" }).waitFor();
  const partly = runProject(parseProject({ ...structuredClone(overloadedProject), constraints: [overloadedProject.constraints[0], { ...loose, enabled: false }] })).best.checks;
  assert.deepEqual(partly.map((check) => check.applied), [true, false]);
  assert.deepEqual(await cells("Heaviest load"), ["Heaviest load", `${shown(partly[0].left)} kg`, "at most 20 kg", "No, broken", breach(partly[0])]);
  assert.deepEqual(await cells(near.name), [near.name, "1", "at most 0.5", "Off, not checked", ""]);
  const notChecked = 'one constraint was turned off in this run ("Near one"). The result does not say whether it holds.';
  assert.ok((await result.innerText()).includes(`Not checked: ${notChecked}`));
  reported = await text(await save("Download the report"));
  assert.ok(reported.replaceAll("&quot;", '"').replaceAll("&#34;", '"').includes(`<strong>Not checked:</strong> ${notChecked}`), "the report names the constraint that was off in the words of the screen");
  assert.ok(reported.includes(`<td class="off">Off, not checked</td><td></td>`) && reported.includes(`<td>${breach(partly[0])}</td>`));
  // a constraint that is off still uses its names: removing a variable it names asks first
  await side("Variables").click();
  await button("Add a variable").click();
  await side("Constraints").click();
  await field("Left side", card(1)).fill("x");
  await side("Variables").click();
  await button("Remove variable x").click();
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /The constraint "Near one" uses x\./);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await page.locator("fieldset.item").count(), 2);
  say(`constraints: "${breach(partly[0])}" on screen and in the report, the list of tolerances writes "tolerance" and "relative_tolerance" and both leave the file with "==", a right side of 0 is noted, and a constraint that is off stays, is named in the test, the result and the report, and still counts as a use of its names`);

  // 10. Code that takes too long is stopped, by ending its worker.
  await toList();
  await fromList("Long benchmark");
  await side("Functions").click();
  await field("Function definitions").fill("def slow(a):\n    s = 0\n    for i in range(1000000000000):\n        s += i\n    return s\n");
  await side("Objective").click();
  await field("Expression").fill("sum(x ** 2) + slow(x)");
  await side("Test a candidate").click();
  const helpersBefore = helpWorkers;
  await button("Fill with a random candidate").click();
  await alert.filter({ hasText: "This takes too long, so it was stopped after 5 seconds." }).waitFor({ timeout: 20000 });
  assert.ok(helpWorkers >= helpersBefore + 2);
  // the page is still alive
  await side("Objective").click();
  await field("Expression").fill("sum(x ** 2)");
  await saved();
  say(`a loop over a huge range: "${await status.innerText()}"`);

  // 11. A hard reload (no cache): the projects come first, and every result is still there.
  await toList();
  const cdp = await context.newCDPSession(page);
  await Promise.all([page.waitForEvent("load"), cdp.send("Page.reload", { ignoreCache: true })]);
  await heading("Your projects").waitFor();
  assert.equal(await page.locator("main h2").first().innerText(), "Your projects");
  // the theme chosen at the start is still applied after the reload
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.equal(await page.locator("table.projects tbody tr").count(), 14);
  await button("New blank project").waitFor();
  await fromList("Benchmark functions");
  await result.waitFor();
  const again = await result.innerText();
  assert.equal(again, first);
  assert.equal(await status.innerText(), "");
  await toList();
  await fromList("Long benchmark");
  await page.waitForTimeout(300);
  assert.equal(await result.count(), 0);
  // the projects built by hand are there as they were left
  await toList();
  await fromList("My line fit");
  await result.waitFor();
  assert.equal(await result.innerText(), mine);
  await side("Objective").click();
  assert.equal(await field("Expression").inputValue(), squared);
  await side("Data").click();
  assert.deepEqual([await field("Unit of column 0").inputValue(), await field("Unit of column 1").inputValue()], ["V", "kPa"]);
  await toList();
  await fromList("My knapsack");
  await result.waitFor();
  assert.equal(await result.innerText(), pso);
  await side("GA run").click();
  assert.equal(await result.innerText(), again2);
  assert.equal(await field("pop_size").inputValue(), "50");
  assert.equal(await field("Seed").inputValue(), "2");
  // the comparison is still there, with the definition it ran, and so is the note when the project has changed since
  await toList();
  await fromList("0/1 knapsack");
  await side("Compare experiments").click();
  assert.equal(await page.locator(".comparison table").first().innerText(), compared);
  assert.equal(await page.locator(".comparison").getByText("has changed since this comparison").count(), 0);
  await side("Objective").click();
  await field("Expression").fill("sum(value * take) + 0");
  await side("Compare experiments").click();
  await page.locator(".comparison").getByText("has changed since this comparison").waitFor();
  assert.equal(await page.locator(".comparison table").first().innerText(), compared);
  await saved();
  await toList();
  await fromList("My knapsack");
  await side("GA run").click();
  // the downloaded file carries both experiments, and no results
  [download] = await Promise.all([page.waitForEvent("download"), button("Download project").click()]);
  const file = await read(download);
  assert.deepEqual(file.run, { method: "pso", settings: {}, budget: 20000, seed: 1, name: "PSO quick run" });
  assert.deepEqual(file.experiments, [{ id: "e2", name: "GA run", method: "ga", settings: { pop_size: 50 }, budget: 20000, seed: 2 }]);
  assert.equal(parseProject(file).name, "My knapsack");

  // what is the user's own and what still is a suggestion are both as they were left
  await toList();
  // a new name given in the list of projects keeps what is still a suggestion
  await button("Rename My edits").click();
  await field("Project name", dialog).fill("My edits, renamed");
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await button("Open My edits, renamed").waitFor();
  await fromList("My edits, renamed");
  // the history of edits belongs to one visit: after a reload there is nothing to undo
  await side("Variables").click();
  await heading("Variables").click();
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(200);
  assert.equal(await page.locator("fieldset.item").count(), 3);
  assert.equal(await page.locator(".run-status button").count(), 0);
  await side("Quick run").click();
  assert.equal(await chosen(field("Solver")), "de");
  assert.equal(await page.locator(".suggested").count(), 0);
  await side("Experiment 2").click();
  assert.match(await page.locator(".suggested").innerText(), /because it mixes orderings/);
  await side("Variables").click();
  await button("Remove variable x").click();
  await status.filter({ hasText: 'The variable x was removed. The suggested settings of "Experiment 2" changed with the variables.' }).waitFor();
  await side("Quick run").click();
  assert.equal(await chosen(field("Solver")), "de");
  await side("Experiment 2").click();
  assert.equal(await page.locator(".suggested").innerText(), `${METHODS.ga.name} is suggested for this project because it holds yes or no values or whole numbers. You can change it.`);
  await page.getByText(`Settings of ${METHODS.ga.name}`).click();
  assert.equal(await chosen(field("Work on")), "encoded");
  // the first experiment is deleted: the next one takes its place, and is still the suggestion
  await side("Quick run").click();
  await button("Delete").click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(await field("Name of the experiment").inputValue(), "Experiment 2");
  await page.locator(".suggested").waitFor();
  assert.equal(await page.locator(".sidebar ul").nth(2).getByRole("button").count(), 2);
  // deleting an experiment starts the history again, so the removal of the variable before it can no longer be undone
  await page.waitForFunction(() => document.activeElement.id === "panel-heading");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".sidebar ul").nth(2).getByRole("button").count(), 2);
  await side("Variables").click();
  assert.equal(await page.locator("fieldset.item").count(), 2);
  // and the experiment that moved up still follows the variables
  await button("Add a variable").click();
  await choose(field("What it holds", card(2)), "permutation");
  await status.filter({ hasText: 'The suggested settings of "Experiment 2" changed with the variables.' }).waitFor();
  await saved();
  await shot("08-after-reload");
  say("after a hard reload: 14 projects listed first, an experiment changed by hand stays as it is while one that is still a suggestion follows the variables, also after the project was renamed in the list and after the first experiment was deleted, the history of edits starts again, the benchmark result is unchanged, the cancelled run has none, both built projects are as they were left, each experiment of the knapsack keeps its own result, and the stored comparison is there and notes a later edit");

  // one worker per run, and for each of the two comparisons as many workers as the app's rule gives on this computer
  const pools = 2 * Math.max(1, Math.min(((await page.evaluate(() => navigator.hardwareConcurrency)) || 2) - 1, 8, 15));
  assert.equal(runWorkers, 19 + pools, "one worker per run, and one pool per comparison");
  assert.deepEqual(problems, []);
  say(`${runWorkers} run workers (19 runs and ${pools} for two comparisons) and ${helpWorkers} helper workers loaded, no page errors, no failed requests, no requests outside the site`);
  await context.close();
}

// A launch of the installed Chrome sometimes fails for reasons outside the app, so it gets a second try.
let browser;
for (let attempt = 1; !browser; attempt++) {
  try {
    browser = await chromium.launch({ channel: "chrome" });
  } catch (error) {
    if (attempt === 2) {
      console.error(`Chrome could not be started:\n${error.message}`);
      process.exit(1);
    }
    console.log("Chrome did not start. Trying once more.");
  }
}
try {
  console.log(`Chrome ${browser.version()}`);
  await check(browser, "/");
  await check(browser, "/preview/studio/");
  console.log("\nBrowser check passed.");
} catch (error) {
  console.error(`\nBrowser check FAILED\n${error.stack}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  process.exit(); // the servers are still listening
}
