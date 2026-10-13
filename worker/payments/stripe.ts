import { PAYMENT_MSG, PaymentError, type PaidCheckout, type PaymentProvider } from "./provider";

const API = "https://api.stripe.com/v1";

/**
 * Stripe Checkout over plain fetch: the whole integration is one form-encoded
 * POST and one HMAC check, so the SDK would only add weight.
 */
export function createStripePayments(opts: { secretKey: string; fetch: typeof fetch }): PaymentProvider {
  return {
    id: "stripe",
    async createCheckout({ userId, email, pack, successUrl, cancelUrl }) {
      const body = new URLSearchParams({
        mode: "payment",
        locale: "cs",
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: userId,
        customer_email: email,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "czk",
        // CZK is a two-decimal currency for Stripe: the amount is in haléře.
        "line_items[0][price_data][unit_amount]": String(pack.priceCzk * 100),
        "line_items[0][price_data][product_data][name]": `FirstReader: ${pack.credits} kreditů`,
        // What the webhook credits: fixed now, whatever happens to the pack later.
        "metadata[pack_id]": pack.id,
        "metadata[credits]": String(pack.credits),
        ...(pack.label && { "metadata[pack_label]": pack.label }),
      });
      let res: Response;
      try {
        res = await opts.fetch(`${API}/checkout/sessions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
      } catch (e) {
        throw new PaymentError(PAYMENT_MSG.failed, `stripe unreachable: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!res.ok) throw new PaymentError(PAYMENT_MSG.failed, `stripe ${res.status}: ${(await res.text()).slice(0, 500)}`);
      const session = (await res.json()) as { url?: unknown };
      if (typeof session.url !== "string") throw new PaymentError(PAYMENT_MSG.failed, "stripe returned a session without a url");
      return { url: session.url };
    },
  };
}

export class WebhookSignatureError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "WebhookSignatureError";
  }
}

/** Stripe's own default: older events are refused, so a captured one can't be replayed later. */
export const SIGNATURE_TOLERANCE_S = 300;

const enc = new TextEncoder();

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Checks a `Stripe-Signature` header (`t=…,v1=…`) against the raw request body. */
export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowMs = Date.now(),
): Promise<void> {
  if (!header) throw new WebhookSignatureError("missing Stripe-Signature header");
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t") timestamp = value ?? "";
    // Several v1 entries appear while a secret is being rolled.
    if (key === "v1" && value) signatures.push(value);
  }
  if (!/^\d+$/.test(timestamp) || signatures.length === 0) throw new WebhookSignatureError("malformed Stripe-Signature header");
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_S) {
    throw new WebhookSignatureError("timestamp outside the tolerance");
  }
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signed = enc.encode(`${timestamp}.${rawBody}`);
  for (const hex of signatures) {
    const sig = hexToBytes(hex);
    // subtle.verify compares in constant time.
    if (sig && (await crypto.subtle.verify("HMAC", key, sig, signed))) return;
  }
  throw new WebhookSignatureError("no matching signature");
}

type StripeEvent = {
  id?: string;
  type?: string;
  data?: {
    object?: {
      id?: string;
      mode?: string;
      payment_status?: string;
      client_reference_id?: string | null;
      amount_total?: number | null;
      metadata?: Record<string, string> | null;
    };
  };
};

// A delayed method (bank transfer) completes the session unpaid and reports
// the money later through the async event.
const PAID_EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];

/**
 * Verifies a webhook and returns the checkout to credit, or null for anything
 * that is not a paid credit purchase of ours. Throws WebhookSignatureError.
 */
export async function parseStripeEvent(
  rawBody: string,
  signature: string | null,
  secret: string,
  nowMs = Date.now(),
): Promise<PaidCheckout | null> {
  await verifyStripeSignature(rawBody, signature, secret, nowMs);
  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return null;
  }
  const session = event.data?.object;
  if (!event.type || !PAID_EVENTS.includes(event.type) || !session) return null;
  if (session.payment_status !== "paid" || session.mode !== "payment") return null;
  const credits = Number(session.metadata?.credits);
  const packId = session.metadata?.pack_id;
  // Another product on the same Stripe account would land here without our metadata.
  if (!session.id || !session.client_reference_id || !packId || !Number.isInteger(credits) || credits <= 0) return null;
  return {
    sessionId: session.id,
    eventId: event.id ?? null,
    userId: session.client_reference_id,
    packId,
    credits,
    packLabel: session.metadata?.pack_label || null,
    amountCzk: Math.round((session.amount_total ?? 0) / 100),
  };
}
