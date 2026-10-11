import { describe, expect, it } from "vitest";
import { describeSource } from "./imageSource";

describe("describeSource", () => {
  it("joins provider, model and quality", () => {
    expect(describeSource({ provider: "openai", model: "gpt-image-2", quality: "low" })).toBe("openai · gpt-image-2 · low");
  });

  it("skips what a provider does not have", () => {
    expect(describeSource({ provider: "gemini", model: "gemini-nano-banana-2.1", quality: null })).toBe(
      "gemini · gemini-nano-banana-2.1",
    );
  });

  it("is empty for uploads", () => {
    expect(describeSource(null)).toBe("");
  });
});
