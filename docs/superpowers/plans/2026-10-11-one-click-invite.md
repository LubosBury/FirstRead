# One-click Invite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The invitation email signs the person in with one button press on an `/invite` page, instead of sending them through a second magic-link email.

**Architecture:** A small Better Auth plugin, `inviteLink`, owns invitation tokens.

- A server-only `createInvite` endpoint issues a 7-day token. Only its SHA-256 hash is stored in `verification`.
- A public `POST /invite/accept` consumes the token and creates the session, the same way magic-link verify does.
- The SPA page `/invite` only calls the accept endpoint when its button is pressed. Link scanners cannot burn the token.

**Tech Stack:** Better Auth 1.7.7 (`createAuthEndpoint`, `setSessionCookie`, `revokeUnprovenAccountAccess`), Hono, D1, React 19 + react-router 7, Vitest (workerd + jsdom).

Spec: [`docs/superpowers/specs/2026-10-11-one-click-invite-design.md`](../specs/2026-10-11-one-click-invite-design.md)

## Global Constraints

- User-facing copy is Czech and gender-neutral. Code, comments and docs are English.
- Standard hyphens only, never en or em dashes.
- Invitation validity: 7 days. Only the most recently sent invitation works.
- No GET route may consume a token.
- No new dependencies.
- Before every commit: `npm run lint`, `npm run typecheck`, `npm test`.

---

### Task 1: `inviteLink` plugin, admin route and email

**Files:**
- Create: `worker/invite-link.ts`
- Modify: `worker/auth.ts`, `worker/routes/admin.ts`, `worker/mail.ts`, `worker/api.test.ts`

**Interfaces:**
- Produces:
  - `inviteLink(): BetterAuthPlugin` with `auth.api.createInvite({ body: { userId } }) => { token: string }`, which is server-only.
  - HTTP `POST /api/auth/invite/accept { token }`:
    - `200 { status: true }` with the session cookie set.
    - `400 { code: "INVALID_INVITE" }` for a used, expired, unknown or superseded token.
    - `403` for a banned user.
  - `INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000`.
  - `inviteMail(to: string, invitedBy: string, url: string): Mail`.

- [ ] **Step 1: Write the failing tests**

In `worker/api.test.ts`, inside `describe("access", ...)`, add a helper below `post`:

```ts
  /** Invites through /admin and returns the token from the printed email. */
  const inviteToken = async (email: string) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await inviteVia(email);
    const mail = log.mock.calls.map((c) => String(c[0])).find((s) => s.includes(`to=${email}`)) ?? "";
    log.mockRestore();
    expect(res.status).toBeLessThan(300);
    return mail.match(/\/invite\?token=([A-Za-z0-9]+)/)?.[1] ?? "";
  };
  const accept = (token: string) => api("/auth/invite/accept", json({ token }));
  const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
```

Change the URL assertion in "invites by email; the user is pending until the first sign-in" from `/?email=` to:

```ts
    expect(mail).toMatch(/http:\/\/localhost\/invite\?token=[A-Za-z0-9]{32}&email=new\.teacher%40example\.com/);
```

Then add:

```ts
  it("signs the invited person in from the invitation, once", async () => {
    const token = await inviteToken("oneclick@example.com");
    const res = await accept(token);
    expect(res.status).toBe(200);
    expect((await api("/me", { cookie: cookieOf(res) })).status).toBe(200);
    expect((await row("oneclick@example.com")).emailVerified).toBe(true);

    const again = await accept(token);
    expect(again.status).toBe(400);
    expect(((await again.json()) as { code: string }).code).toBe("INVALID_INVITE");
  });

  it("does not consume the token on a GET, as a link scanner would send", async () => {
    const token = await inviteToken("scanned@example.com");
    expect((await api(`/auth/invite/accept?token=${token}`)).status).not.toBe(200);
    expect((await accept(token)).status).toBe(200);
  });

  it("refuses an expired invitation", async () => {
    const token = await inviteToken("late@example.com");
    const { id } = await row("late@example.com");
    await env.DB.prepare(`UPDATE verification SET expiresAt = ? WHERE identifier LIKE 'invite:%' AND value = ?`)
      .bind(new Date(Date.now() - 60_000).toISOString(), id)
      .run();
    expect((await accept(token)).status).toBe(400);
  });

  it("keeps only the latest invitation valid", async () => {
    const first = await inviteToken("twice@example.com");
    const second = await inviteToken("twice@example.com");
    expect((await accept(first)).status).toBe(400);
    expect((await accept(second)).status).toBe(200);
  });

  it("gives a banned invitee no session", async () => {
    const token = await inviteToken("blocked@example.com");
    const { id } = await row("blocked@example.com");
    expect((await post(`/admin/users/${id}/ban`, admin)).status).toBe(204);
    const res = await accept(token);
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie().some((c) => c.includes("session_token=") && !c.includes("Max-Age=0"))).toBe(false);
  });

  it("is not reachable for issuing tokens over HTTP", async () => {
    expect((await api("/auth/invite/create", { ...json({ userId: "x" }), cookie: admin })).status).toBe(404);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project worker worker/api.test.ts`
