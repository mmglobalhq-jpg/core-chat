// Knowledge chat browser test — see system-source-of-truth doc 17 ("Knowledge chat browser test")
// for how to run it (Playwright in Docker, minted session at /e2e/session.json).
// Knowledge chat end-to-end against the DEPLOYED core-chat (127.0.0.1:3000), signed in.
const { chromium, devices } = require("/farm/node_modules/@playwright/test");
const fs = require("fs");
const BASE = "http://127.0.0.1:3000";
const { storage_key, session } = JSON.parse(fs.readFileSync("/e2e/session.json", "utf8"));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signedInPage(browser, ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch {} }, [storage_key, JSON.stringify(session)]);
  return { ctx, page: await ctx.newPage() };
}

async function ask(page, text) {
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
  // wait for streaming to finish: Send button back (Stop disappears)
  await page.getByRole("button", { name: "Stop generating" }).waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  await page.getByRole("button", { name: "Send message" }).waitFor({ state: "visible", timeout: 120000 });
  await sleep(500);
}

async function run(label, ctxOpts, mobile) {
  const browser = await chromium.launch();
  const { ctx, page } = await signedInPage(browser, ctxOpts);
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  const resp = await page.goto(BASE + "/knowledge");
  check(`${label}: /knowledge loads from core-chat`, resp.status() === 200 && (await page.title()) === "Core Chat");
  await page.getByText("Ask your knowledge base").waitFor({ timeout: 20000 });
  check(`${label}: empty state explains KB-only answers`, await page.getByText(/only from the documents/).isVisible());

  // chat switch
  if (mobile) await page.getByRole("button", { name: "Open menu" }).click();
  const nav = page.getByRole("navigation", { name: "Chats" }).last();
  await nav.waitFor({ timeout: 10000 });
  check(`${label}: switch marks Knowledge current`, (await nav.getByRole("link", { name: "Knowledge" }).getAttribute("aria-current")) === "page");
  check(`${label}: no Knowledge Base popup button`, (await page.getByRole("button", { name: "Knowledge Base", exact: true }).count()) === 0);
  if (mobile) await page.keyboard.press("Escape");
  await sleep(400);

  // composer: no attachments
  check(`${label}: no attachment control`, (await page.getByRole("button", { name: "Add attachment" }).count()) === 0);

  // first question
  await ask(page, "What did the September 11 securitized products research say about subprime auto delinquencies?");
  const sources1 = page.getByLabel("Sources").last();
  const n1 = await sources1.getByRole("button").count();
  const text1 = (await sources1.innerText()).replace(/\s+/g, " ");
  check(`${label}: answer shows cited sources`, n1 >= 1, `${n1} source(s): ${text1.slice(0, 120)}`);
  check(`${label}: sources are from the Sep 11 issue`, /September 11/.test(text1));
  await sources1.getByRole("button").first().click();
  await sleep(300);
  check(`${label}: a source expands to its excerpt`, (await sources1.innerText()).length > text1.length + 40);
  await page.screenshot({ path: `/e2e/${label}-answer.png`, fullPage: false });
  if (mobile) {
    const vw = await page.evaluate(() => window.innerWidth);
    const right = await sources1.evaluate((el) => el.getBoundingClientRect().right);
    check(`${label}: source cards fit on screen`, right <= vw, `right=${right} viewport=${vw}`);
  }

  // follow-up
  await ask(page, "What else did that report say about CLOs?");
  const text2 = (await page.getByLabel("Sources").last().innerText()).replace(/\s+/g, " ");
  check(`${label}: follow-up stays on the same report`, /September 11/.test(text2), text2.slice(0, 120));

  // persistence + separate histories
  await page.reload();
  if (mobile) await page.getByRole("button", { name: "Open menu" }).click();
  const recentTitle = page.getByRole("button", { name: /^What did the September 11 securitized/i }).first();
  await recentTitle.waitFor({ timeout: 20000 }).catch(() => {});
  const listedInKnowledge = await recentTitle.count();
  check(`${label}: conversation listed under Knowledge after reload`, listedInKnowledge > 0);
  if (listedInKnowledge) {
    await recentTitle.click();
    if (mobile) await sleep(400);
    await page.getByLabel("Sources").first().waitFor({ timeout: 20000 }).catch(() => {});
    check(`${label}: reopened conversation shows its saved sources`, (await page.getByLabel("Sources").count()) >= 1);
  }
  if (mobile) {
    const open = await page.getByRole("navigation", { name: "Chats" }).count();
    if (!open) await page.getByRole("button", { name: "Open menu" }).click();
  }
  await page.getByRole("navigation", { name: "Chats" }).last().getByRole("link", { name: "Chat" }).click();
  await page.waitForURL(BASE + "/");
  await sleep(2500);
  if (mobile) await page.getByRole("button", { name: "Open menu" }).click();
  const leaked = await page.getByRole("button", { name: /^What did the September 11 securitized/i }).count();
  check(`${label}: knowledge conversation is NOT in main chat history`, leaked === 0);
  if (mobile) await page.keyboard.press("Escape");

  // library
  await page.goto(BASE + "/knowledge");
  await page.getByRole("button", { name: "Documents" }).first().waitFor({ timeout: 15000 });
  if (mobile) await page.getByRole("button", { name: "Documents" }).first().click();
  const docsHeading = page.getByRole("heading", { name: "Documents" }).last();
  await page.getByText("North America Securitized Products Research - September 11, 2026").first().waitFor({ timeout: 20000 }).catch(() => {});
  check(`${label}: library lists documents`, await page.getByText("North America Securitized Products Research - September 11, 2026").last().isVisible().catch(() => false));
  check(`${label}: library is mounted once`, (await page.locator("#kb-add-files").count()) === 1);
  check(`${label}: replace and remove controls present`, (await page.getByRole("button", { name: /^Replace / }).count()) > 0 && (await page.getByRole("button", { name: /^Remove North/ }).count()) > 0);
  await page.screenshot({ path: `/e2e/${label}-library.png`, fullPage: false });

  if (mobile) {
    // nothing clipped horizontally on a phone
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`${label}: no horizontal overflow`, !overflow);
  }
  check(`${label}: no uncaught page errors`, consoleErrors.length === 0, consoleErrors.join(" | ").slice(0, 200));
  void docsHeading;
  await ctx.close();
  await browser.close();
}

