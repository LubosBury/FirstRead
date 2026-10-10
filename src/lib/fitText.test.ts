import { describe, expect, it } from "vitest";
import { fitFontSize } from "./fitText";

// A fake measurer: every character is 0.5 em wide.
const measure = (text: string, size: number) => text.length * size * 0.5;

describe("fitFontSize", () => {
  it("keeps the maximum size when the text fits", () => {
    expect(fitFontSize("Ahoj", 15, 186, measure)).toBe(15);
  });

  it("shrinks long text to the box width", () => {
    const text = "x".repeat(40);
    const size = fitFontSize(text, 15, 186, measure);
    expect(measure(text, size)).toBeLessThanOrEqual(186 + 1e-9);
    expect(size).toBeLessThan(15);
  });
});
