import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  completeGeneration,
  ensureWallet,
  failGeneration,
  getBalance,
  grantCredits,
  InsufficientCreditsError,
  refundStaleGenerations,
  startGeneration,
} from "./credits";
import { createUser, ledgerRows, uniqueEmail } from "./test/helpers";

const gen = (userId: string, cost = 1) => ({
  userId,
  slot: "icon" as const,
  prompt: "houbička",
  referenceImageId: null,
  provider: "mock",
  model: "mock-1",
  quality: "low",
  cost,
});

async function userWith(balance: number) {
  const id = await createUser(uniqueEmail());
  await ensureWallet(env.DB, id, balance);
  return id;
}

describe("ensureWallet", () => {
  it("grants the welcome credits exactly once", async () => {
    const id = await createUser(uniqueEmail());
    await ensureWallet(env.DB, id, 5);
    await ensureWallet(env.DB, id, 5);
    expect(await getBalance(env.DB, id)).toBe(5);
    expect(await ledgerRows(id)).toEqual([{ delta: 5, reason: "grant", note: "welcome", generation_id: null }]);
  });

  it("opens an empty wallet without a ledger row when there is no welcome bonus", async () => {
    const id = await createUser(uniqueEmail());
    await ensureWallet(env.DB, id, 0);
    expect(await getBalance(env.DB, id)).toBe(0);
    expect(await ledgerRows(id)).toEqual([]);
  });

  it("survives concurrent first requests without double-granting", async () => {
    const id = await createUser(uniqueEmail());
    await Promise.all([ensureWallet(env.DB, id, 5), ensureWallet(env.DB, id, 5), ensureWallet(env.DB, id, 5)]);
    expect(await getBalance(env.DB, id)).toBe(5);
    expect(await ledgerRows(id)).toHaveLength(1);
  });
});

describe("startGeneration", () => {
  it("debits the cost and records a pending generation", async () => {
    const id = await userWith(5);
    const genId = await startGeneration(env.DB, gen(id, 2));
    expect(await getBalance(env.DB, id)).toBe(3);
    const row = await env.DB.prepare("SELECT status, cost FROM generations WHERE id = ?").bind(genId).first();
    expect(row).toEqual({ status: "pending", cost: 2 });
    expect((await ledgerRows(id)).at(-1)).toEqual({ delta: -2, reason: "generation", note: null, generation_id: genId });
  });

  it("refuses when the balance is short and changes nothing", async () => {
    const id = await userWith(1);
    await expect(startGeneration(env.DB, gen(id, 2))).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await getBalance(env.DB, id)).toBe(1);
    expect(await ledgerRows(id)).toHaveLength(1);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM generations WHERE user_id = ?").bind(id).first("n");
    expect(count).toBe(0);
  });

  it("refuses a user without a wallet", async () => {
    const id = await createUser(uniqueEmail());
    await expect(startGeneration(env.DB, gen(id))).rejects.toBeInstanceOf(InsufficientCreditsError);
  });

  it("never overdraws under concurrent requests", async () => {
    const id = await userWith(1);
    const results = await Promise.allSettled([startGeneration(env.DB, gen(id)), startGeneration(env.DB, gen(id))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(InsufficientCreditsError);
    expect(await getBalance(env.DB, id)).toBe(0);
  });
});

describe("completeGeneration / failGeneration", () => {
  it("marks a generation done without touching the balance", async () => {
    const id = await userWith(3);
    const genId = await startGeneration(env.DB, gen(id));
    await completeGeneration(env.DB, genId, { imageId: "img-1", usage: { total_tokens: 10 } });
    const row = await env.DB.prepare("SELECT status, image_id, usage_json FROM generations WHERE id = ?")
      .bind(genId)
      .first();
    expect(row).toEqual({ status: "done", image_id: "img-1", usage_json: '{"total_tokens":10}' });
    expect(await getBalance(env.DB, id)).toBe(2);
  });

  it("refunds a failed generation exactly once", async () => {
    const id = await userWith(3);
    const genId = await startGeneration(env.DB, gen(id, 2));
    expect(await failGeneration(env.DB, genId, "boom")).toBe(true);
    expect(await failGeneration(env.DB, genId, "boom again")).toBe(false);
    expect(await getBalance(env.DB, id)).toBe(3);
    const refunds = (await ledgerRows(id)).filter((r) => r.reason === "refund");
    expect(refunds).toEqual([{ delta: 2, reason: "refund", note: null, generation_id: genId }]);
  });

  it("does not refund a generation that already succeeded", async () => {
    const id = await userWith(3);
    const genId = await startGeneration(env.DB, gen(id));
    await completeGeneration(env.DB, genId, { imageId: "img", usage: null });
    expect(await failGeneration(env.DB, genId, "late")).toBe(false);
    expect(await getBalance(env.DB, id)).toBe(2);
  });
});

describe("grantCredits", () => {
  it("adds credits with a ledger row", async () => {
    const id = await userWith(5);
    expect(await grantCredits(env.DB, { userId: id, amount: 20, note: "doplnění", createdBy: "admin" })).toBe(25);
    expect((await ledgerRows(id)).at(-1)).toEqual({ delta: 20, reason: "grant", note: "doplnění", generation_id: null });
  });

  it("opens a wallet for a user who has none", async () => {
    const id = await createUser(uniqueEmail());
    expect(await grantCredits(env.DB, { userId: id, amount: 7, note: null, createdBy: "admin" })).toBe(7);
  });

  it("refuses to take the balance below zero", async () => {
    const id = await userWith(2);
    await expect(grantCredits(env.DB, { userId: id, amount: -3, note: null, createdBy: "admin" })).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect(await getBalance(env.DB, id)).toBe(2);
  });
});

describe("refundStaleGenerations", () => {
  it("refunds only generations pending longer than the cutoff", async () => {
    const id = await userWith(5);
    const stale = await startGeneration(env.DB, gen(id));
    const fresh = await startGeneration(env.DB, gen(id));
    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    await env.DB.prepare("UPDATE generations SET created_at = ? WHERE id = ?").bind(old, stale).run();

    expect(await refundStaleGenerations(env.DB, 10 * 60_000)).toBe(1);
    expect(await getBalance(env.DB, id)).toBe(4);
    const statuses = await env.DB.prepare("SELECT id, status FROM generations WHERE user_id = ?").bind(id).all();
    expect(Object.fromEntries(statuses.results.map((r) => [r.id, r.status]))).toEqual({
      [stale]: "failed",
      [fresh]: "pending",
    });
  });
});
