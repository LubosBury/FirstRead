# Invite-based Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `ALLOWED_EMAILS` and `ADMIN_EMAILS` secrets with database-managed access: admins invite teachers from `/admin`, can revoke and restore access, and the admin role lives in the `user` table.

**Architecture:** Better Auth's `admin` plugin adds `role` and ban columns. Accounts are pre-created by an admin (`createUser`), magic links can no longer create accounts (`disableSignUp`), and a `hooks.before` gate refuses links to unknown or banned addresses. Thin Hono routes wrap the plugin's `createUser` / `banUser` / `unbanUser`, keep the app's `{ error, message }` shape, and send the invitation email.

**Tech Stack:** Cloudflare Workers + Hono, D1, Better Auth 1.7.7 (`admin`, `magic-link` plugins), React 19 + react-router 7, Vitest (workerd pool for `worker/`, jsdom for `src/`).

Spec: [`docs/superpowers/specs/2026-10-11-invite-access-design.md`](../specs/2026-10-11-invite-access-design.md)

## Global Constraints

- All user-facing copy is Czech and gender-neutral. Code, comments, docs and commit messages are English.
- Typography: standard hyphens only. Never use en or em dashes anywhere.
- Error responses from app routes keep the shape `{ error: string, message: string }`.
- Admin check everywhere: `user.role === "admin"`. No email lists in code, config or tests.
- Magic links stay: 15-minute expiry, hashed tokens. Invitation emails contain a link to `APP_URL/?email=...`, never a magic link.
- Do not add dependencies.
- Checks before every commit: `npm run lint`, `npm run typecheck`, `npm test`.

## Verified facts (Better Auth 1.7.7, probed in workerd against D1)

- `getMigrations` for the admin plugin emits exactly:
  `alter table "user" add column "role" text;`, `"banned" integer default 0`, `"banReason" text`, `"banExpires" date`, and `alter table "session" add column "impersonatedBy" text;`.
- Better Auth stores dates as ISO strings (`2026-10-11T07:47:31.695Z`) and booleans as `0`/`1`. Ids are 32-char strings.
- `auth.api.createUser({ body: { email, name: "", role } })` without headers skips permission checks and lowercases the email. With a non-admin's headers it throws `APIError` 403 `YOU_ARE_NOT_ALLOWED_TO_CREATE_USERS`. A duplicate throws 400 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`.
- `databaseHooks.user.create.after` fires for `createUser`.
- A `hooks.before` middleware that throws `new APIError("FORBIDDEN", { code, message })` yields HTTP 403 with body `{ code, message }`, and no `verification` row is written.
- After the first magic-link sign-in, a pre-created user's `emailVerified` flips from `false` to `true`. `session.user.role` is present.
- A reused or expired link redirects to `/?error=INVALID_TOKEN`.
- `banUser` deletes the user's sessions. Banning yourself throws `APIError` with `statusCode` 400. `APIError` has a numeric `statusCode`.

## File map

| File | Change |
|---|---|
| `migrations/0003_admin_plugin.sql` | Create: admin plugin columns and backfill. |
| `worker/auth.ts` | Admin plugin, `disableSignUp`, `hooks.before` gate, welcome-credit hook. |
| `worker/app.ts` | `SessionUser.role`, `isAdmin()`. |
| `worker/env.ts` | Keep only `intVar`. |
| `worker/index.ts` | Drop the custom magic-link route. |
| `worker/routes/me.ts`, `worker/routes/generations.ts` | Use `isAdmin()`. |
| `worker/routes/admin.ts` | Role check; invite, ban, unban routes; richer user list. |
| `worker/mail.ts` | `inviteMail()`. |
| `worker/make-admin.ts` | Create: `makeAdminSql()`. |
| `worker/make-admin.test.ts` | Create: SQL works with Better Auth. |
| `worker/test/session.ts` | `invite()` helper. |
| `worker/api.test.ts` | Invite users in `beforeAll`; auth and access tests. |
| `scripts/make-admin.ts` | Create: CLI wrapper around `wrangler d1 execute`. |
| `src/lib/api.ts` | `ApiError` reads `code`; admin access calls; `AdminUser` fields. |
| `src/lib/access.ts`, `src/lib/access.test.ts` | Create: status derivation. |
| `src/components/InviteCard.tsx` | Create: invite form. |
| `src/pages/Admin.tsx` | Status column, row actions, invite card. |
| `src/pages/Login.tsx`, `src/pages/Login.test.tsx` | Prefill and link errors. |
| `vitest.config.ts`, `.dev.vars.example`, `wrangler.jsonc`, `worker/worker-configuration.d.ts`, `tsconfig.node.json`, `package.json`, `README.md` | Remove env lists; wire the script; document access. |

---

### Task 1: Admin role in the database

**Files:**
- Create: `migrations/0003_admin_plugin.sql`
- Modify: `worker/auth.ts`, `worker/app.ts`, `worker/env.ts`, `worker/routes/me.ts`, `worker/routes/admin.ts`, `worker/routes/generations.ts`, `worker/test/session.ts`, `worker/api.test.ts`, `vitest.config.ts`

**Interfaces:**
- Produces: `isAdmin(user: SessionUser): boolean` and `SessionUser = { id: string; email: string; name: string; role: string | null }` in `worker/app.ts`.
- Produces: `invite(email: string, role?: "user" | "admin"): Promise<void>` in `worker/test/session.ts`.

- [ ] **Step 1: Make the tests rely on roles, not `ADMIN_EMAILS`**

