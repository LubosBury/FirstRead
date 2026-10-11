import { describe, expect, it } from "vitest";
import { swipeStep } from "./swipe";

describe("swipeStep", () => {
  it("goes forward on a swipe to the left and back on a swipe to the right", () => {
    expect(swipeStep(-80, 10)).toBe(1);
    expect(swipeStep(80, -10)).toBe(-1);
  });

  it("ignores taps and short drags", () => {
    expect(swipeStep(0, 0)).toBe(0);
    expect(swipeStep(-30, 0)).toBe(0);
  });

  it("ignores mostly vertical movement", () => {
    expect(swipeStep(-60, 90)).toBe(0);
  });
});
