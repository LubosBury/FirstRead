import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MOCK_ICON_PNG_B64 } from "./imaging/fixtures";
import { fromBase64 } from "./imaging/base64";
import worker from "./index";
import { api, json, signIn } from "./test/session";

const PNG = fromBase64(MOCK_ICON_PNG_B64);
const upload = (cookie: string, body: Uint8Array | string, type = "image/png") =>
  api("/images", { method: "POST", cookie, headers: { "Content-Type": type }, body });

let teacher: string;
let other: string;
let admin: string;

beforeAll(async () => {
  teacher = await signIn("teacher@example.com");
  other = await signIn("other@example.com");
  admin = await signIn("admin@example.com");
});

describe("auth", () => {
  it("refuses to send a link to an address that is not invited", async () => {
    const res = await api("/auth/sign-in/magic-link", json({ email: "stranger@example.com", callbackURL: "/" }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("not_invited");
  });

  it("requires a session for the app API", async () => {
    expect((await api("/me")).status).toBe(401);
  });
});

describe("/me", () => {
  it("returns the user with their welcome credits", async () => {
    const me = (await (await api("/me", { cookie: teacher })).json()) as Record<string, unknown>;
    expect(me).toMatchObject({
      user: { email: "teacher@example.com" },
      balance: 5,
      isAdmin: false,
      costs: { main: 1, icon: 1 },
    });
  });

  it("flags admins", async () => {
    const me = (await (await api("/me", { cookie: admin })).json()) as { isAdmin: boolean };
    expect(me.isAdmin).toBe(true);
  });
});

describe("sheets", () => {
  it("saves, lists, updates and deletes a sheet for its owner only", async () => {
    const params = { title: "Čtenářská výzva na říjen", count: 31 };
    const created = await api("/sheets", { ...json({ templateId: "reading-challenge", title: "Říjen", params }), cookie: teacher });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const list = (await (await api("/sheets", { cookie: teacher })).json()) as { id: string; title: string }[];
    expect(list.find((s) => s.id === id)?.title).toBe("Říjen");

    expect((await api(`/sheets/${id}`, { cookie: other })).status).toBe(404);

    const put = await api(`/sheets/${id}`, { ...json({ title: "Říjen 2", params: { ...params, count: 30 } }), method: "PUT", cookie: teacher });
    expect(put.status).toBe(200);
    const got = (await (await api(`/sheets/${id}`, { cookie: teacher })).json()) as { title: string; params: { count: number } };
    expect(got).toMatchObject({ title: "Říjen 2", params: { count: 30 } });

    expect((await api(`/sheets/${id}`, { method: "DELETE", cookie: other })).status).toBe(404);
    expect((await api(`/sheets/${id}`, { method: "DELETE", cookie: teacher })).status).toBe(204);
    expect((await api(`/sheets/${id}`, { cookie: teacher })).status).toBe(404);
  });

  it("rejects oversized params", async () => {
    const res = await api("/sheets", {
      ...json({ templateId: "reading-challenge", title: "x", params: { blob: "x".repeat(40_000) } }),
      cookie: teacher,
    });
    expect(res.status).toBe(400);
  });
});

describe("images", () => {
  it("stores an upload and serves it to its owner only", async () => {
    const res = await upload(teacher, PNG);
    expect(res.status).toBe(201);
    const image = (await res.json()) as { id: string; url: string; origin: string };
    expect(image.origin).toBe("upload");

    const own = await api(`/images/${image.id}`, { cookie: teacher });
    expect(own.status).toBe(200);
    expect(own.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await own.arrayBuffer())).toEqual(PNG);

    expect((await api(`/images/${image.id}`, { cookie: other })).status).toBe(404);

    const list = (await (await api("/images", { cookie: teacher })).json()) as { id: string }[];
    expect(list.some((i) => i.id === image.id)).toBe(true);
  });

  it("rejects files that are not images", async () => {
    expect((await upload(teacher, "not an image", "image/png")).status).toBe(415);
  });

  it("deletes an image and its stored file", async () => {
    const { id } = (await (await upload(teacher, PNG)).json()) as { id: string };
    expect((await api(`/images/${id}`, { method: "DELETE", cookie: other })).status).toBe(404);
    expect((await api(`/images/${id}`, { method: "DELETE", cookie: teacher })).status).toBe(204);
    expect((await api(`/images/${id}`, { cookie: teacher })).status).toBe(404);
    const objects = await env.IMAGES.list();
    expect(objects.objects.some((o) => o.key.includes(id))).toBe(false);
  });
});

describe("generations", () => {
  it("charges a credit and returns a stored image", async () => {
    const cookie = await signIn("teacher@example.com");
    const before = ((await (await api("/me", { cookie })).json()) as { balance: number }).balance;

    const res = await api("/generations", { ...json({ slot: "icon", prompt: "houbička" }), cookie });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { image: { id: string; origin: string }; balance: number };
    expect(body.image.origin).toBe("generated");
    expect(body.balance).toBe(before - 1);
    expect((await api(`/images/${body.image.id}`, { cookie })).status).toBe(200);
  });

  it("redraws an uploaded reference image", async () => {
    const { id } = (await (await upload(admin, PNG)).json()) as { id: string };
    const res = await api("/generations", { ...json({ slot: "main", prompt: "", referenceImageId: id }), cookie: admin });
    expect(res.status).toBe(201);
  });

  it("refuses someone else's reference image", async () => {
    const { id } = (await (await upload(admin, PNG)).json()) as { id: string };
    const res = await api("/generations", { ...json({ slot: "main", prompt: "x", referenceImageId: id }), cookie: other });
    expect(res.status).toBe(404);
  });

  it("refunds the credit when the provider fails", async () => {
    const before = ((await (await api("/me", { cookie: other })).json()) as { balance: number }).balance;
    const res = await api("/generations", { ...json({ slot: "icon", prompt: "[fail] houbička" }), cookie: other });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { message: string }).message).toMatch(/Kredit jsme vrátili/);
    const after = ((await (await api("/me", { cookie: other })).json()) as { balance: number }).balance;
    expect(after).toBe(before);
  });

  it("answers 402 when the credits run out", async () => {
    const cookie = await signIn("other@example.com");
    let res: Response;
    let guard = 0;
    do {
      res = await api("/generations", { ...json({ slot: "icon", prompt: "houbička" }), cookie });
      guard++;
    } while (res.status === 201 && guard < 20);
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: string }).error).toBe("insufficient_credits");
  });

  it("validates the request", async () => {
    expect((await api("/generations", { ...json({ slot: "poster", prompt: "x" }), cookie: teacher })).status).toBe(400);
    expect((await api("/generations", { ...json({ slot: "icon", prompt: "  " }), cookie: teacher })).status).toBe(400);
  });
});