In `vitest.config.ts`, delete the line `ADMIN_EMAILS: "admin@example.com",`. Keep `ALLOWED_EMAILS` for now (Task 2 removes it).

In `worker/test/session.ts`, add below the imports:

```ts
import { env } from "cloudflare:test";
import { getAuth } from "../auth";

/** Creates a user the way an admin's invite does. Server-side, so no permission check. */
export async function invite(email: string, role: "user" | "admin" = "user"): Promise<void> {
  await getAuth(env).api.createUser({ body: { email, name: "", role } });
}
```

In `worker/api.test.ts`, import `invite` and replace `beforeAll`:

```ts
import { api, invite, json, signIn } from "./test/session";
```

```ts
beforeAll(async () => {
  await invite("teacher@example.com");
  await invite("other@example.com");
  await invite("admin@example.com", "admin");
  teacher = await signIn("teacher@example.com");
  other = await signIn("other@example.com");
  admin = await signIn("admin@example.com");
});
```

Add to the `describe("admin", ...)` block:

```ts
  it("keeps the plugin's own admin endpoints closed to regular users", async () => {
    expect((await api("/auth/admin/list-users", { cookie: teacher })).status).toBe(403);
  });
```

- [ ] **Step 2: Run the worker tests to see them fail**

Run: `npx vitest run --project worker`
Expected: FAIL. `beforeAll` throws because `api.createUser` does not exist (`TypeError: ... createUser is not a function`).

- [ ] **Step 3: Add the migration**

Create `migrations/0003_admin_plugin.sql`:

```sql
-- Better Auth admin plugin columns (as emitted by better-auth 1.7 getMigrations
-- for SQLite). Access now lives in the database: an admin pre-creates users,
-- a ban revokes access, and `role` replaces the ADMIN_EMAILS secret.
alter table "user" add column "role" text;
alter table "user" add column "banned" integer default 0;
alter table "user" add column "banReason" text;
alter table "user" add column "banExpires" date;
alter table "session" add column "impersonatedBy" text;

-- Everyone who has signed in so far keeps access as a regular user. The first
-- admin is set with `npm run make-admin`, since this public repo can't name them.
UPDATE "user" SET role = 'user', banned = 0;
```

- [ ] **Step 4: Add the plugin and the role check**

`worker/auth.ts`: add the import and put `admin()` first in `plugins`:

```ts
import { admin } from "better-auth/plugins/admin";
```

```ts
    plugins: [
      admin(),
      magicLink({
```

`worker/app.ts`: replace the `SessionUser` type and the `c.set(...)` line, and add `isAdmin`:

```ts
export type SessionUser = { id: string; email: string; name: string; role: string | null };
```

```ts
  c.set("user", { id: session.user.id, email: session.user.email, name: session.user.name, role: session.user.role ?? null });
```

```ts
/** Admins are users with the `admin` role (see `npm run make-admin`). */
export const isAdmin = (user: SessionUser) => user.role === "admin";
```

`worker/env.ts`: delete `isAdminEmail` (keep `emailSet`, `isAllowedEmail` and `intVar` for now).

`worker/routes/me.ts`:

```ts
import { Hono } from "hono";
import { isAdmin, type AppEnv } from "../app";
import { ensureWallet, getBalance } from "../credits";
import { intVar } from "../env";
```

and in the handler:

```ts
  const admin = isAdmin(user);
  const engine = await resolveEngine(c.env);
  return c.json({
    user,
    balance: await getBalance(c.env.DB, user.id),
    isAdmin: admin,
    // What the next image costs on the current default engine.
    costs: { main: creditCost(c.env, engine, "main"), icon: creditCost(c.env, engine, "icon") },
    // Admins can compare engines on the same prompt; everyone else gets the default.
    ...(admin && { engines: engineOptions(), defaultEngine: engine }),
  });
```

`worker/routes/admin.ts`: change the imports and the middleware:

```ts
import { badRequest, isAdmin, notFound, type AppEnv } from "../app";
```

(remove `import { isAdminEmail } from "../env";`)

```ts
admin.use("/admin/*", async (c, next) => {
  if (!isAdmin(c.get("user"))) return c.json({ error: "forbidden", message: "Jen pro správce." }, 403);
  await next();
});
```

`worker/routes/generations.ts`: replace the import of `isAdminEmail` with `isAdmin` from `../app`:

```ts
import { badRequest, isAdmin, notFound, type AppEnv } from "../app";
```

and the check:

```ts
  if (engine && !isAdmin(user)) {
```

- [ ] **Step 5: Run the checks**

Run: `npx vitest run --project worker && npm run lint && npm run typecheck`
Expected: all PASS, including "flags admins", "lists engines for admins only" and the new plugin-endpoint test.

- [ ] **Step 6: Commit**

```bash
git add migrations/0003_admin_plugin.sql worker vitest.config.ts
git commit -m "Move the admin role from ADMIN_EMAILS into the database"
```

---

### Task 2: Invite-only sign-in and welcome credits at creation

**Files:**
- Modify: `worker/auth.ts`, `worker/index.ts`, `worker/env.ts`, `worker/test/session.ts`, `worker/api.test.ts`, `vitest.config.ts`, `src/lib/api.ts`

**Interfaces:**
- Consumes: `invite()` from Task 1.
- Produces: magic-link requests for unknown or banned addresses return 403 `{ code: "NOT_INVITED", message }`. Every created user gets `WELCOME_CREDITS` at creation.

- [ ] **Step 1: Write the failing tests**

