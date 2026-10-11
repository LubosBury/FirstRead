import { getEngine, type EngineId } from "./engines";
import { createGeminiProvider } from "./gemini";
import { createMockProvider } from "./mock";
import { createOpenAIProvider } from "./openai";

export type ImageInput = { bytes: Uint8Array; mime: string };
export type ImageRequest = { prompt: string; reference?: ImageInput };
export type ImageResult = { bytes: Uint8Array; mime: string; usage: unknown; model: string };

export interface ImageProvider {
  id: "openai" | "gemini" | "mock";
  model: string;
  quality: string | null;
  generate(req: ImageRequest): Promise<ImageResult>;
}

/** A failure with a message fit to show the teacher; `detail` is for logs. */
export class ProviderError extends Error {
  constructor(
    readonly userMessage: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "ProviderError";
  }
}

export const MSG = {
  refused: "Tento obrázek se nepodařilo vytvořit. Zkuste prosím upravit zadání.",
  busy: "Služba na obrázky je teď přetížená. Zkuste to prosím za chvíli.",
  failed: "Obrázek se nepodařilo vytvořit. Kredit jsme vrátili, zkuste to prosím znovu.",
  config: "Generování obrázků není nastavené. Ozvěte se prosím správci.",
};

/** Shared mapping of HTTP failures from either provider. */
export async function errorFromResponse(provider: string, res: Response): Promise<ProviderError> {
  const text = await res.text();
  const detail = `${provider} ${res.status}: ${text.slice(0, 500)}`;
  if (res.status === 429 || res.status >= 500) return new ProviderError(MSG.busy, detail);
  if (res.status === 401 || res.status === 403) return new ProviderError(MSG.config, detail);
  if (res.status === 400 && /moderation|safety|policy|blocked/i.test(text)) return new ProviderError(MSG.refused, detail);
  return new ProviderError(MSG.failed, detail);
}

type ProviderOptions = {
  /** Admin-picked combination; overrides the configured default. */
  engine?: EngineId;
  fetch?: typeof fetch;
};

export function getProvider(env: Env, opts: ProviderOptions = {}): ImageProvider {
  // The wrapper matters: providers call it as `opts.fetch(...)`, and Workers
  // throw "Illegal invocation" when the global fetch runs with any other `this`.
  const fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  const engine = opts.engine ? getEngine(opts.engine) : undefined;
  const providerId = engine?.provider ?? env.IMAGE_PROVIDER;
  const quality = (engine && "quality" in engine ? engine.quality : env.IMAGE_QUALITY) || "medium";
  const geminiModel = engine && "model" in engine ? engine.model : env.GEMINI_IMAGE_MODEL;

  switch (providerId) {
    case "mock":
      return createMockProvider();
    case "gemini":
      if (!env.GEMINI_API_KEY) throw new ProviderError(MSG.config, "GEMINI_API_KEY is not set");
      return createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: geminiModel, fetch: fetchImpl });
    case "openai":
      if (!env.OPENAI_API_KEY) throw new ProviderError(MSG.config, "OPENAI_API_KEY is not set");
      return createOpenAIProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_IMAGE_MODEL, quality, fetch: fetchImpl });
    default:
      throw new ProviderError(MSG.config, `Unknown IMAGE_PROVIDER "${providerId}"`);
  }
}
