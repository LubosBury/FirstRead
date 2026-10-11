/**
 * Named provider + model + quality combinations. An admin picks the default
 * for everyone (Správa) and can override it per generation to compare.
 *
 * Gemini is shelved after a side-by-side print test (its outlines came out
 * mangled); its provider stays in ./gemini.ts and returns here as a line like
 * { id: "gemini-...", label: "Gemini · ...", provider: "gemini", model: "...", credits: 1 }.
 */
type EngineDef = {
  id: string;
  label: string;
  provider: "openai" | "gemini";
  quality?: string;
  model?: string;
  /** Credits charged per image; tracks the provider cost of the engine. */
  credits: number;
};

export const ENGINES = [
  // Medium used ~9x the output tokens of low in the print test; 2 credits keeps it
  // the deliberate choice without making it prohibitive.
  { id: "openai-low", label: "OpenAI · nízká kvalita", provider: "openai", quality: "low", credits: 1 },
  { id: "openai-medium", label: "OpenAI · střední kvalita", provider: "openai", quality: "medium", credits: 2 },
] as const satisfies readonly EngineDef[];

export type EngineId = (typeof ENGINES)[number]["id"];

export const ENGINE_IDS = ENGINES.map((e) => e.id) as [EngineId, ...EngineId[]];

export const isEngineId = (id: unknown): id is EngineId => ENGINE_IDS.includes(id as EngineId);

export const getEngine = (id: EngineId): EngineDef => ENGINES.find((e) => e.id === id)!;

/** The engine the Worker vars describe, if they match a listed one. */
export function engineFromEnv(env: Pick<Env, "IMAGE_PROVIDER" | "IMAGE_QUALITY">): EngineId | null {
  const quality = env.IMAGE_QUALITY || "medium";
  return ENGINES.find((e) => e.provider === env.IMAGE_PROVIDER && e.quality === quality)?.id ?? null;
}

/** Public shape of the list, for /me and Správa. */
export const engineOptions = () => ENGINES.map(({ id, label, credits }) => ({ id, label, credits }));
