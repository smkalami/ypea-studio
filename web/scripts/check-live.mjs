// Checks a deployed copy of the app: node scripts/check-live.mjs <address>
// It opens the address in the installed Chrome, runs the line fit example, reads the result and opens the guide.

import assert from "node:assert/strict";
import { chromium, firefox } from "playwright-core";

// BROWSER=edge or BROWSER=firefox uses that browser instead (Firefox is the build that `npx playwright-core install firefox` downloads).
const open = () => (process.env.BROWSER === "firefox" ? firefox.launch() : chromium.launch({ channel: process.env.BROWSER === "edge" ? "msedge" : "chrome" }));

const address = process.argv[2];
if (!address) {
  console.error("Usage: node scripts/check-live.mjs <address>");
  process.exit(2);
}
const browser = await open();
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
  await page.getByRole("link", { name: "Guide", exact: true }).click();
  await page.getByRole("heading", { name: "What YPEA Studio is" }).waitFor();
  assert.deepEqual(problems, []);
  console.log(`${address}: the line fit ran, and the guide opens. ${text.split("\n").slice(1, 5).join(" | ")}`);
} finally {
  await browser.close();
}
