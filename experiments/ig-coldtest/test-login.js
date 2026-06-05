// Test: can instagram-private-api perform the mechanical login flow?
// Uses throwaway creds. We don't expect success; we want to classify the FAILURE:
//  - normal auth error (bad password / user not found) => flow works, needs real creds
//  - checkpoint/challenge                              => flow works, IP slightly flagged
//  - 4xx datacenter/IP block / consent / parse error  => library or our IP blocked
const { IgApiClient } = require("instagram-private-api");

async function main() {
  const ig = new IgApiClient();
  const username = "pebble_test_doesnotexist";
  const password = "Wrongpass!" + Math.random().toString(36).slice(2);
  ig.state.generateDevice(username);
  console.log("device generated, deviceId:", ig.state.deviceId);
  try {
    // pre-login flow mirrors what the library does internally
    const res = await ig.account.login(username, password);
    console.log("UNEXPECTED LOGIN SUCCESS:", JSON.stringify(res).slice(0, 500));
  } catch (e) {
    console.log("=== ERROR CAUGHT ===");
    console.log("name:", e && e.name);
    console.log("message:", e && e.message);
    if (e && e.response) {
      console.log("http status:", e.response.statusCode);
      console.log("http headers x-fb-trip-id:", e.response.headers && e.response.headers["x-fb-trip-id"]);
      const body = e.response.body;
      console.log("body type:", typeof body);
      console.log("body:", typeof body === "string" ? body.slice(0, 800) : JSON.stringify(body).slice(0, 800));
    } else {
      console.log("no e.response present; full error:", e);
    }
  }
}
main().catch((e) => { console.error("TOP-LEVEL:", e); process.exit(1); });
