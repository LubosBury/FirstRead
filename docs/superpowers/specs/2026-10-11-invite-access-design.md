# Invite-based access via the Better Auth admin plugin

Status: approved design, 2026-10-11.

## Problem

Access is controlled by two Worker secrets:

- `ALLOWED_EMAILS` decides who may sign in.
- `ADMIN_EMAILS` decides who is an admin.

Adding a teacher means editing a secret in the Cloudflare dashboard. The goal is to manage access from `/admin` instead, and to remove both env lists.

Magic-link sign-in stays as it is. No passwords, no social login, no public signup.

## Decisions made with the user

| Topic | Decision |
|---|---|
| Mechanism | Better Auth `admin` plugin: users are pre-created by an admin, magic link has `disableSignUp`, revoking access is a ban, the admin role lives in the database. |
| Inviting | Adding an email in `/admin` sends an invitation email. |
| `ADMIN_EMAILS` | Removed entirely. The first admin is set with a one-off script that runs SQL through `wrangler d1 execute`. |

## Verified Better Auth 1.7.7 behavior this design relies on

- `auth.api.createUser` accepts no password. Called with an admin's request headers, the plugin checks that the caller has the `admin` role. Called without headers (server-only), it skips the check.
- `banUser` sets `banned` and deletes all of the user's sessions. A banned user cannot create a new session (`session.create.before` hook). An admin cannot ban themselves.
- A user created by `createUser` has `emailVerified = false`. The first magic-link verification sets it to `true`. This is the "pending" vs. "active" signal.
- `magicLink({ disableSignUp: true })` is only checked when the link is opened, not when it is sent. A pre-send check is still needed so strangers get no email.
- An invalid, expired or already-used link redirects to `callbackURL?error=INVALID_TOKEN`. Today `Login.tsx` ignores it.
- The top-level `hooks.before` option and `createAuthMiddleware` / `APIError` from `better-auth/api` are available.

## Design

### 1. Auth layer

`worker/auth.ts`:

- Add the `admin()` plugin with default settings (`defaultRole: "user"`, `adminRoles: ["admin"]`).
- Set `disableSignUp: true` on `magicLink`, so a magic link never creates an account.
- Move the "may this address get a link?" gate out of the Hono route in `worker/index.ts` and into `hooks.before`:
  - Applies to the path `/sign-in/magic-link`.
  - Allowed: a `user` row with that email (case-insensitive) and `banned` not true.
  - Otherwise: throw `APIError("FORBIDDEN", { code: "NOT_INVITED", message: "Tento e-mail zatím nemá přístup. Požádejte o pozvánku." })`.
  - Because it runs before the endpoint, no `verification` row is written for strangers.
- Add `databaseHooks.user.create.after`, which calls `ensureWallet(db, user.id, WELCOME_CREDITS)`.
  - This fixes a bug the plugin would otherwise expose: `grantCredits` opens a wallet with 0 credits. If an admin granted credits to an invited user before their first sign-in, `ensureWallet` in `/me` would then be a no-op and the welcome credits would be lost.
  - The `ensureWallet` call in `/me` stays as an idempotent backstop for accounts created before this change.
- Remove the `sendMagicLink` allowlist backstop. `disableSignUp` now guarantees a link cannot create an account.

`worker/index.ts`: delete the custom `POST /auth/sign-in/magic-link` route. All `/auth/*` requests go straight to the Better Auth handler.

`worker/app.ts`: `SessionUser` gains `role: string | null`. `requireUser` copies it from the session.

`worker/env.ts`: delete `emailSet`, `isAllowedEmail` and `isAdminEmail`. Admin checks become `user.role === "admin"` (an `isAdmin(user)` helper in `worker/app.ts`) in `/me`, the admin middleware and the engine override in `worker/routes/generations.ts`.

### 2. Database migration

`migrations/0003_admin_plugin.sql`:

- Add the admin plugin columns as Better Auth's `getMigrations` emits them for SQLite: `user.role`, `user.banned`, `user.banReason`, `user.banExpires` and `session.impersonatedBy`.
- Backfill existing users with `role = 'user'` and `banned = 0`.

All columns are nullable, so the currently deployed code keeps working against the migrated database.

### 3. Admin API

All routes sit behind the existing admin middleware, which now checks the role.

`POST /api/admin/invites { email }`. The email is trimmed, lowercased and validated with zod.

| Existing user | Result |
|---|---|
| None | `auth.api.createUser({ headers, body: { email, name: "", role: "user" } })`, then send the invitation. `201`. |
| Pending (`emailVerified = false`, not banned) | Send the invitation again. `200`. |
| Active | `409` "Tento e-mail už přístup má." |
| Banned | `409` "Přístup byl odebrán. Vraťte ho v seznamu uživatelů." |

`POST /api/admin/users/:id/ban` calls `auth.api.banUser({ headers, body: { userId } })`. `POST /api/admin/users/:id/unban` calls `auth.api.unbanUser`. Plugin errors map to Czech messages:

- Banning yourself returns `400`.
- An unknown user returns `404`.

`GET /api/admin/users` keeps its own SQL query, which adds balance and generated count. It gains `role`, `banned` and `emailVerified`. The client derives the status from these:

