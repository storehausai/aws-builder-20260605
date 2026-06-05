# IG Cold-DM mechanism test — NOTES (2026-06-05)

Goal: which method can send a COLD Instagram DM (business-initiated first DM to an
arbitrary influencer by @handle) in 2026. No real IG account was available, so every
mechanism was tested as far as possible WITHOUT credentials, then judged "would it work
given a burner account."

All tests run from this machine's IP (residential, US). Test scripts kept in this dir:
test-login.js, test-login2.js, test-resolve.js, test-playwright*.js
(node_modules + browser binaries deleted after testing — `npm i` to re-run).

## RANKED RESULT

### #1 (recommended) — `instagram-private-api` (dilame) → yes-with-burner-account
The mechanical auth flow is INTACT from our IP. Throwaway login returned a clean,
application-level auth error — NOT an IP/datacenter block, NOT a parse failure:

    name:    IgLoginInvalidUserError
    status:  400
    body:    {"message":"We can't find an account with pebble_test_doesnotexist...",
              "status":"fail","exception_name":"UserInvalidCredentials",
              "invalid_credentials":true,"error_type":"invalid_user"}

That means: the library still speaks IG's private API correctly, IG accepts the request
from our IP, and only real credentials are missing. The main repo already wires the full
cold path: resolve @handle -> pk -> `ig.entity.directThread([pk]).broadcastText(text)`
(packages/outreach/src/instagram/private-api.ts).
- Library status: v1.46.1, last published 2024-03-07 (~2 yrs stale, 381 open issues).
- Known 2026 risk: fresh logins frequently hit `challenge_required` (email/SMS code) or
  checkpoints, especially from cloud IPs. From a residential IP with a warmed burner it
  usually clears. Mitigation already in repo: log in ONCE interactively, persist the
  serialized session, reuse it (avoids re-challenge mid-demo).
- NEED FROM USER: a burner IG account username+password (ideally already logged-in once
  on a phone so it's "warmed"), and access to that account's email/SMS to clear the
  one-time challenge. Optionally a residential proxy (IG_PROXY).

### #2 (fallback / most robust if private-api gets challenge-walled) — Playwright web UI → yes-with-burner-account
Headless Chromium drives instagram.com cleanly from our IP:
- https://www.instagram.com/accounts/login/  -> HTTP 200, real login form renders.
  Form fields are `input[name="email"]` + `input[name="pass"]` + submit button.
  Verified fillable via Playwright (typed creds, values read back correctly).
  (Earlier `name="username"` selector was wrong — IG serves the email/pass variant.)
- Public profile https://www.instagram.com/instagram/ -> HTTP 200, full content.
- https://www.instagram.com/direct/inbox/ -> redirects to login when logged out (expected).
- `navigator.webdriver` was true (bot tell) but trivially masked via addInitScript;
  no hard bot-block hit on logged-out browsing.
Cold-DM steps for a logged-in session (cookies/sessionid from a burner):
  1. load session cookies into context (or log in via the form once).
  2. goto https://www.instagram.com/<handle>/ , click the "Message" button
     (only present when logged in). OR goto /direct/t/<thread> / use "Send message".
  3. type into the message composer (contenteditable / `textarea[placeholder*="Message"]`),
     press Enter to send.
- Most robust against private-API signature changes (it's the real web app), but slower
  and more brittle to UI/selector changes; needs the bot-detection masking + human-like
  pacing to avoid action-blocks.
- NEED FROM USER: a burner account's logged-in session cookies (export `sessionid`,
  `ds_user_id`, `csrftoken`) OR username+password + ability to clear the login challenge.

### #4 (enabling capability, not a sender) — handle → user-id WITHOUT login → YES, works now
Needed to open a DM thread by pk. Tested unauthenticated from our IP:
- `GET https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram`
  with header `x-ig-app-id: 936619743392459`  -> HTTP 200, resolved id = 25025320.
  Works on both www.instagram.com and i.instagram.com.
- Legacy `?__a=1&__d=dis` -> HTTP 201, empty body (deprecated/dead).
- Plain profile-HTML regex scrape -> 200 but ids no longer embedded in obvious markers.
So: resolution is solved unauthenticated via web_profile_info + x-ig-app-id header.
(May rate-limit under volume; for a demo it's fine. The private-api's
`user.getIdByUsername` does this while authenticated, which is more reliable.)

### #3 — Other libraries / services → NO (none better)
- `instauto` (mifi): puppeteer follow/unfollow/like automation. ARCHIVED 2026-03-11
  (read-only). No first-class DM support. Not a fit.
- `instabot` (npm): unrelated junk package (a dep-installer), last touched 2022.
  The Python `instabot` is a different, abandoned ecosystem.
- `@igpapi/core` / `igpapi` / `instabot-js`: NOT FOUND on npm (404). Dead/renamed.
- `instagram-web-api`: last modified 2022; stale; private-web-api, same fragility class
  as #1 but more abandoned.
- Third-party DM-sending SaaS (e.g. ManyChat/Instagram Graph messaging): the OFFICIAL
  Graph API can only message users who messaged the business FIRST (24h window) — it
  CANNOT initiate a cold first DM. So no compliant API path exists for cold DMs; the
  outreach-tool vendors that "cold DM" all use the same unofficial/browser automation
  under the hood (often with managed residential proxies + warmed accounts), i.e. paid
  versions of #1/#2.

## BOTTOM LINE / RECOMMENDATION
Cold IG DMs ARE achievable for the demo, but ONLY via an unofficial path with a burner
account — there is no official/API-compliant way to send a cold first DM.

Primary: use `instagram-private-api` (already integrated in packages/outreach) with a
warmed burner account. The login mechanics demonstrably still work from our IP; we only
need real creds + a one-time challenge clear, then a persisted session.

If the burner trips a persistent challenge or the private API signature breaks at demo
time, fall back to Playwright driving the real web UI with that same burner's session
cookies.

WHAT WE NEED FROM THE USER (to make a real cold DM arrive):
  1. A burner IG account: username + password (warm it: log in on a phone first, post
     a pic, follow a few accounts, wait a day).
  2. Access to that account's email/SMS to clear the one-time login challenge.
  3. (Recommended) a residential proxy URL for IG_PROXY to reduce challenge/ban risk.
With those, run the repo's `ig:login` once to persist the session, then send.
