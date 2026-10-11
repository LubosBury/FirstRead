import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { confirmDelete, Thumb } from "@/components/ImagePicker";
import { ImageViewer } from "@/components/ImageViewer";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/useMe";
import { api, ApiError, type LibraryImage } from "@/lib/api";
import { describeSource } from "@/lib/imageSource";
import { cn } from "@/lib/utils";

const ORIGIN = { upload: "nahraný", generated: "vygenerovaný" };

export function Library() {
  const { me } = useMe();
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
    if (!confirmDelete(img)) return;
    await api.deleteImage(img.id);
    setImages((list) => list?.filter((i) => i.id !== img.id) ?? null);
  }

  async function toggleShared(img: LibraryImage) {
    setError(null);
    try {
      const flags = await api.setShared(img.id, !img.shared);
      setImages((list) => list?.map((i) => (i.id === img.id ? { ...i, ...flags } : i)) ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sdílení se nepovedlo změnit.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
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
      {me?.isAdmin && (
        <p className="text-sm text-muted">
          Tlačítkem Sdílet přidáte obrázek do knihovny zdarma, kterou při výběru obrázku vidí všichni přihlášení. Odebráním
          z knihovny se nic nerozbije, smazáním obrázek zmizí i z cizích listů.
        </p>
      )}
      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {images === null ? (
        <Loader2 className="h-6 w-6 animate-spin text-brand" />
      ) : images.length === 0 ? (
        <p className="text-muted">Zatím žádné obrázky.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4 sm:gap-x-4 lg:grid-cols-6">
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
                {me?.isAdmin && (
                  <button
                    type="button"
                    onClick={() => toggleShared(img)}
                    aria-pressed={img.shared}
                    title={img.shared ? "Je v knihovně zdarma. Kliknutím ho z ní odeberete." : "Přidat do knihovny zdarma pro všechny"}
                    className={cn(
                      "-mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                      img.shared ? "bg-brand-soft text-brand" : "border border-line text-muted hover:text-brand",
                    )}
                  >
                    {img.shared ? "Sdílený" : "Sdílet"}
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Smazat"
                  onClick={() => remove(img)}
                  className="-mt-1.5 -mr-2 shrink-0 rounded-lg p-2 text-muted hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
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
