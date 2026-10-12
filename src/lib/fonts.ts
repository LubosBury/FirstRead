import { z } from "zod";
import "@fontsource/andika/700.css";
import "@fontsource/nunito/900.css";
import "@fontsource/baloo-2/800.css";
import "@fontsource/grandstander/800.css";

export const FONT_IDS = ["andika", "nunito", "baloo-2", "grandstander"] as const;
export type FontId = (typeof FONT_IDS)[number];

export const FONTS: Record<FontId, { label: string; family: string; weight: number }> = {
  andika: { label: "Andika (pro začínající čtenáře)", family: "Andika", weight: 700 },
  nunito: { label: "Nunito (oblé)", family: "Nunito", weight: 900 },
  "baloo-2": { label: "Baloo 2 (tučné)", family: "Baloo 2", weight: 800 },
  grandstander: { label: "Grandstander (hravé)", family: "Grandstander", weight: 800 },
};

/** Fonts no longer offered, and what sheets saved with them open in. Fredoka had no Č, Ř, Ě, Ů, Ď, Ť or Ň. */
const RETIRED_FONTS: Record<string, FontId> = { fredoka: "nunito" };

export const fontIdSchema = z.preprocess(
  (id) => (typeof id === "string" && Object.hasOwn(RETIRED_FONTS, id) ? RETIRED_FONTS[id] : id),
  z.enum(FONT_IDS),
);

export const cssFont = (id: FontId, sizePx: number) =>
  `${FONTS[id].weight} ${sizePx}px "${FONTS[id].family}"`;

/** Canvas and SVG-in-canvas only use fonts the document has actually loaded. */
export async function ensureFontLoaded(id: FontId): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await document.fonts.load(cssFont(id, 32), "ÁČĎÉĚÍŇÓŘŠŤÚŮÝŽáčďéěíňóřšťúůýž");
}
