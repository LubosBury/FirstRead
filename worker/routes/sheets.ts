import { Hono } from "hono";
import { z } from "zod";
import { badRequest, notFound, type AppEnv } from "../app";

export const sheets = new Hono<AppEnv>();

const MAX_PARAMS = 20_000;

const body = z.object({
  templateId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(160),
  params: z.record(z.string(), z.unknown()),
});

/** Params are template-owned and opaque here; only their size is policed. */
function paramsJson(params: unknown): string | null {
  const s = JSON.stringify(params);
  return s.length <= MAX_PARAMS ? s : null;
}

type SheetRow = { id: string; template_id: string; title: string; params_json: string; created_at: string; updated_at: string };

const summary = (r: SheetRow) => ({ id: r.id, templateId: r.template_id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at });

sheets.get("/sheets", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, template_id, title, created_at, updated_at FROM sheets WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200",
  )
    .bind(c.get("user").id)
    .all<SheetRow>();
  return c.json(results.map(summary));
});

sheets.get("/sheets/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM sheets WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("user").id)
    .first<SheetRow>();
  if (!row) return notFound(c);
  return c.json({ ...summary(row), params: JSON.parse(row.params_json) });
});

sheets.post("/sheets", async (c) => {
  const parsed = body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, "Neplatný list.");
  const json = paramsJson(parsed.data.params);
  if (!json) return badRequest(c, "List je příliš velký.");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO sheets (id, user_id, template_id, title, params_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, c.get("user").id, parsed.data.templateId, parsed.data.title, json, now, now)
    .run();
  return c.json({ id }, 201);
});

sheets.put("/sheets/:id", async (c) => {
  const parsed = body.omit({ templateId: true }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, "Neplatný list.");
  const json = paramsJson(parsed.data.params);
  if (!json) return badRequest(c, "List je příliš velký.");
  const res = await c.env.DB.prepare("UPDATE sheets SET title = ?, params_json = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(parsed.data.title, json, new Date().toISOString(), c.req.param("id"), c.get("user").id)
    .run();
  if (res.meta.changes === 0) return notFound(c);
  return c.json({ ok: true });
});

sheets.delete("/sheets/:id", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM sheets WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("user").id)
    .run();
  if (res.meta.changes === 0) return notFound(c);
  return c.body(null, 204);
});