describe("engine switch", () => {
  afterEach(() => vi.restoreAllMocks());

  /** Answers as the image APIs would, and records what the Worker sent. */
  function fakeProviders() {
    const calls: { url: string; body: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
      const reply = url.includes("openai.com")
        ? { data: [{ b64_json: MOCK_ICON_PNG_B64 }], usage: { output_tokens: 1 } }
        : { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: MOCK_ICON_PNG_B64 } }] } }] };
      return new Response(JSON.stringify(reply), { headers: { "Content-Type": "application/json" } });
    });
    return calls;
  }

  it("lists engines for admins only", async () => {
    const forAdmin = (await (await api("/me", { cookie: admin })).json()) as { engines?: { id: string; label: string }[] };
    expect(forAdmin.engines?.map((e) => e.id)).toEqual(["openai-low", "openai-medium"]);
    const forTeacher = (await (await api("/me", { cookie: teacher })).json()) as { engines?: unknown };
    expect(forTeacher.engines).toBeUndefined();
  });

  it("refuses an engine from a non-admin", async () => {
    const res = await api("/generations", { ...json({ slot: "icon", prompt: "x", engine: "openai-low" }), cookie: teacher });
    expect(res.status).toBe(403);
  });

  it("rejects an unknown engine", async () => {
    const res = await api("/generations", { ...json({ slot: "icon", prompt: "x", engine: "dall-e-1" }), cookie: admin });
    expect(res.status).toBe(400);
  });

  it("generates with OpenAI at low quality for an admin", async () => {
    await api("/admin/grant", { ...json({ email: "admin@example.com", amount: 10 }), cookie: admin });
    const calls = fakeProviders();
    const res = await api("/generations", { ...json({ slot: "icon", prompt: "houbička", engine: "openai-low" }), cookie: admin });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { source: { provider: string; model: string; quality: string } };
    expect(body.source).toEqual({ provider: "openai", model: env.OPENAI_IMAGE_MODEL, quality: "low" });
    expect(calls[0].url).toBe("https://api.openai.com/v1/images/generations");
    expect(JSON.parse(calls[0].body).quality).toBe("low");
  });

  it("no longer offers Gemini", async () => {
    const res = await api("/generations", { ...json({ slot: "icon", prompt: "x", engine: "gemini-nano-banana-2.1" }), cookie: admin });
    expect(res.status).toBe(400);
  });

  it("shows where each library image came from", async () => {
    const list = (await (await api("/images", { cookie: admin })).json()) as {
      origin: string;
      source: { provider: string; quality: string | null } | null;
    }[];
    expect(list.some((i) => i.source?.provider === "openai" && i.source.quality === "low")).toBe(true);
    expect(list.filter((i) => i.origin === "upload").every((i) => i.source === null)).toBe(true);
  });
});

