# Buying credits (server side)

Date: 2026-10-13. Follows `2026-10-10-firstread-design.md`, which left payments out of v1 and reserved the ledger reason `purchase` for them.

## Goal

A signed-in teacher buys one of three credit packs through Stripe Checkout (hosted page, CZK). The paid credits land in the wallet exactly once and show in the ledger. An admin can edit the packs. Local development and tests need no Stripe account.

## Decisions

| Topic | Decision |
|---|---|
| Gateway | Stripe Checkout Sessions, `mode=payment`, currency `czk`. |
| Stripe client | Plain `fetch` to the REST API plus WebCrypto HMAC for the webhook. No SDK: the feature is one form-encoded POST and one signature check, so the SDK would add a dependency and bundle weight for nothing. |
| Packs | Exactly three rows in `credit_packs`, seeded by the migration with placeholder prices. Admins edit them; nobody adds or deletes. |
| Price source | `price_data` is built from the pack row when the session is created. No Stripe products or prices to keep in sync. |
| What gets credited | The credits written to the session `metadata` at purchase time, not the pack's value when the webhook arrives. An admin edit never changes a purchase in flight. |
| Idempotency key | The checkout session id (`credit_purchases.session_id`, primary key). One session can produce two events (`completed`, `async_payment_succeeded`), so the event id would be the wrong key. |
| Provider choice | `PAYMENT_PROVIDER` = `stripe` \| `mock`, like `IMAGE_PROVIDER`. |

## Provider interface (`worker/payments/`)

```ts
interface PaymentProvider {
  id: "stripe" | "mock";
  createCheckout(req: CheckoutRequest): Promise<{ url: string; paid?: PaidCheckout }>;
}
```

- `getPaymentProvider(env)` returns the provider, or `null` when payments are off.
  - `stripe` needs both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Without the webhook secret a payment could never be credited, so purchase stays off.
  - `mock` only works when `APP_URL` is a localhost address. A stray `PAYMENT_PROVIDER=mock` in production must not hand out free credits.
  - Anything else: payments off.
- **Stripe** (`stripe.ts`): `createCheckout` posts to `/v1/checkout/sessions` and returns the session `url`. `parseStripeEvent` verifies `Stripe-Signature` (`t=…,v1=…`, HMAC-SHA256 over `"{t}.{rawBody}"`, 5 minute tolerance, constant-time compare via `crypto.subtle.verify`) and returns the paid checkout or `null` for events to ignore.
- **Mock** (`mock.ts`): `createCheckout` returns the success URL as `url` and a `paid` checkout with a fresh `mock_…` session id. The route credits it on the spot through the same fulfilment function the webhook uses.

Session parameters sent to Stripe:

- `mode=payment`, `locale=cs`, `customer_email` (the user's), `client_reference_id` (the user id)
- one line item: `quantity=1`, `price_data[currency]=czk`, `price_data[unit_amount]=priceCzk*100`, `price_data[product_data][name]`
- `metadata[pack_id]`, `metadata[credits]`, `metadata[pack_label]`
- `success_url={APP_URL}/credits?status=success`, `cancel_url={APP_URL}/credits?status=cancelled`
- `payment_method_types` is left unset, so the methods enabled in the Stripe dashboard apply.

The return origin is `APP_URL`, never a request header.

## Data (`migrations/0005_credit_purchase.sql`)

- `credit_packs(id PK, credits >0, price_czk >0, label, active, updated_at, updated_by)`, seeded: `small` 20 / 99 Kč, `medium` 60 / 249 Kč, `large` 150 / 499 Kč.
- `credit_purchases(session_id PK, provider, user_id, pack_id, credits, amount_czk, ledger_id, event_id, created_at)`. One row per credited checkout session; it is both the dedupe key and the payment record.

## Crediting (`creditPurchase` in `worker/credits.ts`)

One D1 batch (= one transaction), in the style of `failGeneration`:

1. `INSERT OR IGNORE INTO credit_purchases …` carrying a freshly generated `ledger_id`.
2. Insert the ledger row (`reason='purchase'`, note naming the pack) **selecting from** `credit_purchases` where `session_id` and `ledger_id` both match. A replay kept the old `ledger_id`, so it selects nothing.
3. Add the delta to the wallet only if that ledger row exists.

Returns whether this call credited. A replayed or concurrent duplicate changes nothing. A payment for a user who no longer exists is logged and acknowledged (there is nobody to credit; refund by hand in Stripe).

Ledger note: `"{label} ({credits} kreditů)"`, or `"{credits} kreditů"` for a pack without a label.

## Webhook (`POST /api/stripe/webhook`, no session)

- 503 when `STRIPE_WEBHOOK_SECRET` is not set; 400 on a missing, malformed, stale or wrong signature.
- Credits on `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and only when `payment_status == "paid"`. A delayed method completes the session as `unpaid` first and is credited by the async event.
- Ignored with 200: other event types, unpaid sessions, sessions that are not ours (no `client_reference_id` or no valid `metadata.credits`).
- 200 `{ received: true }` on success and on replay. A database error surfaces as 500, so Stripe retries.

## API

All under `/api`, signed-in unless noted.

| Route | Result |
|---|---|
| `GET /credits/packs` | `[{ id, credits, priceCzk, label }]`, active only, by credits ascending. |
| `POST /credits/checkout` `{ packId }` | `{ url }`. 400 unknown or inactive pack. 503 `payments_off` when no provider is configured. 502 when Stripe refuses or is down. |
| `GET /me` | adds `canBuyCredits: boolean`. |
| `POST /stripe/webhook` | see above; no session. |
| `GET /admin/packs` | all packs with `active`. Admin only. |
| `PUT /admin/packs/:id` `{ credits, priceCzk, label, active }` | the updated pack. 400 on invalid input, 404 unknown id. Admin only. |

Pack validation: `credits` integer 1–10000; `priceCzk` integer 15–100000 (Stripe's minimum charge in CZK is 15 Kč); `label` trimmed, at most 40 characters, empty becomes `null`; `active` boolean.

## Configuration

| Name | Where | Value |
|---|---|---|
| `PAYMENT_PROVIDER` | `wrangler.jsonc` vars (`stripe`), `.dev.vars` (`mock`) | provider choice |
| `STRIPE_SECRET_KEY` | secret | `sk_live_…` / `sk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | secret | `whsec_…` of the webhook endpoint |

Production ships with `PAYMENT_PROVIDER=stripe` and no secrets, so purchase is hidden until both secrets are set.

## Tests

Worker suite, never touching Stripe: packs listing, mock checkout crediting, payments-off, Stripe session request (injected `fetch`), webhook signature accept and reject (payload signed in the test), stale timestamp, replay, `async_payment_succeeded`, unpaid ignored, metadata credits winning over an edited pack, admin edit with validation, non-admin 403.

## Out of scope

Refunds and disputes (handled by hand in Stripe plus an admin negative grant), invoices and VAT, subscriptions, promo codes, receipts by e-mail beyond Stripe's own.
