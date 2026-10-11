import { Hono } from "hono";
import { requireUser, type AppEnv } from "./app";
import { getAuth } from "./auth";
import { refundStaleGenerations } from "./credits";
import { admin } from "./routes/admin";
import { generations } from "./routes/generations";
import { images } from "./routes/images";
import { me } from "./routes/me";
import { sheets } from "./routes/sheets";

const app = new Hono<AppEnv>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));

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