| Status | Condition |
|---|---|
| Bez přístupu | `banned` is true |
| Čeká na přihlášení | `emailVerified` is false |
| Aktivní | otherwise |

Plugin endpoints under `/api/auth/admin/*` stay reachable, protected by the role. The UI does not use them. Wrapping them in app routes keeps the `{ error, message }` error shape and Czech messages, and the invite route also has to send email.

### 4. Invitation email

`worker/mail.ts` gets `inviteMail(to, invitedBy, appUrl)`:

- Subject: "Pozvánka do FirstRead".
- Short text: who invited them, what the app is, and that sign-in works through an emailed link with no password.
- One button, "Otevřít FirstRead", linking to `${APP_URL}/?email=<encoded address>`.
- It deliberately does not contain a magic link, because those expire after 15 minutes.

Locally, without `RESEND_API_KEY`, it is printed to the console like the magic link.

### 5. Admin UI

`src/pages/Admin.tsx`:

- New "Pozvat" card: email input and a submit button. Success and error messages are shown inline.
- The users table gets a "Stav" column and a row action:
  - Čeká na přihlášení: "Poslat znovu" and "Odebrat přístup" (to withdraw a mistaken invite).
  - Aktivní: "Odebrat přístup", with a `confirm()` prompt.
  - Bez přístupu: "Vrátit přístup".
  - The admin's own row has no ban action.
- Remove the footnote about `ALLOWED_EMAILS`.
- Granting credits to a pending user now works, because the user row exists. Remove the "ještě se nepřihlásil" special case on 404.

`src/lib/api.ts`: add `adminInvite`, `adminBan` and `adminUnban`, and extend `AdminUser` with `role`, `banned` and `emailVerified`.

### 6. Login page

`src/pages/Login.tsx`:

- Prefill the email field from `?email=`.
- Show "Odkaz už neplatí nebo byl použitý. Pošlete si nový." when `?error=INVALID_TOKEN` is present. Any other `error` value shows "Přihlášení se nepovedlo. Zkuste to prosím znovu."
- After reading the parameters, clear them from the URL with react-router's `setSearchParams({}, { replace: true })`, so a reload does not show the error again.

### 7. First admin and recovery

`scripts/make-admin.ts`, run as `npm run make-admin -- <email> [--remote]` (default `--local`; Node 22.18+ runs TypeScript directly):

- Runs `wrangler d1 execute firstread` with one statement. It inserts the user with `role = 'admin'` and `emailVerified = 0`, or, if the email exists, sets `role = 'admin'` and `banned = 0`.
- The SQL comes from `makeAdminSql(email)` in `worker/make-admin.ts`. It writes what Better Auth writes (lowercased email, ISO timestamps, 0/1 booleans). A worker test runs it against D1 and signs the new admin in, so a broken script can't lock the owner out of production.
- The same command is the recovery path if the last admin locks themselves out.

### 8. Removing the env lists

Remove `ALLOWED_EMAILS` and `ADMIN_EMAILS` from:

- `worker/env.ts`
- the `Env` type (`worker/worker-configuration.d.ts`)
- `.dev.vars.example`
- `vitest.config.ts`
- the `wrangler.jsonc` comment
- `README.md`

The README replaces them with the `make-admin` step and documents the invite flow.

## Production rollout

1. `npm run db:migrate:remote`
2. `npm run make-admin -- <owner email> --remote`
3. Deploy.
4. In `/admin`, invite everyone from the old `ALLOWED_EMAILS` who never signed in. Users who already signed in keep access through the migration backfill.
5. Delete the `ALLOWED_EMAILS` and `ADMIN_EMAILS` secrets.

Between steps 1 and 3 the old code runs against the new schema. This is safe because the new columns are nullable and unused by it. Step 2 runs before step 3, so the owner is an admin the moment the new code goes live.

## Testing

Worker integration tests in the style of `worker/api.test.ts`. `worker/test/session.ts` gets an `invite(email, role?)` helper that calls `getAuth(env).api.createUser` server-side; `signIn` assumes the user exists.

- Stranger: the magic-link request returns `403` with code `NOT_INVITED`, and no mail is logged.
- Invited user: shows as pending in `/admin/users`, signs in, then shows as active.
- Ban: the existing session gets `401` on `/me`, and a new link request gets `403`. After unban, sign-in works again.
- A non-admin gets `403` on invite, ban and unban. An admin banning themselves gets `400`.
- Invite edge cases: the second invite of a pending user resends (`200`, mail logged). Inviting an active user returns `409`. Inviting a banned user returns `409`.
- Credits granted before the first sign-in plus the welcome credits are both on the account after sign-in.
- `/me` reports `isAdmin` from the role.

App unit test for the Login page: `?error=INVALID_TOKEN` shows the expired-link message, and `?email=` prefills the field.

## Out of scope

- UI for promoting other admins. Use `make-admin` for now; the plugin's `setRole` makes this a small follow-up.
- Deleting accounts.
- Public signup. It still needs Turnstile and a welcome-credit cap first, per the README.

## Known trade-off

The plugin also exposes an impersonation endpoint. An admin can sign in as any user through the API. Nothing in the UI uses it, and disabling it would need a custom access-control role set. With a single admin this is accepted.