Expected: FAIL. The mail still links to `/?email=`, the token helper returns `""`, and `/auth/invite/accept` returns 404.

- [ ] **Step 3: Write the plugin**

Create `worker/invite-link.ts`:

```ts
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import { revokeUnprovenAccountAccess } from "better-auth/db";
import { z } from "zod";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PREFIX = "invite:";

/** Only the hash is stored, so a database read does not reveal working links. */
async function identifierFor(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return PREFIX + Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

const invalid = () => new APIError("BAD_REQUEST", { code: "INVALID_INVITE", message: "Pozvánka už neplatí." });

/**
 * Invitation links that sign the person in directly. The invitation already
 * proves control of the mailbox, so a second magic-link email adds nothing.
 * Only POST consumes a token: the /invite page sends it when its button is
 * pressed, so mail scanners that prefetch links cannot burn it.
 */
export const inviteLink = () =>
  ({
    id: "invite-link",
    endpoints: {
      createInvite: createAuthEndpoint(
        "/invite/create",
        { method: "POST", body: z.object({ userId: z.string().min(1) }), metadata: { SERVER_ONLY: true } },
        async (ctx) => {
          const { userId } = ctx.body;
          // Only the latest invitation works.
          await ctx.context.adapter.deleteMany({
            model: "verification",
            where: [
              { field: "value", value: userId },
              { field: "identifier", operator: "starts_with", value: PREFIX },
            ],
          });
          const token = generateRandomString(32, "a-z", "A-Z", "0-9");
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: await identifierFor(token),
            value: userId,
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          });
          return ctx.json({ token });
        },
      ),
      acceptInvite: createAuthEndpoint(
        "/invite/accept",
        { method: "POST", body: z.object({ token: z.string().min(1).max(200) }) },
        async (ctx) => {
          const record = await ctx.context.internalAdapter.consumeVerificationValue(await identifierFor(ctx.body.token));
          // Consuming deletes the row but does not check the expiry.
          if (!record || new Date(record.expiresAt).getTime() < Date.now()) throw invalid();
          let user = await ctx.context.internalAdapter.findUserById(record.value);
          if (!user) throw invalid();
          // Same promotion as magic-link verify: the mailbox is now proven.
          if (!user.emailVerified) user = await revokeUnprovenAccountAccess(ctx, user.id);
          if (!user) throw invalid();
          // The admin plugin refuses banned users here.
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          await ctx.context.adapter.deleteMany({
            model: "verification",
            where: [
              { field: "value", value: user.id },
              { field: "identifier", operator: "starts_with", value: PREFIX },
            ],
          });
          return ctx.json({ status: true });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
```

In `worker/auth.ts`, import it and add it after `admin()`:

```ts
import { inviteLink } from "./invite-link";
```

```ts
    plugins: [
      admin(),
      inviteLink(),
      magicLink({
```

- [ ] **Step 4: Issue the token from the admin route and mail the link**

`worker/mail.ts`: replace `inviteMail` with:

```ts
/** Signs the person in from the /invite page (see worker/invite-link.ts). */
export function inviteMail(to: string, invitedBy: string, url: string): Mail {
  return {
    to,
    subject: "Pozvánka do FirstRead",
    text: `Dobrý den,\n\n${invitedBy} vás zve do FirstRead, kde si připravíte pracovní listy pro prvňáčky.\n\nPřihlásíte se tímto odkazem, bez hesla:\n${url}\n\nPozvánka platí 7 dní. Potom se přihlásíte odkazem, který vám pošleme e-mailem.`,
    html: `<div style="font-family:Arial,sans-serif;font-size:16px;color:#1d2422">
