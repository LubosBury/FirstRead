/**
 * Named provider + model + quality combinations an admin can pick per
 * generation, to compare them on the same prompt. Everyone else gets the
 * default from IMAGE_PROVIDER / IMAGE_QUALITY / *_IMAGE_MODEL.
 */
export const ENGINES = [
  { id: "openai-medium", label: "OpenAI · střední kvalita", provider: "openai", quality: "medium" },
  { id: "openai-low", label: "OpenAI · nízká kvalita", provider: "openai", quality: "low" },
  { id: "gemini-nano-banana-2.1", label: "Gemini · Nano Banana 2.1", provider: "gemini", model: "gemini-nano-banana-2.1" },
  { id: "gemini-3.1-flash-image", label: "Gemini · 3.1 Flash Image", provider: "gemini", model: "gemini-3.1-flash-image" },
] as const;

export type Engine = (typeof ENGINES)[number];
export type EngineId = Engine["id"];

export const ENGINE_IDS = ENGINES.map((e) => e.id) as [EngineId, ...EngineId[]];

export const getEngine = (id: EngineId): Engine => ENGINES.find((e) => e.id === id)!;
