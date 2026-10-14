import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getBalance } from "./credits";
import worker from "./index";
import { getPaymentProvider } from "./payments/provider";
import { createStripePayments, SIGNATURE_TOLERANCE_S, verifyStripeSignature, WebhookSignatureError } from "./payments/stripe";
import { ledgerRows } from "./test/helpers";
import { invite, json, ORIGIN, signIn } from "./test/session";

const WHSEC = "whsec_test_secret";

// One object per setup: the auth instance is cached per env object. Every call
// names its setup, so a developer's own .dev.vars can't change what is tested.
const MOCK: Env = { ...env, PAYMENT_PROVIDER: "mock", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "" };
const OFF: Env = { ...env, PAYMENT_PROVIDER: "", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "" };
const STRIPE: Env = { ...env, PAYMENT_PROVIDER: "stripe", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: WHSEC };

async function call(vars: Env, path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Origin", ORIGIN);
  if (init.cookie) headers.set("Cookie", init.cookie);
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${ORIGIN}/api${path}`, { ...init, headers }), vars, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const put = (body: unknown): RequestInit => ({ ...json(body), method: "PUT" });

async function sign(payload: string, secret = WHSEC, at = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${at}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${at},v1=${hex}`;
}

type SessionOverrides = { id?: string; payment_status?: string; credits?: string; userId?: string | null; type?: string };

function event(o: SessionOverrides = {}) {
  return JSON.stringify({
    id: `evt_${crypto.randomUUID()}`,
    type: o.type ?? "checkout.session.completed",
    data: {
      object: {
        id: o.id ?? `cs_test_${crypto.randomUUID()}`,
        object: "checkout.session",
        mode: "payment",
        payment_status: o.payment_status ?? "paid",
        client_reference_id: o.userId === undefined ? buyerId : o.userId,
        amount_total: 24900,
        currency: "czk",
        metadata: { pack_id: "medium", credits: o.credits ?? "60", pack_label: "Střední" },
      },
    },
  });
}

const webhook = async (payload: string, signature?: string | null, vars = STRIPE) =>
  call(vars, "/stripe/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(signature !== null && { "Stripe-Signature": signature ?? (await sign(payload)) }) },
    body: payload,
  });

const purchases = async (userId: string) => (await ledgerRows(userId)).filter((r) => r.reason === "purchase");

let buyer: string;
let buyerId: string;
let admin: string;

beforeAll(async () => {
  await invite("buyer@example.com");
  await invite("pack-admin@example.com", "admin");
  buyer = await signIn("buyer@example.com");
  admin = await signIn("pack-admin@example.com");
  // Opens the wallet with the welcome credits.
  const me = (await (await call(MOCK, "/me", { cookie: buyer })).json()) as { user: { id: string } };
  buyerId = me.user.id;
});

afterEach(() => vi.restoreAllMocks());

describe("credit packs", () => {
  it("lists the three seeded packs smallest first", async () => {
    const res = await call(MOCK, "/credits/packs", { cookie: buyer });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: "small", credits: 20, priceCzk: 99, label: "Malý" },
      { id: "medium", credits: 60, priceCzk: 249, label: "Střední" },
      { id: "large", credits: 150, priceCzk: 499, label: "Velký" },
    ]);
  });

  it("requires a session", async () => {
    expect((await call(MOCK, "/credits/packs")).status).toBe(401);
    expect((await call(MOCK, "/credits/checkout", json({ packId: "small" }))).status).toBe(401);
  });
});

describe("/me canBuyCredits", () => {
  const canBuy = async (vars: Env) => ((await (await call(vars, "/me", { cookie: buyer })).json()) as { canBuyCredits: boolean }).canBuyCredits;

  it("is true with a provider and false without one", async () => {
    expect(await canBuy(MOCK)).toBe(true);
    expect(await canBuy(STRIPE)).toBe(true);
    expect(await canBuy(OFF)).toBe(false);
  });

  it("needs both Stripe secrets", () => {
    expect(getPaymentProvider({ ...STRIPE, STRIPE_WEBHOOK_SECRET: "" })).toBeNull();
    expect(getPaymentProvider({ ...STRIPE, STRIPE_SECRET_KEY: "" })).toBeNull();
  });

  it("never offers the mock on a real domain", () => {
    expect(getPaymentProvider({ ...MOCK, APP_URL: "https://app.prvnictenari.cz" })).toBeNull();
  });
});

