import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { A4, type BadgeEl } from "@/templates/types";
import { SheetSvg } from "./renderSvg";

describe("SheetSvg", () => {
  const badge = (stroke: BadgeEl["stroke"]) => {
    const html = renderToStaticMarkup(
      <SheetSvg
        layout={{
          page: A4,
          elements: [{ kind: "badge", x: 50, y: 60, r: 4, stroke, text: "17", font: "andika", fontSize: 4.8 }],
        }}
        assets={{}}
      />,
    );
    return new DOMParser().parseFromString(html, "image/svg+xml").querySelector('[data-role="badge"]')!;
  };

  const circles = (b: Element) =>
    [...b.querySelectorAll("circle")].map((c) => ({
      r: c.getAttribute("r"),
      fill: c.getAttribute("fill"),
      stroke: c.getAttribute("stroke"),
      width: c.getAttribute("stroke-width"),
      dash: c.getAttribute("stroke-dasharray"),
    }));

  it("draws day-number badges: white fill out to the outline's edge, then the outline", () => {
    const b = badge({ width: 0.4, dash: null });
    expect(circles(b)).toEqual([
      { r: "4.2", fill: "#fff", stroke: null, width: null, dash: null },
      { r: "4", fill: "none", stroke: "#000", width: "0.4", dash: null },
    ]);
    expect(b.textContent).toBe("17");
  });

  it("dashes the outline", () => {
    expect(circles(badge({ width: 0.8, dash: [2, 1] }))[1].dash).toBe("2 1");
  });

  it("leaves the outline out, keeping the white fill", () => {
    expect(circles(badge(null))).toEqual([{ r: "4", fill: "#fff", stroke: null, width: null, dash: null }]);
  });
});
