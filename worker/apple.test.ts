import { env } from "cloudflare:test";
import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appleClientSecret, appleConfig, type AppleConfig } from "./apple";
import { appleEnabled, getAuth } from "./auth";
import { api, json, signIn } from "./test/session";

const APPLE = "https://appleid.apple.com";
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString()) as Record<string, unknown>;
const cookiesOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]);

async function newKey() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  const b64 = Buffer.from(der).toString("base64");
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;
  return { pem, b64, publicKey: pair.publicKey };
}

describe("appleConfig", () => {
  const full = { APPLE_CLIENT_ID: "id", APPLE_TEAM_ID: "team", APPLE_KEY_ID: "key", APPLE_PRIVATE_KEY: "pem" };

  it("is on only when all four values are set", () => {
    expect(appleConfig(full as unknown as Env)).toEqual({ clientId: "id", teamId: "team", keyId: "key", privateKey: "pem" });
    for (const name of Object.keys(full)) {
      expect(appleConfig({ ...full, [name]: " " } as unknown as Env)).toBeNull();
      expect(appleConfig({ ...full, [name]: undefined } as unknown as Env)).toBeNull();
    }
  });
});

describe("appleClientSecret", () => {
  it("signs an ES256 JWT that Apple's token endpoint accepts", async () => {
    const { pem, publicKey } = await newKey();
    const config: AppleConfig = { clientId: "com.example.web", teamId: "TEAM123456", keyId: "KEY1234567", privateKey: pem };
    const now = Date.UTC(2026, 9, 11);
    const { secret, expiresAt } = await appleClientSecret(config, now);

    const [header, claims, signature] = secret.split(".");
    expect(decode(header)).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(decode(claims)).toEqual({
      iss: "TEAM123456",
      iat: now / 1000,
      exp: now / 1000 + 30 * 24 * 60 * 60,
      aud: APPLE,
      sub: "com.example.web",
    });
    expect(expiresAt).toBe(now + 30 * 24 * 60 * 60 * 1000);
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      Buffer.from(signature, "base64url"),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
  });

  it("takes the key however it was pasted", async () => {
    const { pem, b64 } = await newKey();
    for (const privateKey of [b64, pem.replace(/\n/g, "\\n")]) {
      const config: AppleConfig = { clientId: "c", teamId: "t", keyId: "k", privateKey };
      await expect(appleClientSecret(config)).resolves.toMatchObject({ secret: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/) });
    }
  });
});

// The whole browser round trip, with Apple's token endpoint faked: start on our
// sign-in page, Apple posts the result back, the browser follows to the callback.
async function appleSignIn(email: string, opts: { user?: unknown; sub?: string } = {}) {
  const tokenRequests: URLSearchParams[] = [];
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== `${APPLE}/auth/token`) return realFetch(input, init);
    tokenRequests.push(new URLSearchParams(String(init?.body)));
    const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const idToken = [
      part({ alg: "RS256", kid: "test" }),
      part({ iss: APPLE, aud: env.APPLE_CLIENT_ID, sub: opts.sub ?? `apple-${email}`, email, email_verified: "true" }),
      "signature",
    ].join(".");
    return Response.json({ access_token: "at", token_type: "Bearer", expires_in: 3600, refresh_token: "rt", id_token: idToken });
  });

  const start = await api("/auth/sign-in/social", json({ provider: "apple", callbackURL: "/", errorCallbackURL: "/login" }));
  expect(start.status).toBe(200);
  const authorize = new URL(((await start.json()) as { url: string }).url);
  expect(`${authorize.origin}${authorize.pathname}`).toBe(`${APPLE}/auth/authorize`);
  expect(authorize.searchParams.get("response_mode")).toBe("form_post");

  const form = new URLSearchParams({ code: "apple-code", state: authorize.searchParams.get("state")! });
  if (opts.user) form.set("user", JSON.stringify(opts.user));
  const posted = await api("/auth/callback/apple", {
    method: "POST",
    headers: { Origin: APPLE, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    redirect: "manual",
  });
  expect(posted.status).toBe(302);
  const callback = new URL(posted.headers.get("Location")!);

  const done = await api(callback.pathname.replace(/^\/api/, "") + callback.search, {
    cookie: cookiesOf(start).join("; "),
    redirect: "manual",
  });
  expect(done.status).toBe(302);
  const session = cookiesOf(done).filter((c) => c.startsWith("better-auth.session_token="));
  return { location: done.headers.get("Location")!, cookie: session.join("; "), tokenRequests };
}

const me = async (cookie: string) =>
  (await (await api("/me", { cookie })).json()) as { user: { id: string; email: string; name: string } };

const userCount = async (email: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM "user" WHERE email = ?`).bind(email).first<{ n: number }>())!.n;

describe("Sign in with Apple", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is offered on the sign-in page once configured", async () => {
    expect(await (await api("/login-methods")).json()).toEqual({ apple: true });
  });

  it("switches only itself off when the key is broken", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { ...env, APPLE_PRIVATE_KEY: "pasted the wrong file" };
    expect(await appleEnabled(broken)).toBe(false);
    expect(error).toHaveBeenCalled();
    // Magic links and sessions keep working.
    expect(await (await getAuth(broken)).api.getSession({ headers: new Headers() })).toBeNull();
  });

  it("signs an invited teacher in and keeps the name Apple sends only the first time", async () => {
    const first = await appleSignIn("apple@example.com", { user: { name: { firstName: "Jana", lastName: "Nováková" } } });
    expect(first.location).toBe("/");
    expect((await me(first.cookie)).user).toMatchObject({ email: "apple@example.com", name: "Jana Nováková" });

    vi.restoreAllMocks();
    const again = await appleSignIn("apple@example.com");
    expect((await me(again.cookie)).user).toMatchObject({ email: "apple@example.com", name: "Jana Nováková" });
    expect(await userCount("apple@example.com")).toBe(1);
  });

  it("authenticates to Apple with a client secret signed by the configured key", async () => {
    const { tokenRequests } = await appleSignIn("apple@example.com");
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0].get("client_id")).toBe("com.example.firstread.web");
    const [header, claims] = tokenRequests[0].get("client_secret")!.split(".");
    expect(decode(header)).toMatchObject({ alg: "ES256", kid: "KEY1234567" });
    expect(decode(claims)).toMatchObject({ iss: "TEAM123456", sub: "com.example.firstread.web", aud: APPLE });
  });

  it("joins the account a teacher already has from a magic link", async () => {
    const before = await me(await signIn("linked@example.com"));
    const viaApple = await appleSignIn("linked@example.com");
    expect((await me(viaApple.cookie)).user.id).toBe(before.user.id);
  });

  it("turns away an Apple account whose email is not invited", async () => {
    const res = await appleSignIn("stranger@example.com");
    expect(new URL(res.location, "http://localhost").pathname).toBe("/login");
    expect(new URL(res.location, "http://localhost").searchParams.get("error")).toBe("not_invited");
    expect(res.cookie).toBe("");
    expect(await userCount("stranger@example.com")).toBe(0);
  });

  it("says so when Apple hid the email", async () => {
    const res = await appleSignIn("x7k2p9@privaterelay.appleid.com");
    expect(new URL(res.location, "http://localhost").searchParams.get("error")).toBe("apple_private_email");
    expect(res.cookie).toBe("");
  });
});
