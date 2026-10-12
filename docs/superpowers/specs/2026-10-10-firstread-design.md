# FirstRead - worksheet template generator (v1)

Status: approved design, 2026-10-10.

## Context

The primary user is a first-grade teacher who hand-builds reading aids. The first one to automate is the monthly reading challenge sheet:

- A4 page.
- Editable header at the top, e.g. "Čtenářská výzva na říjen".
- A main illustration in the bottom quarter, placed left, center or right (e.g. a teddy bear in leaves with mushrooms).
- The rest of the page is filled with small black-and-white motifs (e.g. mushrooms), one per day of the month (31 for October), scattered randomly. Kids color one for each day they read.

Goals:

- Generate that sheet in minutes.
- AI-generate the main image (from a prompt, or from an uploaded image redrawn as line art) and the small repeated motif.
- Charge AI usage against a credit wallet, so the system is pay-as-you-go ready for external users later.
- Make templates pluggable, because more worksheet types will follow.
- Deploy to a custom domain: `firstread.bozkovo.org`, or `product-gnome.com` (owned, currently a dead project). The final pick happens at deploy.

Repo `LubosBury/FirstRead` is empty. Develop on branch `claude/clever-faraday-1sikg8`.

### Decisions made with the user

| Topic | Decision |
|---|---|
| Credits v1 | Wallet + ledger, admin grants credits by hand. No payment gateway yet; Stripe becomes one more ledger `reason` later. |
| Uploaded image | Both: use as-is (free), or use as a reference that AI redraws as a coloring page (costs credits). |
| Platform | Cloudflare: Workers (API + static SPA) + D1 (SQLite) + R2 (images). Fully separate from bozkovo's Supabase. No changes to the bozkovo repo. |
| Image AI | Pluggable provider: OpenAI (GPT Image) and Google Gemini (Nano Banana), chosen by env. The spike decides the default. |
| Starter credits | Every new account gets `WELCOME_CREDITS` (default 5) once, as a `grant` ledger row. |
| Domain | Configurable. `firstread.bozkovo.org` or `product-gnome.com`. |

### Decisions I made (defaults, override if wrong)

- **Login:** magic link only (no passwords), with an email allowlist (`ALLOWED_EMAILS`) and no open signup in v1.
  - Avoids password hashing, which risks the Workers free 10 ms CPU limit.
  - An open signup endpoint would let strangers burn the Resend quota.
- **New users get 5 welcome credits.** The admin (`ADMIN_EMAILS`) grants more.
  - Opening signup to the public is a follow-up, and it must ship with Cloudflare Turnstile plus a daily global cap on welcome credits.
  - Free credits on an open signup is the classic abuse path. Exposure per throwaway account is about 5 × $0.034-0.053 = $0.17-0.27 (third-party price estimates).
- **Credit unit:** 1 credit = 1 image generation; the cost per action is configurable.
  - Every generation stores OpenAI's returned token `usage`, so real credit prices for external users get set from measured cost, not guesses. (Judgment call: users can't reason about tokens.)
- **Output:** a print-ready A4 PDF download (raster at 300 DPI, so Czech diacritics need no PDF font embedding). The file name is ASCII-only (`rijen-2026-ctenarska-vyzva.pdf`), because some browser locales drop non-ASCII download names.
- **UI language:** Czech.

## Product risks to keep in view

1. **The riskiest assumption is image quality, not code.** Can the model reliably produce clean, thick-outline, no-shading line art that still reads at about 2-3 cm when printed?
   - Cheapest test, before or in parallel with the build: run the style prompt below in both ChatGPT and Gemini for the same 5 themes, also try one photo-to-coloring-page conversion, then print and show the teacher.
   - Zero code. Pick the provider that wins on the printout. If both fail, the generator is pointless.
2. **Cost per sheet.** These are third-party estimates, so verify on the official pricing pages. One sheet = 1 main + 1 icon = 2 images.

   | Provider / model (1K image) | Per image | Per sheet |
   |---|---|---|
   | OpenAI GPT Image 2, low | $0.006 | 2 × 0.006 = $0.012 |
   | OpenAI GPT Image 2, medium | $0.053 | 2 × 0.053 = $0.106 |
   | Gemini Nano Banana 2.1 (released 2026-10-06) | $0.0336 | 2 × 0.0336 = $0.067 |

   - Assuming about 3 attempts per image (my assumption), multiply by 3.
   - Line art may look fine at OpenAI `low`; the spike decides.
3. **Workers free plan CPU: 10 ms per request.** Waiting on `fetch` does not count, but JSON-parsing and base64-decoding a large image response does.
   - OpenAI: request `output_format: "webp"` for a small payload.
   - Gemini returns inline base64 and I found no output-format option, so the risk is higher there.
   - Measure both. Fallback: Workers Paid plan.
