import type { Context, MiddlewareHandler } from "hono";
import { getAuth } from "./auth";

export type SessionUser = { id: string; email: string; name: string };
export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
export type AppContext = Context<AppEnv>;

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await getAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized", message: "Přihlaste se prosím." }, 401);
  c.set("user", { id: session.user.id, email: session.user.email, name: session.user.name });
  await next();
};

export const badRequest = (c: AppContext, message: string) => c.json({ error: "bad_request", message }, 400);
export const notFound = (c: AppContext) => c.json({ error: "not_found", message: "Nenalezeno." }, 404);