<p>Dobrý den,</p>
<p>${esc(invitedBy)} vás zve do FirstRead, kde si připravíte pracovní listy pro prvňáčky.</p>
<p><a href="${esc(url)}" style="display:inline-block;background:#1f6f5c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Přihlásit se do FirstRead</a></p>
<p style="color:#66706c;font-size:13px">Pozvánka platí 7&nbsp;dní. Potom se přihlásíte odkazem, který vám pošleme e-mailem.</p>
</div>`,
  };
}
```

`worker/routes/admin.ts`, in `POST /admin/invites`: select the id, keep the user id from `createUser`, and issue a token for both new and pending users:

```ts
  const existing = await c.env.DB.prepare(`SELECT id, emailVerified, banned FROM "user" WHERE lower(email) = ?`)
    .bind(email)
    .first<{ id: string; emailVerified: number; banned: number | null }>();
  if (existing?.banned) return c.json({ error: "conflict", message: "Přístup byl odebrán. Vraťte ho v seznamu uživatelů." }, 409);
  if (existing?.emailVerified) return c.json({ error: "conflict", message: "Tento e-mail už přístup má." }, 409);
  const auth = getAuth(c.env);
  // With the admin's headers, the plugin checks the role as well.
  const userId =
    existing?.id ?? (await auth.api.createUser({ headers: c.req.raw.headers, body: { email, name: "", role: "user" } })).user.id;
  const { token } = await auth.api.createInvite({ body: { userId } });
  const url = `${c.env.APP_URL.replace(/\/$/, "")}/invite?token=${token}&email=${encodeURIComponent(email)}`;
  await sendMail(c.env, inviteMail(email, c.get("user").email, url));
  return c.json({ email, resent: Boolean(existing) }, existing ? 200 : 201);
```

- [ ] **Step 5: Run the checks**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add worker
git commit -m "Sign invited people in straight from the invitation"
```

---

### Task 2: `/invite` page

**Files:**
- Create: `src/pages/InviteAccept.tsx`, `src/pages/InviteAccept.test.tsx`
- Modify: `src/App.tsx`, `src/lib/api.ts`, `src/pages/Login.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/invite/accept { token }` from Task 1.
- Produces: `api.acceptInvite(token: string): Promise<{ status: boolean }>`. Login understands `?error=INVALID_INVITE`.

- [ ] **Step 1: Write the failing test**

Create `src/pages/InviteAccept.test.tsx`:

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeProvider, useMe } from "@/hooks/useMe";
import { InviteAccept } from "./InviteAccept";
import { Login } from "./Login";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

function Probe() {
  const { me } = useMe();
  return <p>{me ? `in as ${me.user.email}` : "signed out"}</p>;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** /api/me answers 401 until the invite is accepted. */
function mockApi(acceptStatus: number) {
  let signedIn = false;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/api/me") return signedIn ? json(200, { user: { id: "u", email: "u@example.com", name: "" } }) : json(401, {});
    if (url === "/api/auth/invite/accept") {
      signedIn = acceptStatus === 200;
      return acceptStatus === 200 ? json(200, { status: true }) : json(acceptStatus, { code: "INVALID_INVITE", message: "x" });
    }
    return json(404, {});
  });
}

async function renderAt(url: string) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <MeProvider>
          <Probe />
          <Routes>
            <Route path="/invite" element={<InviteAccept />} />
            <Route path="/" element={<Login />} />
          </Routes>
        </MeProvider>
      </MemoryRouter>,
    ),
  );
}

const button = () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Přihlásit se")!;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("InviteAccept", () => {
  it("does nothing until the button is pressed, then signs in", async () => {
    const fetch = mockApi(200);
    await renderAt("/invite?token=abc&email=u%40example.com");
    expect(fetch.mock.calls.some((c) => String(c[0]) === "/api/auth/invite/accept")).toBe(false);

    await act(async () => button().click());
    const call = fetch.mock.calls.find((c) => String(c[0]) === "/api/auth/invite/accept")!;
    expect(call[1]?.method).toBe("POST");
    expect(JSON.parse(String(call[1]?.body))).toEqual({ token: "abc" });
    expect(container.textContent).toContain("in as u@example.com");
  });

  it("falls back to the login form with the email when the invitation no longer works", async () => {
    mockApi(400);
    await renderAt("/invite?token=used&email=u%40example.com");
    await act(async () => button().click());
    expect(container.textContent).toContain("Pozvánka už neplatí nebo byla použitá. Pošlete si přihlašovací odkaz.");
    expect(container.querySelector<HTMLInputElement>("input#email")?.value).toBe("u@example.com");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --project app src/pages/InviteAccept.test.tsx`
