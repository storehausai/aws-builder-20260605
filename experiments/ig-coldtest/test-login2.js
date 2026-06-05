// Second login test: use a username that almost certainly EXISTS ("instagram")
// with a wrong password. If we get a "bad password" style error (not user-not-found,
// not datacenter block), that further confirms the auth endpoint works for us.
const { IgApiClient } = require("instagram-private-api");
async function main() {
  const ig = new IgApiClient();
  const username = "instagram";
  const password = "definitely_wrong_" + Math.random().toString(36).slice(2);
  ig.state.generateDevice(username);
  try {
    await ig.account.login(username, password);
    console.log("UNEXPECTED SUCCESS");
  } catch (e) {
    console.log("name:", e && e.name);
    console.log("message:", (e && e.message || "").slice(0, 300));
    if (e && e.response) {
      console.log("status:", e.response.statusCode);
      const b = e.response.body;
      console.log("body:", (typeof b === "string" ? b : JSON.stringify(b)).slice(0, 600));
    }
  }
}
main();
