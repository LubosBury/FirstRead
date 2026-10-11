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

const cache = new WeakMap<Env, ReturnType<typeof createAuth>>();

function createAuth(env: Env) {
  return betterAuth(authOptions(env));
}

/** One instance per isolate: building Better Auth on every request costs CPU. */
export function getAuth(env: Env) {
  let auth = cache.get(env);
  if (!auth) {
    auth = createAuth(env);
    cache.set(env, auth);
  }
  return auth;
}