In `vitest.config.ts`, delete the line `ALLOWED_EMAILS: "teacher@example.com,admin@example.com,other@example.com",`.

In `worker/api.test.ts`, replace the first test of `describe("auth", ...)` and add three more:

```ts
describe("auth", () => {
  it("refuses to send a link to an address that is not invited", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await api("/auth/sign-in/magic-link", json({ email: "stranger@example.com", callbackURL: "/" }));
    const mailed = log.mock.calls.some((c) => String(c[0]).includes("stranger@example.com"));
    log.mockRestore();
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("NOT_INVITED");
    expect(mailed).toBe(false);
  });

  it("refuses to send a link to a banned user", async () => {
    await invite("banned@example.com");
    await env.DB.prepare(`UPDATE "user" SET banned = 1 WHERE email = 'banned@example.com'`).run();
    const res = await api("/auth/sign-in/magic-link", json({ email: "banned@example.com", callbackURL: "/" }));
    expect(res.status).toBe(403);
  });

  it("does not create an account from a link", async () => {
    const count = () => env.DB.prepare(`SELECT COUNT(*) AS n FROM "user"`).first<number>("n");
    const before = await count();
    await api("/auth/sign-in/magic-link", json({ email: "walk-in@example.com", callbackURL: "/" }));
    expect(await count()).toBe(before);
  });

  it("keeps the welcome credits when an admin grants credits before the first sign-in", async () => {
    await invite("early@example.com");
    expect((await api("/admin/grant", { ...json({ email: "early@example.com", amount: 10 }), cookie: admin })).status).toBe(200);
    const cookie = await signIn("early@example.com");
    expect(((await (await api("/me", { cookie })).json()) as { balance: number }).balance).toBe(15);
  });

  it("requires a session for the app API", async () => {
    expect((await api("/me")).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project worker`
Expected: FAIL. `beforeAll` sign-ins get 403 `not_invited` (the env list is gone, the old route still checks it), so every test fails.

- [ ] **Step 3: Move the gate into Better Auth**

Replace `worker/auth.ts` with:

```ts
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin } from "better-auth/plugins/admin";
import { magicLink } from "better-auth/plugins/magic-link";
import { ensureWallet } from "./credits";
import { intVar } from "./env";
import { magicLinkMail, sendMail } from "./mail";

/** Invite-only: a link goes only to a user an admin created and hasn't banned. */
async function mayRequestLink(db: D1Database, email: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM "user" WHERE lower(email) = ? AND COALESCE(banned, 0) = 0`)
    .bind(email.trim().toLowerCase())
    .first();
  return row !== null;
}

export function authOptions(env: Env) {
  return {
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    basePath: "/api/auth",
    trustedOrigins: [env.APP_URL],
    session: {
      expiresIn: 60 * 60 * 24 * 60,
      updateAge: 60 * 60 * 24,
    },
    hooks: {
      // Say so up front instead of letting someone wait for an email that will
      // never come. Runs before the endpoint, so strangers leave no token behind.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/magic-link") return;
        if (!(await mayRequestLink(env.DB, String(ctx.body?.email ?? "")))) {
          throw new APIError("FORBIDDEN", {
            code: "NOT_INVITED",
            message: "Tento e-mail zatím nemá přístup. Požádejte o pozvánku.",
          });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Welcome credits when the account is created, i.e. at invite time.
          // Opening the wallet later would lose them if an admin granted first.
          after: async (user) => {
            await ensureWallet(env.DB, user.id, intVar(env.WELCOME_CREDITS, 5));
          },
        },
      },
    },
    plugins: [
      admin(),
      magicLink({
        expiresIn: 60 * 15,
        storeToken: "hashed",
        // Accounts come from invites only.
        disableSignUp: true,
        sendMagicLink: async ({ email, url }) => {
          await sendMail(env, magicLinkMail(email, url));
        },
      }),
    ],
  } satisfies BetterAuthOptions;
}
```

Keep the `cache`, `createAuth` and `getAuth` code below it unchanged.

`worker/index.ts`: delete the `import { isAllowedEmail } from "./env";` line and the whole custom `app.post("/auth/sign-in/magic-link", ...)` block including its comment. The remaining auth line is:

```ts
app.on(["GET", "POST"], "/auth/*", (c) => getAuth(c.env).handler(c.req.raw));
```

`worker/env.ts`: delete `emailSet` and `isAllowedEmail`. Only `intVar` remains.

`worker/test/session.ts`: update the `signIn` doc comment's first line to:

```ts
/**
 * Signs in like a person would (the user must be invited first): request a
 * link, "open the email" (locally the mailer prints it), follow the link, keep
 * the cookies.
 */
```

`src/lib/api.ts`: Better Auth errors carry `code` instead of `error`. In `request`:

```ts
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string; message?: string };
    throw new ApiError(res.status, body.error ?? body.code ?? "error", body.message ?? "Něco se pokazilo. Zkuste to prosím znovu.");
```

- [ ] **Step 4: Run the checks**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all PASS. `grep -rn "ALLOWED_EMAILS\|isAllowedEmail\|emailSet" worker src vitest.config.ts` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add worker src/lib/api.ts vitest.config.ts
git commit -m "Gate magic links on invited, unbanned users instead of ALLOWED_EMAILS"
```

---

### Task 3: Admin API for invites, revoking and restoring access

**Files:**
- Modify: `worker/mail.ts`, `worker/routes/admin.ts`, `worker/api.test.ts`

