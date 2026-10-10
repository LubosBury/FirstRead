import { Hono } from "hono";
import { requireUser, type AppEnv } from "./app";
import { getAuth } from "./auth";
import { refundStaleGenerations } from "./credits";
import { isAllowedEmail } from "./env";
import { admin } from "./routes/admin";
import { generations } from "./routes/generations";
import { images } from "./routes/images";
import { me } from "./routes/me";
import { sheets } from "./routes/sheets";

const app = new Hono<AppEnv>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));

// Invite-only: say so up front instead of letting someone wait for an email
// that will never come. (The mailer itself also refuses unknown addresses.)
app.post("/auth/sign-in/magic-link", async (c) => {
  const body = (await c.req.raw.clone().json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email : "";
  if (!isAllowedEmail(c.env, email)) {
    return c.json({ error: "not_invited", message: "Tento e-mail zatím nemá přístup. Požádejte o pozvánku." }, 403);
  }
  return getAuth(c.env).handler(c.req.raw);
});
app.on(["GET", "POST"], "/auth/*", (c) => getAuth(c.env).handler(c.req.raw));

const authed = new Hono<AppEnv>();
authed.use("*", requireUser);
authed.route("/", me);
authed.route("/", sheets);
authed.route("/", images);
authed.route("/", generations);
authed.route("/", admin);
app.route("/", authed);

app.onError((err, c) => {
  console.error("unhandled", err);
  return c.json({ error: "internal", message: "Něco se pokazilo. Zkuste to prosím znovu." }, 500);
});

const STALE_AFTER_MS = 10 * 60_000;

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(refundStaleGenerations(env.DB, STALE_AFTER_MS).then((n) => n && console.log(`refunded ${n} stale generations`)));
  },
} satisfies ExportedHandler<Env>;
