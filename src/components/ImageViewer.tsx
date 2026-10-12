import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Printer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { LibraryImage } from "@/lib/api";
import { loadAsset } from "@/lib/assets";
import { describeSource } from "@/lib/imageSource";
import { printImage } from "@/lib/printImage";
import { swipeStep } from "@/lib/swipe";

/** Large preview of library images, stepping through them and printing one per A4 page. */
export function ImageViewer({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: LibraryImage[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const img = index === null ? undefined : images[index];
  // "As on the sheet" shows the cleaned black outlines the PDF uses; off shows
  // exactly what the model returned.
  const [asOnSheet, setAsOnSheet] = useState(true);
  const [cleaned, setCleaned] = useState<{ id: string; url: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!img || !asOnSheet) return;
    let alive = true;
    loadAsset(img.id, true).then(
      (a) => alive && setCleaned({ id: img.id, url: a.url }),
      () => alive && setNotice("Obrázek se nepodařilo načíst."),
    );
    return () => {
      alive = false;
    };
  }, [img, asOnSheet]);

  const count = images.length;
  const step = (delta: number) => index !== null && count > 0 && onIndexChange((index + delta + count) % count);

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (!img) return null;
  const src = asOnSheet ? (cleaned?.id === img.id ? cleaned.url : null) : img.url;
  const source = describeSource(img.source);
  const title = img.label ?? "obrázek";

  function print() {
    if (!src) return;
    setNotice(printImage(src, title) ? null : "Prohlížeč zablokoval nové okno. Povolte prosím vyskakovací okna pro tento web.");
  }

  return (
    <Dialog open onClose={onClose} title={`Obrázek ${index! + 1} z ${count}`} className="max-w-4xl">
      <div className="space-y-3">
        <div
          className="flex h-[45dvh] items-center justify-center overflow-hidden rounded-xl border border-line bg-white sm:h-[62vh]"
          style={{ backgroundImage: "repeating-conic-gradient(#f3f1ea 0% 25%, #fff 0% 50%)", backgroundSize: "20px 20px" }}
          onTouchStart={(e) => {
            const t = e.touches[0];
            touch.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
          }}
          onTouchEnd={(e) => {
            const start = touch.current;
            touch.current = null;
            const t = e.changedTouches[0];
            if (start && count > 1) {
              const delta = swipeStep(t.clientX - start.x, t.clientY - start.y);
              if (delta) step(delta);
            }
          }}
        >
          {src ? (
            <img src={src} alt={title} data-testid="viewer-image" className="h-full w-full object-contain" />
          ) : (
            <Loader2 className="h-8 w-8 animate-spin text-brand" />
          )}
        </div>

        <div className="text-sm">
          <p className="font-semibold">{img.label ?? (img.origin === "upload" ? "Nahraný obrázek" : "Vygenerovaný obrázek")}</p>
          {source && (
            <p className="text-muted" data-testid="viewer-source">
              {source}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="icon" aria-label="Předchozí" onClick={() => step(-1)} disabled={count < 2}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button variant="secondary" size="icon" aria-label="Další" onClick={() => step(1)} disabled={count < 2}>
            <ChevronRight className="h-5 w-5" />
          </Button>
          <label className="ml-1 flex min-h-10 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand" checked={asOnSheet} onChange={(e) => setAsOnSheet(e.target.checked)} />
            Jak na listu (černé obrysy)
          </label>
          <div className="grid w-full grid-cols-[auto_1fr] gap-2 sm:ml-auto sm:flex sm:w-auto">
            <a
              href={img.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line-strong px-4 text-sm font-semibold hover:bg-canvas"
            >
              <ExternalLink className="h-4 w-4" /> Originál
            </a>
            <Button onClick={print} disabled={!src}>
              <Printer className="h-4 w-4" /> Vytisknout na A4
            </Button>
          </div>
        </div>
        {notice && <p className="text-sm text-danger">{notice}</p>}
      </div>
    </Dialog>
  );
}
