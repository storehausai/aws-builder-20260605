const { chromium } = require("playwright");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "en-US" });
  await ctx.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
  const page = await ctx.newPage();
  await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "networkidle", timeout: 60000 });
  await page.fill('input[name="email"]', "demo_burner_account");
  await page.fill('input[name="pass"]', "demo_password_123");
  const u = await page.inputValue('input[name="email"]');
  const p = await page.inputValue('input[name="pass"]');
  const submitEnabled = await page.locator('button[type="submit"]').isEnabled().catch(()=>null);
  console.log("filled email:", u, "| pass len:", p.length, "| submit button enabled:", submitEnabled);
  console.log("=> Login form is fully fillable & submittable via Playwright. A real burner would click submit + handle any challenge, then the session cookies (sessionid) persist for direct/ DM sending.");
  await browser.close();
}
main().catch(e=>console.error("ERR:",e.message));
