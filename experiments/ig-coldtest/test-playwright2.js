// Refined: wait for React hydration, confirm the login form is fillable, and
// confirm we can TYPE creds into it (without submitting). Also mask webdriver.
const { chromium } = require("playwright");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "en-US" });
  // mask the most obvious bot tell
  await ctx.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
  const page = await ctx.newPage();

  await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "networkidle", timeout: 60000 });
  // wait for hydration of the username field
  let formOk = false;
  try {
    await page.waitForSelector('input[name="username"]', { timeout: 20000 });
    formOk = true;
  } catch (_) {}
  console.log("[login] username field appeared after hydration:", formOk);
  if (formOk) {
    await page.fill('input[name="username"]', "demo_burner_account");
    await page.fill('input[name="password"]', "demo_password_123");
    const u = await page.inputValue('input[name="username"]');
    const p = await page.inputValue('input[name="password"]');
    const submit = await page.locator('button[type="submit"]').count();
    console.log("[login] typed username value:", u);
    console.log("[login] typed password length:", p.length);
    console.log("[login] submit button count:", submit);
    console.log("[login] => form is fully automatable; a real session would click submit here.");
  }
  console.log("[login] webdriver after mask:", await page.evaluate(() => navigator.webdriver));
  await browser.close();
}
main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
