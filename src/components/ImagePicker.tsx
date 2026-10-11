import { Gift, ImagePlus, Library, Loader2, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label, Select, Textarea } from "@/components/ui/input";
import { useMe } from "@/hooks/useMe";
import { api, ApiError, type LibraryImage } from "@/lib/api";
import { describeSource, type ImageSource } from "@/lib/imageSource";
import { credits } from "@/lib/plural";
import { cn } from "@/lib/utils";

type Preset = "main" | "icon";
type Tab = "generate" | "library" | "shared" | "upload";

const PLACEHOLDER: Record<Preset, string> = {
  main: "např. medvídek sedí v podzimním listí mezi houbami",
  icon: "např. houbička",
};

export function Thumb({ src, className }: { src: string; className?: string }) {
  return (
    <div
      className={cn("overflow-hidden rounded-lg border border-line bg-white", className)}
      style={{ backgroundImage: "repeating-conic-gradient(#f3f1ea 0% 25%, #fff 0% 50%)", backgroundSize: "16px 16px" }}
    >
      <img src={src} alt="" loading="lazy" className="h-full w-full object-contain" />
    </div>
  );
}

/** A picture that was ever shared may sit on other people's sheets. */
export function confirmDelete(img: LibraryImage) {
  return confirm(
    img.everShared
      ? "Smazat obrázek? Byl ve sdílené knihovně, takže zmizí i z listů ostatních uživatelů."
      : "Smazat obrázek? Listy, které ho používají, ho ztratí.",
  );
}

