import { describe, expect, it } from "vitest";
import { clamp, parseWhole } from "./wholeNumber";

describe("parseWhole", () => {
  it("reads whole numbers", () => {
    expect(parseWhole("2026")).toBe(2026);
    expect(parseWhole(" 7 ")).toBe(7);
  });

  it("is null while the field is empty or not a whole number", () => {
    expect(parseWhole("")).toBeNull();
    expect(parseWhole("-")).toBeNull();
    expect(parseWhole("1.5")).toBeNull();
    expect(parseWhole("12a")).toBeNull();
  });
});

describe("clamp", () => {
  it("keeps a number within bounds", () => {
    expect(clamp(0, 1, 62)).toBe(1);
    expect(clamp(99, 1, 62)).toBe(62);
    expect(clamp(31, 1, 62)).toBe(31);
  });
});