describe("default engine setting", () => {
  afterEach(() => vi.restoreAllMocks());

  const put = (cookie: string, defaultEngine: unknown) =>
    api("/admin/settings", { ...json({ defaultEngine }), method: "PUT", cookie });

  it("is closed to non-admins", async () => {
    expect((await api("/admin/settings", { cookie: teacher })).status).toBe(403);
    expect((await put(teacher, "openai-medium")).status).toBe(403);
  });

  it("rejects an unknown engine", async () => {
    expect((await put(admin, "gemini-3.1-flash-image")).status).toBe(400);
  });

  it("starts from the configured default and can be changed", async () => {
    const before = (await (await api("/admin/settings", { cookie: admin })).json()) as { defaultEngine: string | null };
    expect(before.defaultEngine).toBeNull(); // tests run on the mock provider, which is no listed engine

    expect((await put(admin, "openai-low")).status).toBe(200);
    const after = (await (await api("/admin/settings", { cookie: admin })).json()) as {
      defaultEngine: string;
      engines: { id: string }[];
    };
    expect(after.defaultEngine).toBe("openai-low");
    expect(after.engines.map((e) => e.id)).toEqual(["openai-low", "openai-medium"]);
    const me = (await (await api("/me", { cookie: admin })).json()) as { defaultEngine: string };
    expect(me.defaultEngine).toBe("openai-low");
  });

  it("applies the chosen default to everyone's generations", async () => {
    const calls: { url: string; body: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push({ url: String(input), body: typeof init?.body === "string" ? init.body : "" });
      return new Response(JSON.stringify({ data: [{ b64_json: MOCK_ICON_PNG_B64 }] }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const cookie = await signIn("teacher@example.com");
    await api("/admin/grant", { ...json({ email: "teacher@example.com", amount: 5 }), cookie: admin });

    const res = await api("/generations", { ...json({ slot: "icon", prompt: "houbička" }), cookie });
    expect(res.status).toBe(201);
    expect(calls[0].url).toBe("https://api.openai.com/v1/images/generations");
    expect(JSON.parse(calls[0].body).quality).toBe("low");
  });

  it("charges the default engine's price and shows it on /me", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: MOCK_ICON_PNG_B64 }] }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    expect((await put(admin, "openai-medium")).status).toBe(200);
    const cookie = await signIn("teacher@example.com");
    const me = (await (await api("/me", { cookie })).json()) as { balance: number; costs: { main: number; icon: number } };
    expect(me.costs).toEqual({ main: 2, icon: 2 });

    const res = await api("/generations", { ...json({ slot: "icon", prompt: "houbička" }), cookie });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { balance: number }).balance).toBe(me.balance - 2);
  });

  it("charges an admin override at that engine's price", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: MOCK_ICON_PNG_B64 }] }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    const before = ((await (await api("/me", { cookie: admin })).json()) as { balance: number }).balance;
    const low = await api("/generations", { ...json({ slot: "main", prompt: "x", engine: "openai-low" }), cookie: admin });
    expect(((await low.json()) as { balance: number }).balance).toBe(before - 1);
    const medium = await api("/generations", { ...json({ slot: "main", prompt: "x", engine: "openai-medium" }), cookie: admin });
    expect(((await medium.json()) as { balance: number }).balance).toBe(before - 3);
  });

  it("lists each engine's price for admins", async () => {
    const me = (await (await api("/me", { cookie: admin })).json()) as { engines: { id: string; credits: number }[] };
    expect(me.engines).toEqual([
      { id: "openai-low", label: "OpenAI · nízká kvalita", credits: 1 },
      { id: "openai-medium", label: "OpenAI · střední kvalita", credits: 2 },
    ]);
  });

  it("can be cleared back to the configured default", async () => {
    expect((await put(admin, null)).status).toBe(200);
    const cookie = await signIn("teacher@example.com");
    const res = await api("/generations", { ...json({ slot: "icon", prompt: "houbička" }), cookie });
    expect(((await res.json()) as { source: { provider: string } }).source.provider).toBe("mock");
  });
});

describe("admin", () => {
  it("is closed to non-admins", async () => {
    expect((await api("/admin/users", { cookie: teacher })).status).toBe(403);
    expect((await api("/admin/grant", { ...json({ email: "teacher@example.com", amount: 5 }), cookie: teacher })).status).toBe(403);
  });

  it("lists users and grants credits by email", async () => {
    const users = (await (await api("/admin/users", { cookie: admin })).json()) as { email: string; balance: number }[];
    const before = users.find((u) => u.email === "teacher@example.com")!.balance;

    const res = await api("/admin/grant", { ...json({ email: "teacher@example.com", amount: 10, note: "start" }), cookie: admin });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { balance: number }).balance).toBe(before + 10);
  });

  it("reports an unknown email", async () => {
    const res = await api("/admin/grant", { ...json({ email: "nobody@example.com", amount: 10 }), cookie: admin });
    expect(res.status).toBe(404);
  });
});

describe("scheduled", () => {
  it("refunds generations stuck in pending", async () => {
    const userId = (await env.DB.prepare(`SELECT id FROM "user" WHERE email = 'teacher@example.com'`).first<string>("id"))!;
    const old = new Date(Date.now() - 30 * 60_000).toISOString();
    await env.DB.prepare(
      `INSERT INTO generations (id, user_id, slot, prompt, provider, model, status, cost, created_at)
       VALUES ('stuck-1', ?, 'icon', 'x', 'mock', 'mock', 'pending', 1, ?)`,
    )
      .bind(userId, old)
      .run();

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "*/15 * * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(await env.DB.prepare("SELECT status FROM generations WHERE id = 'stuck-1'").first("status")).toBe("failed");
  });
});
