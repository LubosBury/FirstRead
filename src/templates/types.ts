import type { ComponentType } from "react";
import type { ZodType } from "zod";
import type { FontId } from "@/lib/fonts";

/** Every layout is in millimetres on an A4 portrait page. */
export const A4 = { w: 210, h: 297 } as const;

export type TextEl = {
  kind: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  font: FontId;
  /** Upper bound; renderers shrink the text until it fits the box width. */
  maxFontSize: number;
};

export type ImageEl = {
  kind: "image";
  role: "main" | "icon";
  /** null while the slot is still empty; the preview shows a placeholder. */
  imageId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  mirror: boolean;
};

/** A short label in a white circle, e.g. the day number next to a picture. Always drawn upright. */
export type BadgeEl = {
  kind: "badge";
  /** Center of the circle. */
  x: number;
  y: number;
  r: number;
  text: string;
  font: FontId;
  fontSize: number;
};

export type LayoutElement = TextEl | ImageEl | BadgeEl;
export type Layout = { page: typeof A4; elements: LayoutElement[] };

/** Natural pixel size of each image, so layouts can respect aspect ratios. */
export type AssetSizes = Record<string, { w: number; h: number }>;

export type ImageSlot = {
  key: string;
  label: string;
  stylePreset: "main" | "icon";
  multiple?: boolean;
};

export type EditorProps<P> = { params: P; onChange: (params: P) => void };

export interface TemplateDefinition<P> {
  id: string;
  name: string;
  description: string;
  paramsSchema: ZodType<P>;
  defaultParams(now?: Date): P;
  /** Title for the saved-sheets list. */
  sheetTitle(params: P): string;
  /** Image ids the sheet references, so the editor can load them. */
  imageIds(params: P): string[];
  layout(params: P, assets: AssetSizes): Layout;
  Editor: ComponentType<EditorProps<P>>;
}