Expected: FAIL with "Failed to resolve import ./InviteAccept".

- [ ] **Step 3: Implement**

`src/lib/api.ts`, in `api` after `signOut`:

```ts
  acceptInvite: (token: string) => request<{ status: boolean }>("/auth/invite/accept", send("POST", { token })),
```

`src/pages/Login.tsx`, in `LINK_ERRORS`:

```ts
  INVALID_INVITE: "Pozvánka už neplatí nebo byla použitá. Pošlete si přihlašovací odkaz.",
```

Create `src/pages/InviteAccept.tsx`:

```tsx
import { BookOpenCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useMe } from "@/hooks/useMe";
import { api } from "@/lib/api";

/**
 * Landing page of the invitation email. Nothing happens on load: mail
 * scanners open links before people do, and a one-time token must survive
 * that. The button spends it.
 */
export function InviteAccept() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useMe();
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      await api.acceptInvite(params.get("token") ?? "");
      await refresh(); // the app opens
      navigate("/", { replace: true });
    } catch {
      setBusy(false);
      navigate(`/?${new URLSearchParams({ email: params.get("email") ?? "", error: "INVALID_INVITE" })}`, { replace: true });
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm p-7 text-center">
        <div className="mb-6 flex items-center justify-center gap-2 text-2xl font-extrabold text-brand">
          <BookOpenCheck className="h-7 w-7" /> FirstRead
        </div>
        <p className="font-bold">Máte pozvánku do FirstRead</p>
        <p className="mt-2 text-sm text-muted">Pracovní listy pro prvňáčky. Přihlásíte se jedním kliknutím, bez hesla.</p>
        <Button className="mt-6 w-full" onClick={accept} disabled={busy}>
          Přihlásit se
        </Button>
      </Card>
    </div>
  );
}
```

`src/App.tsx`: import the page and add the route to the signed-out `Routes`:

```tsx
import { InviteAccept } from "@/pages/InviteAccept";
```

```tsx
      <Routes>
        <Route path="/invite" element={<InviteAccept />} />
        <Route path="*" element={<Login />} />
      </Routes>
```

- [ ] **Step 4: Run the checks**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "Add the /invite page that signs people in with one button"
```

---

### Task 3: Docs and an end-to-end check

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README Access section**

Replace the "Invite-only" bullet with:

```markdown
- **Invite-only.** An admin enters an email at `/admin`. That creates the account (with the welcome credits) and emails an invitation valid for 7 days. Its link opens `/invite`, where one button signs the person in. Only the button spends the one-time token, so mail scanners that open links first cannot. Resending replaces the previous invitation. After that, people sign in with a magic link.
```

- [ ] **Step 2: Browser smoke run on local D1**

Run these against `npm run dev`, with a `.dev.vars` copied from the example and `npm run make-admin -- you@example.com`:

- Sign in as admin, invite `ucitelka@example.com`, and take the `/invite?token=...` link from the dev log.
- Open the link in a fresh browser context.
- Reload the page once and confirm that the token survives (a scanner-like visit).
- Press "Přihlásit se": the app opens with 5 credits, and `/admin` shows the user as Aktivní.
- Open the same link again in a new context and press the button: the login page shows the expired-invitation message with the email prefilled.
- Afterwards, remove `.dev.vars` and `.wrangler/state`.

- [ ] **Step 3: Run all checks and commit**

Run: `npm test && npm run lint && npm run typecheck && npm run build`

```bash
git add README.md
git commit -m "Document one-click invitations"
```
