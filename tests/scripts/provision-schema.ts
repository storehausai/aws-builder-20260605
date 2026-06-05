import { readFileSync } from "node:fs";
import { createBb } from "@pebble/bb";

const ROOT = "/Users/myoons/Gilbreth/aws-builder-storehaus";
const schema = JSON.parse(readFileSync(`${ROOT}/butterbase/schema.json`, "utf8"));

// Butterbase apply-DSL uses `primaryKey`, our file uses `primary`.
for (const t of Object.values(schema.tables) as any[]) {
  for (const col of Object.values(t.columns) as any[]) {
    if (col.primary !== undefined) { col.primaryKey = col.primary; delete col.primary; }
  }
}

const bb = createBb() as any;
console.log("dry-run…");
const dry = await bb.admin.schema.dryRun(schema);
if (dry.error) { console.error("dryRun error:", dry.error); }
else console.log("dryRun ok:", JSON.stringify(dry.data).slice(0, 400));

console.log("\napplying…");
const res = await bb.admin.schema.apply(schema);
if (res.error) { console.error("APPLY ERROR:", JSON.stringify(res.error).slice(0,600)); process.exit(1); }
console.log("APPLIED:", JSON.stringify(res.data).slice(0, 600));
