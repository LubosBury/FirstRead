import { fromBase64, toBase64 } from "./base64";
import { errorFromResponse, MSG, ProviderError, type ImageProvider, type ImageRequest } from "./provider";

type Options = { apiKey: string; model: string; fetch: typeof fetch };

type Part = { text?: string; inlineData?: { mimeType: string; data: string } };
type Reply = {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: unknown;
};

/** Gemini image models over the REST generateContent endpoint. */
export function createGeminiProvider(opts: Options): ImageProvider {
  return {
    id: "gemini",
    model: opts.model,
    quality: null,
    async generate(req: ImageRequest) {
      const parts: Part[] = [{ text: req.prompt }];
      if (req.reference) parts.push({ inlineData: { mimeType: req.reference.mime, data: toBase64(req.reference.bytes) } });

      const res = await opts.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": opts.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } },
          }),
        },
      );
      if (!res.ok) throw await errorFromResponse("gemini", res);

      const json = (await res.json()) as Reply;
      const image = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
      if (!image) {
        const reason = json.promptFeedback?.blockReason ?? json.candidates?.[0]?.finishReason ?? "no image part";
        // Without an image, Gemini has nearly always declined the prompt.
        throw new ProviderError(MSG.refused, `gemini: ${reason}`);
      }
      return { bytes: fromBase64(image.data), mime: image.mimeType, usage: json.usageMetadata ?? null, model: opts.model };
    },
  };
}