async function replaceFlow() {
  const browser = await chromium.launch();
  const { ctx, page } = await signedInPage(browser, { viewport: { width: 1280, height: 900 } });
  await page.goto(BASE + "/knowledge");
  const v1 = "/e2e/kc-e2e-canary.txt", v2 = "/e2e/kc-e2e-canary-v2.txt";
  fs.writeFileSync(v1, "# E2E Canary Document\n\nTest document, safe to delete. Orchid Island Capital invests in Agency RMBS issued by Fannie Mae.\n");
  fs.writeFileSync(v2, "# E2E Canary Document Version 2\n\nTest document, safe to delete. ARMOUR Residential REIT hedges with interest rate swaps.\n");
  await page.locator("#kb-add-files").setInputFiles(v1);
  await page.getByRole("button", { name: /Add 1 to knowledge base/ }).click();
  await page.getByRole("button", { name: "Add to knowledge base" }).waitFor({ timeout: 300000 });
  const row = page.locator("li", { hasText: /canary/i }).filter({ has: page.getByRole("button", { name: /^Replace / }) }).first();
  await row.waitFor({ timeout: 60000 });
  const title1 = (await row.locator("p").first().innerText()).trim();
  check("replace: canary added and listed", !!title1, title1);
  const replaceBtn = row.getByRole("button", { name: /^Replace / });
  const inputId = await row.locator('input[type="file"]').getAttribute("id");
  await page.locator(`#${inputId}`).setInputFiles(v2);
  await page.getByText(/Replacing with kc-e2e-canary-v2.txt/).waitFor({ timeout: 20000 });
  await page.getByText(/Replacing with kc-e2e-canary-v2.txt/).waitFor({ state: "detached", timeout: 300000 });
  await sleep(1500);
  const canaryRows = page.locator("li", { hasText: /canary/i }).filter({ has: page.getByRole("button", { name: /^Replace / }) });
  check("replace: exactly one canary remains after replace", (await canaryRows.count()) === 1);
  // remove it
  const remaining = canaryRows.first();
  await remaining.getByRole("button", { name: /^Remove / }).click();
  await remaining.getByRole("button", { name: "Remove?" }).click();
  await sleep(3000);
  check("replace: canary removed", (await page.locator("li", { hasText: /canary/i }).filter({ has: page.getByRole("button", { name: /^Replace / }) }).count()) === 0);
  void replaceBtn;
  await ctx.close();
  await browser.close();
}

(async () => {
  const which = process.argv[2] || "all";
  try {
    if (which === "all" || which === "desktop") await run("desktop", { viewport: { width: 1280, height: 900 } }, false);
    if (which === "all" || which === "phone") await run("phone", { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } }, true);
    if (which === "all" || which === "replace") await replaceFlow();
  } catch (e) {
    check("script completed", false, String(e).slice(0, 400));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length }));
  process.exit(failed.length ? 1 : 0);
})();
