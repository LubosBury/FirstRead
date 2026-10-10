import { fromBase64 } from "./base64";
import { errorFromResponse, MSG, ProviderError, type ImageProvider, type ImageRequest } from "./provider";

type Options = { apiKey: string; model: string; quality: string; fetch: typeof fetch };

const API = "https://api.openai.com/v1/images";
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/**
 * GPT Image over plain fetch. WebP keeps the response small, which keeps the
 * Worker's CPU time for JSON.parse and base64 decoding low. Transparency is not
 * requested: it is a preview option on gpt-image-2, and the client turns white
 * paper transparent anyway, for every provider alike.
 */
export function createOpenAIProvider(opts: Options): ImageProvider {
  return {
    id: "openai",
    model: opts.model,
    quality: opts.quality,
    async generate(req: ImageRequest) {
      const headers = { Authorization: `Bearer ${opts.apiKey}` };
      let res: Response;
      if (req.reference) {
        const form = new FormData();
        form.set("model", opts.model);
        form.set("prompt", req.prompt);
        form.set("n", "1");
        form.set("size", "1024x1024");
        form.set("quality", opts.quality);
        form.set("output_format", "webp");
        const ext = EXT[req.reference.mime] ?? "png";
        form.set("image", new File([req.reference.bytes], `reference.${ext}`, { type: req.reference.mime }));
        res = await opts.fetch(`${API}/edits`, { method: "POST", headers, body: form });
      } else {
        res = await opts.fetch(`${API}/generations`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: opts.model,
            prompt: req.prompt,
            n: 1,
            size: "1024x1024",
            quality: opts.quality,
            output_format: "webp",
          }),
        });
      }
      if (!res.ok) throw await errorFromResponse("openai", res);

      const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: unknown };
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) throw new ProviderError(MSG.failed, "openai: response without b64_json");
      return { bytes: fromBase64(b64), mime: "image/webp", usage: json.usage ?? null, model: opts.model };
    },
  };
}
