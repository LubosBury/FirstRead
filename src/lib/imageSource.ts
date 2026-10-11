export type ImageSource = { provider: string; model: string | null; quality: string | null };

/** "openai · gpt-image-2 · low": which engine drew a picture, for comparing them. */
export function describeSource(source: ImageSource | null | undefined): string {
  if (!source) return "";
  return [source.provider, source.model, source.quality].filter(Boolean).join(" · ");
}
