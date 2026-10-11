import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { A4 } from "@/templates/types";
import { SheetSvg } from "./renderSvg";

describe("SheetSvg", () => {
  it("draws day-number badges", () => {
    const html = renderToStaticMarkup(
      <SheetSvg
        layout={{
          page: A4,
          elements: [{ kind: "badge", x: 50, y: 60, r: 4, text: "17", font: "andika", fontSize: 4.8 }],
        }}
        assets={{}}
      />,
    );
    const svg = new DOMParser().parseFromString(html, "image/svg+xml");
    const badge = svg.querySelector('[data-role="badge"]')!;
    expect(badge.querySelector("circle")?.getAttribute("r")).toBe("4");
    expect(badge.textContent).toBe("17");
  });
});
