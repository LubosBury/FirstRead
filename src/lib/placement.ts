import { mulberry32 } from "./prng";

export type Rect = { x: number; y: number; w: number; h: number };

/** Center of a square item of side `size` (see the result). */
export type Placement = { x: number; y: number; rotation: number; mirror: boolean; variant: number };

export type PlaceOptions = {
  count: number;
  /** Items must lie fully inside this area. */
  area: Rect;
  /** Items must not touch these. */
  exclusions: Rect[];
  seed: number;
  /** Minimum clear space between items and around exclusions, in the same units. */
  gap?: number;
  variants?: number;
  jitter?: boolean;
  maxSize?: number;
  minSize?: number;
};

const CANDIDATES = 24;
const TRIES_PER_ITEM = 400;
const SHRINK = 0.95;
const MAX_ROTATION = 15;

function distanceToRect(x: number, y: number, r: Rect): number {
  const nx = Math.max(r.x, Math.min(x, r.x + r.w));
  const ny = Math.max(r.y, Math.min(y, r.y + r.h));
  return Math.hypot(x - nx, y - ny);
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Scatters `count` equally sized, non-overlapping items over the free area.
 *
 * Items are treated as circles of diameter `size` (the drawn icon sits in that
 * square, so the circle is its visible footprint). Each item is the best of a
 * handful of random candidates, picked to be farthest from what is already
 * placed: random enough to look hand-made, even enough to leave no big holes.
 * If they don't fit, the size shrinks and the whole layout is redone from the
 * same seed, so a seed always gives the same sheet.
 */
export function placeItems(opts: PlaceOptions): { items: Placement[]; size: number } {
  const { count, area, exclusions, seed } = opts;
  const gap = opts.gap ?? 3;
  const variants = Math.max(1, opts.variants ?? 1);
  const minSize = opts.minSize ?? 4;
  if (count <= 0) return { items: [], size: 0 };

  const free = area.w * area.h - exclusions.reduce((sum, e) => sum + overlapArea(area, e), 0);
  // Random packing of disks tops out a little above 0.5; start just under it.
  const density = 0.45;
  let size = Math.sqrt((4 * free * density) / (count * Math.PI)) - gap;
  if (opts.maxSize !== undefined) size = Math.min(size, opts.maxSize);

  while (size >= minSize) {
    const items = tryPlace(count, size, gap, area, exclusions, seed);
    if (items) return { items: decorate(items, variants, opts.jitter ?? false, seed), size };
    size *= SHRINK;
  }
  throw new Error(`Cannot fit ${count} items in the free area`);
}

function tryPlace(
  count: number,
  size: number,
  gap: number,
  area: Rect,
  exclusions: Rect[],
  seed: number,
): { x: number; y: number }[] | null {
  const rand = mulberry32(seed);
  const r = size / 2;
  const minDist = size + gap;
  const placed: { x: number; y: number }[] = [];

  const valid = (x: number, y: number) =>
    exclusions.every((e) => distanceToRect(x, y, e) >= r + gap) &&
    placed.every((p) => Math.hypot(p.x - x, p.y - y) >= minDist);

  for (let i = 0; i < count; i++) {
    let best: { x: number; y: number } | null = null;
    let bestScore = -1;
    let found = 0;
    for (let t = 0; t < TRIES_PER_ITEM && found < CANDIDATES; t++) {
      const x = area.x + r + rand() * (area.w - size);
      const y = area.y + r + rand() * (area.h - size);
      if (!valid(x, y)) continue;
      found++;
      const nearest = placed.reduce((m, p) => Math.min(m, Math.hypot(p.x - x, p.y - y)), Infinity);
      if (nearest > bestScore) {
        bestScore = nearest;
        best = { x, y };
      }
    }
    if (!best) return null;
    placed.push(best);
  }
  return placed;
}

function decorate(
  points: { x: number; y: number }[],
  variants: number,
  jitter: boolean,
  seed: number,
): Placement[] {
  // A separate stream, so toggling jitter or adding a variant never moves items.
  const rand = mulberry32(seed ^ 0x5bd1e995);
  const order = points.map((_, i) => i % variants);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return points.map((p, i) => {
    const rotation = jitter ? Math.round((rand() * 2 - 1) * MAX_ROTATION) : 0;
    const mirror = jitter ? rand() < 0.5 : false;
    return { x: p.x, y: p.y, rotation, mirror, variant: order[i] };
  });
}