4. **Transparent background:** OpenAI supports `background: "transparent"`; I couldn't confirm the same for Gemini.
   - `lineArt.ts` (white → transparent + black threshold, at render time) is therefore required, not optional. It also makes output from both providers look the same.
5. **Custom domain:** a Workers custom domain needs the domain's zone on Cloudflare DNS. Current DNS hosting of both candidate domains is unknown (lookups were blocked from this sandbox).
   - `product-gnome.com` (dead project, probably no live email records) is the lower-risk zone to move.
   - Moving `bozkovo.org` means first copying every record: Vercel A/CNAME, MX, and Resend SPF/DKIM TXT.
   - This is a user task with a checklist (step 9).
   - Brand note (judgment): neither domain says "reading/teachers" to an external Czech teacher. That's fine for v1; revisit before marketing to externals.
6. **Vercel Hobby forbids commercial use.** Not relevant any more, since FirstRead runs on Cloudflare.

## Architecture

The app is one Cloudflare Worker project (via `@cloudflare/vite-plugin`):

- The React SPA is served as static assets.
- The `/api/*` routes are handled by Hono.

```
Browser (React SPA)
  ├─ template editor → layout() pure fn → SVG preview
  ├─ export: same layout → Canvas 2480x3508 (A4@300dpi) → jsPDF
  └─ /api/* (cookie session)
Worker (Hono)
  ├─ auth: Better Auth + magic-link plugin, native D1 support, emails via Resend
  ├─ credits: atomic debit/refund/grant (D1 batch = transaction)
  ├─ images: ImageProvider (OpenAI | Gemini) generate/edit → R2 (private), served via ownership-checked GET
  ├─ sheets: save/load template params (JSON)
  └─ cron trigger: refund generations stuck in "pending" > 10 min
D1: auth tables, wallets, credit_ledger, generations, images, sheets
R2: users/{userId}/images/{imageId}.webp|png
```

**Stack:**

