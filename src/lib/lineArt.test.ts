import { describe, expect, it } from "vitest";
import { cleanLineArt, inkAlpha } from "./lineArt";

describe("inkAlpha", () => {
  it("drops white and light gray", () => {
    expect(inkAlpha(255, 255, 255, 255)).toBe(0);
    expect(inkAlpha(200, 200, 200, 255)).toBe(0);
  });

  it("keeps dark lines fully opaque", () => {
    expect(inkAlpha(0, 0, 0, 255)).toBe(255);
    expect(inkAlpha(60, 60, 60, 255)).toBe(255);
  });

  it("ramps edges so lines stay anti-aliased", () => {
    const a = inkAlpha(130, 130, 130, 255);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(255);
  });

  it("treats transparent pixels as paper", () => {
    expect(inkAlpha(0, 0, 0, 0)).toBe(0);
  });
});

describe("cleanLineArt", () => {
  it("turns pixels into black ink with computed alpha", () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 10, 20, 30, 255]);
    cleanLineArt(px);
    expect(Array.from(px)).toEqual([0, 0, 0, 0, 0, 0, 0, 255]);
  });
});
