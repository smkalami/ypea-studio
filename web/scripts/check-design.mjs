// Walks every screen of the built app in the installed Chrome, at several window sizes and in
// both themes, and checks what can be measured: no sideways scrolling of the page, no control
// outside the window, at most one filled primary button, equal insets of chevrons, equal
// heights of controls in a row, a visible focus halo, a clean console, and the rules of the
// axe accessibility scanner. With OUT set to a folder, it also saves a picture of each screen.
//
// Run after a build: node scripts/check-design.mjs            (every size, both themes)
//                    node scripts/check-design.mjs 1280       (one width only)

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const dist = new URL("../dist/", import.meta.url);
const axeSource = await readFile(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const tsp = JSON.parse(await readFile(new URL("../../examples/tsp.json", import.meta.url), "utf8"));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
const out = process.env.OUT;

// The last entry stands for 200 percent zoom of a 1280 by 800 window: the same layout width, at twice the pixel density.
const SIZES = [
  { name: "1280", width: 1280, height: 800 }, { name: "390", width: 390, height: 844 }, { name: "320", width: 320, height: 640 },
  { name: "768", width: 768, height: 1024 }, { name: "1440", width: 1440, height: 900 },
  { name: "640-as-200-percent-of-1280", width: 640, height: 400, deviceScaleFactor: 2 },
].filter((size) => !process.argv[2] || size.name.startsWith(process.argv[2]));

const server = createServer(async (request, response) => {
  const file = new URL(request.url, "http://localhost").pathname.slice(1) || "index.html";
  try {
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(await readFile(new URL(file, dist)));
  } catch {
    response.writeHead(404).end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const findings = [];
const measured = {};
let screens = 0;

/** What the page itself can measure about the screen that is shown. */
function measure() {
  const problems = [];
  const root = document.documentElement, width = root.clientWidth;
  if (root.scrollWidth > width) problems.push(`the page scrolls sideways: ${root.scrollWidth} wide in a window of ${width}`);
  const top = [...document.querySelectorAll("dialog[open]")].at(-1);
  const scope = top ?? document;
  const visible = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
  // controls that leave the window, unless they are inside a box that scrolls on its own
  for (const control of scope.querySelectorAll("button, a, input:not([hidden]):not(.visually-hidden), textarea, summary, [role=combobox]")) {
    if (!visible(control) || control.closest(".table-box, .drawing-box, .visually-hidden")) continue;
    const box = control.getBoundingClientRect();
    if (box.left < -0.5 || box.right > width + 0.5) problems.push(`outside the window: ${control.tagName} "${(control.getAttribute("aria-label") ?? control.textContent).trim().slice(0, 40)}" from ${box.left.toFixed(1)} to ${box.right.toFixed(1)}`);
    if (box.width < 24 || box.height < 24) {
      // a small box is fine when the label around it is the target
      const label = control.closest("label");
      const target = label ? label.getBoundingClientRect() : box;
      if (target.width < 24 || target.height < 24) problems.push(`a target under 24px: ${control.tagName} "${control.textContent.trim().slice(0, 30)}" ${box.width.toFixed(0)} by ${box.height.toFixed(0)}`);
    }
  }
  const primaries = [...scope.querySelectorAll(".btn-primary")].filter(visible);
  if (primaries.length > 1) problems.push(`${primaries.length} filled primary buttons: ${primaries.map((b) => b.textContent.trim()).join(", ")}`);
  // a chevron is as far from the end edge as the text is from the start edge
  const pad = parseFloat(getComputedStyle(root).getPropertyValue("--space-sm"));
  for (const holder of scope.querySelectorAll(".select-trigger, .disclosure > summary")) {
    if (!visible(holder)) continue;
    const box = holder.getBoundingClientRect(), style = getComputedStyle(holder);
    const chevron = holder.querySelector(".chevron").getBoundingClientRect(), text = holder.querySelector("span").getBoundingClientRect();
    const end = box.right - parseFloat(style.borderRightWidth) - chevron.right, start = text.left - box.left - parseFloat(style.borderLeftWidth);
    const middle = Math.abs((chevron.top + chevron.bottom) / 2 - (box.top + box.bottom) / 2);
    if (Math.abs(end - pad) > 0.5 || Math.abs(start - pad) > 0.5 || middle > 0.5) problems.push(`chevron inset: end ${end.toFixed(1)}, text start ${start.toFixed(1)}, expected ${pad}, off center by ${middle.toFixed(1)}`);
  }
  // the controls of one row have one height
  for (const row of scope.querySelectorAll(".row")) {
    const heights = new Set([...row.querySelectorAll(":scope > .field > .input, :scope > .field > .select > .input")].filter(visible).map((c) => Math.round(c.getBoundingClientRect().height)));
    if (heights.size > 1) problems.push(`controls of one row differ in height: ${[...heights].join(", ")}`);
  }
  // a button beside the fields of a row stands at the middle of their controls, while it is on their line
  for (const beside of scope.querySelectorAll(".row > .beside-field")) {
    const control = beside.parentElement.querySelector(":scope > .field > .input");
    if (!visible(beside) || !control) continue;
    const box = beside.getBoundingClientRect(), other = control.getBoundingClientRect();
    if (box.top >= other.bottom) continue; // wrapped onto a line of its own in a narrow window
    const off = Math.abs((box.top + box.bottom) / 2 - (other.top + other.bottom) / 2);
    if (off > 0.5) problems.push(`a button beside a field is off the middle of the control by ${off.toFixed(1)}`);
  }
  // an offer in a hint: when its button wraps onto a line of its own, its words start where the words of the hint start
  for (const offer of scope.querySelectorAll(".hint .btn")) {
    if (!visible(offer)) continue;
    const box = offer.getBoundingClientRect(), hint = offer.closest(".hint").getBoundingClientRect();
    const start = box.left + parseFloat(getComputedStyle(offer).paddingLeft) + parseFloat(getComputedStyle(offer).borderLeftWidth);
    const wrapped = box.left < hint.left + 1;
    if (wrapped && Math.abs(start - hint.left) > 0.5) problems.push(`the words of an offer start at ${start.toFixed(1)}, the hint at ${hint.left.toFixed(1)}`);
  }
  // text under 12px
  for (const element of scope.querySelectorAll("p, span, label, button, a, th, td, dt, dd, li, legend, figcaption, input, textarea, h1, h2, h3, h4")) {
    if (visible(element) && parseFloat(getComputedStyle(element).fontSize) < 12) problems.push(`text under 12px: ${element.tagName} "${element.textContent.trim().slice(0, 30)}"`);
  }
  return [...new Set(problems)];
}

// ---- figures, start: what the page can measure about every drawing and chart that is shown
/**
 * For every figure on the screen: no two texts overlap, no text is cut by the edge of the figure, the text is at its full size,
 * every axis of a chart has at least three tick labels, and every series that has a color also has its name as text.
 */
function measureFigures() {
  const problems = [];
  for (const svg of document.querySelectorAll(".drawing svg")) {
    if (svg.getClientRects().length === 0) continue;
    const name = `the figure "${(svg.getAttribute("aria-label") ?? "").slice(0, 36)}"`;
    const frame = svg.getBoundingClientRect();
    if (frame.width / svg.viewBox.baseVal.width < 0.999) problems.push(`${name} is drawn smaller than its natural size, so its text is under 12px`);
    // the box of the letters themselves on the screen, without the halo around a label, also for a text that is turned
    const boxOf = (text) => {
      const box = text.getBBox(), matrix = text.getScreenCTM();
      const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
      const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
      return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    };
    const texts = [...svg.querySelectorAll("text")].map((text) => ({ words: text.textContent, box: boxOf(text) }));
    for (let i = 0; i < texts.length; i++) {
      const a = texts[i].box;
      if (a.left < frame.left - 0.5 || a.right > frame.right + 0.5 || a.top < frame.top - 0.5 || a.bottom > frame.bottom + 0.5) problems.push(`${name}: the text "${texts[i].words}" is cut by the edge of the figure`);
      for (let j = 0; j < i; j++) {
        const b = texts[j].box;
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) problems.push(`${name}: the texts "${texts[j].words}" and "${texts[i].words}" overlap`);
      }
    }
    for (const axis of ["x", "y"]) {
      const ticks = svg.querySelectorAll(`text[data-tick=${axis}]`).length;
      if (ticks > 0 && ticks < 3) problems.push(`${name}: the ${axis} axis has ${ticks} tick labels`);
    }
    if (svg.querySelector("[data-tick]") && !svg.querySelector("text[data-tick=x]")) problems.push(`${name}: a chart without tick labels along the bottom`);
    for (const series of new Set([...svg.querySelectorAll(":not(text)[data-series]")].map((mark) => mark.getAttribute("data-series")))) {
      // its name beside its line, and its entry in the legend
      const named = svg.querySelectorAll(`text[data-series="${series}"]`).length;
      if (named < 2) problems.push(`${name}: series ${series} has a color and ${named} of its 2 texts (its name on the figure and its legend entry)`);
    }
  }
  return [...new Set(problems)];
}
// ---- figures, end

async function walk(browser, size, theme) {
  const label = `${size.name} ${theme}`;
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.deviceScaleFactor ?? 1, colorScheme: theme });
  const page = await context.newPage();
  page.on("pageerror", (error) => findings.push(`${label}: page error: ${error.message}`));
  page.on("console", (message) => ["error", "warning"].includes(message.type()) && findings.push(`${label}: console ${message.type()}: ${message.text()}`));
  page.on("requestfailed", (request) => findings.push(`${label}: request failed: ${request.url()}`));
  if (out) await mkdir(`${out}/${size.name}-${theme}`, { recursive: true });

  let number = 0;
  /** Checks the screen that is shown, and saves its picture. */
  const audit = async (name) => {
    screens++;
    const id = `${String(++number).padStart(2, "0")}-${name}`;
    await page.waitForTimeout(250); // transitions end
    for (const problem of [...await page.evaluate(measure), ...await page.evaluate(measureFigures)]) findings.push(`${label}, ${id}: ${problem}`);
    await page.addScriptTag({ content: axeSource });
    const scan = await page.evaluate(() => window.axe.run(document, { resultTypes: ["violations"] }));
    for (const violation of scan.violations) {
      findings.push(`${label}, ${id}: axe ${violation.id} (${violation.impact}): ${violation.help}. ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
    }
    if (out) await page.screenshot({ path: `${out}/${size.name}-${theme}/${id}.png`, fullPage: true });
  };
  const button = (name) => page.getByRole("button", { name, exact: true });
  const field = (name, within = page) => within.getByLabel(name, { exact: true });
  const narrow = size.width < 1180;
  /** Shows an entry of the sidebar. In a narrow window the sidebar is a drawer. */
  const go = async (name) => {
    if (narrow) await button("Show the parts of the project").click();
    await page.locator(".sidebar").getByRole("button", { name: new RegExp(`^${name}`) }).click();
    if (narrow) await page.locator("dialog.drawer[open]").waitFor({ state: "detached" });
  };
  const choose = async (box, value) => {
    await box.click();
    await page.getByRole("listbox").locator(`[data-value="${value}"]`).click();
  };
  /** The halo of a button that the keyboard reached: it is left and reached again, so that the focus is one that shows. */
  const haloOf = async (name, what) => {
    await button(name).focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await page.waitForTimeout(250);
    const [reached, shadow] = await page.evaluate(() => [(document.activeElement.getAttribute("aria-label") ?? document.activeElement.textContent).trim(), getComputedStyle(document.activeElement).boxShadow]);
    if (reached !== name || shadow === "none") findings.push(`${label}: no focus halo on ${what}: the focus is on "${reached}" with ${shadow}`);
    measured[`${theme}: halo of ${what}`] = shadow;
  };
  const toList = async () => {
    await button("All projects").click();
    await page.getByRole("heading", { name: "Your projects" }).waitFor();
  };

  await page.goto(url);
  await button("Calibration line fit").waitFor();
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), theme);
  // The scanner is tried on a fault first: a picture without a text must be reported, or its silence means nothing.
  await page.addScriptTag({ content: axeSource });
  const planted = await page.evaluate(async () => {
    const picture = document.body.appendChild(document.createElement("img"));
    const scan = await window.axe.run(document, { resultTypes: ["violations"] });
    picture.remove();
    return scan.violations.map((violation) => violation.id);
  });
  assert.ok(planted.includes("image-alt"), "the scanner reports a planted fault");
  await audit("welcome-new-visitor");

  // Keyboard only, from the first Tab to a result: open the first example and run it.
  for (let n = 0; n < 12 && (await page.evaluate(() => document.activeElement.textContent.trim())) !== "Calibration line fit"; n++) await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await button("Run").waitFor();
  await audit("experiment-no-result");
  for (let n = 0; n < 30 && (await page.evaluate(() => document.activeElement.textContent.trim())) !== "Run"; n++) await page.keyboard.press("Tab");
  // the halo of the focused Run button: its edge against the page, as a contrast ratio
  await page.waitForTimeout(250);
  measured[`${theme}: halo of the filled Run button`] = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
  await audit("focus-on-run");
  await page.keyboard.press("Enter");
  await page.locator(".result").waitFor();
  await audit("result");
  // Going back up with the keyboard: nothing that takes the focus may end under the run bar that stays in view.
  await button("Run again with a new seed").focus();
  for (let n = 0; n < 14; n++) {
    await page.keyboard.press("Shift+Tab");
    await page.waitForTimeout(60);
    const hidden = await page.evaluate(() => {
      const bar = document.querySelector(".runbar"), element = document.activeElement;
      if (getComputedStyle(bar).position !== "sticky" || bar.contains(element) || !element.closest(".panel")) return "";
      const top = element.getBoundingClientRect().top, edge = bar.getBoundingClientRect().bottom;
      return top < edge - 0.5 ? `${element.tagName} "${(element.getAttribute("aria-label") ?? element.textContent).trim().slice(0, 30)}" starts at ${top.toFixed(0)}, the bar ends at ${edge.toFixed(0)}` : "";
    });
    if (hidden) findings.push(`${label}: the focus is under the run bar: ${hidden}`);
  }
  await page.evaluate(() => window.scrollTo(0, 0));

  if (narrow) {
    // the drawer: it takes the focus, Escape closes it, and the focus returns to its button
    await button("Show the parts of the project").focus();
    await page.keyboard.press("Enter");
    await page.locator("dialog.drawer[open]").waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.closest("dialog") !== null), true, "the focus is inside the drawer");
    await audit("drawer-open");
    await page.keyboard.press("Escape");
    await page.locator("dialog.drawer[open]").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Show the parts of the project");
  }

  for (const part of ["Overview", "Data", "Variables", "Objective", "Constraints", "Functions", "Drawing"]) {
    await go(part);
    await audit(part.toLowerCase());
  }
  // a list of choices, open, and a field that has the focus
  await go("Variables");
  const holds = field("What it holds", page.locator("fieldset.item").first());
  await holds.click();
  await page.getByRole("listbox").waitFor();
  await audit("variables-choice-open");
  await page.keyboard.press("Escape");
  await field("Name", page.locator("fieldset.item").first()).focus();
  await page.waitForTimeout(250);
  measured[`${theme}: halo of a field`] = await page.evaluate(() => [getComputedStyle(document.activeElement).boxShadow, getComputedStyle(document.activeElement).borderColor].join(" | border "));
  await audit("variables-field-focus");

  // a problem next to its field, and a run that is refused
  await go("Objective");
  await field("Expression").fill("sum((pressure - offset)\n  ** )");
  await page.locator(".problems").waitFor();
  await audit("objective-problem");
  await button("Run").click();
  await page.locator(".run-status[data-state=error]").waitFor();
  await audit("run-refused");
  await field("Expression").fill("sum((pressure - (offset + gain * voltage)) ** 2)");
  await page.locator(".problems").waitFor({ state: "detached" });
  await page.getByText("Write the expression from a preset").click();
  await audit("objective-preset-open");

  await go("Test a candidate");
  await audit("candidate");
  await button("Test this candidate").click();
  await page.locator(".tested").waitFor();
  await audit("candidate-tested");
  await field("gain (kPa/V)").fill("500");
  await button("Test this candidate").click();
  await page.getByRole("alert").waitFor();
  await audit("candidate-refused");

  // the list of projects and its dialogs
  await page.evaluate(() => window.scrollTo(0, 0));
  await toList();
  await audit("project-list");
  await button("Rename Calibration line fit").click();
  await page.getByRole("dialog").waitFor();
  await audit("dialog-rename");
  await field("Project name", page.getByRole("dialog")).fill("");
  await page.getByRole("dialog").getByRole("button", { name: "Rename", exact: true }).click();
  await audit("dialog-rename-refused");
  await page.keyboard.press("Escape");
  await button("Delete Calibration line fit").click();
  await page.getByRole("dialog").waitFor();
  // the keyboard moves away and back, so that the focus on Cancel is one that shows
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await page.waitForTimeout(250);
  measured[`${theme}: halo of a quiet button (Cancel in a dialog)`] = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
  await audit("dialog-delete");
  await page.keyboard.press("Escape");
  // a file that is not a project
  await page.locator("#project-file").setInputFiles({ name: "not-a-project.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await page.getByRole("alert").waitFor();
  await audit("project-list-file-refused");

  // the knapsack: a constraint, check boxes, a solver that was designed for other values, settings, two experiments
  await button("0/1 knapsack").click();
  await button("Run").waitFor();
  // a solver that was designed for other values than yes or no, to see the note
  await choose(field("Solver"), "pso");
  await page.getByRole("note").waitFor();
  await page.getByText("Settings of").click();
  await audit("experiment-note-and-settings");
  await go("Constraints");
  await audit("constraints-one");
  await go("Test a candidate");
  await page.locator("fieldset.checks").getByLabel("4", { exact: true }).check();
  await audit("candidate-check-boxes");
  await go("New experiment");
  await choose(field("Solver"), "ga");
  await button("Run").click();
  await page.locator(".result").waitFor();
  await audit("second-experiment-result");
  await button("Delete").click();
  await page.getByRole("dialog").waitFor();
  await audit("dialog-delete-experiment");
  await page.keyboard.press("Escape");

  // compare: the form with two budgets, a comparison that runs, seen from another part too, the summary with its charts, and share
  await field("Budget (evaluations)").fill("2000000000");
  await go("Compare experiments");
  await page.getByRole("note").waitFor();
  await page.getByLabel("Add Random Search as a reference").check();
  await field("Runs of each experiment").fill("0");
  await audit("compare-form-refused");
  await field("Runs of each experiment").fill("3");
  await field("Budget of every run (evaluations)").fill("2000000000");
  await button("Run the comparison").click();
  await page.locator(".comparing").waitFor();
  await audit("compare-running");
  await go("Variables");
  await audit("compare-running-seen-from-another-part");
  await button("Show the comparison").click();
  await button("Cancel the comparison").click();
  await page.getByText("Comparison cancelled.").waitFor();
  await audit("compare-cancelled-and-empty");
  await field("Budget of every run (evaluations)").fill("3000");
  await button("Run the comparison").click();
  await page.getByText("Comparison finished.").waitFor({ timeout: 120000 });
  await audit("compare-summary");
  await page.getByText("What ran: the setups and the seeds").click();
  await audit("compare-seeds-open");
  await go("Share");
  await audit("share");
  await field("Result to share").click();
  await page.getByRole("listbox").waitFor();
  await audit("share-choice-open");
  await page.keyboard.press("Escape");

  // vehicle routing: ordered groups, the drawing of several routes with its form, and the two presets that write helper functions
  await toList();
  await button("Vehicle routing").click();
  await button("Run").waitFor();
  await button("Run").click();
  await page.locator(".result").waitFor();
  await audit("routes-result");
  await go("Variables");
  await audit("routes-ordered-groups");
  await go("Drawing");
  await audit("routes-drawing-form");
  await go("Objective");
  await page.getByText("Write the expression from a preset").click();
  await choose(field("Preset"), "routes-length");
  await button("Write the expression").click();
  await page.getByText(/^Functions already has route_length, total_length/).waitFor();
  await audit("routes-objective-preset");
  await go("Constraints");
  await page.getByText("Add a constraint from a preset").click();
  await choose(field("Preset"), "largest-load");
  await audit("routes-constraint-preset");

  // ---- figures, start: the checks of figures are tried on planted faults, the chart of a run is read with the keyboard, and the examples that the walk has not run yet are run
  const runExample = async (name) => {
    await toList();
    await button(name).click();
    await button("Run").waitFor();
    await button("Run").click();
    await page.locator(".result").waitFor();
  };
  await runExample("Benchmark functions");
  // Planted faults: a text on top of a tick label, a text outside the figure, a value axis with two ticks, and a series with no name. Each must be reported, or the silence of the checks means nothing.
  await page.evaluate(() => {
    const svg = document.querySelector(".result .drawing svg"), tick = svg.querySelector("text[data-tick=x]");
    for (const x of [tick.getAttribute("x"), "-30"]) {
      const copy = svg.appendChild(tick.cloneNode(true));
      copy.removeAttribute("data-tick");
      copy.setAttribute("x", x);
      copy.setAttribute("data-planted", "");
    }
    svg.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "path")).setAttribute("data-series", "9");
    svg.lastChild.setAttribute("data-planted", "");
    for (const label of [...svg.querySelectorAll("text[data-tick=y]")].slice(2)) {
      label.removeAttribute("data-tick");
      label.setAttribute("data-was-tick", "");
    }
  });
  const faults = (await page.evaluate(measureFigures)).join("\n");
  for (const fault of [/" overlap$/m, /is cut by the edge of the figure$/m, /the y axis has 2 tick labels$/m, /series 9 has a color and 0 of its 2 texts/]) assert.match(faults, fault, "the checks of figures report a planted fault");
  await page.evaluate(() => {
    for (const planted of document.querySelectorAll("[data-planted]")) planted.remove();
    for (const label of document.querySelectorAll("[data-was-tick]")) label.setAttribute("data-tick", "y");
  });
  await audit("figures-benchmark-result");
  // the chart of a run gives its values to the keyboard: End goes to the last checkpoint, the left arrow one back, and Escape clears the mark
  const read = page.locator(".result .chart-read"), readout = read.locator(".hint");
  const idleWords = await readout.innerText();
  await read.locator(".drawing-box").focus();
  await page.keyboard.press("End");
  assert.match(await readout.innerText(), /^After 20,000 evaluations: \S+\.$/);
  await page.keyboard.press("ArrowLeft");
  assert.match(await readout.innerText(), /^After 19,800 evaluations: \S+\.$/);
  assert.equal(await read.locator("svg circle").count(), 1, "the checkpoint that is read is marked on the chart");
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains("drawing-box")), true, "the chart keeps the focus while it is read");
  // In a narrow window the chart is wider than its box, and the arrow keys no longer scroll it. So the box follows the mark: at both ends of the run the mark is in view.
  const markInView = () => read.evaluate((holder) => {
    const box = holder.querySelector(".drawing-box").getBoundingClientRect(), mark = holder.querySelector("svg circle").getBoundingClientRect();
    return mark.left >= box.left && mark.right <= box.right;
  });
  assert.equal(await markInView(), true, "the mark of the checkpoint before the last is in view");
  await page.keyboard.press("Home");
  assert.match(await readout.innerText(), /^After 200 evaluations: \S+\.$/);
  assert.equal(await markInView(), true, "the mark of the first checkpoint is in view");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await audit("figures-history-read-with-the-keyboard");
  await page.keyboard.press("Escape");
  assert.equal(await readout.innerText(), idleWords);
  // the pointer reads a value too, and leaving the chart clears it
  await read.locator(".drawing-box").hover();
  assert.match(await readout.innerText(), /^After [\d,]+ evaluations: \S+\.$/);
  await page.mouse.move(0, 0);
  await readout.filter({ hasText: idleWords }).waitFor();
  for (const name of ["Traveling salesman", "Assignment"]) {
    await runExample(name);
    await audit(`figures-${name.toLowerCase().replace(" ", "-")}-result`);
  }
  // ---- figures, end

  // a run that lasts: the live preview, then cancelled
  await toList();
  await page.locator("#project-file").setInputFiles({ name: "route.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...tsp, name: "Long route", run: { ...tsp.run, budget: 2_000_000_000 } })) });
  await button("Run").waitFor();
  // where the panel under the run bar starts, and the box of the Run button, to see whether a run moves the page
  const place = () => page.evaluate(() => {
    const run = document.querySelector(".runbar .run").getBoundingClientRect();
    return { panel: Math.round(document.querySelector(".panel").getBoundingClientRect().top + window.scrollY), width: Math.round(run.width), height: Math.round(run.height) };
  });
  const idle = await place();
  await button("Run").click();
  await page.locator(".live svg").waitFor();
  const during = await place();
  await audit("running");
  await go("Variables");
  await audit("running-seen-from-another-part");
  await button("Cancel").click();
  await page.getByRole("status").filter({ hasText: "Run cancelled." }).waitFor();
  const after = await place();
  // In a wide window nothing may move. In a narrow one the progress text wraps onto more lines, which is recorded, not refused.
  if (JSON.stringify(idle) !== JSON.stringify(during) || JSON.stringify(idle) !== JSON.stringify(after)) {
    const moved = `a run moves the page: idle ${JSON.stringify(idle)}, running ${JSON.stringify(during)}, cancelled ${JSON.stringify(after)}`;
    if (size.width >= 1180) findings.push(`${label}: ${moved}`);
    else measured[`${label}: ${moved}`] = "recorded, a narrow window";
  } else measured[`${label}: the panel and the Run button keep their place through idle, running and cancelled`] = JSON.stringify(idle);
  await audit("cancelled");
  // a long name of a project must not break the frame
  await go("Overview");
  await field("Project name").fill("A project with a very long name that goes on and on, Supercalifragilisticexpialidocious_and_more_without_any_space_to_break_at");
  await page.getByRole("heading", { name: /^A project with a very long name/ }).waitFor();
  await audit("long-names");

  // a blank project: empty states, and a run that cannot start yet
  await toList();
  await button("New blank project").click();
  await page.getByRole("heading", { name: "Untitled project" }).waitFor();
  await page.locator(".card-problem").first().waitFor();
  await audit("blank-overview");
  for (const part of ["Data", "Variables", "Constraints"]) {
    await go(part);
    await audit(`blank-${part.toLowerCase()}`);
  }
  await go("Test a candidate");
  await audit("blank-candidate");
  await button("Run").click();
  await page.locator(".run-status[data-state=error]").waitFor();
  await audit("blank-run-refused");

  // editing: the suggested solver, a removal with Undo and then Redo in the status line, the dialog that names what uses a column,
  // a new name offered to the places that use the old one, and the way back from a run
  await go("Variables");
  await button("Add a variable").click();
  await go("Quick run");
  await page.locator(".suggested").waitFor();
  await audit("suggested-solver");
  await go("Variables");
  const calm = await place();
  await button("Remove variable x").click();
  await button("Undo").waitFor();
  const noted = await place();
  await audit("removed-with-undo");
  // The Undo button must not make the status line taller than its words. Where the button does not fit beside the words
  // it takes a line of its own, which is recorded, not refused.
  const line = await page.evaluate(() => {
    const row = document.querySelector(".run-status"), words = row.querySelector("p").getBoundingClientRect(), undo = row.querySelector("button").getBoundingClientRect();
    return { extra: Math.round((row.getBoundingClientRect().height - words.height) * 10) / 10, wrapped: undo.top >= words.bottom - 1 };
  });
  if (line.wrapped) measured[`${label}: the Undo button takes a line of its own under the words, and the status line is ${line.extra}px taller`] = "recorded, a narrow window";
  else if (Math.abs(line.extra) > 0.5) findings.push(`${label}: the Undo button makes the status line ${line.extra}px taller than its words`);
  else measured[`${label}: the status line is as tall with the Undo button as its words alone`] = `${line.extra}px more`;
  // In a wide window, where every message is one line, the page must not move at all. The message before was the refusal of a run.
  if (size.width >= 1180) {
    if (JSON.stringify(calm) !== JSON.stringify(noted)) findings.push(`${label}: the Undo message moves the page: before ${JSON.stringify(calm)}, with it ${JSON.stringify(noted)}`);
    else measured[`${label}: the panel and the Run button keep their place when the Undo message appears`] = JSON.stringify(calm);
  }
  await button("Undo").focus();
  await page.keyboard.press("Enter");
  await button("Redo").waitFor();
  // the same button, used with the keyboard, still has the focus and shows it
  await page.waitForTimeout(250);
  const haloOfUndo = await page.evaluate(() => [document.activeElement.textContent, getComputedStyle(document.activeElement).boxShadow]);
  if (haloOfUndo[0] !== "Redo" || haloOfUndo[1] === "none") findings.push(`${label}: after Undo by the keyboard the focus is on "${haloOfUndo[0]}" with the halo ${haloOfUndo[1]}`);
  measured[`${theme}: halo of the Redo button in the status line`] = haloOfUndo[1];
  await audit("undone-with-redo");
  // a very long name in the message must not break the bar
  await field("Name", page.locator("fieldset.item").first()).fill("a_variable_with_a_very_long_name_that_goes_on_and_on_Supercalifragilisticexpialidocious_and_more_without_a_break");
  await page.locator(".item-head .btn").first().click();
  await button("Undo").waitFor();
  await audit("removed-long-name");
  await toList();
  await button("0/1 knapsack").click();
  await button("Run").waitFor();
  await go("Data");
  await button("Remove column weight").click();
  await page.getByRole("dialog").waitFor();
  await audit("dialog-remove-column-in-use");
  await page.keyboard.press("Escape");
  await field("Name of column 0").fill("mass");
  await button("Rename there too").waitFor();
  await audit("rename-offer");
  await haloOf("Rename there too", "the offer under a name");
  await haloOf("Remove column mass", "the Remove column button");
  await button("Rename there too").click();
  await go("Constraints");
  await button("Run").click();
  await page.locator(".result").waitFor();
  await button("Back to Constraints").waitFor();
  await audit("back-to-part");
  await haloOf("Back to Constraints", "the Back to button of the run bar");
  await button("Back to Constraints").click();
  await page.getByRole("heading", { name: "Constraints", exact: true }).waitFor();
  await button("Show the result").waitFor();
  await audit("back-on-the-part");
  await context.close();
  console.log(`  ${label}: ${number} screens`);
}

let browser;
for (let attempt = 1; !browser; attempt++) {
  try {
    browser = await chromium.launch({ channel: "chrome" });
  } catch (error) {
    if (attempt === 2) throw error;
    console.log("Chrome did not start. Trying once more.");
  }
}
/** Forced colors remove shadows, so the halo must be replaced there by an outline of the system. */
async function forcedColors(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, forcedColors: "active" });
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole("button", { name: "Calibration line fit", exact: true }).waitFor();
  const seen = [];
  // the skip link, the Python link, the theme choice, the first card, then a button and a field of the workspace
  const outlined = () => page.evaluate(() => {
    const element = document.activeElement;
    // the input of the theme choice is clipped away, so only an outline on its label counts
    const drawn = [element.closest(".segmented label") ?? element].find((e) => getComputedStyle(e).outlineStyle !== "none");
    return `${element.tagName}${element.type ? ` ${element.type}` : ""}: ${drawn ? `${getComputedStyle(drawn).outlineStyle} ${getComputedStyle(drawn).outlineWidth} on ${drawn.tagName}` : "NO OUTLINE"}`;
  });
  for (let n = 0; n < 4; n++) {
    await page.keyboard.press("Tab");
    seen.push(await outlined());
  }
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Run", exact: true }).waitFor();
  for (const control of [page.getByRole("button", { name: "Run", exact: true }), page.getByLabel("Name of the experiment"), page.getByLabel("Solver", { exact: true }), page.locator(".nav-item").first()]) {
    await control.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    seen.push(await outlined());
  }
  await context.close();
  console.log(`  forced colors: ${seen.join("; ")}`);
  for (const line of seen) if (line.includes("NO OUTLINE")) findings.push(`forced colors: the focus has no outline: ${line}`);
}

let failed = false;
try {
  console.log(`Chrome ${browser.version()}`);
  if (!process.argv[2]) await forcedColors(browser);
  for (const size of SIZES) for (const theme of ["light", "dark"]) await walk(browser, size, theme);
} catch (error) {
  failed = true;
  console.error(`\nThe walk stopped: ${error.stack}`);
}
console.log(`\n${screens} screens checked. ${findings.length} findings.`);
for (const finding of findings) console.log(`  ${finding}`);
console.log("\nMeasured focus halos (computed box shadows):");
for (const [what, value] of Object.entries(measured)) console.log(`  ${what}: ${value}`);
if (out) await writeFile(`${out}/findings.json`, JSON.stringify({ screens, findings, measured }, null, 2));
await browser.close();
process.exit(failed || findings.length ? 1 : 0);
