import { jsPDF } from "jspdf";
import type { Asset } from "./assets";
import { cssFont, ensureFontLoaded } from "./fonts";
import { titleFontSize } from "./renderSvg";
import type { Layout } from "@/templates/types";

const DPI = 300;
const PX_PER_MM = DPI / 25.4;

function loadImg(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img);
}

/**
 * Draws the layout at 300 DPI and wraps it in an A4 PDF. Rasterizing keeps
 * Czech diacritics and web fonts exact without embedding fonts in the PDF.
 * Empty image slots are left out: placeholders are for the screen only.
 */
export async function renderSheetCanvas(layout: Layout, assets: Record<string, Asset>): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(layout.page.w * PX_PER_MM);
  canvas.height = Math.round(layout.page.h * PX_PER_MM);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(PX_PER_MM, PX_PER_MM);

  for (const el of layout.elements) {
    if (el.kind === "text") {
      await ensureFontLoaded(el.font);
      // Canvas fonts are in px; draw at 10x and scale down so tiny mm sizes keep precision.
      const size = titleFontSize(el);
      ctx.save();
      ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
      ctx.scale(0.1, 0.1);
      ctx.font = cssFont(el.font, size * 10);
      ctx.fillStyle = "#000";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(el.text, 0, 0);
      ctx.restore();
      continue;
    }
    const asset = el.imageId ? assets[el.imageId] : undefined;
    if (!asset) continue;
    const img = await loadImg(asset.url);
    const fit = Math.min(el.w / img.naturalWidth, el.h / img.naturalHeight);
    const dw = img.naturalWidth * fit;
    const dh = img.naturalHeight * fit;
    ctx.save();
    ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
    ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.scale(el.mirror ? -1 : 1, 1);
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
  return canvas;
}

export async function exportPdf(layout: Layout, assets: Record<string, Asset>, filename: string): Promise<void> {
  const canvas = await renderSheetCanvas(layout, assets);
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  pdf.addImage(canvas, "PNG", 0, 0, layout.page.w, layout.page.h, undefined, "FAST");
  pdf.save(filename);
}
