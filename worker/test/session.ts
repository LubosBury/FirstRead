import { exports } from "cloudflare:workers";
import { vi } from "vitest";

export const ORIGIN = "http://localhost";

export function api(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", ORIGIN);
  if (init.cookie) headers.set("Cookie", init.cookie);
  return exports.default.fetch(new Request(`${ORIGIN}/api${path}`, { ...init, headers }));
}

export const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * Signs in like a person would: request a link, "open the email" (locally the
 * mailer prints it), follow the link, keep the cookies.
 */
export async function signIn(email: string): Promise<string> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const res = await api("/auth/sign-in/magic-link", json({ email, callbackURL: "/" }));
    if (res.status !== 200) throw new Error(`sign-in ${res.status}: ${await res.text()}`);
    const printed = log.mock.calls.map((c) => String(c[0])).find((s) => s.includes(`to=${email}`));
    const link = printed?.match(/https?:\/\/\S+/)?.[0];
    if (!link) throw new Error("no magic link was sent");
    const url = new URL(link);
    const verify = await api(url.pathname.replace(/^\/api/, "") + url.search, { redirect: "manual" });
    const cookies = verify.headers.getSetCookie().map((c) => c.split(";")[0]);
    if (!cookies.length) throw new Error(`verify ${verify.status} set no cookie`);
    return cookies.join("; ");
  } finally {
    log.mockRestore();
  }
}
