import { Hono } from "hono";
import { z } from "zod";
import { badRequest, notFound, type AppEnv } from "../app";
import { grantCredits, InsufficientCreditsError } from "../credits";
import { isAdminEmail } from "../env";
import { ENGINE_IDS, ENGINES, engineFromEnv } from "../imaging/engines";
import { getDefaultEngine, setDefaultEngine } from "../settings";

export const admin = new Hono<AppEnv>();

admin.use("/admin/*", async (c, next) => {
  if (!isAdminEmail(c.env, c.get("user").email)) return c.json({ error: "forbidden", message: "Jen pro správce." }, 403);
  await next();
});

admin.get("/admin/users", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.createdAt AS createdAt, COALESCE(w.balance, 0) AS balance,
            (SELECT COUNT(*) FROM generations g WHERE g.user_id = u.id AND g.status = 'done') AS generated
     FROM "user" u LEFT JOIN wallets w ON w.user_id = u.id ORDER BY u.createdAt DESC`,
  ).all();
  return c.json(results);
});

const grant = z.object({
  email: z.string().trim().toLowerCase().email(),
  amount: z.number().int().min(-1000).max(1000).refine((n) => n !== 0),
  note: z.string().trim().max(200).nullish(),
});

admin.post("/admin/grant", async (c) => {
  const parsed = grant.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, "Zadejte e-mail a nenulový počet kreditů.");
  const target = await c.env.DB.prepare(`SELECT id FROM "user" WHERE lower(email) = ?`).bind(parsed.data.email).first<string>("id");
  if (!target) return notFound(c);
  try {
    const balance = await grantCredits(c.env.DB, {
      userId: target,
      amount: parsed.data.amount,
      note: parsed.data.note ?? null,
      createdBy: c.get("user").email,
    });
    return c.json({ balance });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) return badRequest(c, "Zůstatek nemůže klesnout pod nulu.");
    throw e;
  }
});

const settingsBody = z.object({ defaultEngine: z.enum(ENGINE_IDS).nullable() });

async function settings(c: { env: Env }) {
  return {
    // What generations use right now: the saved choice, else the Worker vars.
    defaultEngine: (await getDefaultEngine(c.env.DB)) ?? engineFromEnv(c.env),
    engines: ENGINES.map(({ id, label }) => ({ id, label })),
  };
}

admin.get("/admin/settings", async (c) => c.json(await settings(c)));

admin.put("/admin/settings", async (c) => {
  const parsed = settingsBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, "Neznámý model.");
  await setDefaultEngine(c.env.DB, parsed.data.defaultEngine, c.get("user").email);
  return c.json(await settings(c));
});
