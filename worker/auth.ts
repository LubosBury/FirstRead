import { betterAuth, type BetterAuthOptions } from "better-auth";
import { magicLink } from "better-auth/plugins/magic-link";
import { isAllowedEmail } from "./env";
import { magicLinkMail, sendMail } from "./mail";

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
