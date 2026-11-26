// Checks a deployed copy of the app: node scripts/check-live.mjs <address>
// It opens the address in the installed Chrome, runs the line fit example and reads the result.

import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const address = process.argv[2];
if (!address) {
  console.error("Usage: node scripts/check-live.mjs <address>");
  process.exit(2);
}
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(String(error)));
  page.on("requestfailed", (request) => problems.push(`failed: ${request.url()}`));
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`${response.status()}: ${response.url()}`);
  });
  await page.goto(address, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Calibration line fit" }).click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const result = page.locator(".result");
  await result.waitFor();
  const text = await result.innerText();
  assert.match(text, /Best feasible solution found/);
  assert.match(text, /Known answer: Least-squares line/);
  assert.deepEqual(problems, []);
  console.log(`${address}: the line fit ran. ${text.split("\n").slice(1, 5).join(" | ")}`);
} finally {
  await browser.close();
}
