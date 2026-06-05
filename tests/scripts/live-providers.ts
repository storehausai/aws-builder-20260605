import { resolveInstagramProfile } from "@pebble/providers";

async function main() {
  console.log("=== resolveInstagramProfile (REAL unauthenticated IG API) ===");
  for (const handle of ["natgeo", "rael.beauty"]) {
    try {
      const p = await resolveInstagramProfile(handle);
      if (p) console.log(`  @${handle} -> pk=${p.pk} followers=${p.followers?.toLocaleString()} verified=${p.isVerified} name="${p.fullName ?? ""}"`);
      else console.log(`  @${handle} -> not found`);
    } catch (e) { console.log(`  @${handle} -> ERROR ${(e as Error).message}`); }
  }
}
main();
