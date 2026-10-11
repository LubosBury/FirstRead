import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiProvider } from "./gemini";
import { createMockProvider } from "./mock";
import { createOpenAIProvider } from "./openai";
import { ENGINE_IDS } from "./engines";
import { getProvider, ProviderError } from "./provider";

type Call = { url: string; init: RequestInit };

function fakeFetch(body: unknown, status = 200) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { fn, calls };
}

const PIXELS = new Uint8Array([1, 2, 3, 4]);
const PIXELS_B64 = btoa(String.fromCharCode(...PIXELS));

describe("OpenAI provider", () => {
  const make = (f: typeof fetch) => createOpenAIProvider({ apiKey: "sk-test", model: "gpt-image-2", quality: "low", fetch: f });

  it("generates from a prompt as WebP", async () => {
    const { fn, calls } = fakeFetch({ data: [{ b64_json: PIXELS_B64 }], usage: { total_tokens: 42 } });
    const out = await make(fn).generate({ prompt: "a mushroom" });

    expect(calls[0].url).toBe("https://api.openai.com/v1/images/generations");
    expect(new Headers(calls[0].init.headers).get("Authorization")).toBe("Bearer sk-test");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: "gpt-image-2",
      prompt: "a mushroom",
      n: 1,
      size: "1024x1024",
      quality: "low",
      output_format: "webp",
    });
    expect(out).toEqual({ bytes: PIXELS, mime: "image/webp", usage: { total_tokens: 42 }, model: "gpt-image-2" });
  });

  it("redraws a reference image through the edits endpoint", async () => {
    const { fn, calls } = fakeFetch({ data: [{ b64_json: PIXELS_B64 }] });
    await make(fn).generate({ prompt: "as a coloring page", reference: { bytes: PIXELS, mime: "image/png" } });

    expect(calls[0].url).toBe("https://api.openai.com/v1/images/edits");
    const form = calls[0].init.body as FormData;
    expect(form.get("model")).toBe("gpt-image-2");
    expect(form.get("prompt")).toBe("as a coloring page");
    expect(form.get("output_format")).toBe("webp");
    const image = form.get("image") as File;
    expect(image.type).toBe("image/png");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PIXELS);
  });

  it("explains a moderation refusal in Czech", async () => {
    const { fn } = fakeFetch({ error: { code: "moderation_blocked", message: "blocked" } }, 400);
    const err = await make(fn).generate({ prompt: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.userMessage).toMatch(/zadání/);
  });

  it("asks to retry when rate limited", async () => {
    const { fn } = fakeFetch({ error: { message: "slow down" } }, 429);
    const err = await make(fn).generate({ prompt: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.userMessage).toMatch(/za chvíli/);
  });
});

describe("Gemini provider", () => {
  const make = (f: typeof fetch) => createGeminiProvider({ apiKey: "g-test", model: "gemini-img", fetch: f });
  const reply = {
    candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: PIXELS_B64 } }] } }],
    usageMetadata: { totalTokenCount: 99 },
  };

  it("generates an image-only response", async () => {
    const { fn, calls } = fakeFetch(reply);
    const out = await make(fn).generate({ prompt: "a mushroom" });

    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-img:generateContent");
    expect(new Headers(calls[0].init.headers).get("x-goog-api-key")).toBe("g-test");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      contents: [{ role: "user", parts: [{ text: "a mushroom" }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } },
    });
    expect(out).toEqual({ bytes: PIXELS, mime: "image/png", usage: { totalTokenCount: 99 }, model: "gemini-img" });
  });

  it("sends the reference image inline", async () => {
    const { fn, calls } = fakeFetch(reply);
    await make(fn).generate({ prompt: "redraw", reference: { bytes: PIXELS, mime: "image/jpeg" } });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.contents[0].parts).toEqual([{ text: "redraw" }, { inlineData: { mimeType: "image/jpeg", data: PIXELS_B64 } }]);
  });

  it("fails clearly when no image comes back", async () => {
    const { fn } = fakeFetch({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] });
    const err = await make(fn).generate({ prompt: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.userMessage).toMatch(/zadání/);
  });
});

describe("mock provider", () => {
  it("returns a PNG", async () => {
    const out = await createMockProvider().generate({ prompt: "icon: x" });
    expect(out.mime).toBe("image/png");
    expect(Array.from(out.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

describe("getProvider", () => {
  const base = { IMAGE_PROVIDER: "openai", OPENAI_API_KEY: "k", GEMINI_API_KEY: "g", OPENAI_IMAGE_MODEL: "m", GEMINI_IMAGE_MODEL: "gm", IMAGE_QUALITY: "medium" } as unknown as Env;

  it("picks the configured provider", () => {
    expect(getProvider(base).id).toBe("openai");
    expect(getProvider({ ...base, IMAGE_PROVIDER: "gemini" }).id).toBe("gemini");
    expect(getProvider({ ...base, IMAGE_PROVIDER: "mock" }).id).toBe("mock");
  });

  it("refuses a provider without an API key", () => {
    expect(() => getProvider({ ...base, OPENAI_API_KEY: "" })).toThrow(ProviderError);
  });
});

describe("default fetch binding", () => {
  // Workers reject `fetch` called as a method of anything but the global
  // object. Production hit exactly this: the provider called `opts.fetch(...)`.
  it("is enforced by the runtime", () => {
    const holder = { f: fetch };
    expect(() => holder.f("http://example.invalid/")).toThrow(/Illegal invocation/);
  });

  afterEach(() => vi.restoreAllMocks());

  const replies: Record<string, unknown> = {
    openai: { data: [{ b64_json: PIXELS_B64 }] },
    gemini: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PIXELS_B64 } }] } }] },
  };

  for (const id of ["openai", "gemini"] as const) {
    it(`lets the ${id} provider call the global fetch`, async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(function (this: unknown) {
        if (this !== undefined && this !== globalThis) {
          return Promise.reject(new TypeError("Illegal invocation: function called with incorrect `this` reference."));
        }
        return Promise.resolve(new Response(JSON.stringify(replies[id]), { headers: { "Content-Type": "application/json" } }));
      });
      const env = { IMAGE_PROVIDER: id, OPENAI_API_KEY: "k", GEMINI_API_KEY: "g", OPENAI_IMAGE_MODEL: "m", GEMINI_IMAGE_MODEL: "gm", IMAGE_QUALITY: "low" } as unknown as Env;

      const out = await getProvider(env).generate({ prompt: "houbička" });
      expect(out.bytes).toEqual(PIXELS);
    });
  }
});

describe("getProvider with an engine", () => {
  const env = {
    IMAGE_PROVIDER: "mock",
    OPENAI_API_KEY: "k",
    GEMINI_API_KEY: "g",
    OPENAI_IMAGE_MODEL: "gpt-image-x",
    GEMINI_IMAGE_MODEL: "gm",
    IMAGE_QUALITY: "medium",
  } as unknown as Env;

  it("offers OpenAI at two qualities, low first", () => {
    expect(ENGINE_IDS).toEqual(["openai-low", "openai-medium"]);
  });

  it("overrides the configured provider and quality", () => {
    const p = getProvider(env, { engine: "openai-low" });
    expect([p.id, p.model, p.quality]).toEqual(["openai", "gpt-image-x", "low"]);
    const m = getProvider(env, { engine: "openai-medium" });
    expect([m.id, m.quality]).toEqual(["openai", "medium"]);
  });

  it("still needs the provider's API key", () => {
    expect(() => getProvider({ ...env, OPENAI_API_KEY: "" }, { engine: "openai-low" })).toThrow(ProviderError);
  });
});
