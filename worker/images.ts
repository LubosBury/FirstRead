export type ImageRow = {
  id: string;
  user_id: string;
  r2_key: string;
  origin: "upload" | "generated";
  generation_id: string | null;
  mime: string;
  bytes: number;
  label: string | null;
  created_at: string;
  /** Set while the picture is in the shared library. */
  shared_at: string | null;
  /** Set on the first share and never cleared: other users' sheets may use it. */
  first_shared_at: string | null;
  /** Joined from generations when listing; absent on a freshly saved row. */
  g_provider?: string | null;
  g_model?: string | null;
  g_quality?: string | null;
};

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Trusts the bytes, not the Content-Type header. */
export function sniffImageMime(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" &&
    String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP"
  )
    return "image/webp";
  return null;
}

export const publicImage = (r: ImageRow) => ({
  id: r.id,
  origin: r.origin,
  mime: r.mime,
  label: r.label,
  createdAt: r.created_at,
  shared: !!r.shared_at,
  everShared: !!r.first_shared_at,
  url: `/api/images/${r.id}`,
  source: r.g_provider ? { provider: r.g_provider, model: r.g_model ?? null, quality: r.g_quality ?? null } : null,
});

export async function saveImage(
  env: Env,
  img: { userId: string; bytes: Uint8Array; mime: string; origin: ImageRow["origin"]; generationId: string | null; label: string | null },
): Promise<ImageRow> {
  const id = crypto.randomUUID();
  const row: ImageRow = {
    id,
    user_id: img.userId,
    r2_key: `users/${img.userId}/images/${id}.${EXT[img.mime] ?? "bin"}`,
    origin: img.origin,
    generation_id: img.generationId,
    mime: img.mime,
    bytes: img.bytes.byteLength,
    label: img.label,
    created_at: new Date().toISOString(),
    shared_at: null,
    first_shared_at: null,
  };
  await env.IMAGES.put(row.r2_key, img.bytes, { httpMetadata: { contentType: img.mime } });
  await env.DB.prepare(
    `INSERT INTO images (id, user_id, r2_key, origin, generation_id, mime, bytes, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(row.id, row.user_id, row.r2_key, row.origin, row.generation_id, row.mime, row.bytes, row.label, row.created_at)
    .run();
  return row;
}

/** For changes (delete, share): only ever looks up images by owner. */
export function getOwnedImage(db: D1Database, userId: string, id: string) {
  return db.prepare("SELECT * FROM images WHERE id = ? AND user_id = ?").bind(id, userId).first<ImageRow>();
}

/** For reads: the owner, or anyone signed in once the picture has been shared. */
export function getReadableImage(db: D1Database, userId: string, id: string) {
  return db
    .prepare("SELECT * FROM images WHERE id = ? AND (user_id = ? OR first_shared_at IS NOT NULL)")
    .bind(id, userId)
    .first<ImageRow>();
}

export async function readImageBytes(env: Env, row: ImageRow): Promise<Uint8Array | null> {
  const obj = await env.IMAGES.get(row.r2_key);
  return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
}
