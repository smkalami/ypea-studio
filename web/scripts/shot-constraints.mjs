// Takes pictures of the constraint form and of what a result and a test say about constraints,
// as a person sees them in a window: the list of tolerances, the note about a right side of 0,
// numbers typed by hand, a constraint that is off, and a broken limit with its percentage.
// Both themes, at 1280 and 390 wide. Run after a build:
//   node scripts/shot-constraints.mjs <folder>

import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname } from "node:path";
import { chromium } from "playwright-core";

const folder = process.argv[2];
if (!folder) {
  console.error("Usage: node scripts/shot-constraints.mjs <folder>");
  process.exit(2);
}
mkdirSync(folder, { recursive: true });
const dist = new URL("../dist/", import.meta.url);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
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

const launch = async () => {
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch {
    return await chromium.launch({ channel: "chrome" }); // the first launch sometimes fails on this kind of computer
  }
};
const browser = await launch();
try {
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
      const page = await context.newPage();
      let number = 0;
      /** A picture of the window, with `top` (when given) brought to just under the run bar. */
      const shot = async (name, top) => {
        if (top) {
          await top.evaluate((element) => {
            const bar = document.querySelector(".runbar");
            const under = bar && getComputedStyle(bar).position === "sticky" ? bar.getBoundingClientRect().height : 0;
            window.scrollBy(0, element.getBoundingClientRect().top - under - 14);
          });
        }
        await page.waitForTimeout(350);
        await page.screenshot({ path: `${folder}/${width}-${theme}-${String(++number).padStart(2, "0")}-${name}.png` });
      };
      const button = (name) => page.getByRole("button", { name, exact: true });
      const field = (name, within = page) => within.getByLabel(name, { exact: true });
      const card = (n) => page.locator("fieldset.item").nth(n);
      const go = async (name) => {
        if (width < 1180) await button("Show the parts of the project").click();
        await page.locator(".sidebar").getByRole("button", { name: new RegExp(`^${name}`) }).click();
        if (width < 1180) await page.locator("dialog.drawer[open]").waitFor({ state: "detached" });
      };
      const choose = async (box, value) => {
        await box.click();
        await page.getByRole("listbox").locator(`[data-value="${value}"]`).click();
      };
      await page.goto(url);
      await button("0/1 knapsack").click();
      await button("Run").waitFor();

      // an "equal to" constraint: the list, the note about a right side of 0, and numbers typed by hand
      await go("Constraints");
      await button("Add a constraint").click();
      await field("Name", card(1)).fill("Seven items");
      await field("Left side", card(1)).fill("sum(take)");
      await choose(field("Comparison", card(1)), "==");
      await field("Right side", card(1)).fill("7");
      await field("Tolerance").click();
      await page.getByRole("listbox").waitFor();
      await shot("tolerance-list-open", card(1));
      await page.getByRole("listbox").locator('[data-value="0.01"]').click();
      await shot("within-one-percent", card(1));
      await field("Right side", card(1)).fill("0");
      await page.getByText("the right side is 0").waitFor();
      await shot("right-side-of-zero-note", card(1));
      await field("Right side", card(1)).fill("7");
      await choose(field("Tolerance"), "both");
      await field("Fixed amount").fill("0.5");
      await field("Fraction").fill("0.02");
      await shot("both-typed-by-hand", card(1));

      // a constraint that is off: in the form and in the sidebar
      await button("Add a constraint").click();
      await field("Name", card(2)).fill("Few items");
      await field("Left side", card(2)).fill("sum(take)");
      await field("Right side", card(2)).fill("3");
      await field("Check this constraint", card(2)).uncheck();
      await shot("constraint-off-in-the-form", card(2));
      if (width < 1180) {
        await button("Show the parts of the project").click();
        await shot("constraint-off-in-the-sidebar");
        await page.keyboard.press("Escape");
      }

      // the candidate test: a limit broken by 4 kg, an "equal to" that is apart, and the one that is off
      await go("Test a candidate");
      for (const item of ["0", "1", "8", "17"]) await page.locator("fieldset.checks").getByLabel(item, { exact: true }).check();
      await button("Test this candidate").click();
      await page.locator(".tested").waitFor();
      await shot("candidate-test-breach-and-off", page.locator(".tested"));

      // a result: no candidate can keep 30 kg with seven items, so the limit is broken, with its percentage
      await go("Constraints");
      await field("Right side", card(0)).fill("30");
      await choose(field("Tolerance"), "exact");
      const box = await button("Run").boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.locator(".result").waitFor();
      await shot("result-not-checked-note", page.locator(".result"));
      await shot("result-breach-and-off", page.locator(".result").getByRole("heading", { name: "Constraints", exact: true }));
      await context.close();
      console.log(`${width} ${theme}: ${number} pictures`);
    }
  }
  console.log("saved pictures to", folder);
} catch (error) {
  console.error(`The pictures were not all taken.
${error.stack}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  process.exit(); // the server is still listening
}
