import type { PaymentProvider } from "./provider";

/**
 * Costs nothing and needs no account: local development and tests. "Checkout"
 * is the success page itself, and the purchase counts as paid right away.
 */
export function createMockPayments(): PaymentProvider {
  return {
    id: "mock",
    async createCheckout(req) {
      return {
        url: req.successUrl,
        paid: {
          sessionId: `mock_${crypto.randomUUID()}`,
          eventId: null,
          userId: req.userId,
          packId: req.pack.id,
          credits: req.pack.credits,
          packLabel: req.pack.label,
          amountCzk: req.pack.priceCzk,
        },
      };
    },
  };
}
