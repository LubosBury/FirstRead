import { useEffect, useState } from "react";
import type { Asset } from "./assets";
import { canvasMeasure, fitFontSize } from "./fitText";
import { FONTS } from "./fonts";
import type { ImageEl, Layout, TextEl } from "@/templates/types";

/** Re-renders once web fonts arrive, so text is measured with the real font. */
function useFontsReady(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!document.fonts) return;
    const bump = () => setTick((t) => t + 1);
    document.fonts.addEventListener("loadingdone", bump);
    document.fonts.ready.then(bump);
    return () => document.fonts.removeEventListener("loadingdone", bump);
  }, []);
  return tick;
}

export function titleFontSize(el: TextEl): number {
  const f = FONTS[el.font];
  return fitFontSize(el.text, el.maxFontSize, el.w, canvasMeasure(f.family, f.weight));
}

function Text({ el }: { el: TextEl }) {
  const f = FONTS[el.font];
  return (
    <text
      x={el.x + el.w / 2}
      y={el.y + el.h / 2}
      textAnchor="middle"
      dominantBaseline="central"
      fontFamily={`"${f.family}"`}
      fontWeight={f.weight}
      fontSize={titleFontSize(el)}
      fill="#000"
    >
      {el.text}
    </text>
  );
}

function Picture({ el, asset, placeholders }: { el: ImageEl; asset?: Asset; placeholders: boolean }) {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  if (!asset) {
    if (!placeholders) return null;
    return el.role === "main" ? (
      <g data-role="main">
        <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={4} fill="#f2efe6" stroke="#b9b3a3" strokeWidth={0.6} strokeDasharray="3 2" />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={5} fill="#8a8473" fontFamily="Nunito">
          Hlavní obrázek
        </text>
      </g>
    ) : (
      <circle data-role="icon" cx={cx} cy={cy} r={el.w / 2} fill="none" stroke="#b9b3a3" strokeWidth={0.6} strokeDasharray="2 1.5" />
    );
  }
  return (
    <g data-role={el.role} transform={`translate(${cx} ${cy}) rotate(${el.rotation}) scale(${el.mirror ? -1 : 1} 1)`}>
      <image href={asset.url} x={-el.w / 2} y={-el.h / 2} width={el.w} height={el.h} preserveAspectRatio="xMidYMid meet" />
    </g>
  );
}

export function SheetSvg({
  layout,
  assets,
  placeholders = true,
  className,
}: {
  layout: Layout;
  assets: Record<string, Asset>;
  placeholders?: boolean;
  className?: string;
}) {
  useFontsReady();
  return (
    <svg
      viewBox={`0 0 ${layout.page.w} ${layout.page.h}`}
      className={className}
      role="img"
      aria-label="Náhled pracovního listu"
      data-testid="sheet-preview"
    >
      <rect width={layout.page.w} height={layout.page.h} fill="#fff" />
      {layout.elements.map((el, i) =>
        el.kind === "text" ? (
          <Text key={i} el={el} />
        ) : (
          <Picture key={i} el={el} asset={el.imageId ? assets[el.imageId] : undefined} placeholders={placeholders} />
        ),
      )}
    </svg>
  );
}