**Interfaces:**
- Consumes: `isAdmin`, `invite`, `signIn` from earlier tasks.
- Produces (HTTP, admin only):
  - `POST /api/admin/invites { email }` returns `201 { email, resent: false }` for a new user, `200 { email, resent: true }` for a pending one, `409` for an active or banned one, `400` for an invalid email.
  - `POST /api/admin/users/:id/ban` and `/unban` return `204`. Banning yourself returns `400`, an unknown id `404`.
  - `GET /api/admin/users` rows gain `role: string | null`, `banned: boolean`, `emailVerified: boolean`.
- Produces: `inviteMail(to: string, invitedBy: string, appUrl: string): Mail` in `worker/mail.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `worker/api.test.ts` (before `describe("scheduled", ...)`):

```ts
describe("access", () => {
  afterEach(() => vi.restoreAllMocks());

  type Row = { id: string; email: string; banned: boolean; emailVerified: boolean };
  const row = async (email: string) =>
    ((await (await api("/admin/users", { cookie: admin })).json()) as Row[]).find((u) => u.email === email)!;
  const inviteVia = (email: string, cookie = admin) => api("/admin/invites", { ...json({ email }), cookie });
  const post = (path: string, cookie: string) => api(path, { method: "POST", cookie });

  it("invites by email; the user is pending until the first sign-in", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await inviteVia(" New.Teacher@Example.com ");
    const mail = log.mock.calls.map((c) => String(c[0])).find((s) => s.includes("to=new.teacher@example.com"));
    log.mockRestore();

    expect(res.status).toBe(201);
    expect(mail).toContain("Pozvánka do FirstRead");
    expect(mail).toContain("http://localhost/?email=new.teacher%40example.com");
    expect(await row("new.teacher@example.com")).toMatchObject({ emailVerified: false, banned: false });

    await signIn("new.teacher@example.com");
    expect((await row("new.teacher@example.com")).emailVerified).toBe(true);
  });

  it("resends to a pending user and refuses one who already has access", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect((await inviteVia("pending@example.com")).status).toBe(201);
    const again = await inviteVia("pending@example.com");
    expect(again.status).toBe(200);
    expect(((await again.json()) as { resent: boolean }).resent).toBe(true);
    expect((await inviteVia("teacher@example.com")).status).toBe(409);
  });

  it("rejects an invalid email", async () => {
    expect((await inviteVia("not-an-email")).status).toBe(400);
  });

  it("revokes access: sessions end and no new link; restoring lets the user back in", async () => {
    await invite("leaver@example.com");
    const cookie = await signIn("leaver@example.com");
    const { id } = await row("leaver@example.com");

    expect((await post(`/admin/users/${id}/ban`, admin)).status).toBe(204);
    expect((await api("/me", { cookie })).status).toBe(401);
    expect((await api("/auth/sign-in/magic-link", json({ email: "leaver@example.com", callbackURL: "/" }))).status).toBe(403);
    expect((await row("leaver@example.com")).banned).toBe(true);
    expect((await inviteVia("leaver@example.com")).status).toBe(409);

    expect((await post(`/admin/users/${id}/unban`, admin)).status).toBe(204);
    expect((await api("/me", { cookie: await signIn("leaver@example.com") })).status).toBe(200);
  });

  it("does not let an admin revoke their own access", async () => {
    const { id } = await row("admin@example.com");
    expect((await post(`/admin/users/${id}/ban`, admin)).status).toBe(400);
  });

  it("is closed to non-admins", async () => {
    const { id } = await row("other@example.com");
    expect((await inviteVia("someone@example.com", teacher)).status).toBe(403);
    expect((await post(`/admin/users/${id}/ban`, teacher)).status).toBe(403);
    expect((await post(`/admin/users/${id}/unban`, teacher)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project worker worker/api.test.ts`
Expected: FAIL. The new routes return 404, and `/admin/users` rows have no `emailVerified`.

- [ ] **Step 3: Add the invitation email**

Append to `worker/mail.ts`:

```ts
/** Points to the app with the address prefilled. Not a magic link: those expire in 15 minutes. */
export function inviteMail(to: string, invitedBy: string, appUrl: string): Mail {
  const url = `${appUrl.replace(/\/$/, "")}/?email=${encodeURIComponent(to)}`;
  return {
    to,
    subject: "Pozvánka do FirstRead",
    text: `Dobrý den,\n\n${invitedBy} vás zve do FirstRead, kde si připravíte pracovní listy pro prvňáčky.\n\nOtevřete ${url} a přihlaste se svým e-mailem. Heslo nepotřebujete, pošleme vám přihlašovací odkaz.`,
    html: `<div style="font-family:Arial,sans-serif;font-size:16px;color:#1d2422">
<p>Dobrý den,</p>
<p>${esc(invitedBy)} vás zve do FirstRead, kde si připravíte pracovní listy pro prvňáčky.</p>
<p><a href="${esc(url)}" style="display:inline-block;background:#1f6f5c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Otevřít FirstRead</a></p>
<p style="color:#66706c;font-size:13px">Přihlásíte se svým e-mailem, bez hesla. Pošleme vám přihlašovací odkaz.</p>
</div>`,
  };
}
```

- [ ] **Step 4: Add the routes**

In `worker/routes/admin.ts`, extend the imports:

```ts
import { Hono } from "hono";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { badRequest, isAdmin, notFound, type AppEnv } from "../app";
import { getAuth } from "../auth";
import { grantCredits, InsufficientCreditsError } from "../credits";
import { ENGINE_IDS, engineOptions } from "../imaging/engines";
import { inviteMail, sendMail } from "../mail";
import { resolveEngine, setDefaultEngine } from "../settings";
```

Replace the `GET /admin/users` handler:

```ts
type UserRow = { id: string; email: string; createdAt: string; role: string | null; banned: number | null; emailVerified: number; balance: number; generated: number };

admin.get("/admin/users", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.createdAt AS createdAt, u.role, u.banned, u.emailVerified, COALESCE(w.balance, 0) AS balance,
            (SELECT COUNT(*) FROM generations g WHERE g.user_id = u.id AND g.status = 'done') AS generated
     FROM "user" u LEFT JOIN wallets w ON w.user_id = u.id ORDER BY u.createdAt DESC`,
  ).all<UserRow>();
  return c.json(results.map((u) => ({ ...u, banned: Boolean(u.banned), emailVerified: Boolean(u.emailVerified) })));
});
```

Add below the grant route:

```ts
const inviteBody = z.object({ email: z.string().trim().toLowerCase().email() });

admin.post("/admin/invites", async (c) => {
  const parsed = inviteBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, "Zadejte platný e-mail.");
  const { email } = parsed.data;
  const existing = await c.env.DB.prepare(`SELECT emailVerified, banned FROM "user" WHERE lower(email) = ?`)
    .bind(email)
    .first<{ emailVerified: number; banned: number | null }>();
  if (existing?.banned) return c.json({ error: "conflict", message: "Přístup byl odebrán. Vraťte ho v seznamu uživatelů." }, 409);
  if (existing?.emailVerified) return c.json({ error: "conflict", message: "Tento e-mail už přístup má." }, 409);
  if (!existing) {
    // With the admin's headers, the plugin checks the role as well.
    await getAuth(c.env).api.createUser({ headers: c.req.raw.headers, body: { email, name: "", role: "user" } });
  }
  await sendMail(c.env, inviteMail(email, c.get("user").email, c.env.APP_URL));
  return c.json({ email, resent: Boolean(existing) }, existing ? 200 : 201);
});

// Revoking access is a Better Auth ban: it ends all sessions, and the magic-link
// gate refuses banned users. Their sheets and images stay.
admin.post("/admin/users/:id/ban", async (c) => {
  try {
    await getAuth(c.env).api.banUser({ headers: c.req.raw.headers, body: { userId: c.req.param("id") } });
  } catch (e) {
    if (e instanceof APIError && e.statusCode === 400) return badRequest(c, "Sami sobě přístup odebrat nemůžete.");
    if (e instanceof APIError && e.statusCode === 404) return notFound(c);
    throw e;
  }
  return c.body(null, 204);
});

admin.post("/admin/users/:id/unban", async (c) => {
  try {
    await getAuth(c.env).api.unbanUser({ headers: c.req.raw.headers, body: { userId: c.req.param("id") } });
  } catch (e) {
    if (e instanceof APIError && e.statusCode === 404) return notFound(c);
    throw e;
  }
  return c.body(null, 204);
});
```

- [ ] **Step 5: Run the checks**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add worker
git commit -m "Let admins invite users and revoke or restore their access"
```

---

### Task 4: Admin UI

**Files:**
- Create: `src/lib/access.ts`, `src/lib/access.test.ts`, `src/components/InviteCard.tsx`
- Modify: `src/lib/api.ts`, `src/pages/Admin.tsx`

**Interfaces:**
- Consumes: the HTTP routes from Task 3.
- Produces: `accessStatus(u: { banned: boolean; emailVerified: boolean }): AccessStatus`, `ACCESS_LABEL: Record<AccessStatus, string>`; `api.adminInvite`, `api.adminBan`, `api.adminUnban`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ACCESS_LABEL, accessStatus } from "./access";

describe("accessStatus", () => {
  it("is revoked when banned, whatever else", () => {
    expect(accessStatus({ banned: true, emailVerified: true })).toBe("revoked");
    expect(accessStatus({ banned: true, emailVerified: false })).toBe("revoked");
  });

  it("is pending until the first sign-in, then active", () => {
    expect(accessStatus({ banned: false, emailVerified: false })).toBe("pending");
    expect(accessStatus({ banned: false, emailVerified: true })).toBe("active");
  });

  it("has a Czech label for each status", () => {
    expect(ACCESS_LABEL).toEqual({ active: "Aktivní", pending: "Čeká na přihlášení", revoked: "Bez přístupu" });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --project app src/lib/access.test.ts`
Expected: FAIL with "Failed to resolve import ./access".

- [ ] **Step 3: Implement the status helper**

Create `src/lib/access.ts`:

```ts
export type AccessStatus = "active" | "pending" | "revoked";

/** Pending = invited but never signed in; revoked = banned by an admin. */
export function accessStatus(u: { banned: boolean; emailVerified: boolean }): AccessStatus {
  if (u.banned) return "revoked";
  return u.emailVerified ? "active" : "pending";
}

export const ACCESS_LABEL: Record<AccessStatus, string> = {
  active: "Aktivní",
  pending: "Čeká na přihlášení",
  revoked: "Bez přístupu",
};
```

Run: `npx vitest run --project app src/lib/access.test.ts`
Expected: PASS.

- [ ] **Step 4: Add the API client calls**

In `src/lib/api.ts`, replace `AdminUser`:

```ts
export type AdminUser = {
  id: string;
  email: string;
  createdAt: string;
  balance: number;
  generated: number;
  role: string | null;
  banned: boolean;
  emailVerified: boolean;
};
```

and add to the `api` object after `adminGrant`:

```ts
  adminInvite: (email: string) => request<{ email: string; resent: boolean }>("/admin/invites", send("POST", { email })),
  adminBan: (id: string) => request<void>(`/admin/users/${id}/ban`, { method: "POST" }),
  adminUnban: (id: string) => request<void>(`/admin/users/${id}/unban`, { method: "POST" }),
```

- [ ] **Step 5: Add the invite card**

Create `src/components/InviteCard.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

/** Creates the account and emails a link to the app. Inviting a pending user again resends. */
export function InviteCard({ onInvited }: { onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { email: invited, resent } = await api.adminInvite(email.trim());
      setMessage(resent ? `Pozvánka znovu odeslána na ${invited}.` : `Pozvánka odeslána na ${invited}.`);
      setEmail("");
      onInvited();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Nepovedlo se.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-lg font-extrabold">Pozvat</h2>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label htmlFor="i-email">E-mail</Label>
          <Input id="i-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" disabled={busy || !email}>
          Poslat pozvánku
        </Button>
        {message && <p className="text-sm text-muted">{message}</p>}
      </form>
    </Card>
  );
}
```

- [ ] **Step 6: Update the admin page**

Replace `src/pages/Admin.tsx` with:

```tsx
import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { Button } from "@/components/ui/button";
import { EngineSettings } from "@/components/EngineSettings";
import { InviteCard } from "@/components/InviteCard";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { useMe } from "@/hooks/useMe";
import { ACCESS_LABEL, accessStatus, type AccessStatus } from "@/lib/access";
import { api, ApiError, type AdminUser } from "@/lib/api";
import { cn } from "@/lib/utils";

const dateFmt = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });

const statusClass: Record<AccessStatus, string> = { active: "text-brand", pending: "text-muted", revoked: "text-danger" };

type AccessAction = "resend" | "ban" | "unban";

const done: Record<AccessAction, (email: string) => string> = {
  resend: (email) => `Pozvánka znovu odeslána na ${email}.`,
  ban: (email) => `${email} už nemá přístup.`,
  unban: (email) => `${email} má znovu přístup.`,
};

export function Admin() {
  const { me, refresh } = useMe();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState(20);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => api.adminUsers().then(setUsers, () => setUsers([]));
  useEffect(() => {
    if (me?.isAdmin) void load();
  }, [me?.isAdmin]);

  if (me && !me.isAdmin) return <Navigate to="/" replace />;

  async function grant(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      const { balance } = await api.adminGrant(email.trim(), amount, note);
      setMessage(`Hotovo, ${email} má teď ${balance}.`);
      setNote("");
      await load();
      if (email.trim().toLowerCase() === me?.user.email.toLowerCase()) await refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? (err.status === 404 ? "Tento e-mail nikdo nepoužívá. Nejdřív ho pozvěte." : err.message) : "Nepovedlo se.");
    }
  }

  async function changeAccess(u: AdminUser, action: AccessAction) {
    if (action === "ban" && !confirm(`Odebrat přístup pro ${u.email}? Přihlášení na všech zařízeních skončí.`)) return;
    setBusyId(u.id);
    setAccessMessage(null);
    try {
      if (action === "resend") await api.adminInvite(u.email);
      else if (action === "ban") await api.adminBan(u.id);
      else await api.adminUnban(u.id);
      setAccessMessage(done[action](u.email));
      await load();
    } catch (err) {
      setAccessMessage(err instanceof ApiError ? err.message : "Nepovedlo se.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section>
        <h1 className="mb-3 text-2xl font-extrabold">Uživatelé</h1>
        {accessMessage && <p className="mb-3 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">{accessMessage}</p>}
        {users === null ? (
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="px-4 py-2">E-mail</th>
                  <th className="px-4 py-2">Stav</th>
                  <th className="px-4 py-2 text-right">Kredity</th>
                  <th className="px-4 py-2 text-right">Obrázků</th>
                  <th className="px-4 py-2">Od</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((u) => {
                  const status = accessStatus(u);
                  const busy = busyId === u.id;
                  return (
                    <tr key={u.id}>
                      <td className="px-4 py-2">
                        <button type="button" className="hover:text-brand" onClick={() => setEmail(u.email)}>
                          {u.email}
                        </button>
                      </td>
                      <td className={cn("whitespace-nowrap px-4 py-2", statusClass[status])}>{ACCESS_LABEL[status]}</td>
                      <td className="px-4 py-2 text-right font-bold">{u.balance}</td>
                      <td className="px-4 py-2 text-right">{u.generated}</td>
                      <td className="px-4 py-2 text-muted">{dateFmt.format(new Date(u.createdAt))}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        {u.id !== me?.user.id &&
                          (status === "revoked" ? (
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => changeAccess(u, "unban")}>
                              Vrátit přístup
                            </Button>
                          ) : (
                            <>
                              {status === "pending" && (
                                <Button size="sm" variant="ghost" disabled={busy} onClick={() => changeAccess(u, "resend")}>
                                  Poslat znovu
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" className="text-danger" disabled={busy} onClick={() => changeAccess(u, "ban")}>
                                Odebrat přístup
                              </Button>
                            </>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Přístup mají jen pozvaní. Přihlašují se odkazem z e-mailu, bez hesla.</p>
      </section>
      <div className="space-y-6">
        <InviteCard onInvited={() => void load()} />
        <Card>
          <h2 className="mb-3 text-lg font-extrabold">Přidat kredity</h2>
          <form onSubmit={grant} className="space-y-3">
            <div>
              <Label htmlFor="g-email">E-mail</Label>
              <Input id="g-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="g-amount">Počet (záporný odebere)</Label>
              <Input id="g-amount" type="number" min={-1000} max={1000} required value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="g-note">Poznámka</Label>
              <Input id="g-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={!email || !amount}>
              Připsat
            </Button>
            {message && <p className="text-sm text-muted">{message}</p>}
          </form>
        </Card>
        <EngineSettings />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Run the checks**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src
git commit -m "Show access status in /admin with invite, revoke and restore actions"
```

---

### Task 5: Login page prefill and link errors

**Files:**
- Create: `src/pages/Login.test.tsx`
- Modify: `src/pages/Login.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/pages/Login.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Login } from "./Login";

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Login />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe("Login", () => {
  it("prefills the email from an invitation link", () => {
    renderAt("/?email=ucitelka%40example.com");
    expect((screen.getByLabelText("E-mail") as HTMLInputElement).value).toBe("ucitelka@example.com");
  });

  it("explains an expired or used link", () => {
    renderAt("/?error=INVALID_TOKEN");
    expect(screen.getByText("Odkaz už neplatí nebo byl použitý. Pošlete si nový.")).toBeTruthy();
  });

  it("shows a generic message for other sign-in errors", () => {
    renderAt("/?error=new_user_signup_disabled");
    expect(screen.getByText("Přihlášení se nepovedlo. Zkuste to prosím znovu.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --project app src/pages/Login.test.tsx`
Expected: FAIL. The input is empty and the messages are not found.

- [ ] **Step 3: Implement**

In `src/pages/Login.tsx`, change the React and router imports and the state at the top of `Login`:

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
```

```tsx
// Better Auth sends people back here with ?error=... when a link fails.
const LINK_ERRORS: Record<string, string> = {
  INVALID_TOKEN: "Odkaz už neplatí nebo byl použitý. Pošlete si nový.",
};

export function Login() {
  const [params, setParams] = useSearchParams();
  // The invitation email links here with ?email=...
  const [email, setEmail] = useState(() => params.get("email") ?? "");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const code = params.get("error");
    return code ? (LINK_ERRORS[code] ?? "Přihlášení se nepovedlo. Zkuste to prosím znovu.") : null;
  });

  // Read once: a reload should not show the error again.
  useEffect(() => {
    if (params.has("email") || params.has("error")) setParams({}, { replace: true });
  }, [params, setParams]);
```

The rest of the component stays as it is; the existing `{error && ...}` paragraph renders the message.

- [ ] **Step 4: Run the checks**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages
git commit -m "Prefill the login email from invites and explain expired links"
```

---

### Task 6: `make-admin` script, env cleanup and docs

**Files:**
- Create: `worker/make-admin.ts`, `worker/make-admin.test.ts`, `scripts/make-admin.ts`
- Modify: `package.json`, `tsconfig.node.json`, `.dev.vars.example`, `wrangler.jsonc`, `worker/worker-configuration.d.ts`, `README.md`

**Interfaces:**
- Consumes: `invite`, `signIn`, `api` test helpers.
- Produces: `makeAdminSql(email: string): string` in `worker/make-admin.ts`; `npm run make-admin -- <email> [--remote]`.

- [ ] **Step 1: Write the failing test**

Create `worker/make-admin.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { makeAdminSql } from "./make-admin";
import { api, invite, signIn } from "./test/session";

const run = (email: string) => env.DB.prepare(makeAdminSql(email)).run();
const user = (email: string) =>
  env.DB.prepare(`SELECT role, banned FROM "user" WHERE email = ?`).bind(email).first<{ role: string; banned: number }>();

describe("makeAdminSql", () => {
  it("creates an admin who can sign in and open /admin", async () => {
    await run(" Boss@Example.com ");
    const cookie = await signIn("boss@example.com");
    const me = (await (await api("/me", { cookie })).json()) as { isAdmin: boolean; balance: number };
    expect(me.isAdmin).toBe(true);
    expect(me.balance).toBe(5);
    expect((await api("/admin/users", { cookie })).status).toBe(200);
  });

  it("promotes and unbans an existing user", async () => {
    await invite("demoted@example.com");
    await env.DB.prepare(`UPDATE "user" SET banned = 1 WHERE email = 'demoted@example.com'`).run();
    await run("demoted@example.com");
    expect(await user("demoted@example.com")).toEqual({ role: "admin", banned: 0 });
  });

  it("refuses anything that is not an email address", () => {
    expect(() => makeAdminSql("x'); DROP TABLE user; --")).toThrow();
    expect(() => makeAdminSql("")).toThrow();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --project worker worker/make-admin.test.ts`
Expected: FAIL with "Failed to resolve import ./make-admin".

- [ ] **Step 3: Implement the SQL builder**

Create `worker/make-admin.ts`:

```ts
/**
 * SQL that makes `email` an admin: inserts the user, or promotes and unbans an
 * existing one. Written the way Better Auth writes users (lowercased email, ISO
 * timestamps, 0/1 booleans) so the new admin can sign in. Used by
 * `npm run make-admin`; no Workers types, so plain Node can import it.
 */
export function makeAdminSql(email: string): string {
  const e = email.trim().toLowerCase();
  // Quotes can't appear in a valid address, which also keeps the literal safe.
  if (!/^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/.test(e)) throw new Error(`Not an email address: ${email}`);
  const now = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
  return `INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt, role, banned)
VALUES (lower(hex(randomblob(16))), '', '${e}', 0, NULL, ${now}, ${now}, 'admin', 0)
ON CONFLICT (email) DO UPDATE SET role = 'admin', banned = 0, banReason = NULL, banExpires = NULL, updatedAt = ${now};`;
}
```

Run: `npx vitest run --project worker worker/make-admin.test.ts`
Expected: PASS.

- [ ] **Step 4: Add the CLI**

Create `scripts/make-admin.ts`:

```ts
// Makes an email an admin, creating the user if needed. Sets up the first
// admin, and gets back in if the last one is locked out.
//   npm run make-admin -- you@example.com            (local D1)
//   npm run make-admin -- you@example.com --remote   (production D1)
import { execFileSync } from "node:child_process";
import { makeAdminSql } from "../worker/make-admin.ts";

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
if (!email) {
  console.error("Usage: npm run make-admin -- <email> [--remote]");
  process.exit(1);
}
const target = args.includes("--remote") ? "--remote" : "--local";
execFileSync("npx", ["wrangler", "d1", "execute", "firstread", target, "--command", makeAdminSql(email)], { stdio: "inherit" });
```

`package.json`, in `scripts` after `db:migrate:remote`:

```json
    "make-admin": "node scripts/make-admin.ts"
```

`tsconfig.node.json`: add `"allowImportingTsExtensions": true` to `compilerOptions` and `"scripts"` to `include`:

```json
  "include": ["vite.config.ts", "vitest.config.ts", "drizzle.config.ts", "e2e", "scripts"]
```

- [ ] **Step 5: Try the script against local D1**

```bash
npm run db:migrate:local
npm run make-admin -- you@example.com
npm run make-admin -- you@example.com
npx wrangler d1 execute firstread --local --command "SELECT email, role, banned, emailVerified, createdAt FROM \"user\""
```

Expected: both runs succeed (the second takes the `ON CONFLICT` path), and the query shows one `you@example.com` row with `role = admin`, `banned = 0`, `emailVerified = 0` and an ISO `createdAt`. Then remove the local state so it does not leak into later work: `rm -rf .wrangler/state`.

- [ ] **Step 6: Remove the env lists from config and typings**

`.dev.vars.example`: delete the last three lines (the comment about allowed addresses, `ALLOWED_EMAILS=...`, `ADMIN_EMAILS=...`).

`worker/worker-configuration.d.ts`: delete the lines `ALLOWED_EMAILS: string;` and `ADMIN_EMAILS: string;`, and remove `| "ALLOWED_EMAILS" | "ADMIN_EMAILS"` from the `ProcessEnv` `Pick` union.

`wrangler.jsonc`: the secrets comment becomes:

```jsonc
  // Non-secret settings. Secrets (BETTER_AUTH_SECRET, RESEND_API_KEY,
  // OPENAI_API_KEY, GEMINI_API_KEY) go in via `wrangler secret put` in
  // production and `.dev.vars` locally.
```

- [ ] **Step 7: Update the README**

In `README.md`:

- Stack, the auth bullet: `- **Auth:** Better Auth, passwordless magic links (sent with Resend), invite-only. Admins invite people at \`/admin\`.`
- Local development block:

```bash
npm install
cp .dev.vars.example .dev.vars        # IMAGE_PROVIDER=mock
npm run db:migrate:local
npm run make-admin -- you@example.com # your local account, as admin
npm run dev                           # http://localhost:5173
```

- Secrets table: delete the `ALLOWED_EMAILS` and `ADMIN_EMAILS` rows, and the sentence "The two email lists are secrets, not vars, so they never land in this public repo."
- Add a section after "Configuration":

```markdown
## Access

- **Invite-only.** An admin enters an email at `/admin`. That creates the account (with the welcome credits) and emails a link to the app with the address prefilled. The person then signs in with a magic link.
- **Status** in `/admin`: *Čeká na přihlášení* until the first sign-in, then *Aktivní*.
- **Revoking access** (*Odebrat přístup*) is a Better Auth ban. It ends all of the user's sessions, and no new link is sent. Sheets and images stay. *Vrátit přístup* undoes it.
- **Admins** are users with the `admin` role. `npm run make-admin -- <email>` makes one locally, `--remote` in production, creating the user if needed. It is also the way back in if the last admin is locked out.
```

- Deploying, step 6: `6. Set the secrets from the table above (\`npx wrangler secret put ...\`).` stays; step 10 becomes: `10. Make yourself admin with \`npm run make-admin -- <your email> --remote\`, sign in, then invite people and top up credits at \`/admin\`.`

- [ ] **Step 8: Run all checks**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all PASS. `grep -rn "ALLOWED_EMAILS\|ADMIN_EMAILS" --exclude-dir=node_modules --exclude-dir=docs .` prints nothing.

- [ ] **Step 9: Commit**

```bash
git add worker/make-admin.ts worker/make-admin.test.ts scripts package.json tsconfig.node.json .dev.vars.example wrangler.jsonc worker/worker-configuration.d.ts README.md
git commit -m "Add make-admin and drop the ALLOWED_EMAILS/ADMIN_EMAILS secrets"
```

---

## Production rollout (for the PR description, not a code task)

1. `npm run db:migrate:remote`
2. `npm run make-admin -- <owner email> --remote`
3. Deploy.
4. In `/admin`, invite everyone from the old `ALLOWED_EMAILS` who never signed in.
5. Delete the `ALLOWED_EMAILS` and `ADMIN_EMAILS` secrets.
