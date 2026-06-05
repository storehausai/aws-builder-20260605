const { chromium } = require("playwright");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "en-US" });
  await ctx.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
  const page = await ctx.newPage();
  await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  console.log("final url:", page.url());
  console.log("title:", await page.title());
  const allInputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input")).map((i) => ({ name: i.name, type: i.type, aria: i.getAttribute("aria-label") }))
  );
  console.log("inputs on page:", JSON.stringify(allInputs));
  const visible = (await page.locator("body").innerText().catch(() => "")).slice(0, 500).replace(/\n/g, " | ");
  console.log("visible text:", visible);
  const btns = await page.evaluate(() => Array.from(document.querySelectorAll("button,a[role=button]")).map((b)=>b.innerText).filter(Boolean).slice(0,15));
  console.log("buttons:", JSON.stringify(btns));
  await browser.close();
}
main().catch((e) => { console.error("ERR:", e.message); });
