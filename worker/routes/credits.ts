import { Hono } from "hono";
import { z } from "zod";
import { badRequest, type AppEnv } from "../app";
import { creditPurchase, ensureWallet } from "../credits";
import { intVar } from "../env";
import { getPack, listPacks } from "../packs";
import { getPaymentProvider, PaymentError } from "../payments/provider";

export const credits = new Hono<AppEnv>();

credits.get("/credits/packs", async (c) => {
  const packs = await listPacks(c.env.DB);
  return c.json(packs.filter((p) => p.active).map(({ id, credits, priceCzk, label }) => ({ id, credits, priceCzk, label })));
});

const checkoutBody = z.object({ packId: z.string().min(1).max(64) });

credits.post("/credits/checkout", async (c) => {
  const parsed = checkoutBody.safeParse(await c.req.json().catch(() => null));
  const pack = parsed.success ? await getPack(c.env.DB, parsed.data.packId) : null;
  if (!pack?.active) return badRequest(c, "Tento balíček kreditů není v nabídce.");
  const provider = getPaymentProvider(c.env);
  if (!provider) return c.json({ error: "payments_off", message: "Nákup kreditů teď není dostupný." }, 503);

  const user = c.get("user");
  // Someone who buys before ever opening the app still gets the welcome credits.
  await ensureWallet(c.env.DB, user.id, intVar(c.env.WELCOME_CREDITS, 5));
  // The return address is ours, never one the request names.
  const back = `${c.env.APP_URL.replace(/\/$/, "")}/credits`;
  try {
    const checkout = await provider.createCheckout({
      userId: user.id,
      email: user.email,
      pack,
      successUrl: `${back}?status=success`,
      cancelUrl: `${back}?status=cancelled`,
    });
    // Stripe reports payment through the webhook; the mock is paid on the spot.
    if (checkout.paid) await creditPurchase(c.env.DB, provider.id, checkout.paid);
    return c.json({ url: checkout.url });
  } catch (e) {
    if (!(e instanceof PaymentError)) throw e;
    console.error("checkout failed", e.detail);
    return c.json({ error: "payment_failed", message: e.userMessage }, 502);
  }
});
