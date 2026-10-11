import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDefaultEngine, setDefaultEngine } from "./settings";

describe("default engine setting", () => {
  it("is null until set", async () => {
    await setDefaultEngine(env.DB, null, "test");
    expect(await getDefaultEngine(env.DB)).toBeNull();
  });

  it("stores and reads an engine", async () => {
    await setDefaultEngine(env.DB, "openai-medium", "test");
    expect(await getDefaultEngine(env.DB)).toBe("openai-medium");
    await setDefaultEngine(env.DB, "openai-low", "test");
    expect(await getDefaultEngine(env.DB)).toBe("openai-low");
  });

  it("ignores a stored engine that is no longer offered", async () => {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('default_engine', 'gemini-3.1-flash-image', '2026-01-01')",
    ).run();
    expect(await getDefaultEngine(env.DB)).toBeNull();
  });

  it("can be cleared", async () => {
    await setDefaultEngine(env.DB, "openai-low", "test");
    await setDefaultEngine(env.DB, null, "test");
    expect(await getDefaultEngine(env.DB)).toBeNull();
  });
});
