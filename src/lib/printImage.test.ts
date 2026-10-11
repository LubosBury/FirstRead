import { describe, expect, it } from "vitest";
import { buildPrintHtml } from "./printImage";

describe("buildPrintHtml", () => {
  it("fills an A4 page with the image", () => {
    const html = buildPrintHtml("blob:https://x/1", "houbička");
    expect(html).toContain("@page { size: A4");
    expect(html).toContain('<img src="blob:https://x/1"');
    expect(html).toContain("object-fit: contain");
  });

  it("escapes the title and source", () => {
    const html = buildPrintHtml('/api/images/1"><script>', "<b>x</b>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain('1"><script>');
  });
});
