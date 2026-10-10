import { Hono } from "hono";
import { notFound, type AppEnv } from "../app";
import { getOwnedImage, MAX_UPLOAD_BYTES, publicImage, saveImage, sniffImageMime, type ImageRow } from "../images";

export const images = new Hono<AppEnv>();

images.get("/images", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM images WHERE user_id = ? ORDER BY created_at DESC LIMIT 500")
    .bind(c.get("user").id)
    .all<ImageRow>();
  return c.json(results.map(publicImage));
});

/** Raw body upload: the file is the body, its type is read from its bytes. */
images.post("/images", async (c) => {
  const declared = Number(c.req.header("Content-Length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES) return c.json({ error: "too_large", message: "Obrázek může mít nejvýš 10 MB." }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return c.json({ error: "too_large", message: "Obrázek může mít nejvýš 10 MB." }, 413);
  const mime = sniffImageMime(bytes);
  if (!mime) return c.json({ error: "unsupported", message: "Nahrajte prosím obrázek PNG, JPG nebo WebP." }, 415);
  const label = c.req.query("label")?.slice(0, 120) ?? null;
  const row = await saveImage(c.env, { userId: c.get("user").id, bytes, mime, origin: "upload", generationId: null, label });
  return c.json(publicImage(row), 201);
});

images.get("/images/:id", async (c) => {
  const row = await getOwnedImage(c.env.DB, c.get("user").id, c.req.param("id"));
  if (!row) return notFound(c);
  const obj = await c.env.IMAGES.get(row.r2_key);
  if (!obj) return notFound(c);
  return new Response(obj.body, {
    headers: {
      "Content-Type": row.mime,
      "X-Content-Type-Options": "nosniff",
      // Ids are never reused, so the bytes behind one never change.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});

images.delete("/images/:id", async (c) => {
  const row = await getOwnedImage(c.env.DB, c.get("user").id, c.req.param("id"));
  if (!row) return notFound(c);
  await c.env.DB.prepare("DELETE FROM images WHERE id = ?").bind(row.id).run();
  await c.env.IMAGES.delete(row.r2_key);
  return c.body(null, 204);
});
