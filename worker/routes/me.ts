import { Hono } from "hono";
import { isAdmin, type AppEnv } from "../app";
import { ensureWallet, getBalance } from "../credits";
import { intVar } from "../env";
import { engineOptions } from "../imaging/engines";
import { getPaymentProvider } from "../payments/provider";
import { creditCost, resolveEngine } from "../settings";

export const me = new Hono<AppEnv>();

me.get("/me", async (c) => {
  const user = c.get("user");
  // First visit opens the wallet with the welcome credits.
  await ensureWallet(c.env.DB, user.id, intVar(c.env.WELCOME_CREDITS, 5));
  const admin = isAdmin(user);
  const engine = await resolveEngine(c.env);
  return c.json({
    user,
    balance: await getBalance(c.env.DB, user.id),
    isAdmin: admin,
    // What the next image costs on the current default engine.
    costs: { main: creditCost(c.env, engine, "main"), icon: creditCost(c.env, engine, "icon") },
    // Lets the UI hide buying when no payment provider is configured.
    canBuyCredits: getPaymentProvider(c.env) !== null,
    // Admins can compare engines on the same prompt; everyone else gets the default.
    ...(admin && { engines: engineOptions(), defaultEngine: engine }),
  });
});

me.get("/credits/ledger", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT delta, reason, note, generation_id AS generationId, created_at AS createdAt
     FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50`,
  )
    .bind(c.get("user").id)
    .all();
  return c.json(results);
});
