// Takes pictures of every drawing and chart of the built app, for every bundled example:
//   node scripts/shot-figures.mjs <folder> <tag> [width ...]
// For each width and theme it opens each example, runs it, and saves the window with each
// figure in view (not one long page). At 1280 it also saves each figure on its own at twice the
// size, the same in gray, the charts of a comparison, the files that Share saves, and one
// report printed to PDF. Run after a build. The tag names the subfolder (before, after).

import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname } from "node:path";
import { chromium } from "playwright-core";

const [folder, tag, ...widths] = process.argv.slice(2);
if (!folder || !tag) {
  console.error("Usage: node scripts/shot-figures.mjs <folder> <tag> [width ...]");
  process.exit(2);
}
const dist = new URL("../dist/", import.meta.url);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
const SIZES = [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 640 }]
  .filter((size) => widths.length === 0 || widths.includes(String(size.width)));
const EXAMPLES = [
  ["linefit", "Calibration line fit"], ["knapsack", "0/1 knapsack"], ["tsp", "Traveling salesman"],
  ["vrp", "Vehicle routing"], ["assignment", "Assignment"], ["benchmark", "Benchmark functions"],
];

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
const dir = (...parts) => {
  const path = [folder, ...parts].join("/");
  mkdirSync(path, { recursive: true });
  return path;
};

let browser;
for (let attempt = 1; !browser; attempt++) {
  try {
    browser = await chromium.launch({ channel: "chrome" });
  } catch (error) {
    if (attempt === 2) throw error; // the first launch sometimes fails
  }
}

/** The window with each figure in view, and at 1280 each figure on its own, also in gray. */
async function figures(page, scope, where, name, alone) {
  const all = page.locator(`${scope} figure`);
  for (let n = 0; n < await all.count(); n++) {
    const figure = all.nth(n);
    await figure.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${dir("screens", tag, where)}/${name}-${n}.png` });
    if (!alone) continue;
    await figure.screenshot({ path: `${dir("figures", tag, alone)}/${name}-${n}.png` });
    if (alone === "light") {
      await figure.evaluate((element) => (element.style.filter = "grayscale(1)"));
      await figure.screenshot({ path: `${dir("gray", tag)}/${name}-${n}.png` });
      await figure.evaluate((element) => (element.style.filter = ""));
    }
  }
}

try {
  for (const size of SIZES) {
    for (const theme of ["light", "dark"]) {
      const full = size.width === 1280;
      const context = await browser.newContext({ viewport: size, colorScheme: theme, deviceScaleFactor: full ? 2 : 1, acceptDownloads: true });
      const page = await context.newPage();
      const button = (name) => page.getByRole("button", { name, exact: true });
      const go = async (name) => {
        if (size.width < 1180) await button("Show the parts of the project").click();
        await page.locator(".sidebar").getByRole("button", { name: new RegExp(`^${name}`) }).click();
        if (size.width < 1180) await page.locator("dialog.drawer[open]").waitFor({ state: "detached" });
      };
      const where = `${size.width}-${theme}`;
      await page.goto(url);
      for (const [id, name] of EXAMPLES) {
        await button(name).click();
        await button("Run").click();
        await page.locator(".result").waitFor({ timeout: 120000 });
        await page.waitForTimeout(300);
        await figures(page, ".result", where, id, full && theme);
        if (full) {
          await go("Compare experiments");
          await page.getByLabel("Runs of each experiment", { exact: true }).fill("5");
          await button("Run the comparison").click();
          await page.getByText("Comparison finished.").waitFor({ timeout: 300000 });
          await figures(page, ".charts", where, `${id}-comparison`, theme);
          if (theme === "light") {
            await go("Share");
            for (const label of ["History chart (SVG)", "History chart (PNG)", "Drawing of the solution (SVG)", "Drawing of the solution (PNG)", "Comparison charts (SVG)", "Comparison charts (PNG)", "Download the report"]) {
              const save = button(label);
              if (await save.count() === 0) continue;
              const [download] = await Promise.all([page.waitForEvent("download"), save.click()]);
              await download.saveAs(`${dir("saved", tag)}/${download.suggestedFilename()}`);
              if (label === "Download the report" && id === "vrp") {
                // the report on A4 paper, as the print command of a browser gives it
                const paper = await context.newPage();
                await paper.setContent(await readFile(await download.path(), "utf8"));
                await writeFile(`${dir("saved", tag)}/vehicle-routing-report.pdf`, await paper.pdf({ format: "A4" }));
                await paper.close();
              }
            }
          }
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await button("All projects").click();
        await page.getByRole("heading", { name: "Your projects" }).waitFor();
      }
      await context.close();
      console.log(`  ${where}: done`);
    }
  }
  console.log("saved pictures to", folder);
} finally {
  await browser.close();
  server.close();
}
