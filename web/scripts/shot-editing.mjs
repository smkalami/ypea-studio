// Takes pictures of the editing states as a person sees them, in a window and not as one long
// page: the suggested solver, the message after a removal with Undo, the dialog that names what
// uses a column, the offer to carry a new name, and the way back from a run. Both themes, at
// 1280 and 390 wide. Run after a build:
//   node scripts/shot-editing.mjs <folder>

import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname } from "node:path";
import { chromium } from "playwright-core";

const folder = process.argv[2];
if (!folder) {
  console.error("Usage: node scripts/shot-editing.mjs <folder>");
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
      const shot = async (name) => {
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

      // a blank project: the suggestion, and how a change of it is said
      await button("New blank project").click();
      await page.getByRole("heading", { name: "Untitled project" }).waitFor();
      await go("Variables");
      await button("Add a variable").click();
      await go("Quick run");
      await page.locator(".suggested").waitFor();
      await shot("suggested-for-decimal-numbers");
      await go("Variables");
      await button("Add a variable").click();
      await choose(field("What it holds", card(1)), "permutation");
      await page.getByRole("status").filter({ hasText: "The suggested solver" }).waitFor();
      await shot("suggestion-changed-said-in-the-status-line");
      await go("Quick run");
      await shot("suggested-for-a-mix");

      // a removal with Undo, then Redo
      await go("Variables");
      await button("Remove variable x2").click();
      await button("Undo").waitFor();
      await shot("removed-with-undo");
      await button("Undo").click();
      await button("Redo").waitFor();
      await shot("undone-with-redo");
      await button("All projects").click();

      // an example: a column in use, a new name, and the way back from a run
      await button("0/1 knapsack").click();
      await button("Run").waitFor();
      await go("Data");
      await button("Remove column weight").scrollIntoViewIfNeeded();
      await button("Remove column weight").click();
      await page.getByRole("dialog").waitFor();
      await shot("dialog-before-removing-a-column-in-use");
      await page.getByRole("dialog").getByRole("button", { name: "Remove anyway", exact: true }).click();
      await button("Undo").waitFor();
      await page.waitForTimeout(700); // the check of the project answers
      await shot("removed-anyway-with-problem-marks");
      await go("Constraints");
      await shot("removed-anyway-problem-at-the-constraint");
      await button("Undo").click();
      await go("Data");
      await field("Name of column 0").click();
      await page.keyboard.press("Control+a");
      await page.keyboard.type("mass", { delay: 30 });
      await button("Rename there too").waitFor();
      await shot("rename-offer-under-the-name");
      await button("Rename there too").click();
      await go("Constraints");
      await shot("renamed-in-the-constraint");
      const box = await button("Run").boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.locator(".result").waitFor();
      await button("Back to Constraints").waitFor();
      await shot("run-bar-back-to-constraints");
      await button("Back to Constraints").click();
      await button("Show the result").waitFor();
      await shot("back-on-constraints-show-the-result");
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