describe("checkout with the mock provider", () => {
  it("returns the success URL and credits at once", async () => {
    const before = await getBalance(env.DB, buyerId);
    const res = await call(MOCK, "/credits/checkout", { ...json({ packId: "small" }), cookie: buyer });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "http://localhost/credits?status=success" });
    expect(await getBalance(env.DB, buyerId)).toBe(before + 20);

    const ledger = (await (await call(MOCK, "/credits/ledger", { cookie: buyer })).json()) as Record<string, unknown>[];
    expect(ledger[0]).toMatchObject({ delta: 20, reason: "purchase", note: "Malý (20 kreditů)" });
  });

  it("refuses an unknown pack, an inactive pack and a missing packId", async () => {
    const before = await getBalance(env.DB, buyerId);
    expect((await call(MOCK, "/credits/checkout", { ...json({ packId: "nope" }), cookie: buyer })).status).toBe(400);
    expect((await call(MOCK, "/credits/checkout", { ...json({}), cookie: buyer })).status).toBe(400);
    await env.DB.prepare("UPDATE credit_packs SET active = 0 WHERE id = 'large'").run();
    try {
      expect((await call(MOCK, "/credits/checkout", { ...json({ packId: "large" }), cookie: buyer })).status).toBe(400);
      const listed = (await (await call(MOCK, "/credits/packs", { cookie: buyer })).json()) as { id: string }[];
      expect(listed.map((p) => p.id)).toEqual(["small", "medium"]);
    } finally {
      await env.DB.prepare("UPDATE credit_packs SET active = 1 WHERE id = 'large'").run();
    }
    expect(await getBalance(env.DB, buyerId)).toBe(before);
  });

  it("answers 503 when payments are off", async () => {
    const res = await call(OFF, "/credits/checkout", { ...json({ packId: "small" }), cookie: buyer });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("payments_off");
  });
});

describe("checkout with Stripe", () => {
  const pack = { id: "medium", credits: 60, priceCzk: 249, label: "Střední" };
  const request = { userId: "user-1", email: "t@example.com", pack, successUrl: "http://localhost/credits?status=success", cancelUrl: "http://localhost/credits?status=cancelled" };

  it("creates a payment-mode CZK session carrying the pack as sold", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    }) as typeof fetch;

    const out = await createStripePayments({ secretKey: "sk_test_x", fetch: fake }).createCheckout(request);
    expect(out).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(new Headers(calls[0].init.headers).get("Authorization")).toBe("Bearer sk_test_x");
    expect(Object.fromEntries(calls[0].init.body as URLSearchParams)).toMatchObject({
      mode: "payment",
      success_url: "http://localhost/credits?status=success",
      cancel_url: "http://localhost/credits?status=cancelled",
      client_reference_id: "user-1",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "czk",
      "line_items[0][price_data][unit_amount]": "24900",
      "metadata[pack_id]": "medium",
      "metadata[credits]": "60",
    });
  });

  it("turns a Stripe failure into a 502 without crediting", async () => {
    const before = await getBalance(env.DB, buyerId);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stripe = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: { message: "Invalid API Key" } }, { status: 401 }));
    const res = await call(STRIPE, "/credits/checkout", { ...json({ packId: "medium" }), cookie: buyer });
    expect(res.status).toBe(502);
    expect(stripe).toHaveBeenCalledOnce();
    expect(await getBalance(env.DB, buyerId)).toBe(before);
  });

  it("returns Stripe's hosted URL and waits for the webhook to credit", async () => {
    const before = await getBalance(env.DB, buyerId);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "cs_test_2", url: "https://checkout.stripe.com/c/pay/cs_test_2" }));
    const res = await call(STRIPE, "/credits/checkout", { ...json({ packId: "medium" }), cookie: buyer });
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_2" });
    expect(await getBalance(env.DB, buyerId)).toBe(before);
  });
});

