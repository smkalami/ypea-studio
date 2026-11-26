// Checks the built app in the installed Chrome: once served at the root of a site, and once
// under a subpath, as a preview build on GitHub Pages is. Run with `npm run check:browser`,
// which builds first. No browser is downloaded.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname } from "node:path";
import { chromium } from "playwright-core";

const dist = new URL("../dist/", import.meta.url);
const benchmark = JSON.parse(await readFile(new URL("../../examples/benchmark.json", import.meta.url), "utf8"));
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
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems = [];
  let workers = 0;
  page.on("worker", () => workers++);
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("console", (message) => message.type() === "error" && problems.push(`console error: ${message.text()}`));
  page.on("requestfailed", (request) => problems.push(`request failed: ${request.url()}`));
  page.on("response", (response) => response.status() >= 400 && problems.push(`status ${response.status()}: ${response.url()}`));
  page.on("request", (request) => {
    if (!/^(data|blob):/.test(request.url()) && !request.url().startsWith(site.url)) problems.push(`request outside the site: ${request.url()}`);
  });

  const button = (name) => page.getByRole("button", { name, exact: true });
  const heading = (name) => page.getByRole("heading", { name, exact: true });
  const status = page.getByRole("status");
  const result = page.locator(".result");
  const fromList = async (name) => {
    await button(`Open ${name}`).click();
    await heading(name).waitFor();
  };
  const toList = async () => {
    await button("All projects").click();
    await heading("Your projects").waitFor();
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
  say("new visitor: Try an example is shown, with no project list");
  // keyboard focus is visible: Tab reaches the link first, then the first example button
  for (const expected of ["Use YPEA in Python", "Calibration line fit"]) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => [document.activeElement.textContent, getComputedStyle(document.activeElement).outlineStyle, getComputedStyle(document.activeElement).outlineWidth]);
    assert.deepEqual(focused, [expected, "solid", "3px"]);
  }
  say("keyboard focus shows a 3px outline on the link and on a button");

  // 3. Create the benchmark project and run it to the end.
  await button("Benchmark functions").click();
  await heading("Benchmark functions").waitFor();
  await button("Run").click();
  await status.filter({ hasText: "Run finished. Best feasible solution found." }).waitFor();
  const first = await result.innerText();
  assert.match(first, /Best feasible solution found\./);
  assert.match(first, /Objective \(minimized\)\s+[\d.e-]+/);
  assert.match(first, /Known answer: reference\s+0\s+Difference from the known answer\s+[\d.e-]+/);
  assert.match(first, /Evaluations\s+20,000 of 20,000/);
  assert.match(first, /Time\s+[\d.]+ m?s/);
  assert.match(first, /x\s+\[(-?[\d.e-]+, ){9}-?[\d.e-]+\]/);
  assert.match(first, /This is one run of a randomized method \(pso\) with a recorded seed \(seed 1, run 0\)/);
  const objective = first.match(/Objective \(minimized\)\s+(\S+)/)[1];
  assert.equal(Number(objective), 3.97294e-12); // the seeded run of the command line, to six digits
  say(`benchmark ran to the end: objective ${objective}, ${first.match(/20,000 of 20,000/)[0]} evaluations`);

  // 4. Open a long project from disk, see live progress, and cancel.
  await toList();
  await page.locator("input[type=file]").setInputFiles({ name: "long.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(long)) });
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
  await page.locator("input[type=file]").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...benchmark, version: 7 })) });
  const alert = page.getByRole("alert");
  await alert.waitFor();
  assert.match(await alert.innerText(), /Project file: version 7 is not supported/);
  say(`bad file: "${await alert.innerText()}"`);

  // 6. An example with data, a baseline and a known answer runs, and reports against both.
  await button("Calibration line fit").click();
  await heading("Calibration line fit").waitFor();
  await button("Run").click();
  await status.filter({ hasText: "Run finished" }).waitFor();
  const fit = await page.locator(".result").innerText();
  assert.match(fit, /Best feasible solution found/);
  assert.match(fit, /In use today: Current settings/);
  assert.match(fit, /Known answer: Least-squares line/);
  say("line fit: ran to the end and is compared with the current settings and the least-squares line");

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

  // 8. A hard reload (no cache): the projects come first, and the result is still there.
  const cdp = await context.newCDPSession(page);
  await Promise.all([page.waitForEvent("load"), cdp.send("Page.reload", { ignoreCache: true })]);
  await heading("Your projects").waitFor();
  assert.equal(await page.locator("main h2").first().innerText(), "Your projects");
  assert.equal(await page.locator("tbody tr").count(), 3);
  await fromList("Benchmark functions");
  await result.waitFor();
  const again = await result.innerText();
  assert.equal(again, first);
  assert.equal(await status.innerText(), "");
  await toList();
  await fromList("Long benchmark");
  await page.waitForTimeout(300);
  assert.equal(await result.count(), 0);
  say("after a hard reload: 3 projects listed first, the benchmark result is unchanged, the cancelled run has none");

  assert.equal(workers, 3, "one worker per run");
  assert.deepEqual(problems, []);
  say(`${workers} workers loaded, no page errors, no failed requests, no requests outside the site`);
  await context.close();
}

let browser;
try {
  browser = await chromium.launch({ channel: "chrome" });
} catch (error) {
  console.error(`Chrome could not be started:\n${error.message}`);
  process.exit(1);
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
