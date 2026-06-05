// Method 4: resolve @handle -> numeric user id WITHOUT auth.
// Try the historically-working public endpoints.
const https = require("https");

const UA_MOBILE = "Instagram 219.0.0.12.117 Android";
const UA_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
// Instagram web app id, public/known constant used by web client
const APP_ID = "936619743392459";

function get(url, headers) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request(
      { method: "GET", hostname: u.hostname, path: u.pathname + u.search, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on("error", (e) => resolve({ status: 0, error: e.message }));
    req.end();
  });
}

async function tryEndpoint(label, url, headers) {
  const r = await get(url, headers);
  let extracted = null;
  try {
    const j = JSON.parse(r.body);
    extracted =
      j?.data?.user?.id ||
      j?.graphql?.user?.id ||
      j?.user?.pk ||
      j?.user?.id ||
      null;
  } catch (_) {}
  console.log(`\n[${label}] ${url}`);
  console.log("  status:", r.status, "len:", (r.body || "").length, r.error ? "err=" + r.error : "");
  console.log("  extracted_id:", extracted);
  console.log("  body_snippet:", (r.body || "").slice(0, 200).replace(/\n/g, " "));
  return extracted;
}

async function main() {
  const handle = "instagram";
  // 1. legacy ?__a=1&__d=dis
  await tryEndpoint("__a=1", `https://www.instagram.com/${handle}/?__a=1&__d=dis`, {
    "User-Agent": UA_DESKTOP, Accept: "*/*",
  });
  // 2. web_profile_info API with app id header
  await tryEndpoint(
    "web_profile_info",
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${handle}`,
    { "User-Agent": UA_DESKTOP, "x-ig-app-id": APP_ID, Accept: "*/*" }
  );
  // 3. mobile UA web_profile_info
  await tryEndpoint(
    "web_profile_info(mobileUA)",
    `https://i.instagram.com/api/v1/users/web_profile_info/?username=${handle}`,
    { "User-Agent": UA_MOBILE, "x-ig-app-id": APP_ID, Accept: "*/*" }
  );
  // 4. raw profile HTML scrape for "profilePage_<id>" / "id":"<id>"
  const r = await get(`https://www.instagram.com/${handle}/`, { "User-Agent": UA_DESKTOP });
  const m1 = (r.body || "").match(/"profilePage_(\d+)"/);
  const m2 = (r.body || "").match(/"props":\{"id":"(\d+)"/);
  const m3 = (r.body || "").match(/"user_id":"(\d+)"/);
  console.log("\n[html scrape] https://www.instagram.com/" + handle + "/");
  console.log("  status:", r.status, "len:", (r.body || "").length);
  console.log("  profilePage_:", m1 && m1[1], "| props.id:", m2 && m2[1], "| user_id:", m3 && m3[1]);
}
main();
