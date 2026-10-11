import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Thumb } from "@/components/ImagePicker";
import { ImageViewer } from "@/components/ImageViewer";
import { Button } from "@/components/ui/button";
import { api, ApiError, type LibraryImage } from "@/lib/api";
import { describeSource } from "@/lib/imageSource";

const ORIGIN = { upload: "nahraný", generated: "vygenerovaný" };

export function Library() {
  const [images, setImages] = useState<LibraryImage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.images().then(setImages, () => setImages([]));
  }, []);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const img = await api.uploadImage(file);
      setImages((list) => [img, ...(list ?? [])]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nahrání se nepovedlo.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(img: LibraryImage) {
    if (!confirm("Smazat obrázek? Listy, které ho používají, ho ztratí.")) return;
    await api.deleteImage(img.id);
    setImages((list) => list?.filter((i) => i.id !== img.id) ?? null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="mr-auto text-2xl font-extrabold">Moje obrázky</h1>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        <Button onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} Nahrát obrázek
        </Button>
      </div>
      <p className="text-sm text-muted">
        Každý vygenerovaný obrázek tu zůstává, takže ho můžete použít znovu bez dalších kreditů. Kliknutím ho otevřete
        ve velkém a můžete ho vytisknout.
      </p>
      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {images === null ? (
        <Loader2 className="h-6 w-6 animate-spin text-brand" />
      ) : images.length === 0 ? (
        <p className="text-muted">Zatím žádné obrázky.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {images.map((img, i) => (
            <li key={img.id}>
              <button type="button" className="block w-full" onClick={() => setViewing(i)} aria-label="Zobrazit ve velkém">
                <Thumb src={img.url} className="aspect-square w-full hover:border-brand" />
              </button>
              <div className="mt-1 flex items-start gap-1 text-xs">
                <span className="min-w-0 flex-1 text-muted">
                  <span className="block truncate" title={img.label ?? undefined}>
                    {img.label ?? ORIGIN[img.origin]}
                  </span>
                  {img.source && (
                    <span className="block truncate text-[11px] opacity-80" title={describeSource(img.source)}>
                      {describeSource(img.source)}
                    </span>
                  )}
                </span>
                <button type="button" aria-label="Smazat" onClick={() => remove(img)} className="text-muted hover:text-danger">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {images && (
        <ImageViewer images={images} index={viewing} onIndexChange={setViewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}
