# One-click sign-in from the invitation

Status: approved design, 2026-10-11. Follows [invite-based access](2026-10-11-invite-access-design.md).

## Problem

Today an invited teacher clicks the invitation, lands on the login page with the email prefilled, requests a magic link, and opens a second email. The second round trip proves nothing new: the invitation already went to the same mailbox. It exists only because Better Auth magic links have one global 15-minute expiry, and an invitation can be opened days later.

## Decisions made with the user

| Topic | Decision |
|---|---|
| Sign-in | The invitation signs the person in directly. |
| Link scanners | The link opens a page with a "Přihlásit se" button. Only the button consumes the token, so mail scanners that prefetch links (Outlook Safe Links and similar) cannot burn it. |
| Validity | 7 days. Only the most recently sent invitation works. |
| Regular magic links | Unchanged. A button page for them waits until someone actually reports a dead link. |

## Verified Better Auth 1.7.7 APIs

- `createAuthEndpoint` from `better-auth/api`. `metadata: { SERVER_ONLY: true }` keeps an endpoint off the HTTP router; it stays callable through `auth.api`.
- `setSessionCookie` from `better-auth/cookies` and `revokeUnprovenAccountAccess` from `better-auth/db`. The magic-link verify endpoint uses the same sequence: consume the token, promote an unverified user, `createSession`, `setSessionCookie`.
- `internalAdapter.consumeVerificationValue` deletes the row atomically but does not check `expiresAt`. The caller must.
- The Kysely adapter (used for D1) supports the `starts_with` operator in `deleteMany`.
- The admin plugin's `session.create.before` hook refuses banned users.

## Design

### Better Auth plugin `inviteLink` (`worker/invite-link.ts`)

- Tokens: 32 random characters (`generateRandomString`). Only the SHA-256 hash is stored, in the `verification` table, as `identifier = "invite:<hex hash>"` and `value = <userId>`, with `expiresAt` 7 days ahead.
- `POST /invite/create { userId }`, server-only:
  - Deletes the user's earlier invite tokens, so only the latest invitation works.
  - Stores a new token and returns `{ token }`.
- `POST /invite/accept { token }`, public at `/api/auth/invite/accept`:
  - Consumes the token. If it is missing or expired, returns 400 `INVALID_INVITE`.
  - Loads the user. If the user is gone, returns 400 `INVALID_INVITE`.
  - Promotes an unverified user with `revokeUnprovenAccountAccess`, as magic-link verify does. `/admin` then shows them as Aktivní.
  - Calls `createSession`, which the admin plugin refuses for banned users with 403, then `setSessionCookie`.
  - Deletes the user's remaining invite tokens and returns `{ status: true }`.
- There is no GET route. Opening a link never consumes a token.

### Admin invite route (`worker/routes/admin.ts`)

The route keeps its behavior and status codes. It now selects the user's `id`, then calls `auth.api.createInvite({ body: { userId } })` for both new and pending users, and mails the token.

### Invitation email (`worker/mail.ts`)

- `inviteMail(to, invitedBy, url)` takes the full link: `${APP_URL}/invite?token=<token>&email=<address>`.
- The button reads "Přihlásit se do FirstRead".
- The text says the invitation is valid for 7 days, and that afterwards the person can sign in with a link sent to their email.

### Frontend

- `src/pages/InviteAccept.tsx` is shown at `/invite` while signed out. A signed-in visitor is sent to `/` as today, and the token stays unused.
  - It renders the logo, "Máte pozvánku do FirstRead", a short line of text and the **Přihlásit se** button.
  - Nothing is called on load.
  - On click it calls `POST /api/auth/invite/accept`, then `refresh()` from `useMe`, and the app opens.
  - On any error it navigates to `/?email=<address>&error=INVALID_INVITE`.
- `src/pages/Login.tsx`: `LINK_ERRORS` gains `INVALID_INVITE`: "Pozvánka už neplatí nebo byla použitá. Pošlete si přihlašovací odkaz." The email is prefilled as before.
- `src/lib/api.ts`: `acceptInvite(token)`.
- `src/App.tsx`: the signed-out routes gain `/invite`.

### Error handling

| Case | Result |
|---|---|
| Used, expired, unknown or superseded token | 400 `INVALID_INVITE`. The login page explains it and the magic-link form is prefilled. |
| Banned user | 403 from the admin plugin, then the same fallback. A magic-link request then gets `NOT_INVITED`. |
| Scanner prefetch | GET of `/invite` renders the SPA only, and there is no GET API route. |

## Testing

Worker integration tests (`worker/api.test.ts`):

- The invitation email contains `/invite?token=`.
- Accepting signs the person in: `/me` returns 200 and the user shows `emailVerified: true`.
- A used token is refused with 400.
- An expired token is refused with 400 (the row's `expiresAt` is set in the past through SQL).
- A banned user gets no session.
- A resend invalidates the previous token.
- A GET to the accept path does not consume the token.

App tests (jsdom):

- `InviteAccept` makes no accept call on load.
- A click posts the token and opens the app.
- A failure lands on the login page with the invitation message and the prefilled email.

## Out of scope

- A button page for regular magic links.
- Configurable validity.
