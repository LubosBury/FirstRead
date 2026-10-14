import { createMockPayments } from "./mock";
import { createStripePayments } from "./stripe";

export type Pack = { id: string; credits: number; priceCzk: number; label: string | null };

export type CheckoutRequest = {
  userId: string;
  email: string;
  pack: Pack;
  successUrl: string;
  cancelUrl: string;
};

/** A checkout that has been paid for and should be credited once. */
export type PaidCheckout = {
  sessionId: string;
  eventId: string | null;
  userId: string;
  packId: string;
  /** As sold, not the pack's current value. */
  credits: number;
  packLabel: string | null;
  amountCzk: number;
};

export interface PaymentProvider {
  id: "stripe" | "mock";
  /** `paid` is set when the provider settles on the spot (the mock); otherwise a webhook follows. */
  createCheckout(req: CheckoutRequest): Promise<{ url: string; paid?: PaidCheckout }>;
}

/** A failure with a message fit to show the teacher; `detail` is for logs. */
export class PaymentError extends Error {
  constructor(
    readonly userMessage: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "PaymentError";
  }
}

export const PAYMENT_MSG = {
  failed: "Platbu se nepodařilo zahájit. Zkuste to prosím za chvíli.",
};

const isLocalUrl = (url: string) => {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

type PaymentEnv = Pick<Env, "PAYMENT_PROVIDER" | "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SECRET" | "APP_URL">;

/** The configured provider, or null when buying credits is switched off. */
export function getPaymentProvider(env: PaymentEnv, opts: { fetch?: typeof fetch } = {}): PaymentProvider | null {
  switch (env.PAYMENT_PROVIDER) {
    case "mock":
      // The mock credits without payment, so it must never answer on a real domain.
      return isLocalUrl(env.APP_URL) ? createMockPayments() : null;
    case "stripe":
      // Without the webhook secret a payment could never be credited.
      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) return null;
      return createStripePayments({
        secretKey: env.STRIPE_SECRET_KEY,
        // The wrapper matters: Workers throw "Illegal invocation" when the
        // global fetch runs with any other `this`.
        fetch: opts.fetch ?? ((input, init) => fetch(input, init)),
      });
    default:
      return null;
  }
}

/** How a purchase reads in the ledger. */
export const packNote = (p: { credits: number; packLabel: string | null }) =>
  p.packLabel ? `${p.packLabel} (${p.credits} kreditů)` : `${p.credits} kreditů`;
