import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin } from "better-auth/plugins/admin";
import { magicLink } from "better-auth/plugins/magic-link";
import { appleClientSecret, appleConfig, isAppleRelayEmail } from "./apple";
import { ensureWallet } from "./credits";
import { intVar } from "./env";
import { inviteLink } from "./invite-link";
import { magicLinkMail, sendMail } from "./mail";

/** Invite-only: a link goes only to a user an admin created and hasn't banned. */
async function mayRequestLink(db: D1Database, email: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM "user" WHERE lower(email) = ? AND COALESCE(banned, 0) = 0`)
    .bind(email.trim().toLowerCase())
    .first();
  return row !== null;
}

const APPLE_ORIGIN = "https://appleid.apple.com";

/** `apple` is the Services ID and a signed client secret; leave it out to turn Apple off. */
export function authOptions(env: Env, apple?: { clientId: string; clientSecret: string }) {
  return {
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    basePath: "/api/auth",
    // Apple posts the sign-in result back to us from its own origin.
    trustedOrigins: apple ? [env.APP_URL, APPLE_ORIGIN] : [env.APP_URL],
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
    user: {
      // Accounts come from invites only: Apple may sign in to one, never create
      // one. Better Auth asks this before it would create a user from Apple.
      validateUserInfo: ({ user, source }) => {
        if (source.action !== "create-user" || source.method !== "oauth") return;
        if (isAppleRelayEmail(user.email ?? "")) {
          return { error: "APPLE_PRIVATE_EMAIL", errorDescription: "Apple hid the email, so it cannot match an invite." };
        }
        return { error: "NOT_INVITED", errorDescription: "This email is not invited." };
      },
    },
    socialProviders: apple ? { apple: { clientId: apple.clientId, clientSecret: apple.clientSecret } } : {},
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
      inviteLink(),
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

const build = (...args: Parameters<typeof authOptions>) => betterAuth(authOptions(...args));
type Auth = ReturnType<typeof build>;

// Rebuild a day before the Apple client secret runs out.
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;

type Entry = { auth: Auth; apple: boolean; renewAt: number };
const cache = new WeakMap<Env, Entry>();

/**
 * Better Auth starts its setup (a D1 schema check) without waiting for it, and
 * every later query waits on that same promise. Finish it in the request that
 * builds the instance: a request that ends first leaves it pending for good,
 * and every sign-in in the isolate hangs.
 */
async function ready(auth: Auth): Promise<Auth> {
  await (await auth.$context).checkSchema?.();
  return auth;
}

async function createAuth(env: Env): Promise<Entry> {
  const config = appleConfig(env);
  if (config) {
    let secret: { secret: string; expiresAt: number } | null = null;
    try {
      secret = await appleClientSecret(config);
    } catch (err) {
      // A badly pasted key must not take magic links down with it.
      console.error("Sign in with Apple is off: cannot sign the client secret", err);
    }
    if (secret) {
      return {
        auth: await ready(build(env, { clientId: config.clientId, clientSecret: secret.secret })),
        apple: true,
        renewAt: secret.expiresAt - RENEW_BEFORE_MS,
      };
    }
  }
  return { auth: await ready(build(env)), apple: false, renewAt: Infinity };
}

/** One instance per isolate: building Better Auth on every request costs CPU. */
async function authEntry(env: Env): Promise<Entry> {
  let entry = cache.get(env);
  if (!entry || Date.now() >= entry.renewAt) {
    entry = await createAuth(env);
    cache.set(env, entry);
  }
  return entry;
}

export const getAuth = async (env: Env) => (await authEntry(env)).auth;

/** Configured and the key signs; the sign-in page shows the button only then. */
export const appleEnabled = async (env: Env) => (await authEntry(env)).apple;
