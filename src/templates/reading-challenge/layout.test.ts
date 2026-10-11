import { describe, expect, it } from "vitest";
import { A4, badgeOuterR, type BadgeEl, type ImageEl, type TextEl } from "@/templates/types";
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
const badges = (els: ReturnType<typeof layoutReadingChallenge>["elements"]) =>
  els.filter((e): e is BadgeEl => e.kind === "badge");

describe("reading challenge defaults", () => {
  it("defaults to the given month with one item per day", () => {
    const p = october();
    expect(p.year).toBe(2026);
    expect(p.month).toBe(10);
    expect(p.count).toBe(31);
    expect(p.title).toBe("Čtenářská výzva na říjen");
  });

  it("leaves day numbers off, so older sheets print as before", () => {
    expect(october().dayNumbers).toBe(false);
  });

  it("styles numbers as a thin solid circle in the corner, as before styles existed", () => {
    expect(october().numberStyle).toEqual({ position: "corner", border: "solid", weight: "thin" });
  });
});

describe("day numbers", () => {
  const numbered = (overrides: Partial<ReadingChallengeParams> = {}) =>
    layoutReadingChallenge(october({ dayNumbers: true, ...overrides }), {}).elements;

  it("adds no numbers when off", () => {
    expect(badges(layoutReadingChallenge(october(), {}).elements)).toHaveLength(0);
  });

  it("numbers every picture once, 1 to the day count", () => {
    const texts = badges(numbered()).map((b) => Number(b.text));
    expect(texts.toSorted((a, b) => a - b)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  it("follows the picture count", () => {
    const texts = badges(numbered({ count: 28 })).map((b) => Number(b.text));
    expect(Math.max(...texts)).toBe(28);
    expect(texts).toHaveLength(28);
  });

  it("puts the numbers in random order on the page", () => {
    const els = numbered({ seed: 5 });
    // Reading order: top to bottom, then left to right.
    const reading = badges(els)
      .toSorted((a, b) => Math.round(a.y / 10) - Math.round(b.y / 10) || a.x - b.x)
      .map((b) => Number(b.text));
    expect(reading).not.toEqual(reading.toSorted((a, b) => a - b));
  });

  it("reshuffles the numbers with the seed", () => {
    const texts = (seed: number) => badges(numbered({ seed })).map((b) => b.text);
    expect(texts(1)).not.toEqual(texts(2));
  });

  it("never moves the pictures", () => {
    expect(icons(numbered({ seed: 9 }))).toEqual(icons(layoutReadingChallenge(october({ seed: 9 }), {}).elements));
  });

  it.each([
    ["thin", "solid"],
    ["thick", "dashed"],
  ] as const)("sits on its own picture without touching the others, the main image or the page edge (%s %s)", (weight, border) => {
    const els = numbered({ numberStyle: { position: "corner", border, weight } });
    const pics = icons(els);
    const m = main(els);
    badges(els).forEach((b, i) => {
      pics.forEach((pic, j) => {
        const d = Math.hypot(b.x - (pic.x + pic.w / 2), b.y - (pic.y + pic.h / 2));
        if (i === j) expect(d).toBeLessThan(pic.w / 2);
        else expect(d).toBeGreaterThanOrEqual(pic.w / 2 + badgeOuterR(b));
      });
      const nx = Math.max(m.x, Math.min(b.x, m.x + m.w));
      const ny = Math.max(m.y, Math.min(b.y, m.y + m.h));
      expect(Math.hypot(b.x - nx, b.y - ny)).toBeGreaterThanOrEqual(badgeOuterR(b));
      expect(b.x + badgeOuterR(b)).toBeLessThanOrEqual(A4.w);
      expect(b.y + badgeOuterR(b)).toBeLessThanOrEqual(A4.h);
    });
  });

  it("can sit in the middle of its picture", () => {
    const els = numbered({ numberStyle: { position: "center", border: "solid", weight: "thin" } });
    const pics = icons(els);
    badges(els).forEach((b, i) => {
      expect(b.x).toBeCloseTo(pics[i].x + pics[i].w / 2, 9);
      expect(b.y).toBeCloseTo(pics[i].y + pics[i].h / 2, 9);
    });
  });

  it("draws no outline when the border is off", () => {
    for (const b of badges(numbered({ numberStyle: { position: "corner", border: "none", weight: "thick" } })))
      expect(b.stroke).toBeNull();
  });

  it("draws a thicker outline when asked", () => {
    const width = (weight: "thin" | "thick") =>
      badges(numbered({ numberStyle: { position: "corner", border: "solid", weight } }))[0].stroke!.width;
    expect(width("thick")).toBeGreaterThan(width("thin"));
  });

  it("keeps a solid outline unbroken", () => {
    for (const b of badges(numbered())) expect(b.stroke).toEqual({ width: expect.any(Number), dash: null });
  });

  it("dashes the outline evenly all the way round", () => {
    for (const b of badges(numbered({ numberStyle: { position: "corner", border: "dashed", weight: "thin" } }))) {
      const [dash, gap] = b.stroke!.dash!;
      expect(dash).toBeGreaterThan(gap);
      const repeats = (2 * Math.PI * b.r) / (dash + gap);
      expect(repeats).toBeCloseTo(Math.round(repeats), 9);
    }
  });

  it("keeps the number size the same in every style", () => {
    const sizes = (numberStyle: ReadingChallengeParams["numberStyle"]) =>
      badges(numbered({ seed: 7, numberStyle })).map((b) => [b.r, b.fontSize]);
    expect(sizes({ position: "center", border: "dashed", weight: "thick" })).toEqual(
      sizes({ position: "corner", border: "solid", weight: "thin" }),
    );
  });

  it("uses the title font", () => {
    for (const b of badges(numbered({ font: "fredoka" }))) expect(b.font).toBe("fredoka");
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
