/** A whole number typed into a field, or null while it is not one yet (empty, or "1.5"). */
export function parseWhole(text: string): number | null {
  const t = text.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
