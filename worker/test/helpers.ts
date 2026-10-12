import { env } from "cloudflare:test";

export async function createUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, email, email, now, now)
    .run();
  return id;
}

export const uniqueEmail = (prefix = "u") => `${prefix}-${crypto.randomUUID()}@example.com`;

export async function ledgerRows(userId: string) {
  const { results } = await env.DB.prepare(
    "SELECT delta, reason, note, generation_id FROM credit_ledger WHERE user_id = ? ORDER BY created_at, rowid",
  )
    .bind(userId)
    .all<{ delta: number; reason: string; note: string | null; generation_id: string | null }>();
  return results;
}