function PickGrid({
  images,
  empty,
  onPick,
  onReference,
  onDelete,
}: {
  images: LibraryImage[] | null;
  empty: string;
  onPick: (img: LibraryImage) => void;
  onReference: (img: LibraryImage) => void;
  onDelete?: (img: LibraryImage) => void;
}) {
  if (images === null) return <Loader2 className="mx-auto my-8 h-6 w-6 animate-spin text-brand" />;
  if (images.length === 0) return <p className="py-8 text-center text-muted">{empty}</p>;
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
      {images.map((img) => (
        <li key={img.id} className="group relative">
          <button type="button" onClick={() => onPick(img)} className="block w-full" title={img.label ?? undefined}>
            <Thumb src={img.url} className="aspect-square w-full group-hover:border-brand" />
          </button>
          <div className="mt-1 flex justify-between">
            <button type="button" className="text-xs font-semibold text-brand hover:underline" onClick={() => onReference(img)}>
              Předloha pro AI
            </button>
            {onDelete && (
              <button type="button" aria-label="Smazat" className="text-muted hover:text-danger" onClick={() => onDelete(img)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ImagePicker({
  open,
  onClose,
  preset,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  preset: Preset;
  onPick: (image: LibraryImage) => void;
}) {
  const { me, setBalance, refresh } = useMe();
  const [tab, setTab] = useState<Tab>("generate");
  const [prompt, setPrompt] = useState("");
  const [reference, setReference] = useState<LibraryImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LibraryImage | null>(null);
  const [resultSource, setResultSource] = useState<ImageSource | null>(null);
  // Admin-only engine override; "" means the configured default.
  const [engine, setEngine] = useState("");
  const [library, setLibrary] = useState<LibraryImage[] | null>(null);
  const [shared, setShared] = useState<LibraryImage[] | null>(null);
  const [uploaded, setUploaded] = useState<LibraryImage | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // An admin's per-image pick carries its own price; otherwise the default's.
  const cost = me?.engines?.find((e) => e.id === engine)?.credits ?? me?.costs[preset] ?? 1;
  const balance = me?.balance ?? 0;
  const short = balance < cost;

  useEffect(() => {
    if (open && tab === "library" && library === null) {
      api.images().then(setLibrary, (e) => setError(e.message));
    }
  }, [open, tab, library]);

  // Loaded on open, not on tab click: an empty library hides its tab.
  useEffect(() => {
    if (open && shared === null) api.sharedImages(preset).then(setShared, () => setShared([]));
  }, [open, shared, preset]);

  const pick = (img: LibraryImage) => {
    onPick(img);
    onClose();
  };

  const takeAsReference = (img: LibraryImage) => {
    setReference(img);
    setResult(null);
    setTab("generate");
  };

  async function generate() {
    setBusy(true);
    setError(null);
    // The previous result stays until a new one arrives: a failed retry (or a
    // weaker engine in a comparison) must not cost the picture already paid for.
    try {
      const out = await api.generate(preset, prompt, reference?.id, engine || undefined);
      setResult(out.image);
      setResultSource(out.source);
      setBalance(out.balance);
      setLibrary(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Obrázek se nepodařilo vytvořit.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      setUploaded(await api.uploadImage(file));
      setLibrary(null);
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
    setLibrary((l) => l?.filter((i) => i.id !== img.id) ?? null);
    if (img.shared) setShared(null);
  }

  const tabs: { id: Tab; label: string; icon: typeof Sparkles }[] = [
    { id: "generate", label: "Vygenerovat", icon: Sparkles },
    { id: "library", label: "Moje obrázky", icon: Library },
    ...(shared?.length ? [{ id: "shared" as const, label: "Knihovna zdarma", icon: Gift }] : []),
    { id: "upload", label: "Nahrát vlastní", icon: Upload },
  ];

  return (
    <Dialog open={open} onClose={onClose} title={preset === "main" ? "Hlavní obrázek" : "Opakovaný obrázek"}>
      <div className="mb-4 flex gap-1 rounded-xl bg-canvas p-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setError(null);
            }}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-center text-sm leading-tight font-semibold",
              tab === t.id ? "bg-surface shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            <t.icon className="hidden h-4 w-4 shrink-0 sm:block" />
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {tab === "generate" && (
        <div className="space-y-4">
          {reference && (
            <div className="flex items-center gap-3 rounded-xl border border-line p-3">
              <Thumb src={reference.url} className="h-16 w-16" />
              <div className="flex-1 text-sm">
                <p className="font-semibold">Předloha</p>
                <p className="text-muted">AI ji překreslí do stylu omalovánky.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setReference(null)}>
                Odebrat
              </Button>
            </div>
          )}
          <div>
            <Label htmlFor="prompt">{reference ? "Doplňující pokyny (nepovinné)" : "Co má obrázek zobrazovat?"}</Label>
            <Textarea
              id="prompt"
              value={prompt}
              maxLength={500}
              placeholder={PLACEHOLDER[preset]}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted">
              Obrázek bude černobílý, s výraznými obrysy a bez stínování, aby šel vybarvit.
            </p>
          </div>

          {me?.engines && (
            <div>
              <Label htmlFor="engine">Model (jen pro správce)</Label>
              <Select id="engine" value={engine} onChange={(e) => setEngine(e.target.value)}>
                <option value="">
                  Výchozí{me.defaultEngine ? ` (${me.engines.find((e) => e.id === me.defaultEngine)?.label})` : ""} ·{" "}
                  {credits(me.costs[preset])}
                </option>
                {me.engines.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label} · {credits(e.credits)}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {result ? (
            <div className="space-y-3">
              <Thumb src={result.url} className="mx-auto h-56 w-56" />
              {me?.engines && resultSource && (
                <p className="text-center text-xs text-muted" data-testid="result-source">
                  {describeSource(resultSource)}
                </p>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => pick(result)}>Použít tento obrázek</Button>
                <Button variant="secondary" onClick={generate} disabled={busy || short}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Zkusit znovu ·{" "}
                  {credits(cost)}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="w-full"
              onClick={generate}
              disabled={busy || short || (!prompt.trim() && !reference)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {busy ? "Kreslím, může to chvíli trvat…" : `Vygenerovat · ${credits(cost)}`}
            </Button>
          )}
          <p className="text-center text-xs text-muted">
            Zůstatek: {credits(balance)}
            {short && " · na další obrázek nestačí, požádejte správce o doplnění."}
          </p>
        </div>
      )}

      {tab === "library" && (
        <PickGrid
          images={library}
          empty="Zatím tu nic není. Obrázek vygenerujte nebo nahrajte."
          onPick={pick}
          onReference={takeAsReference}
          onDelete={remove}
        />
      )}

      {tab === "shared" && (
        <div className="space-y-3">
          <p className="text-sm text-muted">Hotové obrázky pro všechny. Použít je můžete zdarma.</p>
          <PickGrid images={shared} empty="Knihovna je zatím prázdná." onPick={pick} onReference={takeAsReference} />
        </div>
      )}

      {tab === "upload" && (
        <div className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          {uploaded ? (
            <div className="space-y-3">
              <Thumb src={uploaded.url} className="mx-auto h-56 w-56" />
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => pick(uploaded)}>Použít tak, jak je (zdarma)</Button>
                <Button variant="secondary" onClick={() => takeAsReference(uploaded)}>
                  <Wand2 className="h-4 w-4" /> Překreslit na omalovánku · {credits(cost)}
                </Button>
              </div>
              <Button variant="ghost" className="w-full" onClick={() => setUploaded(null)}>
                Nahrát jiný
              </Button>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-10 text-muted hover:border-brand hover:text-brand"
            >
              {busy ? <Loader2 className="h-8 w-8 animate-spin" /> : <ImagePlus className="h-8 w-8" />}
              <span className="font-semibold">Vyberte obrázek z počítače</span>
              <span className="text-xs">PNG, JPG nebo WebP, nejvýš 10 MB</span>
            </button>
          )}
        </div>
      )}
    </Dialog>
  );
}
