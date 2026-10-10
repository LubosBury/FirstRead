import { describe, expect, it } from "vitest";
import { credits } from "./plural";

describe("credits", () => {
  it("declines the Czech noun by count", () => {
    expect(credits(0)).toBe("0 kreditů");
    expect(credits(1)).toBe("1 kredit");
    expect(credits(2)).toBe("2 kredity");
    expect(credits(4)).toBe("4 kredity");
    expect(credits(5)).toBe("5 kreditů");
    expect(credits(22)).toBe("22 kreditů");
  });
});
