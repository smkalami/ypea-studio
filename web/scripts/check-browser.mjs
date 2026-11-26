// Checks the built app in the installed Chrome: once served at the root of a site, and once
// under a subpath, as a preview build on GitHub Pages is. Run with `npm run check:browser`,
// which builds first. No browser is downloaded.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { parseProject } from "../../engine/project.ts";
import { testCandidate } from "../../engine/run.ts";

const dist = new URL("../dist/", import.meta.url);
const example = async (name) => JSON.parse(await readFile(new URL(`../../examples/${name}.json`, import.meta.url), "utf8"));
const csv = (name) => fileURLToPath(new URL(`../../examples/data/${name}.csv`, import.meta.url));
const benchmark = await example("benchmark");
const linefit = await example("linefit");
const tsp = await example("tsp");
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
  /** Waits for the end of a run. A run that ends in a message instead of a result fails here, with that message. */
  const finished = async () => {
    await page.waitForFunction(() => {
      const region = document.querySelector("[role=status]");
      return region.textContent.includes("Run finished") || region.classList.contains("notice");
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
  say("static HTML holds the description and the Use YPEA in Python link");

  // 2. A new visitor sees the examples and no project list.
  await page.goto(site.url);
  await heading("Try an example").waitFor();
  assert.equal(await heading("Your projects").count(), 0);
  await button("New blank project").waitFor();
  await shot("01-welcome");
  say("new visitor: Try an example is shown, with no project list, and a blank project can be started");
  // keyboard focus is visible: Tab reaches the link first, then the first example button
  for (const expected of ["Use YPEA in Python", "Calibration line fit"]) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => [document.activeElement.textContent, getComputedStyle(document.activeElement).outlineStyle, getComputedStyle(document.activeElement).outlineWidth]);
    assert.deepEqual(focused, [expected, "solid", "3px"]);
  }
  say("keyboard focus shows a 3px outline on the link and on a button");

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
  await result.getByRole("img", { name: /^12 data points of pressure \(kPa\) against voltage \(V\), with the fitted line\. The line is at most [\d.]+ kPa away from a point\.$/ }).waitFor();
  await shot("02-linefit-result");
  say("line fit: ran to the end, is compared with the current settings and the least-squares line, and draws the fitted line");

  // 7. Duplicate, rename, download and delete, from the list.
  await toList();
  await button("Duplicate Benchmark functions").click();
  await button("Rename Benchmark functions copy").waitFor();
  page.once("dialog", (dialog) => dialog.accept("Renamed copy"));
  await button("Rename Benchmark functions copy").click();
  await button("Download Renamed copy").waitFor();
  const read = async (download) => JSON.parse(await readFile(await download.path(), "utf8"));
  let [download] = await Promise.all([page.waitForEvent("download"), button("Download Renamed copy").click()]);
  assert.equal(download.suggestedFilename(), "Renamed-copy.json");
  assert.deepEqual(await read(download), { ...benchmark, name: "Renamed copy" });
  page.once("dialog", (dialog) => dialog.accept());
  await button("Delete Renamed copy").click();
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
  const card = (n) => page.locator("fieldset.card").nth(n);
  for (const [n, name, low, high, unit] of [[0, "offset", "-10", "10", "kPa"], [1, "gain", "0", "100", "kPa/V"]]) {
    await button("Add a variable").click();
    await field("Name", card(n)).fill(name);
    await field("Lowest value", card(n)).fill(low);
    await field("Highest value", card(n)).fill(high);
    await field("Unit", card(n)).fill(unit);
  }
  assert.equal(await field("What it holds", card(0)).locator("option").count(), 11);
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
  await field("Preset").selectOption("squared-error");
  // the preset offers the names that exist, and starts each need on a name of its own
  assert.deepEqual(await field("Measured values (data column)").locator("option").allInnerTexts(), ["voltage", "pressure"]);
  assert.deepEqual(await field("Gain variable").locator("option").allInnerTexts(), ["offset", "gain"]);
  assert.deepEqual([await field("Offset variable").inputValue(), await field("Gain variable").inputValue()], ["offset", "gain"]);
  await field("Measured values (data column)").selectOption("pressure");
  await field("Input values (data column)").selectOption("voltage");
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
  await field("What to draw").selectOption("line");
  await field("Column along the bottom (x)").selectOption("voltage");
  await field("Column up the side (y)").selectOption("pressure");
  await field("Expression of the line").fill("offset + gain * voltage");

  // test a candidate by hand: the current settings of the example
  await side("Candidate").click();
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
  await field("What it holds", card(0)).selectOption("binary");
  await field("Shape", card(0)).selectOption("1");
  await field("Number of values", card(0)).fill("20");
  await side("Objective").click();
  await field("Goal").selectOption("max");
  await field("Unit").fill("$");
  await page.getByText("Write the expression from a preset").click();
  await field("Preset").selectOption("selected-total");
  await field("Value of each item (data column)").selectOption("value");
  await button("Write the expression").click();
  assert.equal(await field("Expression").inputValue(), "sum(value * take)");
  await side("Constraints").click();
  await page.getByText("Add a capacity limit from a preset").click();
  await field("Size of each item (data column)").selectOption("weight");
  await field("Limit").fill("50");
  await button("Add the capacity limit").click();
  assert.deepEqual(
    [await field("Name", card(0)).inputValue(), await field("Left side").inputValue(), await field("Comparison").inputValue(), await field("Right side").inputValue(), await field("Unit", card(0)).inputValue()],
    ["Total weight", "sum(weight * take)", "<=", "50", "kg"],
  );
  await side("Drawing").click();
  await field("What to draw").selectOption("selection");
  assert.equal(await field("Yes or no variable").inputValue(), "take");
  await field("Column for the size of each item").selectOption("weight");
  // check boxes that were never touched are zeros: nothing taken, then item 4 alone (2 kg, 86 $)
  await side("Candidate").click();
  assert.equal(await page.locator("fieldset.checks input").count(), 20);
  await button("Test this candidate").click();
  await tested.filter({ hasText: /Objective \(to maximize\)\s*0 \$/ }).waitFor();
  await page.locator("fieldset.checks").getByLabel("4", { exact: true }).check();
  await button("Test this candidate").click();
  await tested.filter({ hasText: /Objective \(to maximize\)\s*86 \$.*Total weight\s*2 kg\s*at most 50 kg\s*Yes/ }).waitFor();
  say('knapsack: the presets wrote "sum(value * take)" and the constraint "Total weight": sum(weight * take) <= 50 kg');

  // the first experiment uses the default solver, which is not made for yes or no values: a note, not a block
  await side("Quick run").click();
  const note = page.getByRole("note");
  assert.match(await note.innerText(), /^Note: Particle Swarm Optimization is not made for yes or no values, which this project has\. It will run, but it may give a weak result\. Solvers that suit every variable of this project: Random Search, Genetic Algorithm, Simulated Annealing\.$/);
  await field("Name of the experiment").fill("PSO quick run");
  // a second experiment, as a copy with another solver and one of its settings changed
  await button("New experiment").click();
  await field("Name of the experiment").fill("GA run");
  await field("Solver").selectOption("ga");
  await note.waitFor({ state: "detached" });
  await page.getByText("Settings of Genetic Algorithm").click();
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
  assert.match(await page.locator(".pane .empty").innerText(), /"GA run" has no result yet/);

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
  say(`knapsack ran twice. GA run: ${value} with total weight ${weight} of at most 50 kg. PSO quick run keeps its own result, with the note that the solver does not suit yes or no values`);

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

  // 10. Code that takes too long is stopped, by ending its worker.
  await toList();
  await fromList("Long benchmark");
  await side("Functions").click();
  await field("Function definitions").fill("def slow(a):\n    s = 0\n    for i in range(1000000000000):\n        s += i\n    return s\n");
  await side("Objective").click();
  await field("Expression").fill("sum(x ** 2) + slow(x)");
  await side("Candidate").click();
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
  assert.equal(await page.locator("table.projects tbody tr").count(), 7);
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
  // the downloaded file carries both experiments, and no results
  [download] = await Promise.all([page.waitForEvent("download"), button("Download project").click()]);
  const file = await read(download);
  assert.deepEqual(file.run, { method: "pso", settings: {}, budget: 20000, seed: 1, name: "PSO quick run" });
  assert.deepEqual(file.experiments, [{ id: "e2", name: "GA run", method: "ga", settings: { pop_size: 50 }, budget: 20000, seed: 2 }]);
  assert.equal(parseProject(file).name, "My knapsack");
  await shot("08-after-reload");
  say("after a hard reload: 7 projects listed first, the benchmark result is unchanged, the cancelled run has none, both built projects are as they were left, and each experiment of the knapsack keeps its own result");

  assert.equal(runWorkers, 9, "one worker per run");
  assert.deepEqual(problems, []);
  say(`${runWorkers} run workers and ${helpWorkers} helper workers loaded, no page errors, no failed requests, no requests outside the site`);
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