describe("Stripe webhook", () => {
  it("credits a paid session with a valid signature, without a login", async () => {
    const before = await getBalance(env.DB, buyerId);
    const res = await webhook(event({ id: "cs_test_paid" }));
    expect(res.status).toBe(200);
    expect(await getBalance(env.DB, buyerId)).toBe(before + 60);
    expect((await purchases(buyerId)).at(-1)).toMatchObject({ delta: 60, reason: "purchase", note: "Střední (60 kreditů)" });
    const row = await env.DB.prepare("SELECT provider, pack_id, credits, amount_czk FROM credit_purchases WHERE session_id = 'cs_test_paid'").first();
    expect(row).toEqual({ provider: "stripe", pack_id: "medium", credits: 60, amount_czk: 249 });
  });

  it("rejects a wrong, missing, tampered or stale signature", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = await getBalance(env.DB, buyerId);
    const payload = event();
    const stale = Math.floor(Date.now() / 1000) - SIGNATURE_TOLERANCE_S - 60;

    expect((await webhook(payload, await sign(payload, "whsec_other"))).status).toBe(400);
    expect((await webhook(payload, null)).status).toBe(400);
    expect((await webhook(payload, "garbage")).status).toBe(400);
    expect((await webhook(payload, await sign(payload, WHSEC, stale))).status).toBe(400);
    // Signed for one body, delivered with another.
    expect((await webhook(payload.replace('"60"', '"6000"'), await sign(payload))).status).toBe(400);

    expect(await getBalance(env.DB, buyerId)).toBe(before);
  });

  it("accepts any of several v1 signatures and rejects a timestamp too far ahead", async () => {
    const at = Math.floor(Date.now() / 1000);
    const good = await sign("body", WHSEC, at);
    await expect(verifyStripeSignature("body", `t=${at},v1=${"0".repeat(64)},${good.split(",")[1]}`, WHSEC)).resolves.toBeUndefined();
    const ahead = at + SIGNATURE_TOLERANCE_S + 60;
    await expect(verifyStripeSignature("body", await sign("body", WHSEC, ahead), WHSEC)).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it("credits once when the same event is replayed", async () => {
    const before = await getBalance(env.DB, buyerId);
    const payload = event({ id: "cs_test_replay" });
    const responses = await Promise.all([webhook(payload), webhook(payload)]);
    responses.push(await webhook(payload));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await getBalance(env.DB, buyerId)).toBe(before + 60);
    const { n } = (await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_purchases WHERE session_id = 'cs_test_replay'").first<{ n: number }>())!;
    expect(n).toBe(1);
  });

  it("ignores an unpaid session, then credits once when the async payment succeeds", async () => {
    const before = await getBalance(env.DB, buyerId);
    const unpaid = await webhook(event({ id: "cs_test_async", payment_status: "unpaid" }));
    expect(unpaid.status).toBe(200);
    expect(await getBalance(env.DB, buyerId)).toBe(before);

    await webhook(event({ id: "cs_test_async", type: "checkout.session.async_payment_succeeded" }));
    expect(await getBalance(env.DB, buyerId)).toBe(before + 60);
    // A late duplicate of the first event, now reporting paid, adds nothing.
    await webhook(event({ id: "cs_test_async" }));
    expect(await getBalance(env.DB, buyerId)).toBe(before + 60);
  });

  it("ignores other events, sessions that are not ours and unknown users", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const before = await getBalance(env.DB, buyerId);
    for (const payload of [
      event({ type: "checkout.session.expired" }),
      event({ type: "payment_intent.succeeded" }),
      event({ userId: null }),
      event({ credits: "-5" }),
      event({ credits: "lots" }),
      event({ userId: "no-such-user" }),
      "not json",
    ]) {
      expect((await webhook(payload)).status).toBe(200);
    }
    expect(await getBalance(env.DB, buyerId)).toBe(before);
  });

  it("credits what was sold, not what the pack holds now", async () => {
    const before = await getBalance(env.DB, buyerId);
    await env.DB.prepare("UPDATE credit_packs SET credits = 999 WHERE id = 'medium'").run();
    try {
      await webhook(event({ credits: "60" }));
    } finally {
      await env.DB.prepare("UPDATE credit_packs SET credits = 60 WHERE id = 'medium'").run();
    }
    expect(await getBalance(env.DB, buyerId)).toBe(before + 60);
  });

  it("answers 503 when the webhook secret is not set", async () => {
    const payload = event();
    expect((await webhook(payload, await sign(payload), OFF)).status).toBe(503);
  });
});

describe("admin packs", () => {
  const small = { credits: 20, priceCzk: 99, label: "Malý", active: true };

  it("is forbidden to non-admins", async () => {
    expect((await call(MOCK, "/admin/packs", { cookie: buyer })).status).toBe(403);
    expect((await call(MOCK, "/admin/packs/small", { ...put(small), cookie: buyer })).status).toBe(403);
    expect((await call(MOCK, "/admin/packs")).status).toBe(401);
  });

  it("lists every pack, including inactive ones, and saves an edit", async () => {
    try {
      const res = await call(MOCK, "/admin/packs/small", { ...put({ credits: 25, priceCzk: 119, label: "  ", active: false }), cookie: admin });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: "small", credits: 25, priceCzk: 119, label: null, active: false });

      const all = (await (await call(MOCK, "/admin/packs", { cookie: admin })).json()) as { id: string; active: boolean }[];
      expect(all.map((p) => [p.id, p.active])).toEqual([["small", false], ["medium", true], ["large", true]]);
      const offered = (await (await call(MOCK, "/credits/packs", { cookie: buyer })).json()) as { id: string }[];
      expect(offered.map((p) => p.id)).toEqual(["medium", "large"]);
    } finally {
      await call(MOCK, "/admin/packs/small", { ...put(small), cookie: admin });
    }
    const restored = (await (await call(MOCK, "/admin/packs", { cookie: admin })).json()) as unknown[];
    expect(restored[0]).toEqual({ id: "small", ...small });
  });

  it("validates the edit and knows only the three packs", async () => {
    const bad = [
      { ...small, credits: 0 },
      { ...small, credits: 1.5 },
      { ...small, credits: 10_001 },
      { ...small, priceCzk: 14 },
      { ...small, priceCzk: 99.5 },
      { ...small, priceCzk: "99" },
      { ...small, label: "x".repeat(41) },
      { ...small, active: "yes" },
      { credits: 20, priceCzk: 99, label: "Malý" },
    ];
    for (const body of bad) {
      expect((await call(MOCK, "/admin/packs/small", { ...put(body), cookie: admin })).status, JSON.stringify(body)).toBe(400);
    }
    expect((await call(MOCK, "/admin/packs/huge", { ...put(small), cookie: admin })).status).toBe(404);
    expect((await call(MOCK, "/admin/packs", { ...json(small), cookie: admin })).status).toBe(404);
    const packs = (await (await call(MOCK, "/admin/packs", { cookie: admin })).json()) as unknown[];
    expect(packs).toHaveLength(3);
    expect(packs[0]).toEqual({ id: "small", ...small });
  });
});
