// Makes an email an admin, creating the user if needed. Sets up the first
// admin, and gets back in if the last one is locked out.
//   npm run make-admin -- you@example.com            (local D1)
//   npm run make-admin -- you@example.com --remote   (production D1)
import { execFileSync } from "node:child_process";
import { makeAdminSql } from "../worker/make-admin.ts";

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
if (!email) {
  console.error("Usage: npm run make-admin -- <email> [--remote]");
  process.exit(1);
}
const target = args.includes("--remote") ? "--remote" : "--local";
execFileSync("npx", ["wrangler", "d1", "execute", "firstread", target, "--command", makeAdminSql(email)], { stdio: "inherit" });