- Vite + React 18 + TS + Tailwind + shadcn/ui (mirrors bozkovo's frontend conventions).
- Hono, plain SQL on D1 (migrations applied with `wrangler d1 migrations`).
- Implementation note: Drizzle was dropped. Better Auth 1.7 takes the D1 binding directly, and the credit guards read more clearly as plain SQL.
- Better Auth.
- zod, date-fns (`cs` locale), jsPDF.
- Vitest + `@cloudflare/vitest-pool-workers`.

### Repo layout

```
wrangler.jsonc          D1/R2 bindings, cron, vars (ALLOWED_EMAILS, ADMIN_EMAILS, WELCOME_CREDITS, IMAGE_PROVIDER, OPENAI_IMAGE_MODEL, GEMINI_IMAGE_MODEL, IMAGE_QUALITY, CREDIT_COST_*)
migrations/             D1 SQL
worker/
  index.ts              Hono app, route mounting, scheduled() handler
  auth.ts               Better Auth (D1 binding), magic link via Resend, allowlist
  credits.ts            ensureWallet (+ welcome grant) / debit / refund / grant / balance
  imaging/provider.ts   ImageProvider interface: generate(prompt) / edit(prompt, refBytes) → { bytes, mime, usage, model }
  imaging/openai.ts     GPT Image via fetch (no SDK)
  imaging/gemini.ts     Gemini image via REST generateContent (no SDK)
  imaging/mock.ts       fixture image for dev/tests (IMAGE_PROVIDER=mock)
  imaging/prompts.ts    provider-agnostic style wrappers (main / icon)
  routes/{images,sheets,credits,admin}.ts
src/
  templates/types.ts    TemplateDefinition interface
  templates/registry.ts
  templates/reading-challenge/{definition.ts, layout.ts, Editor.tsx}
  lib/{prng.ts, placement.ts, months.ts, renderSvg.tsx, exportPdf.ts, lineArt.ts}
  pages/{Login, Home, SheetEditor, Library, Admin}.tsx
  components/{CreditBadge, ImageSlot, GenerateDialog}.tsx + shadcn ui
docs/superpowers/specs/2026-10-10-firstread-design.md
```

### Template contract (the extensibility point)

```ts
interface TemplateDefinition<P> {
  id: string; name: string; description: string;
  paramsSchema: ZodType<P>; defaultParams(): P;
  imageSlots: { key: string; label: string; stylePreset: 'main' | 'icon'; multiple?: boolean }[];
  layout(params: P, assets: AssetSizes): Layout; // pure, mm units, A4 210x297
  Editor: React.FC<{ params: P; onChange(p: P): void }>;
}
type Layout = { page: { w: 210; h: 297 }; elements: (TextEl | ImageEl)[] };
```

- Templates are code modules, not a DB-driven builder (YAGNI).
- The preview, PDF export, saving and image slots are generic, so template #2 only needs the definition files.

### Template 1: "Čtenářská výzva" (`reading-challenge`)

**Params:**

- `title`: defaults to `Čtenářská výzva na {month}`. Czech month names take the same form after "na", so `na říjen` works for every month.
- `year`, `month`.
- `count`: defaults to `getDaysInMonth`, can be overridden.
- `font`: one of four faces self-hosted from `@fontsource`: Andika 700, Nunito 900, Baloo 2 800, Grandstander 800 (`src/lib/fonts.ts`). Every face must draw the whole Czech alphabet, and `src/lib/fonts.test.ts` fails if one lacks a letter.
- Retired font ids in saved sheets are mapped to a current face on load (`fredoka` opens in Nunito), so old sheets still open.
- `uppercase`: on/off.
- `mainImage`: `{ imageId, position: left|center|right, scale }`.
- `icons`: `imageId[]`. One or more variants, mixed randomly.
- `seed`.
- `jitter`: random rotation ±15° and mirroring.

**Layout:**

- Header band at the top.
- Main image box in the bottom 25%, roughly 45% of the page width, aligned per `position`.
- Icons fill the remaining area inside the print margins.

**`placement.ts` (pure, seeded mulberry32):**

- Rejection sampling of N non-overlapping circles outside the exclusion rects.
- Starts at size `s ≈ sqrt(freeArea / N × packing)` and shrinks 5% until all N fit.
- Deterministic per seed. The "Zamíchat" button just changes the seed.

## Image generation flow (`POST /api/images/generate`)

**Input:** `{ slot: 'main'|'icon', prompt, referenceImageId? }`

1. Auth. Then read the cost from config: icon and main default to 1 credit each.
2. In one D1 batch:
   - `UPDATE wallets SET balance = balance - ?cost WHERE user_id = ? AND balance >= ?cost`. No row changed → 402 "Nedostatek kreditů".
   - Insert ledger row `-cost` (`reason='generation'`).
   - Insert the `generations` row with status `pending`.

   Concurrent requests cannot overdraw, because the guard sits in the UPDATE.
3. Call the configured `ImageProvider`: `edit` when a reference image exists (bytes read from R2), otherwise `generate`.
   - OpenAI: `images/edits` or `images/generations` with `output_format: "webp"`, 1024x1024, quality from env. `background: "transparent"` is not sent: it is a preview option on gpt-image-2, and `lineArt.ts` already makes white paper transparent for every provider.
   - Gemini: `generateContent` with the reference image as inline data for edits, image response modality, 1K.
   - Models come from env (`OPENAI_IMAGE_MODEL` / `GEMINI_IMAGE_MODEL`), set at implementation time to the current models per the official docs. Third-party sources say gpt-image-1 deprecates 2026-10-23 and Nano Banana 2 is already deprecated.
   - Style wrapper (English, shared by both providers), main: `Black-and-white coloring page for 6-year-olds: {prompt}. Thick clean black outlines, white fill, no shading, no gray, no text, no border.` The icon variant adds `single simple object, large closed areas, recognizable when printed 2 cm wide`.
4. Success:
   - Put the image to R2 and insert an `images` row (`origin='generated'`).
   - Mark the generation `done`, storing `provider`, `model` and the `usage` JSON.
   - Real cost per provider then comes from SQL, not guesses.
5. Failure: the same batch-refund pattern (ledger `+cost`, `reason='refund'`), mark `failed`, and return a friendly error.
6. The cron trigger (every 15 min) refunds `pending` older than 10 min. This covers clients that disconnect mid-generation.

**Uploads:** `POST /api/images/upload`, PNG/JPEG/WebP ≤ 10 MB, stored to R2 with `origin='upload'`, free.

- On the client, `lineArt.ts` can optionally threshold an image to pure black and make white transparent. It runs at render time and never touches the stored original.

**Library:** every generated or uploaded image stays in the user's library. A paid image is never lost and can be reused next year.

**Admin:** `/admin` (only for `ADMIN_EMAILS`) shows users, balances and a grant form, posting to `POST /api/admin/grant {email, amount, note}`.

## D1 schema (besides Better Auth tables)

- `wallets(user_id PK, balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0))`
- `credit_ledger(id, user_id, delta, reason CHECK IN ('grant','generation','refund','purchase'), generation_id, note, created_at)`
- `generations(id, user_id, slot, prompt, reference_image_id, provider, model, quality, status, cost, usage_json, error, created_at, completed_at)`

- `images(id, user_id, r2_key, origin, generation_id, mime, width, height, label, created_at)`
- `sheets(id, user_id, template_id, title, params_json, created_at, updated_at)`

**Welcome credits:** `ensureWallet` runs on first authenticated request (or Better Auth's `user.create.after` hook). It is a single D1 batch: `INSERT OR IGNORE INTO wallets (user_id, balance) VALUES (?, ?WELCOME)` plus the ledger row `+WELCOME, reason='grant', note='welcome'`. The ledger row is guarded by the same "wallet was just inserted" check, so repeats are idempotent and nobody gets the bonus twice.

## Implementation order (each step leaves something runnable)

0. **Spike (user, no code):** test the style prompt in ChatGPT and in Gemini on the same 5 themes plus one photo conversion, print, judge, pick the default provider. In parallel, write the spec doc `docs/superpowers/specs/2026-10-10-firstread-design.md` (from this plan) and commit.
1. **Scaffold:**
   - Vite + React + TS + Tailwind + shadcn, `@cloudflare/vite-plugin`, Hono on `/api/health`.
   - `wrangler.jsonc` with D1 + R2 bindings, Vitest configured.
2. **Pure core, test-first (TDD):** `prng`, `placement` (exact count, no overlaps, no zone intersections, inside margins, deterministic per seed), `months`, and the `reading-challenge` `layout`.
3. **Template UI with local images only (no auth, no AI):**
   - Editor + SVG preview + PDF export, with upload kept in-memory.
   - This alone is already useful to her with her own pictures; dogfood here.
4. **Data + auth:**
   - SQL migrations, Better Auth magic link (dev: link logged to console; prod: Resend), allowlist.
   - Session-guarded routes; sheets save/load; R2 uploads + library.
5. **Credits:** `credits.ts` (including the welcome grant) + routes + `CreditBadge`, plus Worker integration tests (welcome once, debit, 402, parallel overdraw attempt, refund, grant).
6. **AI generation:**
   - `imaging/` with mock, OpenAI and Gemini providers, the generate route, `GenerateDialog` showing the cost on the button, and the reference-image redraw.
   - Cron refund.
7. **Admin page.**
8. **Hardening:** error states in Czech, upload limits, image ownership checks on every R2 read.
9. **Deploy:**
   - Cloudflare account, `wrangler d1 create`, `wrangler r2 bucket create`.
   - Secrets: `OPENAI_API_KEY` and/or `GEMINI_API_KEY`, `RESEND_API_KEY`, `BETTER_AUTH_SECRET`.
   - Workers Builds git integration on `main`.
   - DNS: pick the domain (`product-gnome.com` or `firstread.bozkovo.org`), and put its zone on Cloudflare if it isn't, copying all records first.
   - Add the custom domain, plus a verified Resend sending domain for the magic-link emails.
   - Retire the dead product-gnome project's hosting if that domain wins.
   - Top up the teacher's account beyond the 5 welcome credits.

**Out of scope for v1:** payments (Stripe), open signup, drag-to-reposition icons, day numbers inside icons, more templates, a bozkovo lab card. Each is a small follow-up on this design.

## Verification

- **Unit and integration tests:** `npm test`.
  - Placement and layout tests cover counts of 28, 29, 30 and 31, all three positions, and the seed being deterministic.
  - Worker tests run on `@cloudflare/vitest-pool-workers` with provider `fetch` mocked:
    - A new user gets exactly 5 credits once, including on a repeated `ensureWallet`.
    - A successful generation debits 1 credit and stores the image in R2.
    - Both the OpenAI and Gemini response shapes parse into the same `{bytes, mime, usage}`.
    - An OpenAI error refunds the credit.
    - A balance of 0 returns 402.
    - Two parallel requests with a balance of 1 give exactly one success and one 402.
    - A stale pending generation gets refunded by the cron.
    - A user cannot GET another user's image.
- **Lint and types:** `npm run lint`, `tsc --noEmit`.
- **Local end-to-end:** `npm run dev` (local D1/R2 through Miniflare, `IMAGE_PROVIDER=mock`), then a Playwright smoke run on the pre-installed Chromium:
  - Log in via the console magic link.
  - Create October 2026 → the SVG has 31 icon nodes and the header reads "Čtenářská výzva na říjen".
  - Switch position left/center/right.
  - Export → the PDF has 1 page at A4 (595x842 pt).
- **CPU check:** for each provider with a real key, check the CPU time per request stays under 10 ms on the generate route (Cloudflare dashboard / `wrangler tail`). Gemini is the likelier one to exceed it.
- **Production acceptance:** the teacher logs in, generates one main image plus one icon, exports and prints a real sheet. Lines are crisp, icons are colorable, and the credits shown match the ledger.
