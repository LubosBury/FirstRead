import { describe, expect, it } from "vitest";
import { fileSafeName } from "./fileName";

describe("fileSafeName", () => {
  it("strips Czech diacritics and spaces", () => {
    expect(fileSafeName("Říjen 2026 - Čtenářská výzva", "pdf")).toBe("rijen-2026-ctenarska-vyzva.pdf");
  });

  it("never returns an empty name", () => {
    expect(fileSafeName("???", "pdf")).toBe("list.pdf");
  });
});
