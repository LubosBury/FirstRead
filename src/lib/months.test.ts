import { describe, expect, it } from "vitest";
import { czechMonthName, daysInMonth } from "./months";

describe("months", () => {
  it("names months in Czech nominative", () => {
    expect(czechMonthName(1)).toBe("leden");
    expect(czechMonthName(9)).toBe("září");
    expect(czechMonthName(10)).toBe("říjen");
    expect(czechMonthName(12)).toBe("prosinec");
  });

  it("counts days including leap years", () => {
    expect(daysInMonth(2026, 10)).toBe(31);
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
  });
});
