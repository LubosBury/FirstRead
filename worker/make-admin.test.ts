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
