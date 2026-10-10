import { describe, expect, it } from "vitest";
import { A4, type ImageEl, type TextEl } from "@/templates/types";
import { defaultReadingChallengeParams, type ReadingChallengeParams } from "./params";
import { layoutReadingChallenge } from "./layout";

const october = (overrides: Partial<ReadingChallengeParams> = {}): ReadingChallengeParams => ({
  ...defaultReadingChallengeParams(new Date(2026, 9, 5)),
  ...overrides,
});

const icons = (els: ReturnType<typeof layoutReadingChallenge>["elements"]) =>
  els.filter((e): e is ImageEl => e.kind === "image" && e.role === "icon");
const main = (els: ReturnType<typeof layoutReadingChallenge>["elements"]) =>
  els.find((e): e is ImageEl => e.kind === "image" && e.role === "main")!;
const title = (els: ReturnType<typeof layoutReadingChallenge>["elements"]) =>
  els.find((e): e is TextEl => e.kind === "text")!;

describe("reading challenge defaults", () => {
  it("defaults to the given month with one item per day", () => {
    const p = october();
    expect(p.year).toBe(2026);
    expect(p.month).toBe(10);
    expect(p.count).toBe(31);
    expect(p.title).toBe("Čtenářská výzva na říjen");
  });
});

describe("layoutReadingChallenge", () => {
  it("places one icon per day of October", () => {
    expect(icons(layoutReadingChallenge(october(), {}).elements)).toHaveLength(31);
  });

  it("respects an overridden count", () => {
    expect(icons(layoutReadingChallenge(october({ count: 20 }), {}).elements)).toHaveLength(20);
  });

  it("puts the title in the header", () => {
    const t = title(layoutReadingChallenge(october(), {}).elements);
    expect(t.text).toBe("Čtenářská výzva na říjen");
    expect(t.y).toBeLessThan(A4.h * 0.15);
  });

  it("uppercases the title with Czech rules", () => {
    const t = title(layoutReadingChallenge(october({ uppercase: true }), {}).elements);
    expect(t.text).toBe("ČTENÁŘSKÁ VÝZVA NA ŘÍJEN");
  });

  it("keeps the main image in the bottom quarter", () => {
    const m = main(layoutReadingChallenge(october(), {}).elements);
    expect(m.y).toBeGreaterThanOrEqual(A4.h * 0.75 - 1e-9);
    expect(m.y + m.h).toBeLessThanOrEqual(A4.h);
  });

  it("aligns the main image left, center or right", () => {
    const x = (position: "left" | "center" | "right") =>
      main(
        layoutReadingChallenge(october({ mainImage: { imageId: null, position, scale: 1 } }), {}).elements,
      );
    const l = x("left");
    const c = x("center");
    const r = x("right");
    expect(l.x).toBeLessThan(c.x);
    expect(c.x).toBeLessThan(r.x);
    expect(c.x + c.w / 2).toBeCloseTo(A4.w / 2, 5);
  });

  it("fits the main image to its aspect ratio", () => {
    const m = main(
      layoutReadingChallenge(october({ mainImage: { imageId: "bear", position: "left", scale: 1 } }), {
        bear: { w: 1000, h: 500 },
      }).elements,
    );
    expect(m.w / m.h).toBeCloseTo(2, 5);
  });

  it("keeps icons off the main image", () => {
    const els = layoutReadingChallenge(october(), {}).elements;
    const m = main(els);
    for (const i of icons(els)) {
      const cx = i.x + i.w / 2;
      const cy = i.y + i.h / 2;
      const nx = Math.max(m.x, Math.min(cx, m.x + m.w));
      const ny = Math.max(m.y, Math.min(cy, m.y + m.h));
      expect(Math.hypot(cx - nx, cy - ny)).toBeGreaterThanOrEqual(i.w / 2);
    }
  });

  it("cycles through icon variants", () => {
    const els = layoutReadingChallenge(october({ icons: ["a", "b"] }), {}).elements;
    const ids = new Set(icons(els).map((i) => i.imageId));
    expect(ids).toEqual(new Set(["a", "b"]));
  });

  it("is deterministic for a seed", () => {
    expect(layoutReadingChallenge(october({ seed: 5 }), {})).toEqual(
      layoutReadingChallenge(october({ seed: 5 }), {}),
    );
  });
});
