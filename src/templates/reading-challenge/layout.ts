import { placeItems, type Rect } from "@/lib/placement";
import { A4, type AssetSizes, type ImageEl, type Layout, type TextEl } from "@/templates/types";
import type { ReadingChallengeParams } from "./params";

const MARGIN = 12;
const HEADER_H = 24;
const HEADER_GAP = 4;
const TITLE_MAX_FONT = 15;
/** The main picture lives in the bottom quarter of the page. */
const MAIN_BOX = { w: A4.w * 0.45, h: A4.h * 0.25 - MARGIN };
const ICON_MAX = 34;
const ICON_GAP = 3;

function mainRect(p: ReadingChallengeParams, assets: AssetSizes): Rect {
  const boxW = MAIN_BOX.w * p.mainImage.scale;
  const boxH = MAIN_BOX.h * p.mainImage.scale;
  const asset = p.mainImage.imageId ? assets[p.mainImage.imageId] : undefined;
  let w = boxW;
  let h = boxH;
  if (asset && asset.w > 0 && asset.h > 0) {
    const ratio = asset.w / asset.h;
    if (ratio > boxW / boxH) h = boxW / ratio;
    else w = boxH * ratio;
  }
  const x =
    p.mainImage.position === "left"
      ? MARGIN
      : p.mainImage.position === "right"
        ? A4.w - MARGIN - w
        : (A4.w - w) / 2;
  return { x, y: A4.h - MARGIN - h, w, h };
}

export function layoutReadingChallenge(p: ReadingChallengeParams, assets: AssetSizes): Layout {
  const title: TextEl = {
    kind: "text",
    x: MARGIN,
    y: MARGIN,
    w: A4.w - 2 * MARGIN,
    h: HEADER_H,
    text: p.uppercase ? p.title.toLocaleUpperCase("cs-CZ") : p.title,
    font: p.font,
    maxFontSize: TITLE_MAX_FONT,
  };

  const m = mainRect(p, assets);
  const main: ImageEl = { kind: "image", role: "main", imageId: p.mainImage.imageId, ...m, rotation: 0, mirror: false };

  const top = MARGIN + HEADER_H + HEADER_GAP;
  const area: Rect = { x: MARGIN, y: top, w: A4.w - 2 * MARGIN, h: A4.h - MARGIN - top };
  const { items, size } = placeItems({
    count: p.count,
    area,
    exclusions: [m],
    seed: p.seed,
    gap: ICON_GAP,
    variants: Math.max(1, p.icons.length),
    jitter: p.jitter,
    maxSize: ICON_MAX,
  });
  const icons: ImageEl[] = items.map((it) => ({
    kind: "image",
    role: "icon",
    imageId: p.icons[it.variant] ?? null,
    x: it.x - size / 2,
    y: it.y - size / 2,
    w: size,
    h: size,
    rotation: it.rotation,
    mirror: it.mirror,
  }));

  return { page: A4, elements: [title, main, ...icons] };
}
