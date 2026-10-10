import { describe, expect, it } from "vitest";
import { buildPrompt } from "./prompts";

describe("buildPrompt", () => {
  it("asks for coloring-page line art", () => {
    const p = buildPrompt("main", "medvídek v listí", false);
    expect(p).toMatch(/coloring page/i);
    expect(p).toMatch(/no shading/i);
    expect(p).toContain("medvídek v listí");
  });

  it("asks for a single small object for icons", () => {
    expect(buildPrompt("icon", "houbička", false)).toMatch(/single simple object/i);
  });

  it("redraws a reference image", () => {
    const p = buildPrompt("main", "", true);
    expect(p).toMatch(/redraw the provided image/i);
    expect(p).not.toMatch(/Subject:/);
  });
});
