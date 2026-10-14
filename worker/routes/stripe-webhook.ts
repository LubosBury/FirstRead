import { Hono } from "hono";
import type { AppEnv } from "../app";
import { creditPurchase } from "../credits";
import { parseStripeEvent, WebhookSignatureError } from "../payments/stripe";

export const stripeWebhook = new Hono<AppEnv>();

stripeWebhook.post("/stripe/webhook", async (c) => {
  const secret = c.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: "payments_off", message: "Stripe webhook is not configured." }, 503);
  // The signature covers the exact bytes, so the body is read as text, never re-serialized.
  const raw = await c.req.text();
  let paid;
  try {
    paid = await parseStripeEvent(raw, c.req.header("Stripe-Signature") ?? null, secret);
  } catch (e) {
    if (!(e instanceof WebhookSignatureError)) throw e;
    console.warn("stripe webhook refused:", e.message);
    return c.json({ error: "bad_signature", message: "Invalid signature." }, 400);
  }
  // Anything but a paid credit purchase is acknowledged, or Stripe would keep retrying it.
  if (!paid) return c.json({ received: true });

  const known = await c.env.DB.prepare(`SELECT 1 FROM "user" WHERE id = ?`).bind(paid.userId).first();
  if (!known) {
    // Nobody to credit; retries would not change that. Refund by hand in Stripe.
    console.error(`stripe session ${paid.sessionId} paid for unknown user ${paid.userId}`);
    return c.json({ received: true });
  }
  // A database error escapes as a 500 and Stripe delivers the event again.
  const credited = await creditPurchase(c.env.DB, "stripe", paid);
  if (credited) console.log(`credited ${paid.credits} credits to ${paid.userId} for stripe session ${paid.sessionId}`);
  return c.json({ received: true });
});
