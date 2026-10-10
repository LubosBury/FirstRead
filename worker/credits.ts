/**
 * Credit accounting.
 *
 * `wallets.balance` is a cached sum of `credit_ledger`. Every change to it is
 * written in the same D1 batch as its ledger row, and a batch is one
 * transaction, so the two can't drift. The `CHECK (balance >= 0)` on wallets
 * is the overdraw guard: a debit the balance can't cover fails the whole batch.
 */

export class InsufficientCreditsError extends Error {
  constructor() {
    super("Nedostatek kreditů");
    this.name = "InsufficientCreditsError";
  }
}

export type GenerationStart = {
  userId: string;
  slot: "main" | "icon";
  prompt: string;
  referenceImageId: string | null;
  provider: string;
  model: string;
  quality: string | null;
  cost: number;
};

const now = () => new Date().toISOString();

const isBalanceCheck = (e: unknown) => e instanceof Error && /CHECK constraint failed/i.test(e.message);

/** Opens the wallet on first use, granting the welcome credits exactly once. */
export async function ensureWallet(db: D1Database, userId: string, welcome: number): Promise<void> {
  const at = now();
  await db.batch([
    // Runs before the wallet insert, so "no wallet yet" means "first time".
    db
      .prepare(
        `INSERT INTO credit_ledger (id, user_id, delta, reason, note, created_at)
         SELECT ?1, ?2, ?3, 'grant', 'welcome', ?4
         WHERE ?3 > 0 AND NOT EXISTS (SELECT 1 FROM wallets WHERE user_id = ?2)`,
      )
      .bind(crypto.randomUUID(), userId, welcome, at),
    db.prepare("INSERT OR IGNORE INTO wallets (user_id, balance, updated_at) VALUES (?1, ?2, ?3)").bind(userId, welcome, at),
  ]);
}

export async function getBalance(db: D1Database, userId: string): Promise<number> {
  const balance = await db.prepare("SELECT balance FROM wallets WHERE user_id = ?").bind(userId).first<number>("balance");
  return balance ?? 0;
}

/** Debits the cost and records a pending generation. Returns its id. */
export async function startGeneration(db: D1Database, g: GenerationStart): Promise<string> {
  const id = crypto.randomUUID();
  const at = now();
  try {
    const [debit] = await db.batch([
      db.prepare("UPDATE wallets SET balance = balance - ?1, updated_at = ?2 WHERE user_id = ?3").bind(g.cost, at, g.userId),
      // Both inserts select from the wallet, so a user without one gets nothing.
      db
        .prepare(
          `INSERT INTO generations (id, user_id, slot, prompt, reference_image_id, provider, model, quality, status, cost, created_at)
           SELECT ?1, user_id, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?9 FROM wallets WHERE user_id = ?10`,
        )
        .bind(id, g.slot, g.prompt, g.referenceImageId, g.provider, g.model, g.quality, g.cost, at, g.userId),
      db
        .prepare(
          `INSERT INTO credit_ledger (id, user_id, delta, reason, generation_id, created_at)
           SELECT ?1, user_id, ?2, 'generation', ?3, ?4 FROM wallets WHERE user_id = ?5`,
        )
        .bind(crypto.randomUUID(), -g.cost, id, at, g.userId),
    ]);
    if (debit.meta.changes === 0) throw new InsufficientCreditsError();
  } catch (e) {
    if (isBalanceCheck(e)) throw new InsufficientCreditsError();
    throw e;
  }
  return id;
}

export async function completeGeneration(
  db: D1Database,
  id: string,
  result: { imageId: string; usage: unknown },
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE generations SET status = 'done', image_id = ?1, usage_json = ?2, completed_at = ?3
       WHERE id = ?4 AND status = 'pending'`,
    )
    .bind(result.imageId, result.usage == null ? null : JSON.stringify(result.usage), now(), id)
    .run();
  return res.meta.changes === 1;
}

/**
 * Marks a pending generation failed and refunds it. Safe to call twice or race
 * with the cron: the refund is keyed to the generation, so it happens once.
 * Returns whether this call issued the refund.
 */
export async function failGeneration(db: D1Database, id: string, error: string): Promise<boolean> {
  const refundId = crypto.randomUUID();
  const at = now();
  const [, refund] = await db.batch([
    db
      .prepare("UPDATE generations SET status = 'failed', error = ?1, completed_at = ?2 WHERE id = ?3 AND status = 'pending'")
      .bind(error.slice(0, 500), at, id),
    db
      .prepare(
        `INSERT INTO credit_ledger (id, user_id, delta, reason, generation_id, created_at)
         SELECT ?1, user_id, cost, 'refund', id, ?2 FROM generations
         WHERE id = ?3 AND status = 'failed' AND cost > 0
           AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE generation_id = ?3 AND reason = 'refund')`,
      )
      .bind(refundId, at, id),
    // Credits the wallet only if the refund row above was just written.
    db
      .prepare(
        `UPDATE wallets SET balance = balance + (SELECT delta FROM credit_ledger WHERE id = ?1), updated_at = ?2
         WHERE user_id = (SELECT user_id FROM credit_ledger WHERE id = ?1)`,
      )
      .bind(refundId, at),
  ]);
  return refund.meta.changes === 1;
}

/** Refunds generations whose request died mid-flight (closed tab, timeout). */
export async function refundStaleGenerations(db: D1Database, olderThanMs: number, nowMs = Date.now()): Promise<number> {
  const cutoff = new Date(nowMs - olderThanMs).toISOString();
  const { results } = await db
    .prepare("SELECT id FROM generations WHERE status = 'pending' AND created_at < ?1 LIMIT 100")
    .bind(cutoff)
    .all<{ id: string }>();
  let refunded = 0;
  for (const { id } of results) {
    if (await failGeneration(db, id, "Generování nedoběhlo včas")) refunded++;
  }
  return refunded;
}

/** Admin adjustment. Negative amounts correct mistakes but never go below zero. */
export async function grantCredits(
  db: D1Database,
  g: { userId: string; amount: number; note: string | null; createdBy: string },
): Promise<number> {
  await ensureWallet(db, g.userId, 0);
  const at = now();
  try {
    await db.batch([
      db.prepare("UPDATE wallets SET balance = balance + ?1, updated_at = ?2 WHERE user_id = ?3").bind(g.amount, at, g.userId),
      db
        .prepare(
          `INSERT INTO credit_ledger (id, user_id, delta, reason, note, created_by, created_at)
           VALUES (?1, ?2, ?3, 'grant', ?4, ?5, ?6)`,
        )
        .bind(crypto.randomUUID(), g.userId, g.amount, g.note, g.createdBy, at),
    ]);
  } catch (e) {
    if (isBalanceCheck(e)) throw new InsufficientCreditsError();
    throw e;
  }
  return getBalance(db, g.userId);
}
