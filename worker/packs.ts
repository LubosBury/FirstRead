/** The credit packs teachers can buy. Three fixed rows, seeded by the migration. */

export type PackRow = { id: string; credits: number; priceCzk: number; label: string | null; active: boolean };

const SELECT = "SELECT id, credits, price_czk AS priceCzk, label, active FROM credit_packs";

type Raw = Omit<PackRow, "active"> & { active: number };
const toPack = (r: Raw): PackRow => ({ ...r, active: Boolean(r.active) });

/** Every pack, smallest first. */
export async function listPacks(db: D1Database): Promise<PackRow[]> {
  const { results } = await db.prepare(`${SELECT} ORDER BY credits, price_czk, id`).all<Raw>();
  return results.map(toPack);
}

export async function getPack(db: D1Database, id: string): Promise<PackRow | null> {
  const row = await db.prepare(`${SELECT} WHERE id = ?`).bind(id).first<Raw>();
  return row && toPack(row);
}

/** Returns false when there is no such pack. */
export async function updatePack(db: D1Database, id: string, p: Omit<PackRow, "id">, by: string): Promise<boolean> {
  const res = await db
    .prepare("UPDATE credit_packs SET credits = ?1, price_czk = ?2, label = ?3, active = ?4, updated_at = ?5, updated_by = ?6 WHERE id = ?7")
    .bind(p.credits, p.priceCzk, p.label, p.active ? 1 : 0, new Date().toISOString(), by, id)
    .run();
  return res.meta.changes === 1;
}
