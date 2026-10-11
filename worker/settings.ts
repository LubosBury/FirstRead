import { isEngineId, type EngineId } from "./imaging/engines";

const DEFAULT_ENGINE = "default_engine";

/** The admin-chosen default engine, or null to use the Worker vars. */
export async function getDefaultEngine(db: D1Database): Promise<EngineId | null> {
  const value = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(DEFAULT_ENGINE).first<string>("value");
  // A value saved before an engine was retired must not break generation.
  return isEngineId(value) ? value : null;
}

/** Saves the default; null removes it so the Worker vars apply again. */
export async function setDefaultEngine(db: D1Database, engine: EngineId | null, by: string): Promise<void> {
  if (engine === null) {
    await db.prepare("DELETE FROM app_settings WHERE key = ?").bind(DEFAULT_ENGINE).run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (key) DO UPDATE SET value = ?2, updated_at = ?3, updated_by = ?4`,
    )
    .bind(DEFAULT_ENGINE, engine, new Date().toISOString(), by)
    .run();
}
