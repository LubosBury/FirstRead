// Luminance band that becomes the ink edge. Lighter than HI is paper (it also
// removes the light-gray shading models like to add); darker than LO is solid
// ink; the ramp in between keeps outlines anti-aliased instead of jagged.
const LO = 100;
const HI = 170;

/** Alpha of black ink for one RGBA pixel, composited over white paper. */
export function inkAlpha(r: number, g: number, b: number, a: number): number {
  const k = a / 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) * k + 255 * (1 - k);
  const t = (HI - lum) / (HI - LO);
  return Math.round(Math.max(0, Math.min(1, t)) * 255);
}

/** Rewrites RGBA pixels in place to pure black ink on a transparent background. */
export function cleanLineArt(px: Uint8ClampedArray): void {
  for (let i = 0; i < px.length; i += 4) {
    const alpha = inkAlpha(px[i], px[i + 1], px[i + 2], px[i + 3]);
    px[i] = 0;
    px[i + 1] = 0;
    px[i + 2] = 0;
    px[i + 3] = alpha;
  }
}
