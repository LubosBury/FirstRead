import { Hono } from "hono";
import { z } from "zod";
import { badRequest, notFound, type AppEnv } from "../app";
import { grantCredits, InsufficientCreditsError } from "../credits";
import { isAdminEmail } from "../env";
import { getOwnedImage, type ImageRow } from "../images";
import { ENGINE_IDS, engineOptions } from "../imaging/engines";
import { resolveEngine, setDefaultEngine } from "../settings";

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
  // What generations use right now: the saved choice, else the Worker vars.
  return { defaultEngine: await resolveEngine(c.env), engines: engineOptions() };
}

admin.get("/admin/settings", async (c) => c.json(await settings(c)));

admin.put("/admin/settings", async (c) => {
  const parsed = settingsBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, "Neznámý model.");
  await setDefaultEngine(c.env.DB, parsed.data.defaultEngine, c.get("user").email);
  return c.json(await settings(c));
});

const shareBody = z.object({ shared: z.boolean() });

/** Admins share their own pictures only. Delete stays the owner's takedown. */
admin.put("/admin/images/:id/shared", async (c) => {
  const parsed = shareBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, "Chybí, jestli obrázek sdílet.");
  const row = await getOwnedImage(c.env.DB, c.get("user").id, c.req.param("id"));
  if (!row) return notFound(c);
  const now = new Date().toISOString();
  const updated = parsed.data.shared
    ? await c.env.DB.prepare(
        `UPDATE images SET shared_at = COALESCE(shared_at, ?1), first_shared_at = COALESCE(first_shared_at, ?1)
         WHERE id = ?2 RETURNING *`,
      )
        .bind(now, row.id)
        .first<ImageRow>()
    : await c.env.DB.prepare("UPDATE images SET shared_at = NULL WHERE id = ? RETURNING *").bind(row.id).first<ImageRow>();
  if (!updated) return notFound(c);
  return c.json({ shared: !!updated.shared_at, everShared: !!updated.first_shared_at });
});
