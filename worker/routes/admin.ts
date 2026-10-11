import { Hono } from "hono";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { badRequest, isAdmin, notFound, type AppEnv } from "../app";
import { getAuth } from "../auth";
import { grantCredits, InsufficientCreditsError } from "../credits";
import { ENGINE_IDS, engineOptions } from "../imaging/engines";
import { inviteMail, sendMail } from "../mail";
import { resolveEngine, setDefaultEngine } from "../settings";

export const admin = new Hono<AppEnv>();

admin.use("/admin/*", async (c, next) => {
  if (!isAdmin(c.get("user"))) return c.json({ error: "forbidden", message: "Jen pro správce." }, 403);
  await next();
});

type UserRow = {
  id: string;
  email: string;
  createdAt: string;
  role: string | null;
  banned: number | null;
  emailVerified: number;
  balance: number;
  generated: number;
};

admin.get("/admin/users", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.createdAt AS createdAt, u.role, u.banned, u.emailVerified, COALESCE(w.balance, 0) AS balance,
            (SELECT COUNT(*) FROM generations g WHERE g.user_id = u.id AND g.status = 'done') AS generated
     FROM "user" u LEFT JOIN wallets w ON w.user_id = u.id ORDER BY u.createdAt DESC`,
  ).all<UserRow>();
  return c.json(results.map((u) => ({ ...u, banned: Boolean(u.banned), emailVerified: Boolean(u.emailVerified) })));
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

const inviteBody = z.object({ email: z.string().trim().toLowerCase().email() });

admin.post("/admin/invites", async (c) => {
  const parsed = inviteBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, "Zadejte platný e-mail.");
  const { email } = parsed.data;
  const existing = await c.env.DB.prepare(`SELECT id, emailVerified, banned FROM "user" WHERE lower(email) = ?`)
    .bind(email)
    .first<{ id: string; emailVerified: number; banned: number | null }>();
  if (existing?.banned) return c.json({ error: "conflict", message: "Přístup byl odebrán. Vraťte ho v seznamu uživatelů." }, 409);
  if (existing?.emailVerified) return c.json({ error: "conflict", message: "Tento e-mail už přístup má." }, 409);
  const auth = await getAuth(c.env);
  // With the admin's headers, the plugin checks the role as well.
  const userId =
    existing?.id ?? (await auth.api.createUser({ headers: c.req.raw.headers, body: { email, name: "", role: "user" } })).user.id;
  const { token } = await auth.api.createInvite({ body: { userId } });
  const url = `${c.env.APP_URL.replace(/\/$/, "")}/invite?token=${token}&email=${encodeURIComponent(email)}`;
  await sendMail(c.env, inviteMail(email, c.get("user").email, url));
  return c.json({ email, resent: Boolean(existing) }, existing ? 200 : 201);
});

// Revoking access is a Better Auth ban: it ends all sessions, and the magic-link
// gate refuses banned users. Their sheets and images stay.
admin.post("/admin/users/:id/ban", async (c) => {
  try {
    await (await getAuth(c.env)).api.banUser({ headers: c.req.raw.headers, body: { userId: c.req.param("id") } });
  } catch (e) {
    if (e instanceof APIError && e.statusCode === 400) return badRequest(c, "Sami sobě přístup odebrat nemůžete.");
    if (e instanceof APIError && e.statusCode === 404) return notFound(c);
    throw e;
  }
  return c.body(null, 204);
});

admin.post("/admin/users/:id/unban", async (c) => {
  try {
    await (await getAuth(c.env)).api.unbanUser({ headers: c.req.raw.headers, body: { userId: c.req.param("id") } });
  } catch (e) {
    if (e instanceof APIError && e.statusCode === 404) return notFound(c);
    throw e;
  }
  return c.body(null, 204);
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
