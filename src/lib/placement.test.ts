import { describe, expect, it } from "vitest";
import { placeItems, type Rect } from "./placement";

const area: Rect = { x: 12, y: 40, w: 186, h: 245 };
const mainImage: Rect = { x: 12, y: 210, w: 95, h: 75 };

function circleIntersectsRect(cx: number, cy: number, r: number, rect: Rect) {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  return Math.hypot(cx - nx, cy - ny) < r;
}

describe("placeItems", () => {
  for (const count of [28, 29, 30, 31]) {
    it(`places exactly ${count} items`, () => {
      const { items } = placeItems({ count, area, exclusions: [mainImage], seed: 1 });
      expect(items).toHaveLength(count);
    });
  }

  it("keeps items from overlapping each other", () => {
    const gap = 3;
    const { items, size } = placeItems({ count: 31, area, exclusions: [mainImage], seed: 3, gap });
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const d = Math.hypot(items[i].x - items[j].x, items[i].y - items[j].y);
        expect(d).toBeGreaterThanOrEqual(size + gap - 1e-9);
      }
    }
  });

  it("keeps every item fully inside the area", () => {
    const { items, size } = placeItems({ count: 31, area, exclusions: [mainImage], seed: 4 });
    const r = size / 2;
    for (const it of items) {
      expect(it.x - r).toBeGreaterThanOrEqual(area.x - 1e-9);
      expect(it.y - r).toBeGreaterThanOrEqual(area.y - 1e-9);
      expect(it.x + r).toBeLessThanOrEqual(area.x + area.w + 1e-9);
      expect(it.y + r).toBeLessThanOrEqual(area.y + area.h + 1e-9);
    }
  });

  it("keeps every item out of the exclusion zones", () => {
    const { items, size } = placeItems({ count: 31, area, exclusions: [mainImage], seed: 5 });
    for (const it of items) {
      expect(circleIntersectsRect(it.x, it.y, size / 2, mainImage)).toBe(false);
    }
  });

  it("is deterministic for a seed", () => {
    const a = placeItems({ count: 31, area, exclusions: [mainImage], seed: 99 });
    const b = placeItems({ count: 31, area, exclusions: [mainImage], seed: 99 });
    expect(a).toEqual(b);
  });

  it("changes the layout for a different seed", () => {
    const a = placeItems({ count: 31, area, exclusions: [mainImage], seed: 1 });
    const b = placeItems({ count: 31, area, exclusions: [mainImage], seed: 2 });
    expect(a.items).not.toEqual(b.items);
  });

  it("never exceeds the maximum size", () => {
    const { size } = placeItems({ count: 3, area, exclusions: [], seed: 1, maxSize: 30 });
    expect(size).toBeLessThanOrEqual(30);
  });

  it("spreads variants evenly", () => {
    const { items } = placeItems({ count: 31, area, exclusions: [mainImage], seed: 8, variants: 3 });
    const counts = [0, 0, 0];
    for (const it of items) counts[it.variant]++;
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("leaves items upright without jitter", () => {
    const { items } = placeItems({ count: 10, area, exclusions: [], seed: 8, jitter: false });
    expect(items.every((it) => it.rotation === 0 && !it.mirror)).toBe(true);
  });

  it("rotates within ±15 degrees with jitter", () => {
    const { items } = placeItems({ count: 31, area, exclusions: [], seed: 8, jitter: true });
    expect(items.every((it) => Math.abs(it.rotation) <= 15)).toBe(true);
    expect(items.some((it) => it.rotation !== 0)).toBe(true);
  });

  it("returns nothing for a count of zero", () => {
    expect(placeItems({ count: 0, area, exclusions: [], seed: 1 }).items).toEqual([]);
  });
});
