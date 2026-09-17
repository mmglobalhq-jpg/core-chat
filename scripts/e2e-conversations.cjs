// Six real multi-turn conversations (3 main chat, 3 Knowledge chat) through the deployed UI,
// printing every answer for a human to read. Same harness as e2e-knowledge.cjs (doc 17).
const { chromium } = require("/farm/node_modules/@playwright/test");
const fs = require("fs");
const BASE = "http://127.0.0.1:3000";
const { storage_key, session } = JSON.parse(fs.readFileSync("/e2e/session.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];

const CONVERSATIONS = [
  { chat: "/", name: "main-A REIT follow-up", turns: ["What's the latest ARR report about?", "How does that compare with the month before?", "thanks!"] },
  { chat: "/", name: "main-B weather follow-up", turns: ["What's the weather forecast in Savannah tomorrow?", "And what about Sunday?"] },
  { chat: "/", name: "main-C document asked in the wrong chat", turns: ["Summarize the September 11 securitized products research", "ok, what about ORC's latest report?"] },
  { chat: "/knowledge", name: "kb-D library then drill-down", turns: ["What's in my knowledge base?", "Summarize the most recent Agency MBS weekly", "What does it say about prepayments?"] },
  { chat: "/knowledge", name: "kb-E compare two issues", turns: ["Compare what the August 28 and September 11 securitized products reports said about CMBS", "Which of the two was more positive?"] },
  { chat: "/knowledge", name: "kb-F out of scope then in scope", turns: ["What's the capital of France?", "What do my documents say about the Fed raising rates?"] },
];

async function lastAssistantText(page) {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll("main .group")];
    const last = nodes[nodes.length - 1];
    return last ? last.innerText : "";
  });
}

(async () => {
  const browser = await chromium.launch();
  for (const conv of CONVERSATIONS) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [storage_key, JSON.stringify(session)]);
    const page = await ctx.newPage();
    const tools = [];
    page.on("request", (r) => { if (r.url().includes("/api/intent") || r.url().includes("/api/kb/chat")) tools.push(r.url().split("/api/")[1]); });
    await page.goto(BASE + conv.chat);
    await page.getByRole("textbox", { name: "Message" }).waitFor({ timeout: 20000 });
    await sleep(2500);
    console.log(`\n=== ${conv.name} (${conv.chat}) ===`);
    for (const t of conv.turns) {
      const t0 = Date.now();
      await page.getByRole("textbox", { name: "Message" }).fill(t);
      await page.getByRole("button", { name: "Send message" }).click();
      await page.getByRole("button", { name: "Stop generating" }).waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
      await page.getByRole("button", { name: "Send message" }).waitFor({ state: "visible", timeout: 180000 });
      await sleep(800);
      const text = (await lastAssistantText(page)).replace(/\n{2,}/g, "\n").trim();
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`\n> ${t}   [${secs}s]\n${text.slice(0, 1400)}`);
      log.push({ conv: conv.name, q: t, secs, text });
    }
    await page.screenshot({ path: `/e2e/conv-${conv.name.split(" ")[0]}.png` });
    await ctx.close();
  }
  fs.writeFileSync("/e2e/conversations.json", JSON.stringify(log, null, 1));
  await browser.close();
})();
