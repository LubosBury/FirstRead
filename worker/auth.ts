import { betterAuth, type BetterAuthOptions } from "better-auth";
import { magicLink } from "better-auth/plugins/magic-link";
import { appleClientSecret, appleConfig, isAppleRelayEmail } from "./apple";
import { isAllowedEmail } from "./env";
import { magicLinkMail, sendMail } from "./mail";

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
    user: {
      // Invite-only for every sign-in method. Better Auth calls this before it
      // creates a user, links Apple to an existing one, and on every Apple
      // sign-in with the email Apple reports now.
      validateUserInfo: ({ user, source }) => {
        const email = user.email ?? "";
        if (isAllowedEmail(env, email)) return;
        if (source.oauth?.providerId === "apple" && isAppleRelayEmail(email)) {
          return { error: "apple_private_email", errorDescription: "Apple hid the email, so it cannot match an invite." };
        }
        return { error: "not_invited", errorDescription: "This email is not invited." };
      },
    },
    socialProviders: apple ? { apple: { clientId: apple.clientId, clientSecret: apple.clientSecret } } : {},
    plugins: [
      magicLink({
        expiresIn: 60 * 15,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          // The route rejects unknown addresses before we get here; this is the
          // backstop so no code path mails a stranger.
          if (!isAllowedEmail(env, email)) return;
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
