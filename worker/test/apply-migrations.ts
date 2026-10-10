import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

// Setup files run outside isolated storage and may run more than once;
// applyD1Migrations only applies what hasn't been applied yet.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
