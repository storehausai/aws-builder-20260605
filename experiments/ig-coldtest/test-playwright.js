// Method 2: drive instagram.com with headless chromium. No creds.
// Goals: (a) does the login page load / is it automatable? (b) can we reach a
// public profile? (c) what does the bot-detection do to a logged-OUT headless
// browser? (d) document selectors a logged-IN session would click to send a DM.
const { chromium } = require("playwright");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });
  const page = await ctx.newPage();

  // (a) login page
  let resp = await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded", timeout: 45000 });
  console.log("[login] http status:", resp && resp.status());
  console.log("[login] title:", await page.title());
  const hasUser = await page.locator('input[name="username"]').count();
  const hasPass = await page.locator('input[name="password"]').count();
  console.log("[login] username input count:", hasUser, "| password input count:", hasPass);
  console.log("[login] url after load:", page.url());

  // (b) public profile reachability
  resp = await page.goto("https://www.instagram.com/instagram/", { waitUntil: "domcontentloaded", timeout: 45000 });
  console.log("\n[profile] http status:", resp && resp.status());
  console.log("[profile] title:", await page.title());
  console.log("[profile] url:", page.url());
  const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 200).replace(/\n/g, " ");
  console.log("[profile] body snippet:", bodyText);
  // Look for "Message" button (only present when logged in) and login-wall signals
  const messageBtn = await page.getByText(/^Message$/).count().catch(() => 0);
  const followBtn = await page.getByText(/Follow/i).count().catch(() => 0);
  const loginWall = await page.getByText(/Log in|Sign up/i).count().catch(() => 0);
  console.log("[profile] 'Message' matches:", messageBtn, "| 'Follow' matches:", followBtn, "| login/signup text matches:", loginWall);

  // (c) navigator.webdriver / bot fingerprint as IG sees it
  const fp = await page.evaluate(() => ({
    webdriver: navigator.webdriver,
    ua: navigator.userAgent,
    platform: navigator.platform,
    languages: navigator.languages,
  }));
  console.log("\n[fingerprint]", JSON.stringify(fp));

  // (d) try to reach the direct UI (will redirect to login when logged out)
  resp = await page.goto("https://www.instagram.com/direct/inbox/", { waitUntil: "domcontentloaded", timeout: 45000 });
  console.log("\n[direct] http status:", resp && resp.status());
  console.log("[direct] final url:", page.url(), "(redirect to /accounts/login => login required, expected)");

  await browser.close();
}
main().catch((e) => { console.error("PLAYWRIGHT ERROR:", e.message); process.exit(1); });
