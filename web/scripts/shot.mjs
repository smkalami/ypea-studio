// Takes pictures of the app as a person sees it, in a window and not as one long page:
//   node scripts/shot.mjs <address> <folder>
// It opens the vehicle routing example, runs it, and saves the result, the Compare part and the
// Share part. Fixed parts of the layout (the sidebar and the run bar) stay where they are on
// screen, which a full-page picture does not show.

import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const [address, folder] = process.argv.slice(2);
if (!address || !folder) {
  console.error("Usage: node scripts/shot.mjs <address> <folder>");
  process.exit(2);
}
mkdirSync(folder, { recursive: true });
const launch = async () => {
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch {
    return await chromium.launch({ channel: "chrome" }); // the first launch sometimes fails on this kind of computer
  }
};
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(address, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Vehicle routing" }).click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.locator(".result").waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${folder}/window-result.png` });
  for (const part of ["Compare experiments", "Share"]) {
    await page.getByRole("button", { name: part, exact: true }).or(page.getByRole("link", { name: part, exact: true })).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${folder}/window-${part.split(" ")[0].toLowerCase()}.png` });
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${folder}/window-${part.split(" ")[0].toLowerCase()}-scrolled.png` });
  }
  console.log("saved pictures to", folder);
} finally {
  await browser.close();
}
