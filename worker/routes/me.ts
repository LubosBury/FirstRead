import { Hono } from "hono";
import type { AppEnv } from "../app";
import { ensureWallet, getBalance } from "../credits";
import { intVar, isAdminEmail } from "../env";
import { ENGINES } from "../imaging/engines";

export const me = new Hono<AppEnv>();

me.get("/me", async (c) => {
  const user = c.get("user");
  // First visit opens the wallet with the welcome credits.
  await ensureWallet(c.env.DB, user.id, intVar(c.env.WELCOME_CREDITS, 5));
  const isAdmin = isAdminEmail(c.env, user.email);
  return c.json({
    user,
    balance: await getBalance(c.env.DB, user.id),
    isAdmin,
    costs: { main: intVar(c.env.CREDIT_COST_MAIN, 1), icon: intVar(c.env.CREDIT_COST_ICON, 1) },
    // Admins can compare engines on the same prompt; everyone else gets the default.
    ...(isAdmin && { engines: ENGINES.map(({ id, label }) => ({ id, label })) }),
  });
});

me.get("/credits/ledger", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT delta, reason, note, generation_id AS generationId, created_at AS createdAt
     FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(c.get("user").id)
    .all();
  return c.json(results);
});
