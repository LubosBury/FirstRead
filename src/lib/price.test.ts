import { describe, expect, it } from "vitest";
import { czk, czkPerCredit } from "./price";

describe("czk", () => {
  it("writes whole koruna with a non-breaking space before the currency", () => {
    expect(czk(249)).toBe("249\u00a0Kč");
  });

  it("groups thousands", () => {
    expect(czk(1249)).toBe("1\u00a0249\u00a0Kč");
  });
});

describe("czkPerCredit", () => {
  it("shows haléře with a decimal comma", () => {
    expect(czkPerCredit(249, 50)).toBe("4,98\u00a0Kč");
    expect(czkPerCredit(99, 20)).toBe("4,95\u00a0Kč");
  });
});
