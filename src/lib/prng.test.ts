import { describe, expect, it } from "vitest";
import { mulberry32, shuffle } from "./prng";

describe("mulberry32", () => {
  it("returns the same sequence for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("returns a different sequence for a different seed", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it("stays within [0, 1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("shuffle", () => {
  it("keeps every item exactly once", () => {
    const items = Array.from({ length: 31 }, (_, i) => i + 1);
    expect(shuffle([...items], mulberry32(3)).toSorted((a, b) => a - b)).toEqual(items);
  });

  it("is deterministic for a seed", () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(shuffle([...items], mulberry32(3))).toEqual(shuffle([...items], mulberry32(3)));
  });
});
