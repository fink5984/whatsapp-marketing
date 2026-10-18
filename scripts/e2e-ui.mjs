/**
 * Browser E2E (dev tool) — drives the real UI end-to-end against the local
 * fake Meta API: settings → compliance → connect account → health check →
 * template sync → CSV import with consent → campaign wizard → launch →
 * worker sends → signed webhooks → statuses, unsubscribe, lead, clicks.
 *
 * Prereqs: dev server + worker running with META_GRAPH_BASE_URL=http://localhost:4010,
 * fake-meta running on 4010, and `pnpm tsx scripts/create-test-org.ts` executed.
 *   node scripts/e2e-ui.mjs --out <screenshots dir>
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith("--") ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const BASE = args.base ?? "http://localhost:3000";
const FAKE = args.fake ?? "http://localhost:4010";
const OUT = args.out ?? "e2e-shots";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.UI_CHECK_BROWSER ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text().slice(0, 200)));

const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `);
  try {
    await fn();
    console.log("ok");
  } catch (e) {
    console.log("FAILED");
    await page.screenshot({ path: path.join(OUT, `FAIL-${name.replace(/\W+/g, "_")}.png`), fullPage: true });
    throw e;
  }
};
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
const toast = async (text) => page.getByText(text).first().waitFor({ timeout: 20000 });
const save = async () => {
  await page.getByRole("button", { name: "שמירה", exact: true }).first().click();
  await toast("נשמר");
};

await step("login", async () => {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", "e2e@test.local");
  await page.fill("#password", "E2eTest2026!");
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/`);
});

await step("business details", async () => {
  await page.goto(`${BASE}/settings?tab=business`, { waitUntil: "networkidle" });
  await page.fill("#b-displayName", "לינדר פיננסים (בדיקה)");
  await page.fill("#b-legalName", "לינדר פיננסים בע״מ");
  await page.fill("#b-contactPhone", "03-5550100");
  await page.fill("#b-privacyPolicyUrl", "https://example.com/privacy");
  await save();
});

await step("test recipients", async () => {
  await page.goto(`${BASE}/settings?tab=sending`, { waitUntil: "networkidle" });
  await page.fill("#s-tests", "050-1110001");
  await save();
});

await step("compliance reviews", async () => {
  await page.goto(`${BASE}/settings?tab=compliance`, { waitUntil: "networkidle" });
  for (let i = 0; i < 3; i++) {
    const btn = page.getByRole("button", { name: "ביצוע סקירה" }).first();
    await btn.click();
    await page.locator("textarea[id^=ev-]").first().fill(
      "בדיקת E2E: נבדק נוסח טופס ההרשמה באתר, תיבת סימון לא מסומנת מראש עם ציון שם העסק וערוץ WhatsApp; המוצרים אינם הלוואות ליום המשכורת, P2P או גביית חובות; רישיון נותן אשראי מס׳ 0000 (בדיקה); התוכן נבדק משפטית.",
    );
    await page.getByRole("button", { name: "אישור — הדרישה מתקיימת" }).click();
    await toast("הסקירה נרשמה");
    await page.waitForTimeout(800);
  }
  await page.getByText("סטטוס תאימות תקין").waitFor();
  await shot("settings-compliance");
});

let webhookUrl = "";
await step("connect WhatsApp account", async () => {
  await page.goto(`${BASE}/accounts`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "חיבור חשבון" }).first().click();
  await page.fill("#acc-name", "לינדר — מספר ראשי (בדיקה)");
  await page.fill("#acc-wabaId", "123456789012345");
  await page.fill("#acc-accessToken", "EAAG-fake-token-for-e2e");
  await page.fill("#acc-appSecret", "e2e-app-secret");
  await page.fill("#acc-webhookVerifyToken", "e2e-verify-token");
  await page.getByRole("button", { name: "שמירה" }).click();
  await toast("החשבון נוסף");
  await page.getByRole("button", { name: "בדיקת תקינות" }).click();
  await page.getByText("החיבור תקין").waitFor({ timeout: 30000 });
  await shot("account-health");
  await page.keyboard.press("Escape");
  webhookUrl = await page.locator("input[readonly]").first().inputValue();
  await fetch(`${FAKE}/__config`, { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: JSON.stringify({ webhook: webhookUrl, secret: "e2e-app-secret" }) });
  await page.getByRole("button", { name: "סנכרון תבניות" }).click();
  await toast("התבניות סונכרנו");
  await page.reload();
  await shot("accounts");
});

await step("webhook verify handshake", async () => {
  const ok = await fetch(`${webhookUrl}?hub.mode=subscribe&hub.verify_token=e2e-verify-token&hub.challenge=12345`);
  const bad = await fetch(`${webhookUrl}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`);
  if (ok.status !== 200 || (await ok.text()) !== "12345" || bad.status !== 403) throw new Error("verify handshake failed");
  const forged = await fetch(webhookUrl, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + "0".repeat(64) }, body: "{}" });
  if (forged.status !== 401) throw new Error(`forged webhook accepted: ${forged.status}`);
});

await step("import contacts with consent", async () => {
  const csv = [
    "טלפון,שם,אסמכתה",
    ...["0001", "0002", "0003", "0004", "0005", "0006"].map((s, i) => `050-111${s},איש קשר ${i + 1},נרשם בטופס באתר 01/10/2026 וסימן הסכמה`),
    "050-1110007,ללא הסכמה,",
    "abc,שגוי,",
  ].join("\n");
  const file = path.join(os.tmpdir(), "e2e-contacts.csv");
  fs.writeFileSync(file, "\ufeff" + csv);
  await page.goto(`${BASE}/contacts/import`, { waitUntil: "networkidle" });
  await page.setInputFiles("input[type=file]", file);
  await page.getByRole("button", { name: "המשך למיפוי עמודות" }).click();
  await page.getByText("מיפוי עמודות").waitFor();
  await page.getByRole("switch").click();
  await page.fill("#imp-att", "אנשי הקשר נרשמו בטופס באתר עם תיבת סימון לא מסומנת מראש וציון שם העסק וערוץ WhatsApp");
  // map consent proof column (third select in the grid after enabling consent)
  const selects = page.locator("button[role=combobox]");
  const n = await selects.count();
  for (let i = 0; i < n; i++) {
    const label = await selects.nth(i).locator("xpath=ancestor::div[contains(@class,'space-y-1.5')][1]/label").textContent().catch(() => "");
    if (label?.includes("אסמכתת הסכמה")) {
      await selects.nth(i).click();
      await page.getByRole("option", { name: "אסמכתה" }).click();
    }
  }
  await page.getByRole("button", { name: /^ייבוא \d+ שורות/ }).click();
  await page.getByText("הייבוא הושלם").waitFor({ timeout: 30000 });
  await shot("import-result");
});

await step("campaign wizard", async () => {
  await page.goto(`${BASE}/campaigns/new`, { waitUntil: "networkidle" });
  await page.fill("#w-name", "הצעת הלוואה — בדיקת E2E");
  await page.getByText("loan_offer_he").click();
  await page.getByRole("button", { name: "המשך לבחירת קהל" }).click();
  await page.waitForURL(/\/setup\?step=1/);
  await page.getByText("כשירים לשליחה").waitFor({ timeout: 30000 });
  await shot("wizard-audience");
  await page.getByRole("button", { name: "המשך", exact: true }).click();
  await page.getByText("משתני התבנית").waitFor();
  await page.getByPlaceholder("דף נחיתה").fill("דף זכאות");
  await page.getByPlaceholder("https://…").last().fill("https://example.com/eligibility");
  await page.getByRole("button", { name: "יצירה" }).click();
  await toast("הקישור נוצר");
  await page.getByRole("switch").click(); // ignore sending window for the test run
  await shot("wizard-content");
  await page.getByRole("button", { name: "לבדיקה ואישור" }).click();
  await page.getByText("סיכום").waitFor({ timeout: 30000 });
  await page.getByRole("checkbox").last().click();
  await shot("wizard-review");
  await page.getByRole("button", { name: "הפעלת הקמפיין" }).click();
  await page.waitForURL(/\/campaigns\/[^/]+$/, { timeout: 60000 });
});

await step("worker sends + webhooks update statuses", async () => {
  const deadline = Date.now() + 60000;
  let text = "";
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000);
    await page.reload();
    text = (await page.locator("main, [data-slot=sidebar-inset]").first().textContent()) ?? "";
    if (text.includes("הסתיים") && /נקראו/.test(text)) break;
  }
  await page.waitForTimeout(4000); // allow read receipts + replies
  await page.reload();
  await shot("campaign-report");
});

await step("unsubscribe enforced", async () => {
  await page.goto(`${BASE}/suppressions`, { waitUntil: "networkidle" });
  await page.getByText("השיב/ה מילת הסרה").waitFor({ timeout: 15000 });
  await shot("suppressions");
});

await step("inbox + lead", async () => {
  await page.goto(`${BASE}/inbox`, { waitUntil: "networkidle" });
  await page.locator("a[href*='c=']").first().click();
  await page.getByText(/בקשת הסרה|מעוניין/).first().waitFor();
  await shot("inbox");
  await page.goto(`${BASE}/inbox?tab=leads`, { waitUntil: "networkidle" });
  await page.getByText("אוטומציה: תגובה ב-WhatsApp").waitFor({ timeout: 15000 });
});

await step("dashboard with real data", async () => {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await shot("dashboard");
  await page.goto(`${BASE}/reports`, { waitUntil: "networkidle" });
  await shot("reports");
  await page.goto(`${BASE}/contacts`, { waitUntil: "networkidle" });
  await shot("contacts");
});

const sentLog = await (await fetch(`${FAKE}/__sent`, { headers: { authorization: "Bearer x" } })).json();
console.log(`fake Meta received ${sentLog.length} sends:`, sentLog.map((s) => `${s.type}→${s.to}`).join(", "));
console.log(errors.length ? `browser errors:\n  ${errors.join("\n  ")}` : "no browser errors");
await browser.close();
