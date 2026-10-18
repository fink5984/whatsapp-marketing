/**
 * UI smoke check (dev tool): logs in, visits pages at desktop + mobile widths,
 * reports HTTP errors, console errors, RTL direction and horizontal overflow,
 * and saves screenshots.
 *
 *   node scripts/ui-check.mjs --out <dir> [--base http://localhost:3000] [--pages /,/contacts]
 * Env: UI_CHECK_EMAIL, UI_CHECK_PASSWORD, UI_CHECK_BROWSER (path to chrome/edge)
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const base = args.base ?? "http://localhost:3000";
const out = args.out ?? "ui-check";
const pages = (args.pages ?? "/").split(",");
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.UI_CHECK_BROWSER ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const results = [];
for (const vp of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
  await page.goto(`${base}/login`);
  await page.fill("#email", process.env.UI_CHECK_EMAIL);
  await page.fill("#password", process.env.UI_CHECK_PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);
  for (const p of pages) {
    errors.length = 0;
    const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => ({
      dir: document.documentElement.dir,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      title: document.title,
      h1: document.querySelector("h1")?.textContent ?? null,
    }));
    const file = path.join(out, `${vp.name}${p.replace(/[/?=&]+/g, "_") || "_root"}.png`);
    await page.screenshot({ path: file, fullPage: true });
    results.push({ vp: vp.name, page: p, status: res?.status(), ...info, errors: [...errors] });
  }
  await ctx.close();
}
await browser.close();
for (const r of results) {
  const flag = r.status >= 400 || r.errors.length || r.overflowX > 1 || r.dir !== "rtl" ? "✗" : "✓";
  console.log(`${flag} [${r.vp}] ${r.page} status=${r.status} dir=${r.dir} overflowX=${r.overflowX} h1=${JSON.stringify(r.h1)}`);
  for (const e of r.errors) console.log(`    console: ${e}`);
}
